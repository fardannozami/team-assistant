import { whatsappMessages } from "@repo/database";
import { bots, db, logger } from "./state.js";

// Replies "type" for a while before sending so the bot feels less instant.
const TYPING_MIN_MS = 1_000;
const TYPING_MAX_MS = 4_000;
const TYPING_MS_PER_CHAR = 25;

function typingDelay(text: string) {
  const jitter = Math.random() * 500;
  return Math.min(TYPING_MAX_MS, TYPING_MIN_MS + text.length * TYPING_MS_PER_CHAR + jitter);
}

// Reply to an incoming message: show "typing…", wait, then send.
export async function replyText(workspaceId: string, jid: string, text: string) {
  const socket = bots.get(workspaceId)?.sock;
  try {
    await socket?.presenceSubscribe(jid);
    await socket?.sendPresenceUpdate("composing", jid);
  } catch (error) {
    // Presence is cosmetic; never block the reply on it.
    logger.warn({ workspaceId, jid, error }, "Failed to send typing presence");
  }
  await new Promise((resolve) => setTimeout(resolve, typingDelay(text)));
  try {
    await socket?.sendPresenceUpdate("paused", jid);
  } catch {
    // ignore
  }
  await sendText(workspaceId, jid, text);
}

/** Sends a file (e.g. a fee statement PDF) with an optional caption. */
export async function sendDocument(
  workspaceId: string,
  jid: string,
  file: { buffer: Buffer; fileName: string; mimetype: string; caption?: string },
) {
  const socket = bots.get(workspaceId)?.sock;
  if (!socket) throw new Error("WhatsApp not connected");
  await socket.sendMessage(jid, {
    document: file.buffer,
    mimetype: file.mimetype,
    fileName: file.fileName,
    caption: file.caption,
  });
  await db
    .insert(whatsappMessages)
    .values({
      workspaceId,
      messageId: `out-${Date.now()}-${Math.random()}`,
      fromPhone: "bot",
      toPhone: jid.replace(/@s\.whatsapp\.net$/, ""),
      direction: "outbound",
      body: `[${file.fileName}]${file.caption ? ` ${file.caption}` : ""}`,
    })
    .onConflictDoNothing({ target: [whatsappMessages.workspaceId, whatsappMessages.messageId] });
}

export async function sendText(workspaceId: string, jid: string, text: string) {
  const socket = bots.get(workspaceId)?.sock;
  if (!socket) throw new Error("WhatsApp not connected");
  await socket.sendMessage(jid, { text });
  await db
    .insert(whatsappMessages)
    .values({
      workspaceId,
      messageId: `out-${Date.now()}-${Math.random()}`,
      fromPhone: "bot",
      toPhone: jid.replace(/@s\.whatsapp\.net$/, ""),
      direction: "outbound",
      body: text,
    })
    .onConflictDoNothing({ target: [whatsappMessages.workspaceId, whatsappMessages.messageId] });
}
