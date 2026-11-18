import { MOOD_EMOJI, type CheckinKind } from "@repo/shared";
import { findEmployeesByIdentifier, listEmployees } from "../../employees/service.js";
import { sendStandupPrompts } from "../../standups/service.js";
import { listCheckinResponses, sendCheckinPrompts } from "../../checkins/service.js";
import { CHECKIN_LABEL } from "../../checkins/defaults.js";

export function standupTriggerReply(result: {
  sent: number;
  skipped: number;
  failed: number;
  whatsappConnected?: boolean;
}) {
  if (result.whatsappConnected === false) {
    return "WhatsApp workspace ini belum terhubung, prompt standup tidak dikirim.";
  }
  if (result.sent > 0) {
    const parts = [`Prompt standup terkirim ke ${result.sent} karyawan.`];
    if (result.skipped > 0) {
      parts.push(`${result.skipped} sudah punya sesi.`);
    }
    if (result.failed > 0) parts.push(`${result.failed} gagal terkirim.`);
    return parts.join(" ");
  }
  if (result.failed > 0) {
    return `Gagal mengirim prompt standup (${result.failed} gagal). Apakah WhatsApp sudah terhubung?`;
  }
  return "Tidak ada prompt terkirim - semua karyawan sudah punya sesi standup hari ini.";
}

/** START STANDUP [name or phone]: everyone, or the one matching employee. */
export async function startStandupCommand(ws: string, rest: string): Promise<string> {
  if (rest) {
    const matches = await findEmployeesByIdentifier(ws, rest);
    if (matches.length === 0) {
      return "Karyawan dengan nama atau nomor itu tidak ditemukan.";
    }
    if (matches.length > 1 || !matches[0]) {
      return "Ada beberapa karyawan yang cocok. Kirim nama lengkap atau nomor WhatsApp yang tepat.";
    }
    const result = await sendStandupPrompts(ws, {
      employeeId: matches[0].id,
      resend: true,
    });
    return standupTriggerReply(result);
  }
  const result = await sendStandupPrompts(ws, { resend: true });
  return standupTriggerReply(result);
}

export function checkinKindFrom(rest: string): CheckinKind {
  return /^check/i.test(rest) ? "checkout" : "icebreaker";
}

export async function startCheckinCommand(ws: string, kind: CheckinKind): Promise<string> {
  const result = await sendCheckinPrompts(ws, { kind, resend: true }).catch((error: Error) => error);
  if (result instanceof Error) {
    return `${CHECKIN_LABEL[kind]} belum diatur. Aktifkan dulu di dashboard web: Pengaturan → Check-in.`;
  }
  if ("whatsappConnected" in result) return "WhatsApp belum terhubung.";
  if ("excluded" in result) return `Hari ini hari libur (${result.reason ?? "dikecualikan"}), ${CHECKIN_LABEL[kind].toLowerCase()} tidak dikirim.`;
  return `${CHECKIN_LABEL[kind]} dikirim ke ${result.sent} orang${result.skipped ? `, ${result.skipped} sudah selesai` : ""}${result.failed ? `, ${result.failed} gagal` : ""}.`;
}

export async function checkinReportText(ws: string, kind: CheckinKind) {
  const r = await listCheckinResponses(ws, kind);
  if (!r.date) return `Belum ada data ${CHECKIN_LABEL[kind].toLowerCase()}.`;
  const done = r.rows.filter((row) => row.status === "completed");
  const pending = r.rows.filter((row) => row.status !== "completed");
  const lines = [
    `${CHECKIN_LABEL[kind]} ${r.date}: ${done.length}/${r.rows.length} selesai` +
      (r.averageMood ? `, rata-rata mood ${r.averageMood}/5` : ""),
  ];
  for (const row of done) {
    lines.push("", `*${row.employeeName}*${row.mood ? ` ${row.mood} ${MOOD_EMOJI[row.mood - 1]}` : ""}`);
    for (const q of r.questions) {
      const answer = row.answers[q.key];
      if (q.type === "mood" || !answer || answer === "-") continue;
      lines.push(`- ${q.text.replace(/\s*\(.*\)$/, "")}: ${answer}`);
    }
  }
  if (pending.length) lines.push("", `Belum selesai: ${pending.map((row) => row.employeeName).join(", ")}`);
  return lines.join("\n");
}

export async function renderEmployeeList(workspaceId: string) {
  const rows = await listEmployees(workspaceId, { active: true });
  if (rows.length === 0) return "Tidak ada karyawan aktif.";

  const lines = rows.slice(0, 50).map((employee, index) => {
    const details = [employee.phone];
    if (employee.teamName) details.push(employee.teamName);
    if (employee.roleName) details.push(employee.roleName);
    return `${index + 1}. ${employee.name} - ${details.join(" - ")}`;
  });

  const suffix =
    rows.length > 50 ? `\nMenampilkan 50 dari ${rows.length} karyawan.` : "";
  return [`Karyawan aktif (${rows.length}):`, ...lines].join("\n") + suffix;
}
