import { chatWithTools, type AiConfig, type ChatMessage, type ToolSpec } from "./client.js";
import { pendingSummary } from "./pending-summary.js";
import { setPendingAction, toolContext, type ToolContextInput } from "./pending.js";
import type { Usage } from "./persistence.js";
import { confirmationText, executeTool, MUTATING_TOOLS, prepareTool } from "./tools.js";

// Room for a lookup (e.g. list_employees) before the action and the reply.
const MAX_ITERATIONS = 4;

/** Filled in while the loop runs, so a caller can still log usage on failure. */
export type LoopState = { modelCalled: boolean; model: string; usage: Usage };

function toolMessage(id: string, content: unknown): ChatMessage {
  return { role: "tool", tool_call_id: id, content: JSON.stringify(content) };
}

function parseArguments(raw: string | undefined): Record<string, unknown> {
  try {
    return JSON.parse(raw || "{}");
  } catch {
    return {};
  }
}

/**
 * Runs the model with tools until it answers in text or queues a mutating
 * action for confirmation. Returns null when it runs out of iterations.
 */
export async function runAgentLoop(
  config: AiConfig,
  messages: ChatMessage[],
  tools: ToolSpec[],
  ctx: ToolContextInput,
  phone: string,
  state: LoopState,
): Promise<string | null> {
  for (let i = 0; i < MAX_ITERATIONS; i++) {
    state.modelCalled = true;
    const result = await chatWithTools(config, messages, tools);
    state.model = result.model;
    state.usage = result.usage ?? state.usage;
    messages.push(result.message);

    const toolCalls = result.message.tool_calls ?? [];
    if (toolCalls.length === 0) {
      return (result.message.content ?? "").trim() || null;
    }

    for (const call of toolCalls) {
      const name = call.function?.name ?? "";
      const parsed = parseArguments(call.function?.arguments);

      if (!tools.some((t) => t.function.name === name)) {
        messages.push(toolMessage(call.id, { ok: false, error: "This tool is not available to this user." }));
        continue;
      }

      if (MUTATING_TOOLS.has(name)) {
        // Mutating tools never run immediately; they wait for a YES/NO reply.
        const prepared = await prepareTool(name, parsed, toolContext(ctx));
        if (prepared && !prepared.ok) {
          // Let the model ask for the missing or ambiguous detail.
          messages.push(toolMessage(call.id, prepared));
          continue;
        }
        const summary = prepared ? confirmationText(prepared.summary) : pendingSummary(name, parsed);
        setPendingAction(ctx.workspaceId, phone, name, prepared ? prepared.args : parsed);
        messages.push(toolMessage(call.id, { ok: true, pending: summary }));
        return summary;
      }

      const toolResult = await executeTool(name, parsed, toolContext(ctx));
      messages.push(toolMessage(call.id, toolResult));
    }
  }
  return null;
}
