import { and, desc, eq, gte, sql } from "drizzle-orm";
import { agentConfigs, aiUsageLogs, createDbClient, employees } from "@repo/database";
import { DEFAULT_TIMEZONE } from "@repo/shared";
import { audit } from "../auth/index.js";
import { HttpError } from "../../lib/http-error.js";
import { canViewOthers } from "./context.js";

const db = createDbClient(
  process.env.DATABASE_URL ??
    "postgres://teamassistant:teamassistant@localhost:5432/teamassistant",
);

const POLICY_KEY = "ai_policy";

/** Who may use the AI agent and how much, per workspace. */
export type AiPolicy = {
  /** Employees (not Owner/Admin/Manager) get AI only when this is on. */
  allowEmployees: boolean;
  /** AI messages per employee per day, when allowed. */
  employeeDailyLimit: number;
  /** AI messages per workspace per day, for everyone: a cost ceiling. */
  workspaceDailyLimit: number;
};

export const DEFAULT_AI_POLICY: AiPolicy = {
  allowEmployees: false,
  employeeDailyLimit: 10,
  workspaceDailyLimit: 200,
};

/** Longest message sent to the model; longer texts are refused, not cut. */
export const MAX_MESSAGE_CHARS = { employee: 1000, staff: 4000 };

/** Tools an employee may use when AI is allowed for them: their own standup only. */
export const EMPLOYEE_TOOL_NAMES = new Set([
  "create_standup",
  "get_standup_history",
  "get_schedule",
  "list_holidays",
]);

export function isStaffRole(roleName: string | null): boolean {
  return canViewOthers(roleName);
}

export async function getAiPolicy(workspaceId: string): Promise<AiPolicy> {
  const [row] = await db
    .select({ value: agentConfigs.value })
    .from(agentConfigs)
    .where(and(eq(agentConfigs.workspaceId, workspaceId), eq(agentConfigs.key, POLICY_KEY)))
    .limit(1);
  return { ...DEFAULT_AI_POLICY, ...((row?.value as Partial<AiPolicy> | null) ?? {}) };
}

function limit(value: unknown, name: string, max: number): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > max) {
    throw new HttpError(400, `${name} harus bilangan bulat 1-${max}.`);
  }
  return n;
}

export async function updateAiPolicy(
  workspaceId: string,
  patch: Partial<AiPolicy>,
  actorId: string | null,
): Promise<AiPolicy> {
  const current = await getAiPolicy(workspaceId);
  const next: AiPolicy = {
    allowEmployees: patch.allowEmployees === undefined ? current.allowEmployees : Boolean(patch.allowEmployees),
    employeeDailyLimit:
      patch.employeeDailyLimit === undefined
        ? current.employeeDailyLimit
        : limit(patch.employeeDailyLimit, "Batas per karyawan", 500),
    workspaceDailyLimit:
      patch.workspaceDailyLimit === undefined
        ? current.workspaceDailyLimit
        : limit(patch.workspaceDailyLimit, "Batas workspace", 10000),
  };
  await db
    .insert(agentConfigs)
    .values({ workspaceId, key: POLICY_KEY, value: next })
    .onConflictDoUpdate({
      target: [agentConfigs.workspaceId, agentConfigs.key],
      set: { value: next, updatedAt: new Date() },
    });
  await audit(workspaceId, actorId, "ai_policy.update", "agent_configs", workspaceId, next);
  return next;
}

/** "Today" for limits is the calendar day in the default timezone. */
const today = sql`(now() at time zone ${DEFAULT_TIMEZONE})::date`;
const createdDay = sql`(${aiUsageLogs.createdAt} at time zone ${DEFAULT_TIMEZONE})::date`;

/** AI messages used today: by the whole workspace and by one employee. */
export async function countAiUsageToday(workspaceId: string, employeeId: string) {
  const [row] = await db
    .select({
      workspace: sql<number>`count(*)`.mapWith(Number),
      employee: sql<number>`count(*) filter (where ${aiUsageLogs.employeeId} = ${employeeId})`.mapWith(Number),
    })
    .from(aiUsageLogs)
    .where(and(eq(aiUsageLogs.workspaceId, workspaceId), sql`${createdDay} = ${today}`));
  return { workspace: row?.workspace ?? 0, employee: row?.employee ?? 0 };
}

/** Per-employee AI usage over the last 7 days, heaviest first. */
export async function getAiUsageSummary(workspaceId: string) {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const messages = sql<number>`count(*)`.mapWith(Number);
  const rows = await db
    .select({
      employeeId: aiUsageLogs.employeeId,
      name: employees.name,
      messages,
      tokens: sql<number>`coalesce(sum(${aiUsageLogs.totalTokens}), 0)`.mapWith(Number),
      today: sql<number>`count(*) filter (where ${createdDay} = ${today})`.mapWith(Number),
    })
    .from(aiUsageLogs)
    .leftJoin(employees, eq(employees.id, aiUsageLogs.employeeId))
    .where(and(eq(aiUsageLogs.workspaceId, workspaceId), gte(aiUsageLogs.createdAt, since)))
    .groupBy(aiUsageLogs.employeeId, employees.name)
    .orderBy(desc(messages));
  return {
    today: rows.reduce((sum, r) => sum + r.today, 0),
    week: rows.map((r) => ({ name: r.name ?? "(dihapus)", messages: r.messages, tokens: r.tokens, today: r.today })),
  };
}
