import makeWASocket, { useMultiFileAuthState } from "@whiskeysockets/baileys";
import pino from "pino";
import { handleConnectionUpdate } from "./connection.js";
import { handleIncomingMessage } from "./inbound.js";
import {
  bots,
  clearReconnect,
  getBaileysVersion,
  getOrCreateState,
  removeSessionDir,
  sessionDir,
  setSessionActive,
  starting,
  type Socket,
} from "./state.js";

export function startWhatsApp(workspaceId: string): Promise<Socket> {
  return startBot(workspaceId);
}

export function startBot(workspaceId: string, pairingPhone?: string): Promise<Socket> {
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
    await handleConnectionUpdate(state, socket, update, () => startWhatsApp(workspaceId));
  });

  socket.ev.on("messages.upsert", async ({ messages, type }) => {
    if (!isCurrent()) return;
    if (type !== "notify") return;
    for (const msg of messages) {
      await handleIncomingMessage(state, socket, msg);
    }
  });

  return socket;
}

/** Ends a bot's socket without logging out, so its creds stay usable. */
export async function endBot(workspaceId: string) {
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
