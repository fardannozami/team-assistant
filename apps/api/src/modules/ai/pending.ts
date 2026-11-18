import type { AgentEmployee } from "./context.js";
import { storeConfirmedActionMemory } from "./persistence.js";
import { executeTool, type ToolContext } from "./tools.js";

const PENDING_TTL_MS = 10 * 60 * 1000;

const YES = /^(yes|y|ya|iya|ok|oke|correct|benar|betul)$/i;
const NO = /^(no|n|tidak|bukan|salah|batal|cancel)$/i;

type PendingAction = {
  tool: string;
  args: Record<string, unknown>;
  expiresAt: number;
};

// Keyed by `${workspaceId}:${phone}`: the same phone may exist in several workspaces.
const pendingActions = new Map<string, PendingAction>();

function pendingKey(workspaceId: string, phone: string): string {
  return `${workspaceId}:${phone}`;
}

function isYes(text: string): boolean {
  return YES.test(text.trim().replace(/[.!,\s]+$/, ""));
}

function isNo(text: string): boolean {
  return NO.test(text.trim().replace(/[.!,\s]+$/, ""));
}

export type ToolContextInput = {
  workspaceId: string;
  employee: AgentEmployee;
  roleName: string | null;
};

export function toolContext(args: ToolContextInput): ToolContext {
  return {
    workspaceId: args.workspaceId,
    employee: args.employee,
    roleName: args.roleName,
    actorId: args.employee.userId ?? null,
  };
}

/** Queues a mutating tool call until the user replies YES or NO. */
export function setPendingAction(
  workspaceId: string,
  phone: string,
  tool: string,
  args: Record<string, unknown>,
) {
  pendingActions.set(pendingKey(workspaceId, phone), {
    tool,
    args,
    expiresAt: Date.now() + PENDING_TTL_MS,
  });
}

/**
 * True when this message answers an AI action waiting for YES/NO. The
 * WhatsApp router checks this before the standup and check-in engines, which
 * would otherwise file the "YA" as an answer.
 */
export function isPendingConfirmationReply(workspaceId: string, phone: string, body: string): boolean {
  const entry = pendingActions.get(pendingKey(workspaceId, phone));
  if (!entry || entry.expiresAt < Date.now()) return false;
  return isYes(body) || isNo(body);
}

export async function runPendingConfirmation(
  phone: string,
  body: string,
  ctx: ToolContextInput,
): Promise<string | null> {
  const key = pendingKey(ctx.workspaceId, phone);
  const entry = pendingActions.get(key);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    pendingActions.delete(key);
    return null;
  }

  if (isYes(body)) {
    pendingActions.delete(key);
    const result = await executeTool(entry.tool, entry.args, toolContext(ctx));
    if (result.ok) {
      await storeConfirmedActionMemory(
        ctx.workspaceId,
        ctx.employee.id,
        entry.tool,
        entry.args,
        result.data ?? "Done.",
      );
      return result.data ?? "Done.";
    }
    return `Could not complete that action: ${result.error}`;
  }

  if (isNo(body)) {
    pendingActions.delete(key);
    return "Cancelled.";
  }

  // Not a yes/no answer: treat the message as a new request. Drop the stale
  // pending action so it cannot collide with a future confirmation.
  pendingActions.delete(key);
  return null;
}
