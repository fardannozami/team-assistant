import { AiProviderError, type ChatMessage } from "./client.js";
import { resolveAiConfig } from "./settings.js";
import {
  countAiUsageToday,
  EMPLOYEE_TOOL_NAMES,
  getAiPolicy,
  isStaffRole,
  MAX_MESSAGE_CHARS,
} from "./policy.js";
import { buildAgentContext } from "./context.js";
import { getConversationHistory } from "./conversation.js";
import { runAgentLoop, type LoopState } from "./loop.js";
import { runPendingConfirmation, type ToolContextInput } from "./pending.js";
import { logger, logUsage, persistExchange } from "./persistence.js";
import { AI_TOOLS } from "./tools.js";
import { HttpError } from "../../lib/http-error.js";

export { isPendingConfirmationReply, type ToolContextInput } from "./pending.js";

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
  // Deactivated employees no longer get the assistant.
  if (!args.employee.isActive) return null;

  const config = await resolveAiConfig(args.workspaceId);
  if (!config) return null;

  // Employees are for standups: without AI access they get the keywords.
  const staff = isStaffRole(args.roleName);
  const policy = await getAiPolicy(args.workspaceId);
  if (!staff && !policy.allowEmployees) return null;

  const channel = args.channel ?? "whatsapp";
  const tools = staff ? AI_TOOLS : AI_TOOLS.filter((t) => EMPLOYEE_TOOL_NAMES.has(t.function.name));
  const state: LoopState = { modelCalled: false, model: config.model, usage: null };
  let usageLogged = false;

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

    const finalText =
      (await runAgentLoop(config, messages, tools, args, phone, state)) ??
      "I could not finish that request. Please try again.";

    await logUsage(args.workspaceId, args.employee.id, state.model, state.usage);
    usageLogged = true;
    // The model has answered (and may have queued an action): failing to
    // save the history must not turn that into "something went wrong".
    try {
      await persistExchange(
        args.workspaceId,
        args.employee.id,
        channel,
        body,
        finalText,
      );
    } catch (error) {
      logger.warn({ err: error }, "Failed to store AI conversation");
    }
    return finalText;
  } catch (error) {
    // Failed calls still count toward the daily limits, once.
    if (state.modelCalled && !usageLogged) await logUsage(args.workspaceId, args.employee.id, state.model, null);
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
