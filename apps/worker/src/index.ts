import { Worker, Queue, type Job } from "bullmq";
import pino from "pino";
import {
  calendarSettings,
  checkinConfigs,
  createDbClient,
  jobExecutions,
  schedules,
  scheduledJobs,
  whatsappSessions,
  workspaces,
} from "@repo/database";
import { and, eq } from "drizzle-orm";
import { dateInTimezone } from "@repo/shared";
import { reminderTimes } from "./reminder-times.js";

const logger = pino({ level: process.env.LOG_LEVEL ?? "info" });

const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
const connection = { url: redisUrl };

const queue = new Queue("team-assistant", { connection });

const db = createDbClient(
  process.env.DATABASE_URL ??
    "postgres://teamassistant:teamassistant@localhost:5432/teamassistant",
);

const API_URL = process.env.INTERNAL_API_URL ?? "http://localhost:4000";
const INTERNAL_API_TOKEN =
  process.env.INTERNAL_API_TOKEN ?? "dev-internal-token";

// Daily report time, applied per workspace (timezone falls back to the env
// value when the workspace has no calendar settings).
const ENV_DAILY_REPORT_CRON = process.env.DAILY_REPORT_CRON ?? "0 17 * * 1-5";
const ENV_DAILY_REPORT_TZ = process.env.DAILY_REPORT_TIMEZONE ?? "Asia/Jakarta";

const JOB_ATTEMPTS = Number(process.env.SCHEDULER_JOB_ATTEMPTS ?? 3);
const JOB_BACKOFF_MS = Number(process.env.SCHEDULER_BACKOFF_MS ?? 30_000);
const RECONCILE_INTERVAL_MS = Number(
  process.env.SCHEDULER_RECONCILE_MS ?? 60_000,
);

const OWNED_PREFIXES = [
  "standup-prompts",
  "standup-reminders",
  "standup-summary",
  "standup-close",
  "daily-report",
  "checkin-prompts",
  "checkin-reminders",
  "checkin-close",
];

// Check-in jobs carry a checkin_configs id as their suffix.
const CHECKIN_PREFIXES = new Set(["checkin-prompts", "checkin-reminders", "checkin-close"]);

const API_PATHS: Record<string, string> = {
  "standup-prompts": "/standups/trigger",
  "standup-reminders": "/standups/reminders",
  "standup-summary": "/standups/summary",
  "standup-close": "/standups/close",
  "daily-report": "/reports/daily/notify",
  "checkin-prompts": "/checkins/trigger",
  "checkin-reminders": "/checkins/reminders",
  "checkin-close": "/checkins/close",
};

/**
 * Job names are `<baseName>:<suffix>[@HHmm]`: the suffix is the schedule id
 * for standup jobs and the workspace id for daily reports; reminders add the
 * time they run at, so each reminder of the day is its own repeatable. Legacy
 * `:env` jobs have no owner and yield a null suffix.
 */
function splitJobName(name: string): {
  baseName: string;
  suffix: string | null;
} {
  const separator = name.indexOf(":");
  if (separator === -1) return { baseName: name, suffix: null };
  const baseName = name.slice(0, separator);
  const suffix = name.slice(separator + 1).split("@")[0]!;
  return { baseName, suffix: suffix === "env" ? null : suffix };
}

function cronFor(timeOfDay: string, weekdays: number[]): string {
  const [hour = 0, minute = 0] = timeOfDay.split(":").map(Number);
  const days = [...new Set(weekdays)].sort((a, b) => a - b).join(",");
  return `${minute} ${hour} * * ${days || "*"}`;
}

type DesiredRepeatable = {
  name: string;
  pattern: string;
  tz: string;
  scheduleId: string | null;
  workspaceId: string;
};

async function desiredRepeatables(): Promise<DesiredRepeatable[]> {
  const rows = await db
    .select({ schedule: schedules })
    .from(schedules)
    .innerJoin(workspaces, eq(schedules.workspaceId, workspaces.id))
    .where(and(eq(schedules.isActive, true), eq(workspaces.isActive, true)));

  const desired: DesiredRepeatable[] = [];
  for (const { schedule } of rows) {
    const owner = { scheduleId: schedule.id, workspaceId: schedule.workspaceId };
    const tz = schedule.timezone || "Asia/Jakarta";
    const weekdays = Array.isArray(schedule.weekdays)
      ? (schedule.weekdays as number[])
      : null;

    if (schedule.timeOfDay && weekdays && weekdays.length > 0) {
      desired.push({
        name: `standup-prompts:${schedule.id}`,
        pattern: cronFor(schedule.timeOfDay, weekdays),
        tz,
        ...owner,
      });
      for (const time of reminderTimes({ ...schedule, timeOfDay: schedule.timeOfDay })) {
        desired.push({
          name: `standup-reminders:${schedule.id}@${time.replace(":", "")}`,
          pattern: cronFor(time, weekdays),
          tz,
          ...owner,
        });
      }
      if (schedule.summaryTime) {
        desired.push({
          name: `standup-summary:${schedule.id}`,
          pattern: cronFor(schedule.summaryTime, weekdays),
          tz,
          ...owner,
        });
      }
      if (schedule.closeTime) {
        desired.push({
          name: `standup-close:${schedule.id}`,
          pattern: cronFor(schedule.closeTime, weekdays),
          tz,
          ...owner,
        });
      }
    } else if (schedule.cronExpression) {
      desired.push({
        name: `standup-prompts:${schedule.id}`,
        pattern: schedule.cronExpression,
        tz,
        ...owner,
      });
    }
  }

  // One daily report per active workspace that has an active WhatsApp bot.
  const reportWorkspaces = await db
    .select({
      workspaceId: workspaces.id,
      timezone: calendarSettings.timezone,
    })
    .from(workspaces)
    .innerJoin(whatsappSessions, eq(whatsappSessions.workspaceId, workspaces.id))
    .leftJoin(calendarSettings, eq(calendarSettings.workspaceId, workspaces.id))
    .where(and(eq(workspaces.isActive, true), eq(whatsappSessions.isActive, true)));

  for (const row of reportWorkspaces) {
    desired.push({
      name: `daily-report:${row.workspaceId}`,
      pattern: ENV_DAILY_REPORT_CRON,
      tz: row.timezone || ENV_DAILY_REPORT_TZ,
      scheduleId: null,
      workspaceId: row.workspaceId,
    });
  }

  const checkins = await db
    .select({ config: checkinConfigs })
    .from(checkinConfigs)
    .innerJoin(workspaces, eq(checkinConfigs.workspaceId, workspaces.id))
    .where(and(eq(checkinConfigs.isActive, true), eq(workspaces.isActive, true)));

  for (const { config } of checkins) {
    const weekdays = Array.isArray(config.weekdays) ? (config.weekdays as number[]) : [];
    if (weekdays.length === 0) continue;
    // scheduleId stays null: scheduled_jobs.schedule_id references `schedules`.
    const owner = { scheduleId: null, workspaceId: config.workspaceId };
    const tz = config.timezone || "Asia/Jakarta";
    desired.push({
      name: `checkin-prompts:${config.id}`,
      pattern: cronFor(config.timeOfDay, weekdays),
      tz,
      ...owner,
    });
    for (const time of reminderTimes({ ...config, reminderRepeatMinutes: null })) {
      desired.push({
        name: `checkin-reminders:${config.id}@${time.replace(":", "")}`,
        pattern: cronFor(time, weekdays),
        tz,
        ...owner,
      });
    }
    if (config.closeTime) {
      desired.push({
        name: `checkin-close:${config.id}`,
        pattern: cronFor(config.closeTime, weekdays),
        tz,
        ...owner,
      });
    }
  }

  // Legacy global `:env` repeatables are no longer desired; they fall under
  // OWNED_PREFIXES, so reconcileSchedules removes them.
  return desired;
}

/**
 * Postgres is the source of truth for schedules: sync repeatable BullMQ jobs
 * from the `schedules` table and remove stale registrations. Runs at startup
 * and on an interval, so admin changes apply without a redeploy or restart.
 */
export async function reconcileSchedules(): Promise<void> {
  const desired = await desiredRepeatables();
  const desiredByName = new Map(desired.map((d) => [d.name, d]));

  for (const repeatable of await queue.getRepeatableJobs()) {
    const owned = OWNED_PREFIXES.some(
      (prefix) =>
        repeatable.name === prefix || repeatable.name.startsWith(`${prefix}:`),
    );
    if (!owned) continue;

    const wanted = desiredByName.get(repeatable.name);
    if (
      !wanted ||
      wanted.pattern !== repeatable.pattern ||
      wanted.tz !== (repeatable.tz ?? "UTC")
    ) {
      try {
        await queue.removeRepeatableByKey(repeatable.key);
      } catch {
        // already gone
      }
    }
  }

  const registered = new Set(
    (await queue.getRepeatableJobs()).map((r) => r.name),
  );

  for (const wanted of desired) {
    if (registered.has(wanted.name)) continue;
    await queue.add(
      wanted.name,
      { scheduleId: wanted.scheduleId, workspaceId: wanted.workspaceId },
      {
        repeat: { pattern: wanted.pattern, tz: wanted.tz },
        attempts: JOB_ATTEMPTS,
        backoff: { type: "exponential", delay: JOB_BACKOFF_MS },
        removeOnComplete: 100,
        removeOnFail: 200,
      },
    );
  }

  logger.info(
    { schedules: desired.map((d) => `${d.name} @ ${d.pattern} (${d.tz})`) },
    "Schedules reconciled",
  );
}

async function callApi(
  path: string,
  payload: Record<string, unknown>,
  workspaceId: string,
) {
  const response = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-internal-token": INTERNAL_API_TOKEN,
      "x-workspace-id": workspaceId,
    },
    body: JSON.stringify(payload),
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      `API ${path} failed: ${response.status} ${JSON.stringify(body)}`,
    );
  }
  return body;
}

type SchedulerJobResult = { skipped: true; reason: string } | unknown;

/**
 * Resolves the owning workspace at run time: repeatables registered before
 * multi-tenancy only carry a scheduleId, so the job data is not trusted.
 * Returns null when the owner is gone or inactive.
 */
async function resolveJobOwner(
  baseName: string,
  suffix: string | null,
  data: { scheduleId?: unknown } | undefined,
): Promise<{ workspaceId: string; scheduleId: string | null; configId?: string } | null> {
  if (baseName === "daily-report") {
    if (!suffix) return null;
    const [ws] = await db
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(and(eq(workspaces.id, suffix), eq(workspaces.isActive, true)))
      .limit(1);
    return ws ? { workspaceId: ws.id, scheduleId: null } : null;
  }

  if (CHECKIN_PREFIXES.has(baseName)) {
    if (!suffix) return null;
    const [row] = await db
      .select({ workspaceId: checkinConfigs.workspaceId })
      .from(checkinConfigs)
      .innerJoin(workspaces, eq(checkinConfigs.workspaceId, workspaces.id))
      .where(and(eq(checkinConfigs.id, suffix), eq(workspaces.isActive, true)))
      .limit(1);
    return row ? { workspaceId: row.workspaceId, scheduleId: null, configId: suffix } : null;
  }

  const scheduleId =
    suffix ?? (typeof data?.scheduleId === "string" ? data.scheduleId : null);
  if (!scheduleId) return null;
  const [row] = await db
    .select({ workspaceId: schedules.workspaceId })
    .from(schedules)
    .innerJoin(workspaces, eq(schedules.workspaceId, workspaces.id))
    .where(and(eq(schedules.id, scheduleId), eq(workspaces.isActive, true)))
    .limit(1);
  return row ? { workspaceId: row.workspaceId, scheduleId } : null;
}

/**
 * Executes one occurrence of a scheduled job with idempotency (SCH-010) and
 * execution history (SCH-009). Retries (SCH-008) reuse the same claim and add
 * one job_executions row per attempt.
 */
async function processSchedulerJob(job: Job): Promise<SchedulerJobResult> {
  const { baseName, suffix } = splitJobName(job.name);
  const apiPath = API_PATHS[baseName];
  if (!apiPath) return { skipped: true, reason: "unknown job name" };

  const owner = await resolveJobOwner(baseName, suffix, job.data);
  if (!owner) {
    return { skipped: true, reason: "workspace missing or inactive" };
  }
  const { workspaceId, scheduleId, configId } = owner;

  const manual = job.data?.manual === true;
  const date = dateInTimezone();
  const idempotencyKey = manual
    ? `${job.name}:manual:${job.id}`
    : `${job.name}:${date}`;

  const [existing] = await db
    .select()
    .from(scheduledJobs)
    .where(eq(scheduledJobs.idempotencyKey, idempotencyKey))
    .limit(1);
  if (existing?.status === "completed") {
    return { skipped: true, reason: "already completed" };
  }

  let claimId = existing?.id;
  if (!claimId) {
    const [claimed] = await db
      .insert(scheduledJobs)
      .values({
        workspaceId,
        scheduleId: scheduleId ?? undefined,
        name: baseName,
        payload: { date, manual },
        scheduledAt: new Date(),
        status: "running",
        idempotencyKey,
      })
      .onConflictDoNothing()
      .returning({ id: scheduledJobs.id });
    if (!claimed) {
      return { skipped: true, reason: "claimed by another worker" };
    }
    claimId = claimed.id;
  }

  const [execution] = await db
    .insert(jobExecutions)
    .values({ jobId: claimId, status: "running", startedAt: new Date() })
    .returning({ id: jobExecutions.id });

  try {
    const result = await callApi(
      apiPath,
      { ...(manual ? { resend: true } : {}), ...(configId ? { configId } : {}) },
      workspaceId,
    );
    if (execution) {
      await db
        .update(jobExecutions)
        .set({ status: "completed", finishedAt: new Date() })
        .where(eq(jobExecutions.id, execution.id));
    }
    await db
      .update(scheduledJobs)
      .set({ status: "completed" })
      .where(eq(scheduledJobs.id, claimId));
    return result;
  } catch (error) {
    if (execution) {
      await db
        .update(jobExecutions)
        .set({
          status: "failed",
          finishedAt: new Date(),
          error: error instanceof Error ? error.message : String(error),
        })
        .where(eq(jobExecutions.id, execution.id));
    }
    const attempts = job.opts.attempts ?? 1;
    if (job.attemptsMade + 1 >= attempts) {
      await db
        .update(scheduledJobs)
        .set({ status: "failed" })
        .where(eq(scheduledJobs.id, claimId));
    }
    throw error;
  }
}

logger.info("Worker starting...");

const worker = new Worker(
  "team-assistant",
  async (job) => {
    const { baseName } = splitJobName(job.name);
    if (baseName in API_PATHS) {
      return processSchedulerJob(job);
    }
    logger.info({ name: job.name, id: job.id }, "Processing job");
    return null;
  },
  { connection },
);

worker.on("completed", (job) => {
  logger.info({ id: job.id }, "Job completed");
});

worker.on("failed", (job, err) => {
  logger.error({ id: job?.id, err }, "Job failed");
});

if (import.meta.main) {
  await reconcileSchedules();
  const reconcileTimer = setInterval(() => {
    reconcileSchedules().catch((err) =>
      logger.error({ err }, "Schedule reconcile failed"),
    );
  }, RECONCILE_INTERVAL_MS);
  reconcileTimer.unref?.();

  const repeatable = await queue.getRepeatableJobs();
  logger.info({ repeatable }, "Repeatable jobs registered");
  logger.info("Worker running");
}

export { queue, worker, callApi };
