import { createDbClient, employees, standupAnswers, standupSessions, standups, teams } from "@repo/database";
import { and, eq, inArray } from "drizzle-orm";
import { CORE_STANDUP_ELEMENTS, dateInTimezone, isAdminRole, type StandupElement } from "@repo/shared";
import { getWhatsAppStatus, sendText } from "../whatsapp/service.js";
import { getEmployee, listEmployees } from "../employees/service.js";
import { HttpError } from "../../lib/http-error.js";
import { isUniqueViolation } from "../../lib/db.js";
import {
  getStandupSession,
  standupPromptText,
  standupReminderText,
} from "./engine.js";

const db = createDbClient(
  process.env.DATABASE_URL ??
    "postgres://teamassistant:teamassistant@localhost:5432/teamassistant",
);

type SendFn = (jid: string, text: string) => Promise<void>;

// Returned instead of creating sessions whose prompts could not be sent.
const NOT_CONNECTED = {
  sent: 0,
  failed: 0,
  whatsappConnected: false,
  reason: "WhatsApp is not connected for this workspace",
} as const;

function jidFor(phone: string) {
  return `${phone}@s.whatsapp.net`;
}

/**
 * Sends the daily standup prompt to every active employee who does not have
 * a session for the date yet. Pass `send` to override transport (tests, or a
 * future queue processor).
 */
export async function sendStandupPrompts(
  workspaceId: string,
  options: {
    employeeId?: string;
    date?: string;
    send?: SendFn;
    force?: boolean;
    resend?: boolean;
  } = {},
) {
  const send: SendFn =
    options.send ?? ((jid, text) => sendText(workspaceId, jid, text));
  const date = options.date ?? dateInTimezone();

  if (!options.send && !getWhatsAppStatus(workspaceId).connected) {
    return { date, ...NOT_CONNECTED, skipped: 0 };
  }

  if (!options.force) {
    const { isExcludedDate } = await import("../holidays/service.js");
    const check = await isExcludedDate(workspaceId, date);
    if (check.excluded) {
      return {
        date,
        sent: 0,
        skipped: 0,
        failed: 0,
        excluded: true,
        reason: check.reason,
      };
    }
  }

  let targets;
  if (options.employeeId) {
    const employee = await getEmployee(workspaceId, options.employeeId);
    if (!employee) throw new HttpError(404, "Employee not found");
    if (!employee.isActive) throw new HttpError(400, "Employee is not active");
    targets = [employee];
  } else {
    targets = await standupTargets(workspaceId);
  }

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const employee of targets) {
    const existing = await getStandupSession(employee.id, date);
    if (existing) {
      // Manual triggers may resend to sessions that are still open so the
      // admin gets an immediate prompt without waiting for the cron.
      if (
        options.resend &&
        (existing.status === "pending" || existing.status === "in_progress")
      ) {
        try {
          await send(jidFor(employee.phone), standupPromptText(date));
          sent++;
        } catch {
          failed++;
        }
        continue;
      }
      skipped++;
      continue;
    }

    const [created] = await db
      .insert(standupSessions)
      .values({ workspaceId, employeeId: employee.id, date, status: "pending" })
      .onConflictDoNothing()
      .returning({ id: standupSessions.id });

    if (!created) {
      skipped++;
      continue;
    }

    try {
      await send(jidFor(employee.phone), standupPromptText(date));
      sent++;
    } catch {
      await db
        .delete(standupSessions)
        .where(eq(standupSessions.id, created.id));
      failed++;
    }
  }

  return { date, sent, skipped, failed };
}

/** Employees expected to send a standup: active, admins only when enabled. */
export async function standupTargets(workspaceId: string) {
  const active = await listEmployees(workspaceId, { active: true });
  if (process.env.STANDUP_INCLUDE_ADMINS === "true") return active;
  return active.filter((employee) => !isAdminRole(employee.roleName));
}

/** Who still owes today's standup, and which answers each one is missing. */
async function standupProgress(workspaceId: string, date: string) {
  const [targets, sessions] = await Promise.all([
    standupTargets(workspaceId),
    listStandupsByDate(workspaceId, date),
  ]);
  const byEmployee = new Map(sessions.map((s) => [s.employeeId, s]));
  // Anyone with an open session counts too, e.g. an admin who typed STANDUP.
  const people = new Map(targets.map((t) => [t.id, { id: t.id, name: t.name, phone: t.phone }]));
  for (const s of sessions) {
    if (!people.has(s.employeeId) && (s.status === "pending" || s.status === "in_progress")) {
      people.set(s.employeeId, { id: s.employeeId, name: s.employeeName, phone: s.employeePhone });
    }
  }
  return [...people.values()].map((person) => {
    const session = byEmployee.get(person.id) ?? null;
    const missing = CORE_STANDUP_ELEMENTS.filter((key) => !session?.answers[key]);
    return { ...person, session, missing };
  });
}

async function excludedDay(workspaceId: string, date: string) {
  const { isExcludedDate } = await import("../holidays/service.js");
  return (await isExcludedDate(workspaceId, date)).excluded;
}

/**
 * Reminds everyone who has not finished today's standup, asking only for the
 * missing answers. Employees without a session yet (e.g. the prompt failed)
 * get one now, so they can still answer.
 */
export async function sendStandupReminders(
  workspaceId: string,
  options: { date?: string; send?: SendFn } = {},
) {
  const send: SendFn =
    options.send ?? ((jid, text) => sendText(workspaceId, jid, text));
  const date = options.date ?? dateInTimezone();

  if (!options.send && !getWhatsAppStatus(workspaceId).connected) {
    return { date, ...NOT_CONNECTED, created: 0 };
  }
  if (await excludedDay(workspaceId, date)) {
    return { date, sent: 0, failed: 0, created: 0, excluded: true };
  }

  let sent = 0;
  let failed = 0;
  let created = 0;

  for (const person of await standupProgress(workspaceId, date)) {
    const status = person.session?.status;
    if (status === "completed" || status === "missed") continue;

    let newSessionId: string | null = null;
    if (!person.session) {
      const [row] = await db
        .insert(standupSessions)
        .values({ workspaceId, employeeId: person.id, date, status: "pending" })
        .onConflictDoNothing()
        .returning({ id: standupSessions.id });
      if (!row) continue;
      newSessionId = row.id;
    }

    try {
      await send(jidFor(person.phone), standupReminderText(date, person.missing));
      sent++;
      if (newSessionId) created++;
    } catch {
      // Without a delivered prompt the session would block tomorrow's logic; drop it.
      if (newSessionId) await db.delete(standupSessions).where(eq(standupSessions.id, newSessionId));
      failed++;
    }
  }

  return { date, sent, failed, created };
}

/**
 * Closes the day: unfinished standups become "missed", and so does everyone
 * who never started, so late answers are no longer collected.
 */
export async function closeStandups(workspaceId: string, options: { date?: string } = {}) {
  const date = options.date ?? dateInTimezone();
  if (await excludedDay(workspaceId, date)) return { date, missed: 0, excluded: true };

  let missed = 0;
  for (const person of await standupProgress(workspaceId, date)) {
    const status = person.session?.status;
    if (status === "completed" || status === "missed") continue;
    if (person.session) {
      await db
        .update(standupSessions)
        .set({ status: "missed", updatedAt: new Date() })
        .where(eq(standupSessions.id, person.session.sessionId));
    } else {
      await db
        .insert(standupSessions)
        .values({ workspaceId, employeeId: person.id, date, status: "missed" })
        .onConflictDoNothing();
    }
    missed++;
  }
  return { date, missed };
}

const MISSING_LABEL: Record<StandupElement, string> = {
  yesterday: "kemarin",
  today: "hari ini",
  blockers: "kendala",
};

/** Sends admins the list of who has not finished today's standup yet. */
export async function sendStandupSummary(
  workspaceId: string,
  options: { date?: string; send?: SendFn } = {},
) {
  const send: SendFn =
    options.send ?? ((jid, text) => sendText(workspaceId, jid, text));
  const date = options.date ?? dateInTimezone();

  if (!options.send && !getWhatsAppStatus(workspaceId).connected) {
    return { date, ...NOT_CONNECTED, pending: 0 };
  }
  if (await excludedDay(workspaceId, date)) {
    return { date, sent: 0, failed: 0, pending: 0, excluded: true };
  }

  const progress = await standupProgress(workspaceId, date);
  const pending = progress.filter((p) => p.session?.status !== "completed");
  const done = progress.length - pending.length;
  const describe = (p: (typeof pending)[number]) => {
    const status = p.session?.status;
    if (status === "missed") return "tidak mengisi";
    if (!p.session || p.missing.length === CORE_STANDUP_ELEMENTS.length) return "belum mulai";
    return `kurang ${p.missing.map((k) => MISSING_LABEL[k]).join(", ")}`;
  };
  const text = pending.length
    ? [
        `Standup ${date}: ${done} dari ${progress.length} sudah mengisi.`,
        "Belum selesai:",
        ...pending.map((p) => `- ${p.name}: ${describe(p)}`),
      ].join("\n")
    : `Standup ${date}: semua (${progress.length}) sudah mengisi 🎉`;

  const admins = (await listEmployees(workspaceId, { active: true })).filter((e) => isAdminRole(e.roleName));
  let sent = 0;
  let failed = 0;
  for (const admin of admins) {
    try {
      await send(jidFor(admin.phone), text);
      sent++;
    } catch {
      failed++;
    }
  }
  return { date, sent, failed, pending: pending.length };
}

export async function listStandupsByDate(workspaceId: string, date: string) {
  const rows = await db
    .select({
      sessionId: standupSessions.id,
      status: standupSessions.status,
      employeeId: employees.id,
      employeeName: employees.name,
      employeePhone: employees.phone,
      teamName: teams.name,
      standupId: standups.id,
      questionKey: standupAnswers.questionKey,
      answer: standupAnswers.answer,
    })
    .from(standupSessions)
    .innerJoin(employees, eq(standupSessions.employeeId, employees.id))
    .leftJoin(teams, eq(employees.teamId, teams.id))
    .leftJoin(standups, eq(standups.sessionId, standupSessions.id))
    .leftJoin(standupAnswers, eq(standupAnswers.standupId, standups.id))
    .where(
      and(
        eq(standupSessions.workspaceId, workspaceId),
        eq(standupSessions.date, date),
      ),
    )
    .orderBy(employees.name);

  const grouped = new Map<
    string,
    {
      sessionId: string;
      status: string;
      employeeId: string;
      employeeName: string;
      employeePhone: string;
      teamName: string | null;
      standupId: string | null;
      answers: Record<string, string>;
    }
  >();

  for (const row of rows) {
    const entry = grouped.get(row.sessionId) ?? {
      sessionId: row.sessionId,
      status: row.status,
      employeeId: row.employeeId,
      employeeName: row.employeeName,
      employeePhone: row.employeePhone,
      teamName: row.teamName,
      standupId: row.standupId,
      answers: {},
    };
    if (row.questionKey && row.answer) {
      entry.answers[row.questionKey] = row.answer;
    }
    grouped.set(row.sessionId, entry);
  }

  return [...grouped.values()];
}
