import { and, eq, gte } from "drizzle-orm";
import { employees, standupAnswers, standupSessions, standups } from "@repo/database";
import { dateInTimezone, DEFAULT_TIMEZONE, isNoBlocker } from "@repo/shared";
import { listEmployees } from "../../employees/service.js";
import { canViewOthers } from "../context.js";
import { db, type ToolContext, type ToolResult } from "./shared.js";

/** Per-employee session counts since `startStr`, limited to the roster. */
async function sessionCounts(ctx: ToolContext, startStr: string, rosterIds: Set<string>) {
  const rows = await db
    .select({
      employeeId: standupSessions.employeeId,
      date: standupSessions.date,
      status: standupSessions.status,
    })
    .from(standupSessions)
    .innerJoin(employees, eq(standupSessions.employeeId, employees.id))
    .where(
      and(
        eq(standupSessions.workspaceId, ctx.workspaceId),
        eq(employees.workspaceId, ctx.workspaceId),
        gte(standupSessions.date, startStr),
        eq(employees.isActive, true),
      ),
    );

  const perEmployee = new Map<string, { recorded: number; completed: number }>();
  for (const row of rows) {
    if (!rosterIds.has(row.employeeId)) continue;
    const entry = perEmployee.get(row.employeeId) ?? {
      recorded: 0,
      completed: 0,
    };
    entry.recorded++;
    if (row.status === "completed") entry.completed++;
    perEmployee.set(row.employeeId, entry);
  }
  return perEmployee;
}

/** How often each real blocker was mentioned since `startStr`. */
async function blockerCounts(ctx: ToolContext, startStr: string) {
  const blockerRows = await db
    .select({
      block: standupAnswers.answer,
    })
    .from(standupAnswers)
    .innerJoin(standups, eq(standupAnswers.standupId, standups.id))
    .where(
      and(
        eq(standups.workspaceId, ctx.workspaceId),
        gte(standups.date, startStr),
        eq(standupAnswers.questionKey, "blockers"),
      ),
    )
    .limit(500);

  const blockers = new Map<string, number>();
  for (const row of blockerRows) {
    if (isNoBlocker(row.block)) continue;
    blockers.set(row.block.trim(), (blockers.get(row.block.trim()) ?? 0) + 1);
  }
  return blockers;
}

export async function getTeamActivity(_args: unknown, ctx: ToolContext): Promise<ToolResult> {
  if (!canViewOthers(ctx.roleName)) {
    return {
      ok: false,
      error: "Only Manager, Admin or Owner can view team activity.",
    };
  }

  const since = new Date();
  since.setDate(since.getDate() - 6);
  const startStr = dateInTimezone(DEFAULT_TIMEZONE, since);
  const todayStr = dateInTimezone();

  const rosters = await listEmployees(ctx.workspaceId, { active: true });
  const perEmployee = await sessionCounts(ctx, startStr, new Set(rosters.map((r) => r.id)));
  const blockers = await blockerCounts(ctx, startStr);

  const lines = [
    `Team activity (${startStr} to ${todayStr}):`,
    `Active employees: ${rosters.length}`,
    ...rosters.map((r) => {
      const stats = perEmployee.get(r.id);
      return stats
        ? `- ${r.name}: standups recorded ${stats.recorded}, completed ${stats.completed}`
        : `- ${r.name}: no standups recorded`;
    }),
  ];
  if (blockers.size > 0) {
    lines.push(
      "Blockers mentioned:",
      ...[...blockers.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([text, count]) => `- "${text}" (${count}x)`),
    );
  }
  return { ok: true, data: lines.join("\n") };
}
