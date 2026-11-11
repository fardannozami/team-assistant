import { existsSync } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  type ConnectionState,
  type WAVersion,
} from "@whiskeysockets/baileys";
import pino from "pino";
import { createDbClient } from "@repo/database";
import { whatsappSessions, whatsappMessages, workspaces } from "@repo/database";
import { and, eq, ne } from "drizzle-orm";
import { getEmployeeByPhone, getRoleName } from "../auth/index.js";
import { handleAdminMessage } from "./admin.js";
import { handleStandupMessage } from "../standups/engine.js";

const logger = pino({ level: process.env.LOG_LEVEL ?? "info" });
const db = createDbClient(process.env.DATABASE_URL ?? "postgres://teamassistant:teamassistant@localhost:5432/teamassistant");

// One Baileys session directory per workspace under this root.
const SESSIONS_ROOT = process.env.WHATSAPP_SESSIONS_DIR ?? "./data/whatsapp-sessions";
// Pre-multi-tenant single session directory, migrated on boot.
const LEGACY_SESSION_PATH = process.env.WHATSAPP_SESSION_PATH ?? "./data/whatsapp-session";

const MAX_RECONNECT_DELAY_MS = 60_000;
const MAX_PROCESSED_IDS = 5_000;
const START_SPACING_MS = 1_500;

type Socket = ReturnType<typeof makeWASocket>;

type BotState = {
  workspaceId: string;
  sock: Socket | null;
  qr: string | null;
  pairingCode: string | null;
  pairingPhone: string | null;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  reconnectAttempts: number;
  processedIds: Set<string>;
};

// Kept on globalThis: the API runs with `bun --hot`, and re-evaluating this
// module must not lose track of open sockets (and then open duplicates).
const g = globalThis as any;
const bots: Map<string, BotState> = (g.__taBots ??= new Map());
const starting: Map<string, Promise<Socket>> = (g.__taBotStarts ??= new Map());

function sessionDir(workspaceId: string) {
  return path.join(SESSIONS_ROOT, workspaceId);
}

function getBaileysVersion(): Promise<WAVersion> {
  g.__taBaileysVersion ??= fetchLatestBaileysVersion()
    .then((r) => r.version)
    .catch((error) => {
      g.__taBaileysVersion = undefined;
      throw error;
    });
  return g.__taBaileysVersion;
}

function getOrCreateState(workspaceId: string): BotState {
  let state = bots.get(workspaceId);
  if (!state) {
    state = {
      workspaceId,
      sock: null,
      qr: null,
      pairingCode: null,
      pairingPhone: null,
      reconnectTimer: null,
      reconnectAttempts: 0,
      processedIds: new Set(),
    };
    bots.set(workspaceId, state);
  }
  return state;
}

function clearReconnect(state: BotState) {
  if (state.reconnectTimer) {
    clearTimeout(state.reconnectTimer);
    state.reconnectTimer = null;
  }
}

/** Remembers a message id; returns false when it was already processed. */
function markProcessed(state: BotState, id: string): boolean {
  if (state.processedIds.has(id)) return false;
  state.processedIds.add(id);
  if (state.processedIds.size > MAX_PROCESSED_IDS) {
    const oldest = state.processedIds.values().next().value;
    if (oldest !== undefined) state.processedIds.delete(oldest);
  }
  return true;
}

async function setSessionActive(workspaceId: string, isActive: boolean) {
  await db
    .insert(whatsappSessions)
    .values({ workspaceId, sessionKey: workspaceId, isActive })
    .onConflictDoUpdate({
      target: whatsappSessions.workspaceId,
      set: { sessionKey: workspaceId, isActive, updatedAt: new Date() },
    });
}

async function removeSessionDir(workspaceId: string) {
  try {
    await rm(sessionDir(workspaceId), { recursive: true, force: true });
  } catch {
    // ignore
  }
}

/** "628123456789:12@s.whatsapp.net" -> "628123456789" */
function botPhoneFromJid(jid: string | undefined): string | null {
  if (!jid) return null;
  const phone = jid.split("@")[0]?.split(":")[0]?.trim();
  return phone || null;
}

/**
 * Reconnect with exponential backoff (and a longer base for 440 conflict).
 * A tight reconnect loop — e.g. when another instance holds the same session
 * or WhatsApp replaced the connection — makes the conflict worse.
 */
function scheduleReconnect(state: BotState, statusCode: number | undefined) {
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
    startWhatsApp(state.workspaceId).catch((e) => logger.error(e));
  }, delay);
  state.reconnectTimer.unref?.();
}

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

export function normalizePhoneNumber(input: string): string {
  const digits = (input ?? "").replace(/\D/g, "");
  if (!/^\d{7,15}$/.test(digits)) {
    throw new Error("Phone number must include the country code (7-15 digits, no +, spaces or dashes)");
  }
  return digits;
}

export function startWhatsApp(workspaceId: string): Promise<Socket> {
  return startBot(workspaceId);
}

function startBot(workspaceId: string, pairingPhone?: string): Promise<Socket> {
  const existing = bots.get(workspaceId)?.sock;
  if (existing) return Promise.resolve(existing);
  const pending = starting.get(workspaceId);
  if (pending) return pending;

  const promise = openSocket(workspaceId, pairingPhone).finally(() => {
    starting.delete(workspaceId);
  });
  starting.set(workspaceId, promise);
  return promise;
}

async function openSocket(workspaceId: string, pairingPhone?: string): Promise<Socket> {
  const state = getOrCreateState(workspaceId);
  clearReconnect(state);
  if (pairingPhone !== undefined) {
    state.pairingPhone = pairingPhone;
    state.pairingCode = null;
  }

  await setSessionActive(workspaceId, true);

  const { state: auth, saveCreds } = await useMultiFileAuthState(sessionDir(workspaceId));
  const version = await getBaileysVersion();

  // A previous pairing attempt may have persisted `me` without completing
  // registration, which makes Baileys log in instead of registering.
  if (!auth.creds.registered) {
    delete auth.creds.me;
  }

  const socket = makeWASocket({
    version,
    printQRInTerminal: false,
    auth,
    logger: pino({ level: "silent" }),
  });
  state.sock = socket;

  const isCurrent = () => bots.get(workspaceId) === state && state.sock === socket;

  socket.ev.on("creds.update", saveCreds);

  socket.ev.on("connection.update", async (update) => {
    if (!isCurrent()) return;

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
        scheduleReconnect(state, statusCode);
      }
    } else if (connection === "open") {
      state.qr = null;
      state.pairingCode = null;
      state.pairingPhone = null;
      state.reconnectAttempts = 0;
      clearReconnect(state);

      const botPhone = botPhoneFromJid(socket.user?.id);
      try {
        if (botPhone) {
          // One WhatsApp number cannot serve two workspaces.
          const [clash] = await db
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
        }
        await db
          .update(whatsappSessions)
          .set({ botPhone, lastConnectedAt: new Date(), updatedAt: new Date() })
          .where(eq(whatsappSessions.workspaceId, workspaceId));
      } catch (error) {
        logger.error({ workspaceId, error }, "Failed to update WhatsApp session registry");
      }
      logger.info({ workspaceId, botPhone }, "WhatsApp connected");
    }
  });

  socket.ev.on("messages.upsert", async ({ messages, type }) => {
    if (!isCurrent()) return;
    if (type !== "notify") return;
    for (const msg of messages) {
      if (!msg.message || msg.key.fromMe) continue;
      const id = msg.key.id;
      if (!id || !markProcessed(state, id)) continue;

      const from = msg.key.remoteJid ?? "";
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
      phone = String(phone).replace(/@lid$/, "").replace(/:\d+$/, "").trim();
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

        const employee = await getEmployeeByPhone(workspaceId, phone);
        const roleName = employee ? await getRoleName(employee.roleId) : null;

        if (!employee) {
          logger.warn({ workspaceId, phone }, "Incoming message from unknown number");
        }

        const reply = await handleAdminMessage({
          workspaceId,
          phone,
          body,
          employee,
          roleName,
        });
        if (reply) {
          await sendText(workspaceId, from, reply);
          continue;
        }

        if (employee) {
          const standupReply = await handleStandupMessage({ employee, body });
          if (standupReply) {
            await sendText(workspaceId, from, standupReply);
            continue;
          }

          // M7: AI agent is the last fallback for registered employees.
          // Imported lazily to avoid circular dependencies.
          const { handleAiMessage } = await import("../ai/service.js");
          const aiReply = await handleAiMessage({ workspaceId, phone, body, employee, roleName });
          if (aiReply) {
            await sendText(workspaceId, from, aiReply);
            continue;
          }

          logger.info(
            { workspaceId, phone, body },
            "Employee message had no open standup session and no AI reply",
          );
        }

        logger.info({ workspaceId, phone, body }, "Incoming message");
      } catch (error) {
        logger.error({ workspaceId, phone, body, error }, "Failed to handle incoming message");
      }
    }
  });

  return socket;
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

function waitForRegistrationChannel(socket: Socket): Promise<void> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      cleanup();
      resolve();
    }, 5_000);

    function cleanup() {
      clearTimeout(timeout);
      socket.ev.off("connection.update", onUpdate);
    }

    function onUpdate(update: Partial<ConnectionState>) {
      if (update.qr || update.connection === "open") {
        cleanup();
        resolve();
      }
    }

    socket.ev.on("connection.update", onUpdate);
  });
}

export async function pairWithPhoneNumber(workspaceId: string, phoneNumber: string): Promise<string> {
  const normalized = normalizePhoneNumber(phoneNumber);

  if (bots.get(workspaceId)?.sock?.authState.creds.registered) {
    throw new Error("WhatsApp is already paired. Stop and reset the session before pairing again.");
  }

  await stopWhatsApp(workspaceId);

  try {
    const socket = await startBot(workspaceId, normalized);

    // requestPairingCode sends an encrypted node, so wait until the noise
    // handshake has completed (signalled by the first qr update).
    await waitForRegistrationChannel(socket);

    const code = await socket.requestPairingCode(normalized);

    const state = bots.get(workspaceId);
    if (!state || state.sock !== socket) {
      throw new Error("WhatsApp connection closed while requesting the pairing code");
    }

    state.pairingCode = code;
    logger.info({ workspaceId, phoneNumber: normalized }, "Pairing code generated");
    return code;
  } catch (error) {
    await stopWhatsApp(workspaceId);
    throw error;
  }
}

/** Ends a bot's socket without logging out, so its creds stay usable. */
async function endBot(workspaceId: string) {
  await starting.get(workspaceId)?.catch(() => undefined);
  const state = bots.get(workspaceId);
  if (!state) return;
  clearReconnect(state);
  bots.delete(workspaceId);
  const current = state.sock;
  state.sock = null;
  state.qr = null;
  state.pairingCode = null;
  state.pairingPhone = null;
  await current?.end(undefined);
}

export async function stopWhatsApp(workspaceId: string) {
  await endBot(workspaceId);
  await setSessionActive(workspaceId, false);
  // Remove persisted session so the next start/pairing begins fresh.
  await removeSessionDir(workspaceId);
}

/** Ends every bot (shutdown). Sessions stay active and are resumed on boot. */
export async function stopAllWhatsApp() {
  const ids = new Set([...bots.keys(), ...starting.keys()]);
  await Promise.all([...ids].map((id) => endBot(id).catch((e) => logger.error(e))));
}

/**
 * Moves the pre-multi-tenant session directory to the workspace that the
 * migration assigned it to (whatsapp_sessions.session_key = 'legacy').
 */
async function migrateLegacySession() {
  const [legacy] = await db
    .select()
    .from(whatsappSessions)
    .where(eq(whatsappSessions.sessionKey, "legacy"))
    .limit(1);
  if (!legacy) return;

  const target = sessionDir(legacy.workspaceId);
  const hasLegacyCreds = existsSync(path.join(LEGACY_SESSION_PATH, "creds.json"));
  if (hasLegacyCreds && !existsSync(target)) {
    await mkdir(SESSIONS_ROOT, { recursive: true });
    await rename(LEGACY_SESSION_PATH, target);
    logger.info({ workspaceId: legacy.workspaceId, target }, "Migrated legacy WhatsApp session");
  }

  // The directory may already have been moved by a run that crashed before this update.
  const hasCreds = existsSync(path.join(target, "creds.json"));
  await db
    .update(whatsappSessions)
    .set({
      sessionKey: legacy.workspaceId,
      ...(hasCreds ? {} : { isActive: false }),
      updatedAt: new Date(),
    })
    .where(eq(whatsappSessions.id, legacy.id));
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
