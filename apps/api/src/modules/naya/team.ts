import { createDbClient, standupAnswers, standupSessions, standups } from "@repo/database";
import { and, eq, inArray } from "drizzle-orm";
import { isNoBlocker, shiftDate } from "@repo/shared";
import { standupTargets } from "../standups/service.js";
import { standupTimezone } from "../standups/engine.js";

// The human team in Naya's office: each employee's avatar follows today's standup. After the
// morning standup they work at a desk with today's plan as kanban cards; a plan that is only
// exploration or standby has them santai around the office; after checkout they rest.

const db = createDbClient(
  process.env.DATABASE_URL ?? "postgres://teamassistant:teamassistant@localhost:5432/teamassistant",
);

/** absent: no plan yet today · working · standby: exploration/standby only · resting: checked out. */
export type TeamPresence = "absent" | "working" | "standby" | "resting";
export type TeamTaskStatus = "doing" | "done" | "blocked";
export interface TeamTask { title: string; status: TeamTaskStatus }
export interface TeamMember { id: string; name: string; team: string | null; shift: string; date: string; presence: TeamPresence; tasks: TeamTask[] }

/** Lines, bullets, numbering and semicolons each start a new item. */
export function splitTasks(text: string | null | undefined): string[] {
  if (!text) return [];
  return text
    .split(/\r?\n|;|(?:^|\s)(?=\d+[.)]\s)/)
    .map((item) => item.replace(/^[\s\-–—*•·>]+/, "").replace(/^\d+[.)]\s*/, "").replace(/^(?:hari ini|today|rencana|plan(?:ning)?|selesai|done|kendala|blockers?)\s*:\s*/i, "").trim())
    .filter((item) => item.length > 1);
}

const STANDBY =
  /\b(?:eksplor\w*|explor\w*|stand[\s-]?by|idle|nganggur|santai|free|kosong|(?:belum|tidak|tdk|ga|gak|nggak|no)\s+(?:ada\s+)?(?:task|tugas|kerjaan|project|proyek|projek))\b/i;

/** A plan where every item is exploration or standby. */
export function isStandbyPlan(items: string[]): boolean {
  return items.length > 0 && items.every((item) => STANDBY.test(item));
}

const normalize = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/**
 * Today's kanban: the plan's items are being worked on until checkout; at checkout what was done
 * moves to done (a plan item the done answer mentions counts as done), and blockers get a card.
 */
export function teamTasks(answers: Record<string, string>, checkedOut: boolean): TeamTask[] {
  const plan = splitTasks(answers.today);
  const done = checkedOut ? splitTasks(answers.done) : [];
  const doneText = normalize(done.join(" "));
  const tasks: TeamTask[] = [
    ...plan.filter((item) => !doneText || !doneText.includes(normalize(item))).map((title): TeamTask => ({ title, status: "doing" })),
    ...done.map((title): TeamTask => ({ title, status: "done" })),
  ];
  if (!isNoBlocker(answers.blockers)) tasks.push(...splitTasks(answers.blockers).map((title): TeamTask => ({ title, status: "blocked" })));
  return tasks;
}

export function teamPresence(session: { checkoutStatus: string | null } | undefined, answers: Record<string, string>): TeamPresence {
  // A missed checkout still ends the shift.
  if (session?.checkoutStatus === "completed" || session?.checkoutStatus === "missed") return "resting";
  const plan = splitTasks(answers.today);
  if (plan.length === 0) return "absent";
  return isStandbyPlan(plan) ? "standby" : "working";
}

/**
 * The office as seen without the "allTasks" view: everyone's avatar and presence stay, but only
 * one's own plan comes along; a colleague's standup is for those who run the team.
 */
export function withOwnTasks(members: TeamMember[], employeeId: string | null): TeamMember[] {
  return members.map((member) => (member.id === employeeId ? member : { ...member, tasks: [] }));
}

/** Every standup target with today's (their shift's) standup. No phone numbers leave here. */
export async function teamToday(workspaceId: string): Promise<{ members: TeamMember[]; fetchedAt: string }> {
  const [people, tz] = await Promise.all([standupTargets(workspaceId), standupTimezone(workspaceId)]);
  const dateOf = new Map(people.map((person) => [person.id, shiftDate(person.shift, tz)]));
  const dates = [...new Set(dateOf.values())];
  const rows = people.length === 0 ? [] : await db
    .select({
      employeeId: standupSessions.employeeId,
      date: standupSessions.date,
      checkoutStatus: standupSessions.checkoutStatus,
      questionKey: standupAnswers.questionKey,
      answer: standupAnswers.answer,
    })
    .from(standupSessions)
    .leftJoin(standups, eq(standups.sessionId, standupSessions.id))
    .leftJoin(standupAnswers, eq(standupAnswers.standupId, standups.id))
    .where(and(eq(standupSessions.workspaceId, workspaceId), inArray(standupSessions.date, dates)));

  const sessions = new Map<string, { checkoutStatus: string | null; answers: Record<string, string> }>();
  for (const row of rows) {
    if (dateOf.get(row.employeeId) !== row.date) continue;
    const entry = sessions.get(row.employeeId) ?? { checkoutStatus: row.checkoutStatus, answers: {} };
    if (row.questionKey && row.answer) entry.answers[row.questionKey] = row.answer;
    sessions.set(row.employeeId, entry);
  }

  const members = people.map((person): TeamMember => {
    const session = sessions.get(person.id);
    const answers = session?.answers ?? {};
    const presence = teamPresence(session, answers);
    return {
      id: person.id,
      name: person.name,
      team: person.teamName ?? null,
      shift: person.shift,
      date: dateOf.get(person.id)!,
      presence,
      tasks: presence === "absent" ? [] : teamTasks(answers, presence === "resting"),
    };
  });
  return { members, fetchedAt: new Date().toISOString() };
}
