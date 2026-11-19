import { standupSessions } from "@repo/database";
import { and, eq } from "drizzle-orm";
import { getEmployee } from "../../employees/service.js";
import { HttpError } from "../../../lib/http-error.js";
import { closeStaleCheckouts, getStandupSession, openingText, standupTimezone, standupToday } from "../engine.js";
import { morningOpenings } from "../draft.js";
import { db, excludedDay, jidFor, NOT_CONNECTED, notConnected, senderFor, type SendFn } from "./delivery.js";
import { standupTargets } from "./progress.js";

type PromptOptions = {
  employeeId?: string;
  date?: string;
  send?: SendFn;
  force?: boolean;
  resend?: boolean;
};

async function promptTargets(workspaceId: string, employeeId?: string) {
  if (!employeeId) return standupTargets(workspaceId);
  const employee = await getEmployee(workspaceId, employeeId);
  if (!employee) throw new HttpError(404, "Employee not found");
  if (!employee.isActive) throw new HttpError(400, "Employee is not active");
  return [employee];
}

/** Status of each employee's session for the date, keyed by employee id. */
async function sessionStatuses(workspaceId: string, date: string) {
  const rows = await db
    .select({ employeeId: standupSessions.employeeId, status: standupSessions.status })
    .from(standupSessions)
    .where(and(eq(standupSessions.workspaceId, workspaceId), eq(standupSessions.date, date)));
  return new Map(rows.map((s) => [s.employeeId, s.status]));
}

/**
 * Sends the daily standup prompt to every active employee who does not have
 * a session for the date yet. Pass `send` to override transport (tests, or a
 * future queue processor).
 */
export async function sendStandupPrompts(workspaceId: string, options: PromptOptions = {}) {
  const send = senderFor(workspaceId, options.send);
  const date = options.date ?? (await standupToday(workspaceId));

  if (notConnected(workspaceId, options.send)) {
    return { date, ...NOT_CONNECTED, skipped: 0 };
  }

  if (!options.force) {
    const check = await excludedDay(workspaceId, date);
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

  const targets = await promptTargets(workspaceId, options.employeeId);
  // A new day: yesterday's unfinished checkouts stop taking replies.
  await closeStaleCheckouts(workspaceId, date);

  let sent = 0;
  let skipped = 0;
  let failed = 0;
  // "Kemarin" (checkout, else GitHub and AI drafts) only for who will actually get a prompt.
  const open = await sessionStatuses(workspaceId, date);
  const toPrompt = targets.filter((t) => {
    const status = open.get(t.id);
    return !status || (options.resend && (status === "pending" || status === "in_progress"));
  });
  const tz = await standupTimezone(workspaceId);
  const openings = await morningOpenings(workspaceId, date, toPrompt.map((t) => t.id), tz);
  const prompt = (employeeId: string, sessionId: string) =>
    openingText({ id: employeeId, workspaceId }, sessionId, date, openings.get(employeeId));

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
          await send(jidFor(employee.phone), await prompt(employee.id, existing.id));
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
      await send(jidFor(employee.phone), await prompt(employee.id, created.id));
      sent++;
    } catch {
      // Also drops a drafted "kemarin" (cascade), so a retry drafts afresh.
      await db
        .delete(standupSessions)
        .where(eq(standupSessions.id, created.id));
      failed++;
    }
  }

  return { date, sent, skipped, failed };
}
