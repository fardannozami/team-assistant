import { CHAT_LINK_TTL_MS, HANDOVER_LINK_TTL_MS, appUrl, createLoginLink } from "../auth/login-links.js";
import { ensureEmployeeAccount, employeeRef, type EmployeeRef } from "./accounts.js";

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

/**
 * Lines closing a finished standup: a link into Naya's Tugas Saya that signs the employee in
 * (good for 12 hours, used once). Empty when Naya is off or no account can be had.
 */
export async function nayaStandupLines(workspaceId: string, employeeId: string): Promise<string[]> {
  if (!appUrl("naya")) return [];
  const employee = await employeeRef(workspaceId, employeeId);
  const userId = employee ? await ensureEmployeeAccount(employee) : null;
  if (!userId) return [];
  const url = await createLoginLink(userId, "naya", HANDOVER_LINK_TTL_MS, "/my-tasks");
  return ["", "Lanjut kerja di Naya:", url, "Link hanya untuk kamu, sekali pakai, berlaku 12 jam; setelah itu ketik NAYA untuk link baru."];
}
