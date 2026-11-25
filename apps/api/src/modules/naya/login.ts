import { CHAT_LINK_TTL_MS, appUrl, createLoginLink } from "../auth/login-links.js";
import { ensureEmployeeAccount, type EmployeeRef } from "./accounts.js";

// "NAYA" over WhatsApp: a one-time link that opens Naya signed in, valid for 10 minutes.

export const NAYA_KEYWORD = "NAYA";

export function isNayaKeyword(body: string): boolean {
  return body.trim().toUpperCase() === NAYA_KEYWORD;
}

/**
 * The reply to "NAYA" from a registered employee, or null when Naya is not set up. Their daily
 * account is made (role Employee) the first time: the WhatsApp number is enough to sign in.
 */
export async function nayaLoginReply(employee: EmployeeRef): Promise<string | null> {
  if (!appUrl("naya")) return null;
  const userId = await ensureEmployeeAccount(employee);
  if (!userId) return "Akun Naya Anda sedang dinonaktifkan. Hubungi admin.";
  const url = await createLoginLink(userId, "naya", CHAT_LINK_TTL_MS);
  return [
    `Link masuk Naya untuk ${employee.name}:`,
    url,
    "",
    "Berlaku 10 menit dan hanya bisa dipakai sekali. Jangan teruskan link ini ke orang lain.",
  ].join("\n");
}
