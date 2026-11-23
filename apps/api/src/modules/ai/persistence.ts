import pino from "pino";
import { createDbClient, aiUsageLogs } from "@repo/database";
import { appendConversationMessage } from "./conversation.js";

export const logger = pino({ level: process.env.LOG_LEVEL ?? "info" });

const db = createDbClient(
  process.env.DATABASE_URL ??
    "postgres://teamassistant:teamassistant@localhost:5432/teamassistant",
);

export type Usage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
} | null;

export async function logUsage(
  workspaceId: string,
  employeeId: string,
  model: string,
  usage: Usage,
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

export async function persistExchange(
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
