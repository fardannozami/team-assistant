import { isLidUser, isPnUser, type WAMessage } from "@whiskeysockets/baileys";
import { whatsappMessages } from "@repo/database";
import { getEmployeeByPhone, getRoleName } from "../../auth/index.js";
import { handleStandupMessage } from "../../standups/engine.js";
import { handleCheckinMessage } from "../../checkins/engine.js";
import { handleAdminMessage } from "../admin.js";
import { replyText } from "./send.js";
import { db, logger, markProcessed, type BotState, type Socket } from "./state.js";

type Employee = NonNullable<Awaited<ReturnType<typeof getEmployeeByPhone>>>;

/** The sender's phone number, resolving WhatsApp LIDs where possible. */
async function senderPhone(workspaceId: string, socket: Socket, msg: WAMessage, from: string) {
  const altJid = (msg.key as any).remoteJidAlt ?? (msg.key as any).participantAlt;
  let phone = altJid ? String(altJid).replace(/@s\.whatsapp\.net$/, "") : from.replace(/@s\.whatsapp\.net$/, "");
  if (phone.includes("@lid") || String(from).endsWith("@lid")) {
    const lid = String(from).endsWith("@lid") ? from : phone;
    try {
      const resolved = await (socket as any).signalRepository?.lidMapping?.getPNForLID?.(lid);
      if (resolved) phone = String(resolved).replace(/@s\.whatsapp\.net$/, "");
    } catch (e) {
      logger.warn({ workspaceId, lid, error: e }, "Failed to resolve LID to PN");
    }
  }
  return String(phone).replace(/@lid$/, "").replace(/:\d+$/, "").trim();
}

/** Tries each handler in turn for a registered employee; returns the reply. */
async function employeeReply(
  workspaceId: string,
  phone: string,
  body: string,
  employee: Employee,
  roleName: string | null,
): Promise<string | null> {
  // Imported lazily to avoid circular dependencies.
  const { handleAiMessage, isPendingConfirmationReply } = await import("../../ai/service.js");

  // A YES/NO to an AI action goes to the AI first, before an open
  // check-in or standup can take it as an answer.
  if (isPendingConfirmationReply(workspaceId, phone, body)) {
    const aiReply = await handleAiMessage({ workspaceId, phone, body, employee, roleName });
    if (aiReply) return aiReply;
  }

  const checkinReply = await handleCheckinMessage({ employee, body });
  if (checkinReply) return checkinReply;

  const standupReply = await handleStandupMessage({ employee, body });
  if (standupReply) return standupReply;

  // M7: AI agent is the last fallback for registered employees.
  const aiReply = await handleAiMessage({ workspaceId, phone, body, employee, roleName });
  if (aiReply) return aiReply;

  logger.info(
    { workspaceId, phone, body },
    "Employee message had no open standup session and no AI reply",
  );
  // Without AI nothing else understands free text; point to the keywords.
  // Stickers, images and reactions have no text: stay quiet for those.
  return body.trim() ? "Pesan belum dikenali. Ketik BANTUAN untuk melihat perintah standup." : null;
}

export async function handleIncomingMessage(state: BotState, socket: Socket, msg: WAMessage) {
  const { workspaceId } = state;
  if (!msg.message || msg.key.fromMe) return;
  // Only 1:1 chats. In groups the sender's phone still resolves (via
  // participantAlt) but replies would go to the whole group; status
  // updates, broadcasts and newsletters aren't meant for the bot either.
  if (!isPnUser(msg.key.remoteJid ?? "") && !isLidUser(msg.key.remoteJid ?? "")) return;
  const id = msg.key.id;
  if (!id || !markProcessed(state, id)) return;

  const from = msg.key.remoteJid ?? "";
  const phone = await senderPhone(workspaceId, socket, msg, from);
  const body =
    msg.message.conversation ||
    msg.message.extendedTextMessage?.text ||
    "";

  try {
    // persist incoming
    await db
      .insert(whatsappMessages)
      .values({
        workspaceId,
        messageId: id,
        fromPhone: phone,
        direction: "inbound",
        body,
        raw: msg as any,
      })
      .onConflictDoNothing({ target: [whatsappMessages.workspaceId, whatsappMessages.messageId] });

    const found = await getEmployeeByPhone(workspaceId, phone);
    // Deactivated employees are treated like unregistered numbers.
    const employee = found?.isActive ? found : null;
    const roleName = employee ? await getRoleName(employee.roleId) : null;

    if (!found) {
      logger.warn({ workspaceId, phone }, "Incoming message from unknown number");
    } else if (!employee) {
      logger.info({ workspaceId, phone }, "Incoming message from inactive employee");
    }

    const reply =
      (await handleAdminMessage({ workspaceId, phone, body, employee, roleName })) ??
      (employee ? await employeeReply(workspaceId, phone, body, employee, roleName) : null);
    if (reply) {
      await replyText(workspaceId, from, reply);
      return;
    }
    if (!employee) logger.info({ workspaceId, phone, body }, "Incoming message");
  } catch (error) {
    logger.error({ workspaceId, phone, body, error }, "Failed to handle incoming message");
  }
}
