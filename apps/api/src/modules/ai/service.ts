import pino from "pino";
import { createDbClient, aiUsageLogs, agentMemories } from "@repo/database";
import { chatWithTools, isAiConfigured, aiModel, type ChatMessage } from "./client.js";
import {
  appendConversationMessage,
  buildAgentContext,
  getConversationHistory,
  type AgentEmployee,
} from "./context.js";
import { AI_TOOLS, executeTool, type ToolContext } from "./tools.js";
import { HttpError } from "../../lib/http-error.js";

const logger = pino({ level: process.env.LOG_LEVEL ?? "info" });

const db = createDbClient(
  process.env.DATABASE_URL ??
    "postgres://teamassistant:teamassistant@localhost:5432/teamassistant",
);

const MAX_ITERATIONS = 4;
const PENDING_TTL_MS = 10 * 60 * 1000;

const YES = /^(yes|y|ya|iya|ok|oke|correct|benar|betul)$/i;
const NO = /^(no|n|tidak|bukan|salah|batal|cancel)$/i;

/** Mutating tools never run immediately; they wait for a YES/NO reply. */
const MUTATING_TOOLS = new Set([
  "create_schedule",
  "update_schedule",
  "create_standup",
]);

type PendingAction = {
  tool: string;
  args: Record<string, unknown>;
  expiresAt: number;
};

const pendingActions = new Map<string, PendingAction>();

function isYes(text: string): boolean {
  return YES.test(text.trim().replace(/[.!,\s]+$/, ""));
}

function isNo(text: string): boolean {
  return NO.test(text.trim().replace(/[.!,\s]+$/, ""));
}

function pendingSummary(tool: string, args: Record<string, unknown>): string {
  if (tool === "create_schedule") {
    const days = Array.isArray(args.weekdays)
      ? (args.weekdays as unknown[])
          .map(String)
          .join(", ")
      : "no days";
    return `Confirm: create standup schedule "${args.name ?? "?"}" at ${args.timeOfDay ?? "?"} for days (${days})? Reply YES to confirm or NO to cancel.`;
  }

  if (tool === "update_schedule") {
    const parts: string[] = [];
    if (args.name) parts.push(`rename to "${args.name}"`);
    if (args.timeOfDay) parts.push(`time ${args.timeOfDay}`);
    if (Array.isArray(args.weekdays)) {
      parts.push(`days (${(args.weekdays as unknown[]).map(String).join(", ")})`);
    }
    if (args.timezone) parts.push(`timezone ${args.timezone}`);
    if (args.reminderMinutes !== undefined) {
      parts.push(
        args.reminderMinutes === null
          ? "disable reminder"
          : `reminder ${args.reminderMinutes} min`,
      );
    }
    if (args.isActive !== undefined) {
      parts.push(args.isActive ? "activate" : "deactivate");
    }
    const target = args.id
      ? `schedule ${args.id}`
      : args.name
        ? `schedule "${args.name}"`
        : "the schedule";
    const details = parts.length ? `: ${parts.join(", ")}` : "";
    return `Confirm: update ${target}${details}? Reply YES to confirm or NO to cancel.`;
  }

  if (tool === "create_standup") {
    return `Confirm: save your standup for today?\nYesterday: ${args.yesterday ?? "-"}\nToday: ${args.today ?? "-"}\nBlockers: ${args.blockers ?? "-"}` + "\nReply YES to confirm or NO to cancel.";
  }

  return "An action is waiting for your confirmation. Reply YES to confirm or NO to cancel.";
}

function toolContext(args: ToolContextInput): ToolContext {
  return {
    employee: args.employee,
    roleName: args.roleName,
    actorId: args.employee.userId ?? null,
  };
}

export type ToolContextInput = {
  employee: AgentEmployee;
  roleName: string | null;
};

async function logUsage(
  employeeId: string,
  model: string,
  usage: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  } | null,
) {
  if (!usage || (usage.prompt_tokens ?? 0) + (usage.completion_tokens ?? 0) === 0) {
    return;
  }
  try {
    await db.insert(aiUsageLogs).values({
      employeeId,
      model,
      promptTokens: usage.prompt_tokens ?? null,
      completionTokens: usage.completion_tokens ?? null,
      totalTokens: usage.total_tokens ?? null,
    });
  } catch (error) {
    logger.warn({ error }, "Failed to log AI usage");
  }
}

async function persistExchange(
  employeeId: string,
  channel: string,
  userMessage: string,
  assistantMessage: string,
) {
  await appendConversationMessage(employeeId, "user", userMessage, channel);
  await appendConversationMessage(
    employeeId,
    "assistant",
    assistantMessage,
    channel,
  );
}

/**
 * Records a durable, user-confirmed action as a conversation memory.
 * Kept minimal: only mutating actions that were actually executed.
 */
async function storeConfirmedActionMemory(
  employeeId: string,
  tool: string,
  args: Record<string, unknown>,
  result: string,
) {
  const summary =
    `${tool} confirmed: ${result.replace(/\s+/g, " ").trim()}`.slice(0, 200);
  try {
    await db.insert(agentMemories).values({
      employeeId,
      scope: "conversation",
      content: summary,
    });
  } catch (error) {
    logger.warn({ error }, "Failed to store agent memory");
  }
}

async function runPendingConfirmation(
  phone: string,
  body: string,
  ctx: ToolContextInput,
): Promise<string | null> {
  const entry = pendingActions.get(phone);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    pendingActions.delete(phone);
    return null;
  }

  if (isYes(body)) {
    pendingActions.delete(phone);
    const result = await executeTool(entry.tool, entry.args, toolContext(ctx));
    if (result.ok) {
      await storeConfirmedActionMemory(
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
    pendingActions.delete(phone);
    return "Cancelled.";
  }

  // Not a yes/no answer: treat the message as a new request. Drop the stale
  // pending action so it cannot collide with a future confirmation.
  pendingActions.delete(phone);
  return null;
}

export type AiMessageArgs = ToolContextInput & {
  phone: string;
  body: string;
  isAdmin?: boolean;
  channel?: string;
};

/**
 * Handles an inbound message with the AI agent. Returns the reply text, or
 * null when AI is not configured (so callers can fall back to existing
 * behavior).
 */
export async function handleAiMessage(
  args: AiMessageArgs,
): Promise<string | null> {
  if (!isAiConfigured()) return null;
  const body = (args.body ?? "").trim();
  if (!body) return null;

  const phone = args.phone ?? args.employee?.phone;
  if (!phone || !args.employee?.id) return null;

  const channel = args.channel ?? "whatsapp";

  try {
    const confirmationReply = await runPendingConfirmation(
      phone,
      body,
      args,
    );
    if (confirmationReply) {
      await persistExchange(
        args.employee.id,
        channel,
        body,
        confirmationReply,
      );
      return confirmationReply;
    }

    const system = await buildAgentContext({
      employee: args.employee,
      roleName: args.roleName,
    });
    const history = await getConversationHistory(args.employee.id, 10);

    const messages: ChatMessage[] = [
      { role: "system", content: system },
      ...history,
      { role: "user", content: body },
    ];

    let finalText: string | null = null;
    let usedModel = aiModel();
    let usage: Parameters<typeof logUsage>[2] = null;

    for (let i = 0; i < MAX_ITERATIONS; i++) {
      const result = await chatWithTools(messages, AI_TOOLS);
      usedModel = result.model;
      usage = result.usage ?? usage;
      messages.push(result.message);

      const toolCalls = result.message.tool_calls ?? [];
      if (toolCalls.length === 0) {
        finalText = (result.message.content ?? "").trim() || null;
        break;
      }

      for (const call of toolCalls) {
        const name = call.function?.name ?? "";
        let parsed: Record<string, unknown> = {};
        try {
          parsed = JSON.parse(call.function?.arguments || "{}");
        } catch {
          parsed = {};
        }

        if (MUTATING_TOOLS.has(name)) {
          const summary = pendingSummary(name, parsed);
          pendingActions.set(phone, {
            tool: name,
            args: parsed,
            expiresAt: Date.now() + PENDING_TTL_MS,
          });
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            content: JSON.stringify({
              ok: true,
              pending: summary,
            }),
          });
          finalText = summary;
          break;
        }

        const toolResult = await executeTool(name, parsed, toolContext(args));
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify(toolResult),
        });
      }

      if (finalText) break;
    }

    if (!finalText) {
      finalText = "I could not finish that request. Please try again.";
    }

    await logUsage(args.employee.id, usedModel, usage);
    await persistExchange(args.employee.id, channel, body, finalText);
    return finalText;
  } catch (error) {
    if (error instanceof HttpError) {
      if (error.status === 400) return null;
      logger.warn({ error }, "AI request rejected");
    } else {
      logger.error({ error }, "AI message handling failed");
    }
    return "Sorry, something went wrong on my side. Please try again later.";
  }
}
