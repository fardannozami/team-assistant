import pino from "pino";
import { createDbClient, aiUsageLogs, agentMemories } from "@repo/database";
import { AiProviderError, chatWithTools, type ChatMessage } from "./client.js";
import { resolveAiConfig } from "./settings.js";
import {
  countAiUsageToday,
  EMPLOYEE_TOOL_NAMES,
  getAiPolicy,
  isStaffRole,
  MAX_MESSAGE_CHARS,
} from "./policy.js";
import {
  appendConversationMessage,
  buildAgentContext,
  getConversationHistory,
  type AgentEmployee,
} from "./context.js";
import {
  AI_TOOLS,
  confirmationText,
  executeTool,
  MUTATING_TOOLS,
  prepareTool,
  type ToolContext,
} from "./tools.js";
import { HttpError } from "../../lib/http-error.js";

const logger = pino({ level: process.env.LOG_LEVEL ?? "info" });

const db = createDbClient(
  process.env.DATABASE_URL ??
    "postgres://teamassistant:teamassistant@localhost:5432/teamassistant",
);

// Room for a lookup (e.g. list_employees) before the action and the reply.
const MAX_ITERATIONS = 4;
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
    if (args.reminderRepeatMinutes !== undefined) {
      parts.push(args.reminderRepeatMinutes === null ? "single reminder" : `repeat every ${args.reminderRepeatMinutes} min`);
    }
    if (args.closeTime !== undefined) parts.push(args.closeTime === null ? "never close" : `close at ${args.closeTime}`);
    if (args.summaryTime !== undefined) parts.push(args.summaryTime === null ? "no admin summary" : `admin summary at ${args.summaryTime}`);
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
    workspaceId: args.workspaceId,
    employee: args.employee,
    roleName: args.roleName,
    actorId: args.employee.userId ?? null,
  };
}

export type ToolContextInput = {
  workspaceId: string;
  employee: AgentEmployee;
  roleName: string | null;
};

async function logUsage(
  workspaceId: string,
  employeeId: string,
  model: string,
  usage: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  } | null,
) {
  // One row per AI-handled message: it is also what daily limits count.
  try {
    await db.insert(aiUsageLogs).values({
      workspaceId,
      employeeId,
      model,
      promptTokens: usage?.prompt_tokens ?? null,
      completionTokens: usage?.completion_tokens ?? null,
      totalTokens: usage?.total_tokens ?? null,
    });
  } catch (error) {
    logger.warn({ err: error }, "Failed to log AI usage");
  }
}

async function persistExchange(
  workspaceId: string,
  employeeId: string,
  channel: string,
  userMessage: string,
  assistantMessage: string,
) {
  await appendConversationMessage(
    workspaceId,
    employeeId,
    "user",
    userMessage,
    channel,
  );
  await appendConversationMessage(
    workspaceId,
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
  workspaceId: string,
  employeeId: string,
  tool: string,
  args: Record<string, unknown>,
  result: string,
) {
  const summary =
    `${tool} confirmed: ${result.replace(/\s+/g, " ").trim()}`.slice(0, 200);
  try {
    await db.insert(agentMemories).values({
      workspaceId,
      employeeId,
      scope: "conversation",
      content: summary,
    });
  } catch (error) {
    logger.warn({ err: error }, "Failed to store agent memory");
  }
}

async function runPendingConfirmation(
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
  if (process.env.AI_ENABLED === "false") return null;
  const body = (args.body ?? "").trim();
  if (!body) return null;

  const phone = args.phone ?? args.employee?.phone;
  if (!phone || !args.employee?.id || !args.workspaceId) return null;

  const config = await resolveAiConfig(args.workspaceId);
  if (!config) return null;

  // Employees are for standups: without AI access they get the keywords.
  const staff = isStaffRole(args.roleName);
  const policy = await getAiPolicy(args.workspaceId);
  if (!staff && !policy.allowEmployees) return null;

  const channel = args.channel ?? "whatsapp";
  const tools = staff ? AI_TOOLS : AI_TOOLS.filter((t) => EMPLOYEE_TOOL_NAMES.has(t.function.name));
  let modelCalled = false;
  let usedModel = config.model;

  try {
    const confirmationReply = await runPendingConfirmation(
      phone,
      body,
      args,
    );
    if (confirmationReply) {
      await persistExchange(
        args.workspaceId,
        args.employee.id,
        channel,
        body,
        confirmationReply,
      );
      return confirmationReply;
    }

    const maxChars = staff ? MAX_MESSAGE_CHARS.staff : MAX_MESSAGE_CHARS.employee;
    if (body.length > maxChars) {
      return `Pesan terlalu panjang untuk asisten AI (maksimal ${maxChars} karakter). Persingkat pesannya.`;
    }
    const used = await countAiUsageToday(args.workspaceId, args.employee.id);
    if (used.workspace >= policy.workspaceDailyLimit) {
      return "Batas harian asisten AI untuk workspace ini sudah tercapai. Coba lagi besok, atau ketik BANTUAN untuk perintah standup.";
    }
    if (!staff && used.employee >= policy.employeeDailyLimit) {
      return `Kamu sudah memakai ${policy.employeeDailyLimit} pesan AI hari ini. Untuk standup, gunakan STANDUP atau ketik BANTUAN.`;
    }

    const system = await buildAgentContext({
      workspaceId: args.workspaceId,
      employee: args.employee,
      roleName: args.roleName,
    });
    const history = await getConversationHistory(args.employee.id, 5);

    const messages: ChatMessage[] = [
      { role: "system", content: system },
      ...history,
      { role: "user", content: body },
    ];

    let finalText: string | null = null;
    let usage: Parameters<typeof logUsage>[3] = null;

    for (let i = 0; i < MAX_ITERATIONS; i++) {
      modelCalled = true;
      const result = await chatWithTools(config, messages, tools);
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

        if (!tools.some((t) => t.function.name === name)) {
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            content: JSON.stringify({ ok: false, error: "This tool is not available to this user." }),
          });
          continue;
        }

        if (MUTATING_TOOLS.has(name)) {
          // Mutating tools never run immediately; they wait for a YES/NO reply.
          const prepared = await prepareTool(name, parsed, toolContext(args));
          if (prepared && !prepared.ok) {
            // Let the model ask for the missing or ambiguous detail.
            messages.push({
              role: "tool",
              tool_call_id: call.id,
              content: JSON.stringify(prepared),
            });
            continue;
          }
          const summary = prepared ? confirmationText(prepared.summary) : pendingSummary(name, parsed);
          pendingActions.set(pendingKey(args.workspaceId, phone), {
            tool: name,
            args: prepared ? prepared.args : parsed,
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

    await logUsage(args.workspaceId, args.employee.id, usedModel, usage);
    await persistExchange(
      args.workspaceId,
      args.employee.id,
      channel,
      body,
      finalText,
    );
    return finalText;
  } catch (error) {
    // Failed calls still count toward the daily limits.
    if (modelCalled) await logUsage(args.workspaceId, args.employee.id, usedModel, null);
    if (error instanceof HttpError) {
      if (error.status === 400) return null;
      logger.warn({ err: error }, "AI request rejected");
    } else {
      logger.error({ err: error }, "AI message handling failed");
    }
    if (error instanceof AiProviderError && (error.isKeyRejected || error.status === 429)) {
      return "Asisten AI sedang tidak tersedia: API key workspace ini ditolak atau kuotanya habis. Admin dapat memperbaruinya di Pengaturan → AI.";
    }
    return "Sorry, something went wrong on my side. Please try again later.";
  }
}
