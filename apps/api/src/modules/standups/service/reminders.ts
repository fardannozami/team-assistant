import { standupSessions } from "@repo/database";
import { eq } from "drizzle-orm";
import { standupReminderText, standupToday } from "../engine.js";
import { db, excludedDay, jidFor, NOT_CONNECTED, notConnected, senderFor, type SendFn } from "./delivery.js";
import { standupProgress } from "./progress.js";

/**
 * Reminds everyone who has not finished today's standup, asking only for the
 * missing answers. Employees without a session yet (e.g. the prompt failed)
 * get one now, so they can still answer.
 */
export async function sendStandupReminders(
  workspaceId: string,
  options: { date?: string; send?: SendFn } = {},
) {
  const send = senderFor(workspaceId, options.send);
  const date = options.date ?? (await standupToday(workspaceId));

  if (notConnected(workspaceId, options.send)) {
    return { date, ...NOT_CONNECTED, created: 0 };
  }
  if ((await excludedDay(workspaceId, date)).excluded) {
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
  const date = options.date ?? (await standupToday(workspaceId));
  if ((await excludedDay(workspaceId, date)).excluded) return { date, missed: 0, excluded: true };

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
