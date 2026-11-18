import { and, desc, eq } from "drizzle-orm";
import {
  createDbClient,
  employees,
  roles,
  standupAnswers,
  standups,
  teams,
} from "@repo/database";
import { dateInTimezone } from "@repo/shared";
import { listUpcomingHolidays } from "../holidays/service.js";
import { listSchedules } from "../schedules/service.js";
import { getStandupSession } from "../standups/engine.js";
import { formatWeekdays, identityLines } from "./prompt.js";

export { canViewOthers } from "./prompt.js";
export {
  appendConversationMessage,
  getConversationHistory,
  type HistoryMessage,
} from "./conversation.js";

const db = createDbClient(
  process.env.DATABASE_URL ??
    "postgres://teamassistant:teamassistant@localhost:5432/teamassistant",
);

export type AgentEmployee = {
  id: string;
  name: string;
  phone: string;
  teamId: string | null;
  roleId: string | null;
  isActive: boolean;
  userId?: string | null;
};

export type AgentArgs = {
  workspaceId: string;
  employee: AgentEmployee;
  roleName: string | null;
};

async function recentStandups(employeeId: string, limit: number) {
  const rows = await db
    .select({
      standupId: standups.id,
      date: standups.date,
      questionKey: standupAnswers.questionKey,
      answer: standupAnswers.answer,
    })
    .from(standups)
    .leftJoin(standupAnswers, eq(standupAnswers.standupId, standups.id))
    .where(eq(standups.employeeId, employeeId))
    .orderBy(desc(standups.date));

  const byDate = new Map<string, Record<string, string>>();
  for (const row of rows) {
    if (!row.standupId) continue;
    const entry = byDate.get(row.date) ?? {};
    if (row.questionKey && row.answer) entry[row.questionKey] = row.answer;
    byDate.set(row.date, entry);
  }

  return [...byDate.entries()].slice(0, limit);
}

/**
 * Builds the system prompt for the agent: identity, role, team, recent
 * standups, today's session status, upcoming holidays and the current
 * schedules. Never includes credentials or secrets; data is limited to what
 * the sender may see (self-only for Employee roles).
 */
export async function buildAgentContext(args: AgentArgs): Promise<string> {
  const { workspaceId, employee, roleName } = args;

  const [profile] = await db
    .select({
      teamName: teams.name,
      roleName: roles.name,
    })
    .from(employees)
    .leftJoin(teams, eq(employees.teamId, teams.id))
    .leftJoin(roles, eq(employees.roleId, roles.id))
    .where(
      and(eq(employees.id, employee.id), eq(employees.workspaceId, workspaceId)),
    )
    .limit(1);

  const teamName = profile?.teamName ?? null;
  const resolvedRole = roleName ?? profile?.roleName ?? null;
  const lines = identityLines(employee, resolvedRole, teamName);

  const history = await recentStandups(employee.id, 5);
  if (history.length > 0) {
    lines.push("", "Recent standups:");
    for (const [date, answers] of history) {
      lines.push(
        `- ${date}: yesterday="${answers.yesterday ?? "-"}", today="${answers.today ?? "-"}", blockers="${answers.blockers ?? "-"}"`,
      );
    }
  }

  const today = dateInTimezone();
  const session = await getStandupSession(employee.id, today);
  if (session) {
    lines.push(
      "",
      `Today's standup (${today}): session "${session.status}". Mention this when relevant, e.g. prompt the user to send yesterday/today/blockers.`,
    );
  }

  const holidays = await listUpcomingHolidays(5);
  if (holidays.length > 0) {
    lines.push(
      "",
      "Upcoming holidays:",
      ...holidays.map((h) => `- ${h.date}: ${h.name} (${h.type})`),
    );
  }

  try {
    const schedules = await listSchedules(workspaceId);
    if (schedules.length > 0) {
      lines.push(
        "",
        "Current standup schedules:",
        ...schedules.map((s) =>
          `- ${s.name} (${s.isActive ? "active" : "disabled"}): ${s.timeOfDay ?? "?"} ${formatWeekdays(s.weekdays)} ${s.timezone}`,
        ),
      );
    }
  } catch {
    // Schedule listing is optional context; ignore failures.
  }

  return lines.join("\n");
}
