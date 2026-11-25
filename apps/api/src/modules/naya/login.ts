import { CHAT_LINK_TTL_MS, appUrl, createLoginLink } from "../auth/login-links.js";

// "NAYA" over WhatsApp: a one-time link that opens Naya signed in, valid for 10 minutes.

export const NAYA_KEYWORD = "NAYA";

export function isNayaKeyword(body: string): boolean {
  return body.trim().toUpperCase() === NAYA_KEYWORD;
}

/** The reply to "NAYA" from a registered employee, or null when Naya is not set up. */
export async function nayaLoginReply(employee: { userId: string | null; name: string }): Promise<string | null> {
  if (!appUrl("naya")) return null;
  if (!employee.userId) {
    return "Nomor ini belum terhubung ke akun web daily, jadi belum bisa masuk Naya. Minta admin mengundang email Anda di Pengaturan › Pengguna.";
  }
  const url = await createLoginLink(employee.userId, "naya", CHAT_LINK_TTL_MS);
  return [
    `Link masuk Naya untuk ${employee.name}:`,
    url,
    "",
    "Berlaku 10 menit dan hanya bisa dipakai sekali. Jangan teruskan link ini ke orang lain.",
  ].join("\n");
}
