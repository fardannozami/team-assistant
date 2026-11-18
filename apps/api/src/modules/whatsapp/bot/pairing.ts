import type { ConnectionState } from "@whiskeysockets/baileys";
import { startBot, stopWhatsApp } from "./lifecycle.js";
import { bots, logger, type Socket } from "./state.js";

export function normalizePhoneNumber(input: string): string {
  const digits = (input ?? "").replace(/\D/g, "");
  if (!/^\d{7,15}$/.test(digits)) {
    throw new Error("Phone number must include the country code (7-15 digits, no +, spaces or dashes)");
  }
  return digits;
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
