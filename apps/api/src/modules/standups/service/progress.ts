import { employees, standupAnswers, standupSessions, standups, teams } from "@repo/database";
import { and, eq } from "drizzle-orm";
import { CORE_STANDUP_ELEMENTS, isAdminRole } from "@repo/shared";
import { listEmployees } from "../../employees/service.js";
import { describeCounts, notableItems } from "../../github/digest.js";
import { standupActivity } from "../../github/service.js";
import { db } from "./delivery.js";

type SessionSummary = {
  sessionId: string;
  status: string;
  employeeId: string;
  employeeName: string;
  employeePhone: string;
  teamName: string | null;
  standupId: string | null;
  answers: Record<string, string>;
};

/** Employees expected to send a standup: active, admins only when enabled. */
export async function standupTargets(workspaceId: string) {
  const active = await listEmployees(workspaceId, { active: true });
  if (process.env.STANDUP_INCLUDE_ADMINS === "true") return active;
  return active.filter((employee) => !isAdminRole(employee.roleName));
}

/** Who still owes today's standup, and which answers each one is missing. */
export async function standupProgress(workspaceId: string, date: string) {
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

  const grouped = new Map<string, SessionSummary>();
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

  const sessions = [...grouped.values()];
  const { from, byEmployee } = await standupActivity(
    workspaceId,
    date,
    sessions.map((s) => s.employeeId),
  );
  return sessions.map((s) => {
    const activity = byEmployee.get(s.employeeId);
    return {
      ...s,
      githubSince: from,
      github: activity ? { summary: describeCounts(activity.counts), ...notableItems(activity.items) } : null,
    };
  });
}
