import { Hono } from "hono";
import { getQr, startWhatsApp, stopWhatsApp, sendText } from "./service.js";

export const whatsapp = new Hono();

whatsapp.get("/status", (c) => c.json({ connected: !!getQr() === false ? "maybe" : "qr-pending" }));

whatsapp.get("/qr", (c) => {
  const qr = getQr();
  if (!qr) return c.json({ qr: null, message: "No QR available (connected or not started)" });
  return c.json({ qr });
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
