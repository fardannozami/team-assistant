import {
  checkinAnswers,
  checkinConfigs,
  checkinSessions,
  createDbClient,
  employees,
  teams,
} from "@repo/database";
import { and, desc, eq, inArray, lt } from "drizzle-orm";
import {
  CHECKIN_KINDS,
  dateInTimezone,
  parseMoodScore,
  type CheckinKind,
  type CheckinQuestion,
  type SaveCheckinConfigInput,
} from "@repo/shared";
import pino from "pino";
import { getWhatsAppStatus, sendText } from "../whatsapp/service.js";
import { standupTargets } from "../standups/service.js";
import { audit } from "../auth/index.js";
import { HttpError } from "../../lib/http-error.js";
import { CHECKIN_DEFAULTS, MOTIVATION_QUOTES } from "./defaults.js";
import {
  checkinPromptText,
  checkinReminderText,
  getCheckinAnswers,
  nextQuestionIndex,
} from "./engine.js";

const logger = pino({ level: process.env.LOG_LEVEL ?? "info" });

const db = createDbClient(
  process.env.DATABASE_URL ??
    "postgres://teamassistant:teamassistant@localhost:5432/teamassistant",
);

type SendFn = (jid: string, text: string) => Promise<void>;

const OPEN_STATUSES = ["pending", "in_progress"];

function jidFor(phone: string) {
  return `${phone}@s.whatsapp.net`;
}

/** Saved configs, or the defaults (inactive, id null) for kinds never saved. */
export async function getCheckinConfigs(workspaceId: string) {
  const rows = await db
    .select()
    .from(checkinConfigs)
    .where(eq(checkinConfigs.workspaceId, workspaceId));
  return CHECKIN_KINDS.map((kind) => {
    const row = rows.find((r) => r.kind === kind);
    if (row) return row;
    return {
      id: null,
      kind,
      timezone: "Asia/Jakarta",
      isActive: false,
      ...CHECKIN_DEFAULTS[kind],
    };
  });
}

async function findConfig(workspaceId: string, by: { kind?: CheckinKind; configId?: string }) {
  const [row] = await db
    .select()
    .from(checkinConfigs)
    .where(
      and(
        eq(checkinConfigs.workspaceId, workspaceId),
        by.configId ? eq(checkinConfigs.id, by.configId) : eq(checkinConfigs.kind, by.kind!),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function saveCheckinConfig(
  workspaceId: string,
  kind: CheckinKind,
  input: SaveCheckinConfigInput,
  actorId?: string | null,
) {
  const timezone = input.timezone ?? "Asia/Jakarta";
  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone });
  } catch {
    throw new HttpError(400, `Unknown time zone: ${timezone}`);
  }
  if (input.closeTime && input.closeTime <= input.timeOfDay) {
    throw new HttpError(400, `Jam tutup (${input.closeTime}) harus setelah jam kirim (${input.timeOfDay}).`);
  }

  const values = {
    weekdays: input.weekdays,
    timeOfDay: input.timeOfDay,
    timezone,
    reminderMinutes: input.reminderMinutes ?? null,
    closeTime: input.closeTime ?? null,
    questions: input.questions,
    isActive: input.isActive,
    updatedAt: new Date(),
  };
  const [saved] = await db
    .insert(checkinConfigs)
    .values({ workspaceId, kind, ...values })
    .onConflictDoUpdate({ target: [checkinConfigs.workspaceId, checkinConfigs.kind], set: values })
    .returning();
  await audit(workspaceId, actorId ?? null, "checkin.config", "checkin_config", saved!.id, { kind, ...input });
  return saved!;
}

const motivationCache = new Map<string, string>();

function fallbackQuote(seed: string) {
  let hash = 0;
  for (const ch of seed) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return MOTIVATION_QUOTES[hash % MOTIVATION_QUOTES.length]!;
}

/**
 * One motivational line per workspace per day: written by the workspace's AI
 * when it has a key, otherwise picked from the built-in list.
 */
export async function motivationFor(workspaceId: string, date: string) {
  const cacheKey = `${workspaceId}:${date}`;
  const cached = motivationCache.get(cacheKey);
  if (cached) return cached;

  let quote = fallbackQuote(cacheKey);
  if (process.env.AI_ENABLED !== "false") {
    try {
      const { resolveAiConfig } = await import("../ai/settings.js");
      const { chatWithTools } = await import("../ai/client.js");
      const config = await resolveAiConfig(workspaceId);
      if (config) {
        const result = await chatWithTools(
          config,
          [
            {
              role: "system",
              content:
                "Tulis satu kalimat motivasi kerja yang singkat dan hangat dalam Bahasa Indonesia untuk tim di awal minggu. Boleh kutipan tokoh terkenal yang benar-benar ada (sebutkan namanya) atau kalimat orisinal. Maksimal 30 kata. Jawab hanya kalimatnya, tanpa tanda kutip atau penjelasan.",
            },
            { role: "user", content: `Tanggal: ${date}` },
          ],
          [],
          { temperature: 0.9 },
        );
        const text = (result.message.content ?? "").trim().replace(/^["“]|["”]$/g, "");
        if (text && text.length <= 300) quote = text;
      }
    } catch (error) {
      logger.warn({ workspaceId, err: error }, "AI motivation failed; using built-in quote");
    }
  }
  motivationCache.set(cacheKey, quote);
  return quote;
}

type RunOptions = { kind?: CheckinKind; configId?: string; send?: SendFn };

async function resolveRun(workspaceId: string, options: RunOptions) {
  if (!options.kind && !options.configId) throw new HttpError(400, "kind or configId is required");
  const config = await findConfig(workspaceId, options);
  if (!config) throw new HttpError(404, "Check-in is not configured yet");
  const send: SendFn = options.send ?? ((jid, text) => sendText(workspaceId, jid, text));
  return { config, kind: config.kind as CheckinKind, send, date: dateInTimezone(config.timezone) };
}

const NOT_CONNECTED = { sent: 0, failed: 0, whatsappConnected: false, reason: "WhatsApp is not connected for this workspace" } as const;

/**
 * Opens this period's check-in for every standup target and sends the first
 * question. Older open sessions of the same kind are closed as missed. A
 * manual run (`resend`) also works while the config is paused, and re-asks
 * people whose session is still open.
 */
export async function sendCheckinPrompts(
  workspaceId: string,
  options: RunOptions & { resend?: boolean; force?: boolean } = {},
) {
  const { config, kind, send, date } = await resolveRun(workspaceId, options);
  if (!config.isActive && !options.resend) return { kind, date, sent: 0, skipped: 0, failed: 0, inactive: true };
  if (!options.send && !getWhatsAppStatus(workspaceId).connected) return { kind, date, ...NOT_CONNECTED, skipped: 0 };

  if (!options.force) {
    const { isExcludedDate } = await import("../holidays/service.js");
    const check = await isExcludedDate(workspaceId, date);
    if (check.excluded) return { kind, date, sent: 0, skipped: 0, failed: 0, excluded: true, reason: check.reason };
  }

  await db
    .update(checkinSessions)
    .set({ status: "missed", updatedAt: new Date() })
    .where(
      and(
        eq(checkinSessions.workspaceId, workspaceId),
        eq(checkinSessions.kind, kind),
        inArray(checkinSessions.status, OPEN_STATUSES),
        lt(checkinSessions.date, date),
      ),
    );

  const questions = config.questions as CheckinQuestion[];
  const motivation = kind === "icebreaker" ? await motivationFor(workspaceId, date) : null;

  let sent = 0;
  let skipped = 0;
  let failed = 0;
  for (const employee of await standupTargets(workspaceId)) {
    const [existing] = await db
      .select()
      .from(checkinSessions)
      .where(and(eq(checkinSessions.employeeId, employee.id), eq(checkinSessions.kind, kind), eq(checkinSessions.date, date)))
      .limit(1);

    if (existing) {
      if (!options.resend || !OPEN_STATUSES.includes(existing.status)) {
        skipped++;
        continue;
      }
      const snapshot = existing.questions as CheckinQuestion[];
      const next = nextQuestionIndex(snapshot, await getCheckinAnswers(existing.id));
      try {
        await send(jidFor(employee.phone), checkinReminderText(kind, snapshot, next));
        sent++;
      } catch {
        failed++;
      }
      continue;
    }

    const [created] = await db
      .insert(checkinSessions)
      .values({ workspaceId, configId: config.id, employeeId: employee.id, kind, date, questions, motivation })
      .onConflictDoNothing()
      .returning({ id: checkinSessions.id });
    if (!created) {
      skipped++;
      continue;
    }
    try {
      await send(jidFor(employee.phone), checkinPromptText(kind, { name: employee.name, questions, motivation }));
      sent++;
    } catch {
      await db.delete(checkinSessions).where(eq(checkinSessions.id, created.id));
      failed++;
    }
  }
  return { kind, date, sent, skipped, failed };
}

async function openSessionsToday(workspaceId: string, kind: CheckinKind, date: string) {
  return db
    .select({ session: checkinSessions, phone: employees.phone })
    .from(checkinSessions)
    .innerJoin(employees, eq(checkinSessions.employeeId, employees.id))
    .where(
      and(
        eq(checkinSessions.workspaceId, workspaceId),
        eq(checkinSessions.kind, kind),
        eq(checkinSessions.date, date),
        inArray(checkinSessions.status, OPEN_STATUSES),
        eq(employees.isActive, true),
      ),
    );
}

/** Re-asks the current question to everyone who has not finished today's check-in. */
export async function sendCheckinReminders(workspaceId: string, options: RunOptions = {}) {
  const { kind, send, date } = await resolveRun(workspaceId, options);
  if (!options.send && !getWhatsAppStatus(workspaceId).connected) return { kind, date, ...NOT_CONNECTED };

  let sent = 0;
  let failed = 0;
  for (const { session, phone } of await openSessionsToday(workspaceId, kind, date)) {
    const questions = session.questions as CheckinQuestion[];
    const next = nextQuestionIndex(questions, await getCheckinAnswers(session.id));
    if (next === -1) continue;
    try {
      await send(jidFor(phone), checkinReminderText(kind, questions, next));
      sent++;
    } catch {
      failed++;
    }
  }
  return { kind, date, sent, failed };
}

/** Unfinished check-ins of today become "missed"; late replies are ignored. */
export async function closeCheckins(workspaceId: string, options: RunOptions = {}) {
  const { kind, date } = await resolveRun(workspaceId, options);
  const open = await openSessionsToday(workspaceId, kind, date);
  if (open.length) {
    await db
      .update(checkinSessions)
      .set({ status: "missed", updatedAt: new Date() })
      .where(inArray(checkinSessions.id, open.map((o) => o.session.id)));
  }
  return { kind, date, missed: open.length };
}

/** Answers of one check-in period (default: the latest), for the dashboard. */
export async function listCheckinResponses(workspaceId: string, kind: CheckinKind, date?: string) {
  const recent = await db
    .selectDistinct({ date: checkinSessions.date })
    .from(checkinSessions)
    .where(and(eq(checkinSessions.workspaceId, workspaceId), eq(checkinSessions.kind, kind)))
    .orderBy(desc(checkinSessions.date))
    .limit(12);
  const dates = recent.map((r) => r.date);
  const selected = date ?? dates[0] ?? null;
  if (!selected) return { kind, date: null, dates, questions: [], rows: [], averageMood: null };

  const sessions = await db
    .select({
      session: checkinSessions,
      employeeName: employees.name,
      teamName: teams.name,
    })
    .from(checkinSessions)
    .innerJoin(employees, eq(checkinSessions.employeeId, employees.id))
    .leftJoin(teams, eq(employees.teamId, teams.id))
    .where(
      and(
        eq(checkinSessions.workspaceId, workspaceId),
        eq(checkinSessions.kind, kind),
        eq(checkinSessions.date, selected),
      ),
    )
    .orderBy(employees.name);

  const answers = sessions.length
    ? await db
        .select()
        .from(checkinAnswers)
        .where(inArray(checkinAnswers.sessionId, sessions.map((s) => s.session.id)))
    : [];

  // Union of the snapshots, in order: they only differ if the config changed mid-period.
  const questions: CheckinQuestion[] = [];
  for (const { session } of sessions) {
    for (const q of session.questions as CheckinQuestion[]) {
      if (!questions.some((x) => x.key === q.key)) questions.push(q);
    }
  }
  const moodKey = questions.find((q) => q.type === "mood")?.key;

  const rows = sessions.map(({ session, employeeName, teamName }) => {
    const own = Object.fromEntries(
      answers.filter((a) => a.sessionId === session.id).map((a) => [a.questionKey, a.answer]),
    );
    return {
      employeeId: session.employeeId,
      employeeName,
      teamName,
      status: session.status,
      answers: own,
      mood: moodKey && own[moodKey] ? parseMoodScore(own[moodKey]) : null,
      motivation: session.motivation,
    };
  });
  const moods = rows.map((r) => r.mood).filter((m): m is number => m !== null);
  const averageMood = moods.length ? Math.round((moods.reduce((a, b) => a + b, 0) / moods.length) * 10) / 10 : null;

  return { kind, date: selected, dates, questions, rows, averageMood };
}
