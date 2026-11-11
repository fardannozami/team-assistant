import { createDbClient, schedules } from "@repo/database";
import { and, asc, eq } from "drizzle-orm";
import { STANDUP_SCHEDULE_NAME } from "@repo/shared";
import { schedulerQueue } from "../../lib/queue.js";
import { HttpError } from "../../lib/http-error.js";
import { audit } from "../auth/index.js";
import type { CreateScheduleInput, UpdateScheduleInput } from "@repo/shared";

const db = createDbClient(
  process.env.DATABASE_URL ??
    "postgres://teamassistant:teamassistant@localhost:5432/teamassistant",
);

function assertValidTimezone(timezone: string) {
  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone });
  } catch {
    throw new HttpError(400, `Unknown time zone: ${timezone}`);
  }
}

function scheduleWhere(workspaceId: string, id: string) {
  return and(eq(schedules.id, id), eq(schedules.workspaceId, workspaceId));
}

export async function listSchedules(workspaceId: string) {
  return db
    .select()
    .from(schedules)
    .where(eq(schedules.workspaceId, workspaceId))
    .orderBy(asc(schedules.name));
}

export async function getSchedule(workspaceId: string, id: string) {
  const [schedule] = await db
    .select()
    .from(schedules)
    .where(scheduleWhere(workspaceId, id))
    .limit(1);
  if (!schedule) throw new HttpError(404, "Schedule not found");
  return schedule;
}

export async function createSchedule(
  workspaceId: string,
  input: CreateScheduleInput,
  actorId?: string | null,
) {
  assertValidTimezone(input.timezone ?? "Asia/Jakarta");

  const [created] = await db
    .insert(schedules)
    .values({
      workspaceId,
      name: input.name,
      timeOfDay: input.timeOfDay,
      weekdays: input.weekdays,
      timezone: input.timezone ?? "Asia/Jakarta",
      reminderMinutes: input.reminderMinutes ?? null,
      isActive: true,
    })
    .onConflictDoNothing({ target: [schedules.workspaceId, schedules.name] })
    .returning();

  if (!created) {
    throw new HttpError(409, `Schedule "${input.name}" already exists`);
  }

  await audit(
    workspaceId,
    actorId ?? null,
    "schedule.create",
    "schedule",
    created.id,
    {
      name: input.name,
      timeOfDay: input.timeOfDay,
      weekdays: input.weekdays,
      timezone: created.timezone,
    },
  );

  return created;
}

export async function updateSchedule(
  workspaceId: string,
  id: string,
  input: UpdateScheduleInput,
  actorId?: string | null,
) {
  await getSchedule(workspaceId, id);
  if (input.timezone) assertValidTimezone(input.timezone);

  const changes: Partial<typeof schedules.$inferInsert> = {
    updatedAt: new Date(),
  };
  if (input.name !== undefined) changes.name = input.name;
  if (input.timeOfDay !== undefined) changes.timeOfDay = input.timeOfDay;
  if (input.weekdays !== undefined) changes.weekdays = input.weekdays;
  if (input.timezone !== undefined) changes.timezone = input.timezone;
  if (input.reminderMinutes !== undefined) {
    changes.reminderMinutes = input.reminderMinutes;
  }
  if (input.isActive !== undefined) changes.isActive = input.isActive;

  try {
    const [updated] = await db
      .update(schedules)
      .set(changes)
      .where(scheduleWhere(workspaceId, id))
      .returning();
    if (!updated) throw new Error("Failed to update schedule");
    await audit(
      workspaceId,
      actorId ?? null,
      "schedule.update",
      "schedule",
      id,
      input,
    );
    return updated;
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      (error as { code?: string }).code === "23505"
    ) {
      throw new HttpError(409, `Schedule "${input.name}" already exists`);
    }
    throw error;
  }
}

export async function deleteSchedule(
  workspaceId: string,
  id: string,
  actorId?: string | null,
) {
  const existing = await getSchedule(workspaceId, id);
  await db.delete(schedules).where(scheduleWhere(workspaceId, id));
  await audit(workspaceId, actorId ?? null, "schedule.delete", "schedule", id, {
    name: existing.name,
  });
}

const JOB_ATTEMPTS = Number(process.env.SCHEDULER_JOB_ATTEMPTS ?? 3);
const JOB_BACKOFF_MS = Number(process.env.SCHEDULER_BACKOFF_MS ?? 30_000);

/**
 * SCH-007: enqueue the schedule's job right now. The worker executes it with
 * its own idempotency + execution history, so this is safe to call anytime.
 */
export async function triggerSchedule(
  workspaceId: string,
  id: string,
  actorId?: string | null,
) {
  const schedule = await getSchedule(workspaceId, id);

  await schedulerQueue.add(
    `standup-prompts:${schedule.id}`,
    { scheduleId: schedule.id, workspaceId, manual: true },
    {
      attempts: JOB_ATTEMPTS,
      backoff: { type: "exponential", delay: JOB_BACKOFF_MS },
      removeOnComplete: 100,
      removeOnFail: 200,
    },
  );

  await audit(workspaceId, actorId ?? null, "schedule.trigger", "schedule", id, {
    name: schedule.name,
  });

  return { queued: true, scheduleId: schedule.id };
}

/**
 * Admin-facing helper (WhatsApp `SET SCHEDULE` / `SET REMINDER`): update the
 * standup schedule, creating the default row when it does not exist yet.
 */
export async function upsertStandupSchedule(
  workspaceId: string,
  patch: {
    timeOfDay?: string;
    weekdays?: number[];
    timezone?: string;
    reminderMinutes?: number | null;
    isActive?: boolean;
  },
  actorId?: string | null,
) {
  const [existing] = await db
    .select()
    .from(schedules)
    .where(
      and(
        eq(schedules.workspaceId, workspaceId),
        eq(schedules.name, STANDUP_SCHEDULE_NAME),
      ),
    )
    .limit(1);

  if (!existing) {
    return createSchedule(
      workspaceId,
      {
        name: STANDUP_SCHEDULE_NAME,
        timeOfDay: patch.timeOfDay ?? "09:00",
        weekdays: patch.weekdays ?? [1, 2, 3, 4, 5],
        timezone: patch.timezone,
        reminderMinutes: patch.reminderMinutes ?? null,
      },
      actorId,
    );
  }

  return updateSchedule(
    workspaceId,
    existing.id,
    {
      timeOfDay: patch.timeOfDay,
      weekdays: patch.weekdays,
      timezone: patch.timezone,
      reminderMinutes: patch.reminderMinutes,
      isActive: patch.isActive,
    },
    actorId,
  );
}
