import { dateInTimezone, DEFAULT_TIMEZONE, type StandupElement } from "@repo/shared";
import { and, asc, eq } from "drizzle-orm";
import {
  calendarSettings,
  createDbClient,
  schedules,
  standupAnswers,
  standupSessions,
  standups,
} from "@repo/database";

export const db = createDbClient(
  process.env.DATABASE_URL ??
    "postgres://teamassistant:teamassistant@localhost:5432/teamassistant",
);

export type StandupCollector = {
  id: string;
  workspaceId: string;
  name: string;
  phone: string;
  isActive: boolean;
};

/**
 * The timezone standup days are counted in: the workspace's active standup
 * schedule (the oldest, if there are several), else its calendar timezone.
 * The worker fires the schedule's cron in the same zone, so "today" here
 * matches the day the prompt went out.
 */
export async function standupTimezone(workspaceId: string): Promise<string> {
  const [schedule] = await db
    .select({ timezone: schedules.timezone })
    .from(schedules)
    .where(and(eq(schedules.workspaceId, workspaceId), eq(schedules.isActive, true)))
    .orderBy(asc(schedules.createdAt))
    .limit(1);
  if (schedule) return schedule.timezone;
  const [settings] = await db
    .select({ timezone: calendarSettings.timezone })
    .from(calendarSettings)
    .where(eq(calendarSettings.workspaceId, workspaceId))
    .limit(1);
  return settings?.timezone ?? DEFAULT_TIMEZONE;
}

/** Today's date for the workspace's standups. */
export async function standupToday(workspaceId: string): Promise<string> {
  return dateInTimezone(await standupTimezone(workspaceId));
}

export async function getStandupSession(employeeId: string, date: string) {
  const [session] = await db
    .select()
    .from(standupSessions)
    .where(
      and(
        eq(standupSessions.employeeId, employeeId),
        eq(standupSessions.date, date),
      ),
    )
    .limit(1);
  return session ?? null;
}

async function findStandupRow(employeeId: string, date: string) {
  const [row] = await db
    .select()
    .from(standups)
    .where(
      and(eq(standups.employeeId, employeeId), eq(standups.date, date)),
    )
    .limit(1);
  return row;
}

export async function getOrCreateStandupRow(
  workspaceId: string,
  sessionId: string,
  employeeId: string,
  date: string,
) {
  const existing = await findStandupRow(employeeId, date);
  if (existing) return existing;

  const [created] = await db
    .insert(standups)
    .values({ workspaceId, sessionId, employeeId, date })
    .onConflictDoNothing()
    .returning();
  if (created) return created;

  const raced = await findStandupRow(employeeId, date);
  if (!raced) throw new Error("Failed to load standup row");
  return raced;
}

export async function getAnswers(standupId: string) {
  return db
    .select({
      questionKey: standupAnswers.questionKey,
      answer: standupAnswers.answer,
    })
    .from(standupAnswers)
    .where(eq(standupAnswers.standupId, standupId));
}

export async function upsertAnswer(
  standupId: string,
  questionKey: StandupElement,
  answer: string,
) {
  await db
    .insert(standupAnswers)
    .values({ standupId, questionKey, answer })
    .onConflictDoUpdate({
      target: [standupAnswers.standupId, standupAnswers.questionKey],
      set: { answer },
    });
}

export async function setSessionStatus(sessionId: string, status: string) {
  await db
    .update(standupSessions)
    .set({ status, updatedAt: new Date() })
    .where(eq(standupSessions.id, sessionId));
}
