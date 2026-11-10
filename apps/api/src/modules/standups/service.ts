import { createDbClient, employees, standupAnswers, standupSessions, standups, teams } from "@repo/database";
import { and, eq, inArray } from "drizzle-orm";
import { dateInTimezone } from "@repo/shared";
import { sendText } from "../whatsapp/service.js";
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

function jidFor(phone: string) {
  return `${phone}@s.whatsapp.net`;
}

/**
 * Sends the daily standup prompt to every active employee who does not have
 * a session for the date yet. Pass `send` to override transport (tests, or a
 * future queue processor).
 */
export async function sendStandupPrompts(
  options: {
    employeeId?: string;
    date?: string;
    send?: SendFn;
    force?: boolean;
  } = {},
) {
  const send = options.send ?? sendText;
  const date = options.date ?? dateInTimezone();

  if (!options.force) {
    const { isExcludedDate } = await import("../holidays/service.js");
    const check = await isExcludedDate(date);
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
    const employee = await getEmployee(options.employeeId);
    if (!employee) throw new HttpError(404, "Employee not found");
    if (!employee.isActive) throw new HttpError(400, "Employee is not active");
    targets = [employee];
  } else {
    targets = await listEmployees({ active: true });
  }

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const employee of targets) {
    const existing = await getStandupSession(employee.id, date);
    if (existing) {
      skipped++;
      continue;
    }

    const [created] = await db
      .insert(standupSessions)
      .values({ employeeId: employee.id, date, status: "pending" })
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

export async function sendStandupReminders(
  options: { date?: string; send?: SendFn } = {},
) {
  const send = options.send ?? sendText;
  const date = options.date ?? dateInTimezone();

  const rows = await db
    .select({
      phone: employees.phone,
      name: employees.name,
    })
    .from(standupSessions)
    .innerJoin(employees, eq(standupSessions.employeeId, employees.id))
    .where(
      and(
        eq(standupSessions.date, date),
        inArray(standupSessions.status, ["pending", "in_progress"]),
        eq(employees.isActive, true),
      ),
    );

  let sent = 0;
  let failed = 0;

  for (const row of rows) {
    try {
      await send(jidFor(row.phone), standupReminderText(date));
      sent++;
    } catch {
      failed++;
    }
  }

  return { date, sent, failed };
}

export async function listStandupsByDate(date: string) {
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
    .where(eq(standupSessions.date, date))
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
