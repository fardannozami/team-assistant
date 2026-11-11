import { and, desc, eq } from "drizzle-orm";
import {
  createDbClient,
  conversationMessages,
  conversations,
  employees,
  roles,
  standupAnswers,
  standups,
  teams,
} from "@repo/database";
import { dateInTimezone, DEFAULT_TIMEZONE } from "@repo/shared";
import { listUpcomingHolidays } from "../holidays/service.js";
import { listSchedules } from "../schedules/service.js";
import { getStandupSession } from "../standups/engine.js";

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

/** Employees see only themselves; Owner/Admin/Manager may view others. */
export function canViewOthers(roleName: string | null): boolean {
  return !!roleName && ["Owner", "Admin", "Manager"].includes(roleName);
}

function formatWeekdays(days: unknown): string {
  if (!Array.isArray(days)) return "custom days";
  const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return (days as number[]).map((d) => names[d] ?? String(d)).join(", ");
}

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

  const lines: string[] = [
    "You are Team Assistant, a friendly AI helper for a small Indonesian team.",
    "Style: reply in short, WhatsApp-style messages. Match the user's language (Bahasa Indonesia or English).",
    "Use the provided tools for data about standups, schedules, holidays, activity and reports. Never invent data; if a tool fails, briefly say so.",
    "Security: never ask for or repeat passwords, API keys or any credentials.",
    "",
    "Signed-in user:",
    `- Name: ${employee.name}`,
    `- WhatsApp: ${employee.phone}`,
    `- Role: ${resolvedRole ?? "unknown"}`,
    `- Team: ${teamName ?? "none"}`,
    canViewOthers(resolvedRole)
      ? "This user may look up any employee's profile and standup history, and see team activity and reports."
      : "This user may only access their own profile and standup history (tools enforce this).",
  ];

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

export type HistoryMessage = { role: "user" | "assistant"; content: string };

/** Reads the employee's recent conversation messages, oldest first. */
export async function getConversationHistory(
  employeeId: string,
  limit = 10,
): Promise<HistoryMessage[]> {
  const rows = await db
    .select({
      role: conversationMessages.role,
      content: conversationMessages.content,
    })
    .from(conversationMessages)
    .innerJoin(
      conversations,
      eq(conversationMessages.conversationId, conversations.id),
    )
    .where(eq(conversations.employeeId, employeeId))
    .orderBy(desc(conversationMessages.createdAt))
    .limit(limit);

  return rows
    .reverse()
    .map((r) => ({ role: r.role as "user" | "assistant", content: r.content }));
}

function isToday(when: Date): boolean {
  return dateInTimezone(DEFAULT_TIMEZONE, when) === dateInTimezone();
}

/**
 * Appends a message to the employee's open conversation for today,
 * creating the conversation row when needed.
 */
export async function appendConversationMessage(
  workspaceId: string,
  employeeId: string,
  role: "user" | "assistant" | "system",
  content: string,
  channel = "whatsapp",
): Promise<void> {
  if (!content) return;

  const [latest] = await db
    .select({ id: conversations.id, startedAt: conversations.startedAt })
    .from(conversations)
    .where(
      and(
        eq(conversations.workspaceId, workspaceId),
        eq(conversations.employeeId, employeeId),
        eq(conversations.channel, channel),
      ),
    )
    .orderBy(desc(conversations.startedAt))
    .limit(1);

  let conversationId = latest?.id;
  if (!conversationId || !latest || !isToday(latest.startedAt)) {
    const [created] = await db
      .insert(conversations)
      .values({ workspaceId, employeeId, channel })
      .returning({ id: conversations.id });
    if (!created) return;
    conversationId = created.id;
  }

  await db.insert(conversationMessages).values({
    conversationId,
    role,
    content,
  });
}
