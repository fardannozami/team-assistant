import { DisconnectReason, type ConnectionState } from "@whiskeysockets/baileys";
import { whatsappSessions } from "@repo/database";
import { and, eq, ne, sql } from "drizzle-orm";
import {
  botPhoneFromJid,
  bots,
  clearReconnect,
  db,
  logger,
  removeSessionDir,
  setSessionActive,
  type BotState,
  type Socket,
} from "./state.js";

const MAX_RECONNECT_DELAY_MS = 60_000;

/**
 * Reconnect with exponential backoff (and a longer base for 440 conflict).
 * A tight reconnect loop — e.g. when another instance holds the same session
 * or WhatsApp replaced the connection — makes the conflict worse.
 */
function scheduleReconnect(state: BotState, statusCode: number | undefined, restart: () => Promise<unknown>) {
  if (state.reconnectTimer) return;
  const base = statusCode === 440 ? 15_000 : 1_000;
  const delay = Math.min(
    MAX_RECONNECT_DELAY_MS,
    base * 2 ** Math.min(state.reconnectAttempts, 5),
  );
  state.reconnectAttempts += 1;
  logger.warn({ workspaceId: state.workspaceId, delay, statusCode }, "Scheduling WhatsApp reconnect");
  state.reconnectTimer = setTimeout(() => {
    state.reconnectTimer = null;
    if (bots.get(state.workspaceId) !== state) return;
    restart().catch((e) => logger.error(e));
  }, delay);
  state.reconnectTimer.unref?.();
}

/**
 * One WhatsApp number cannot serve two workspaces. Check and claim it in one
 * transaction, locked per number, so two workspaces linking the same phone at
 * the same moment cannot both keep it. Returns the other workspace on a clash.
 */
async function claimBotPhone(workspaceId: string, botPhone: string | null) {
  return db.transaction(async (tx) => {
    if (botPhone) {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`wa-bot:${botPhone}`}))`);
      const [other] = await tx
        .select({ workspaceId: whatsappSessions.workspaceId })
        .from(whatsappSessions)
        .where(
          and(
            eq(whatsappSessions.botPhone, botPhone),
            eq(whatsappSessions.isActive, true),
            ne(whatsappSessions.workspaceId, workspaceId),
          ),
        )
        .limit(1);
      if (other) return other;
    }
    await tx
      .update(whatsappSessions)
      .set({ botPhone, lastConnectedAt: new Date(), updatedAt: new Date() })
      .where(eq(whatsappSessions.workspaceId, workspaceId));
    return null;
  });
}

async function onOpen(state: BotState, socket: Socket) {
  const { workspaceId } = state;
  state.qr = null;
  state.pairingCode = null;
  state.pairingPhone = null;
  state.reconnectAttempts = 0;
  clearReconnect(state);

  const botPhone = botPhoneFromJid(socket.user?.id);
  try {
    const clash = await claimBotPhone(workspaceId, botPhone);
    if (clash) {
      logger.error(
        { workspaceId, botPhone, otherWorkspaceId: clash.workspaceId },
        "WhatsApp number is already the bot of another workspace; disconnecting",
      );
      state.sock = null;
      bots.delete(workspaceId);
      await socket.end(undefined);
      await setSessionActive(workspaceId, false);
      return;
    }
  } catch (error) {
    logger.error({ workspaceId, error }, "Failed to update WhatsApp session registry");
  }
  logger.info({ workspaceId, botPhone }, "WhatsApp connected");
}

export async function handleConnectionUpdate(
  state: BotState,
  socket: Socket,
  update: Partial<ConnectionState>,
  restart: () => Promise<unknown>,
) {
  const { workspaceId } = state;
  const { connection, lastDisconnect, qr, isNewLogin } = update;
  if (qr && !state.pairingPhone) {
    state.qr = qr;
    logger.info({ workspaceId }, "QR code updated");
  }
  if (isNewLogin) {
    state.pairingCode = null;
    state.pairingPhone = null;
  }
  if (connection === "close") {
    const statusCode = (lastDisconnect?.error as any)?.output?.statusCode;
    const loggedOut = statusCode === DisconnectReason.loggedOut;
    state.sock = null;
    state.qr = null;
    logger.warn({ workspaceId, statusCode, shouldReconnect: !loggedOut }, "Connection closed");
    if (loggedOut) {
      clearReconnect(state);
      bots.delete(workspaceId);
      try {
        await setSessionActive(workspaceId, false);
      } catch (error) {
        logger.error({ workspaceId, error }, "Failed to deactivate WhatsApp session");
      }
      await removeSessionDir(workspaceId);
    } else {
      scheduleReconnect(state, statusCode, restart);
    }
  } else if (connection === "open") {
    await onOpen(state, socket);
  }
}
