import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
} from "@whiskeysockets/baileys";
import pino from "pino";
import { createDbClient } from "@repo/database";
import { whatsappSessions, whatsappMessages, employees } from "@repo/database";
import { eq } from "drizzle-orm";
import { getEmployeeByPhone } from "../auth/index.js";

const logger = pino({ level: process.env.LOG_LEVEL ?? "info" });
const db = createDbClient(process.env.DATABASE_URL ?? "postgres://teamassistant:teamassistant@localhost:5432/teamassistant");

const SESSION_PATH = process.env.WHATSAPP_SESSION_PATH ?? "./data/whatsapp-session";

let sock: ReturnType<typeof makeWASocket> | null = null;
let currentQr: string | null = null;
const processedMessageIds = new Set<string>();

export function getQr() {
  return currentQr;
}

export function getSocket(): any {
  return sock;
}

export async function startWhatsApp(): Promise<any> {
  const { state, saveCreds } = await useMultiFileAuthState(SESSION_PATH);
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    printQRInTerminal: true,
    auth: state,
    logger: pino({ level: "silent" }),
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr) {
      currentQr = qr;
      logger.info("QR code updated");
    }
    if (connection === "close") {
      const statusCode = (lastDisconnect?.error as any)?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      logger.warn({ statusCode, shouldReconnect }, "Connection closed");
      if (shouldReconnect) {
        startWhatsApp().catch((e) => logger.error(e));
      }
    } else if (connection === "open") {
      currentQr = null;
      logger.info("WhatsApp connected");
    }
  });

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
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

      // admin command gating example: unknown senders cannot run admin commands
      const isAdminCommand = /^\s*(MENU|HELP|EMPLOYEE|SCHEDULE|REPORT|HOLIDAY|PAUSE|RESUME)/i.test(body);
      if (isAdminCommand && !employee) {
        await sendText(from, "You are not a registered user.");
        continue;
      }

      // placeholder: echo / store conversation
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

export async function stopWhatsApp() {
  sock?.end(undefined);
  sock = null;
}
