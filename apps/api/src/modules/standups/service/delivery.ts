import { createDbClient } from "@repo/database";
import { getWhatsAppStatus, sendText } from "../../whatsapp/service.js";

export const db = createDbClient(
  process.env.DATABASE_URL ??
    "postgres://teamassistant:teamassistant@localhost:5432/teamassistant",
);

export type SendFn = (jid: string, text: string) => Promise<void>;

// Returned instead of creating sessions whose prompts could not be sent.
export const NOT_CONNECTED = {
  sent: 0,
  failed: 0,
  whatsappConnected: false,
  reason: "WhatsApp is not connected for this workspace",
} as const;

export function jidFor(phone: string) {
  return `${phone}@s.whatsapp.net`;
}

/** The caller's transport, or the workspace's WhatsApp bot. */
export function senderFor(workspaceId: string, send?: SendFn): SendFn {
  return send ?? ((jid, text) => sendText(workspaceId, jid, text));
}

/** True when sends would go to a WhatsApp bot that is not connected. */
export function notConnected(workspaceId: string, send?: SendFn) {
  return !send && !getWhatsAppStatus(workspaceId).connected;
}

export async function excludedDay(workspaceId: string, date: string) {
  const { isExcludedDate } = await import("../../holidays/service.js");
  return isExcludedDate(workspaceId, date);
}
