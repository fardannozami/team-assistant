import { existsSync } from "node:fs";
import path from "node:path";
import { whatsappSessions, workspaces } from "@repo/database";
import { and, eq } from "drizzle-orm";
import { migrateLegacySession } from "./bot/legacy.js";
import { endBot, startWhatsApp } from "./bot/lifecycle.js";
import { botPhoneFromJid, bots, db, logger, sessionDir, starting } from "./bot/state.js";

export { startWhatsApp, stopWhatsApp } from "./bot/lifecycle.js";
export { normalizePhoneNumber, pairWithPhoneNumber } from "./bot/pairing.js";
export { sendText } from "./bot/send.js";

const START_SPACING_MS = 1_500;

export function getWhatsAppStatus(workspaceId: string) {
  const state = bots.get(workspaceId);
  const socket = state?.sock;
  const connected = !!socket?.user;
  return {
    connected,
    registered: !!socket?.authState?.creds?.registered,
    pairingCode: state?.pairingCode ?? null,
    phone: connected ? botPhoneFromJid(socket?.user?.id) : null,
  };
}

export function getWhatsAppQr(workspaceId: string) {
  return bots.get(workspaceId)?.qr ?? null;
}

/** Ends every bot (shutdown). Sessions stay active and are resumed on boot. */
export async function stopAllWhatsApp() {
  const ids = new Set([...bots.keys(), ...starting.keys()]);
  await Promise.all([...ids].map((id) => endBot(id).catch((e) => logger.error(e))));
}

/** Boot: resume every active workspace bot that has stored credentials. */
export async function startAllWhatsApp() {
  try {
    await migrateLegacySession();
  } catch (error) {
    logger.error({ err: error }, "Failed to migrate legacy WhatsApp session");
  }

  const rows = await db
    .select({ workspaceId: whatsappSessions.workspaceId })
    .from(whatsappSessions)
    .innerJoin(workspaces, eq(workspaces.id, whatsappSessions.workspaceId))
    .where(and(eq(whatsappSessions.isActive, true), eq(workspaces.isActive, true)));

  let first = true;
  for (const { workspaceId } of rows) {
    if (!existsSync(path.join(sessionDir(workspaceId), "creds.json"))) continue;
    if (!first) await new Promise((resolve) => setTimeout(resolve, START_SPACING_MS));
    first = false;
    try {
      await startWhatsApp(workspaceId);
    } catch (error) {
      logger.error({ workspaceId, error }, "Failed to start WhatsApp bot");
    }
  }
}
