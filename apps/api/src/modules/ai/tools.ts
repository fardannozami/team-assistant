import { HttpError } from "../../lib/http-error.js";
import type { ToolSpec } from "./client.js";
import { ADMIN_TOOLS } from "./tools/exec-admin.js";
import { LIST_TOOLS } from "./tools/exec-lists.js";
import { SCHEDULE_TOOLS } from "./tools/exec-schedules.js";
import { SELF_TOOLS } from "./tools/exec-self.js";
import { PREPARE_EMPLOYEE_TOOLS } from "./tools/prepare-employees.js";
import { PREPARE_WORKSPACE_TOOLS } from "./tools/prepare-workspace.js";
import {
  ADMIN_ONLY,
  ownerOrAdmin,
  type PrepareHandler,
  type PreparedAction,
  type ToolContext,
  type ToolHandler,
  type ToolResult,
} from "./tools/shared.js";
import { EMPLOYEE_SPECS } from "./tools/specs-employees.js";
import { STANDUP_SPECS } from "./tools/specs-standups.js";
import { WORKSPACE_SPECS } from "./tools/specs-workspace.js";

export type { PreparedAction, ToolContext, ToolResult } from "./tools/shared.js";
export type { EmployeeLookup } from "./tools/lookup.js";
export type { StandupCollector } from "../standups/engine.js";

export const AI_TOOLS: ToolSpec[] = [...EMPLOYEE_SPECS, ...STANDUP_SPECS, ...WORKSPACE_SPECS];

/** Tools that change data: they are prepared, confirmed with YES, then run. */
export const MUTATING_TOOLS = new Set([
  "create_schedule",
  "update_schedule",
  "create_standup",
  "add_employee",
  "update_employee",
  "update_employee_phone",
  "set_employee_active",
  "create_team",
  "update_team",
  "delete_team",
  "delete_schedule",
  "start_standup",
  "send_standup_reminder",
  "add_calendar_exception",
  "delete_calendar_exception",
]);

const PREPARE_HANDLERS: Record<string, PrepareHandler> = {
  ...PREPARE_EMPLOYEE_TOOLS,
  ...PREPARE_WORKSPACE_TOOLS,
};

const TOOL_HANDLERS: Record<string, ToolHandler> = {
  ...SELF_TOOLS,
  ...SCHEDULE_TOOLS,
  ...LIST_TOOLS,
  ...ADMIN_TOOLS,
};

const CONFIRM = "Balas YA untuk melanjutkan atau TIDAK untuk membatalkan.";

/**
 * Validates a mutating tool call and resolves names to ids before asking for
 * confirmation, so the user confirms exactly what will run. Returns null for
 * tools that confirm with their raw arguments.
 */
export async function prepareTool(
  name: string,
  args: any,
  ctx: ToolContext,
): Promise<PreparedAction | null> {
  const adminTools = MUTATING_TOOLS.has(name) && !["create_standup", "create_schedule", "update_schedule"].includes(name);
  if (!adminTools) return null;
  if (!ownerOrAdmin(ctx.roleName)) return { ok: false, error: ADMIN_ONLY };

  const handler = Object.hasOwn(PREPARE_HANDLERS, name) ? PREPARE_HANDLERS[name] : undefined;
  if (!handler) return null;
  try {
    return await handler(args, ctx);
  } catch (error) {
    if (error instanceof HttpError) return { ok: false, error: error.message };
    throw error;
  }
}

/** Appends the YES/NO instruction to a prepared summary. */
export function confirmationText(summary: string): string {
  return `${summary}\n${CONFIRM}`;
}

/**
 * Executes an agent tool with backend-side authorization and validation.
 * Never throws for business errors: unknown tools and unauthorized calls are
 * returned as structured errors so the model can react.
 */
export async function executeTool(
  name: string,
  args: any,
  ctx: ToolContext,
): Promise<ToolResult> {
  const handler = Object.hasOwn(TOOL_HANDLERS, name) ? TOOL_HANDLERS[name] : undefined;
  if (!handler) return { ok: false, error: `Unknown tool: ${name}` };
  try {
    return await handler(args, ctx);
  } catch (error) {
    if (error instanceof HttpError) return { ok: false, error: error.message };
    return {
      ok: false,
      error: `Tool failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
