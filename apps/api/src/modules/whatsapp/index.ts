import { Hono } from "hono";
import {
  getPairingCode,
  getQr,
  getSocket,
  pairWithPhoneNumber,
  startWhatsApp,
  stopWhatsApp,
  sendText,
} from "./service.js";
import { requireRole } from "../auth/index.js";

export const whatsapp = new Hono();

whatsapp.use("*", requireRole("Owner", "Admin"));

whatsapp.get("/status", (c) => {
  const socket = getSocket();
  return c.json({
    connected: !!socket?.user,
    registered: !!socket?.authState?.creds?.registered,
    pairingCode: getPairingCode(),
  });
});

whatsapp.get("/qr", (c) => {
  const qr = getQr();
  if (!qr) return c.json({ qr: null, message: "No QR available (connected or not started)" });
  return c.json({ qr });
});

whatsapp.post("/pair", async (c) => {
  const { phoneNumber } = await c.req.json<{ phoneNumber?: string }>();
  if (!phoneNumber) return c.json({ error: "phoneNumber is required" }, 400);
  try {
    const pairingCode = await pairWithPhoneNumber(phoneNumber);
    return c.json({ pairingCode });
  } catch (error) {
    return c.json({ error: (error as Error).message }, 400);
  }
});

whatsapp.post("/start", async (c) => {
  await startWhatsApp();
  return c.json({ started: true });
});

whatsapp.post("/stop", async (c) => {
  await stopWhatsApp();
  return c.json({ stopped: true });
});

whatsapp.post("/send", async (c) => {
  const { jid, text } = await c.req.json<{ jid: string; text: string }>();
  await sendText(jid, text);
  return c.json({ sent: true });
});
