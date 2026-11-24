import { SSO_LINK_TTL_MS, callbackUrl, createSsoCode, nayaUrl, ssoIdentity } from "../auth/sso.js";

// "NAYA" over WhatsApp: a one-time sign-in link for Naya, valid for 10 minutes.

export const NAYA_KEYWORD = "NAYA";

export function isNayaKeyword(body: string): boolean {
  return body.trim().toUpperCase() === NAYA_KEYWORD;
}

/** The reply to "NAYA" from a registered employee, or null when Naya is not set up. */
export async function nayaLoginReply(employee: { userId: string | null }): Promise<string | null> {
  if (!nayaUrl()) return null;
  const identity = employee.userId ? await ssoIdentity(employee.userId) : null;
  if (!identity) {
    return "Nomor ini belum terhubung ke akun web daily, jadi belum bisa masuk Naya. Minta admin mengundang email Anda di Pengaturan › Pengguna.";
  }
  const url = callbackUrl(await createSsoCode(identity.user.id, SSO_LINK_TTL_MS));
  return [
    `Link masuk Naya untuk ${identity.user.name}:`,
    url,
    "",
    "Berlaku 10 menit dan hanya bisa dipakai sekali. Jangan teruskan link ini ke orang lain.",
  ].join("\n");
}
