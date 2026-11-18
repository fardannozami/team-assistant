import { rm } from "node:fs/promises";
import path from "node:path";
import { fetchLatestBaileysVersion, type WAVersion } from "@whiskeysockets/baileys";
import type makeWASocket from "@whiskeysockets/baileys";
import pino from "pino";
import { createDbClient, whatsappSessions } from "@repo/database";

export const logger = pino({ level: process.env.LOG_LEVEL ?? "info" });
export const db = createDbClient(process.env.DATABASE_URL ?? "postgres://teamassistant:teamassistant@localhost:5432/teamassistant");

// One Baileys session directory per workspace under this root.
export const SESSIONS_ROOT = process.env.WHATSAPP_SESSIONS_DIR ?? "./data/whatsapp-sessions";

const MAX_PROCESSED_IDS = 5_000;

export type Socket = ReturnType<typeof makeWASocket>;

export type BotState = {
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
export const bots: Map<string, BotState> = (g.__taBots ??= new Map());
export const starting: Map<string, Promise<Socket>> = (g.__taBotStarts ??= new Map());

export function sessionDir(workspaceId: string) {
  return path.join(SESSIONS_ROOT, workspaceId);
}

export function getBaileysVersion(): Promise<WAVersion> {
  g.__taBaileysVersion ??= fetchLatestBaileysVersion()
    .then((r) => r.version)
    .catch((error) => {
      g.__taBaileysVersion = undefined;
      throw error;
    });
  return g.__taBaileysVersion;
}

export function getOrCreateState(workspaceId: string): BotState {
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

export function clearReconnect(state: BotState) {
  if (state.reconnectTimer) {
    clearTimeout(state.reconnectTimer);
    state.reconnectTimer = null;
  }
}

/** Remembers a message id; returns false when it was already processed. */
export function markProcessed(state: BotState, id: string): boolean {
  if (state.processedIds.has(id)) return false;
  state.processedIds.add(id);
  if (state.processedIds.size > MAX_PROCESSED_IDS) {
    const oldest = state.processedIds.values().next().value;
    if (oldest !== undefined) state.processedIds.delete(oldest);
  }
  return true;
}

export async function setSessionActive(workspaceId: string, isActive: boolean) {
  await db
    .insert(whatsappSessions)
    .values({ workspaceId, sessionKey: workspaceId, isActive })
    .onConflictDoUpdate({
      target: whatsappSessions.workspaceId,
      set: { sessionKey: workspaceId, isActive, updatedAt: new Date() },
    });
}

export async function removeSessionDir(workspaceId: string) {
  try {
    await rm(sessionDir(workspaceId), { recursive: true, force: true });
  } catch {
    // ignore
  }
}

/** "628123456789:12@s.whatsapp.net" -> "628123456789" */
export function botPhoneFromJid(jid: string | undefined): string | null {
  if (!jid) return null;
  const phone = jid.split("@")[0]?.split(":")[0]?.trim();
  return phone || null;
}
