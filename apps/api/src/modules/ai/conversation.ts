import { and, desc, eq } from "drizzle-orm";
import { createDbClient, conversationMessages, conversations } from "@repo/database";
import { dateInTimezone, DEFAULT_TIMEZONE } from "@repo/shared";

const db = createDbClient(
  process.env.DATABASE_URL ??
    "postgres://teamassistant:teamassistant@localhost:5432/teamassistant",
);

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
