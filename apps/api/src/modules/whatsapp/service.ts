import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  type ConnectionState,
} from "@whiskeysockets/baileys";
import pino from "pino";
import { createDbClient } from "@repo/database";
import { whatsappSessions, whatsappMessages, employees } from "@repo/database";
import { eq } from "drizzle-orm";
import { getEmployeeByPhone, getRoleName } from "../auth/index.js";
import { handleAdminMessage } from "./admin.js";
import { handleStandupMessage } from "../standups/engine.js";

const logger = pino({ level: process.env.LOG_LEVEL ?? "info" });
const db = createDbClient(process.env.DATABASE_URL ?? "postgres://teamassistant:teamassistant@localhost:5432/teamassistant");

const SESSION_PATH = process.env.WHATSAPP_SESSION_PATH ?? "./data/whatsapp-session";

let sock: ReturnType<typeof makeWASocket> | null = null;
let currentQr: string | null = null;
let currentPairingCode: string | null = null;
let pairingPhoneNumber: string | null = null;
const processedMessageIds = new Set<string>();

export function getQr() {
  return currentQr;
}

export function getPairingCode() {
  return currentPairingCode;
}

export function getSocket(): any {
  return sock;
}

export function normalizePhoneNumber(input: string): string {
  const digits = (input ?? "").replace(/\D/g, "");
  if (!/^\d{7,15}$/.test(digits)) {
    throw new Error("Phone number must include the country code (7-15 digits, no +, spaces or dashes)");
  }
  return digits;
}

export async function startWhatsApp(): Promise<ReturnType<typeof makeWASocket>> {
  if (sock) return sock;

  const { state, saveCreds } = await useMultiFileAuthState(SESSION_PATH);
  const { version } = await fetchLatestBaileysVersion();

  // A previous pairing attempt may have persisted `me` without completing
  // registration, which makes Baileys log in instead of registering.
  if (!state.creds.registered) {
    delete state.creds.me;
  }

  const socket = makeWASocket({
    version,
    printQRInTerminal: false,
    auth: state,
    logger: pino({ level: "silent" }),
  });
  sock = socket;

  socket.ev.on("creds.update", saveCreds);

  socket.ev.on("connection.update", (update) => {
    if (sock !== socket) return;

    const { connection, lastDisconnect, qr, isNewLogin } = update;
    if (qr && !pairingPhoneNumber) {
      currentQr = qr;
      logger.info("QR code updated");
    }
    if (isNewLogin) {
      currentPairingCode = null;
      pairingPhoneNumber = null;
    }
    if (connection === "close") {
      const statusCode = (lastDisconnect?.error as any)?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      sock = null;
      currentQr = null;
      logger.warn({ statusCode, shouldReconnect }, "Connection closed");
      if (shouldReconnect) {
        startWhatsApp().catch((e) => logger.error(e));
      }
    } else if (connection === "open") {
      currentQr = null;
      currentPairingCode = null;
      pairingPhoneNumber = null;
      logger.info("WhatsApp connected");
    }
  });

  socket.ev.on("messages.upsert", async ({ messages, type }) => {
    if (sock !== socket) return;
    if (type !== "notify") return;
    for (const msg of messages) {
      if (!msg.message || msg.key.fromMe) continue;
      const id = msg.key.id;
      if (!id || processedMessageIds.has(id)) continue;
      processedMessageIds.add(id);

      const from = msg.key.remoteJid ?? "";
      const phone = from.replace(/@s\.whatsapp\.net$/, "");
      const body =
        msg.message.conversation ||
        msg.message.extendedTextMessage?.text ||
        "";

      // persist incoming
      await db
        .insert(whatsappMessages)
        .values({
          messageId: id,
          fromPhone: phone,
          direction: "inbound",
          body,
          raw: msg as any,
        })
        .onConflictDoNothing();

      const employee = await getEmployeeByPhone(phone);
      const roleName = employee ? await getRoleName(employee.roleId) : null;

      const reply = await handleAdminMessage({
        phone,
        body,
        employee,
        roleName,
      });
      if (reply) {
        await sendText(from, reply);
        continue;
      }

      if (employee) {
        const standupReply = await handleStandupMessage({ employee, body });
        if (standupReply) {
          await sendText(from, standupReply);
          continue;
        }
      }

      logger.info({ phone, body }, "Incoming message");
    }
  });

  return sock;
}

export async function sendText(jid: string, text: string) {
  if (!sock) throw new Error("WhatsApp not connected");
  await sock.sendMessage(jid, { text });
  await db.insert(whatsappMessages).values({
    messageId: `out-${Date.now()}-${Math.random()}`,
    fromPhone: "bot",
    toPhone: jid.replace(/@s\.whatsapp\.net$/, ""),
    direction: "outbound",
    body: text,
  });
}

function waitForRegistrationChannel(socket: ReturnType<typeof makeWASocket>): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("Timed out waiting for WhatsApp to start the pairing flow"));
    }, 20_000);

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

export async function pairWithPhoneNumber(phoneNumber: string): Promise<string> {
  const normalized = normalizePhoneNumber(phoneNumber);

  if (sock?.authState.creds.registered) {
    throw new Error("WhatsApp is already paired. Stop and reset the session before pairing again.");
  }

  await stopWhatsApp();

  pairingPhoneNumber = normalized;
  currentPairingCode = null;

  try {
    const socket = await startWhatsApp();

    // requestPairingCode sends an encrypted node, so wait until the noise
    // handshake has completed (signalled by the first qr update).
    await waitForRegistrationChannel(socket);

    const code = await socket.requestPairingCode(normalized);

    if (sock !== socket) {
      throw new Error("WhatsApp connection closed while requesting the pairing code");
    }

    currentPairingCode = code;
    logger.info({ phoneNumber: normalized }, "Pairing code generated");
    return code;
  } catch (error) {
    await stopWhatsApp();
    throw error;
  }
}

export async function stopWhatsApp() {
  const current = sock;
  sock = null;
  currentQr = null;
  currentPairingCode = null;
  pairingPhoneNumber = null;
  await current?.end(undefined);
}
