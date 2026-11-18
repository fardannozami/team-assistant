export type CommandName =
  | "ADD_EMPLOYEE"
  | "UPDATE_PHONE"
  | "EMPLOYEE_LIST"
  | "START_STANDUP"
  | "SHOW_SCHEDULE"
  | "REPORT_TODAY"
  | "REPORT_WEEKLY"
  | "SET_SCHEDULE"
  | "SET_REMINDER"
  | "START_CHECKIN"
  | "REPORT_CHECKIN"
  | "MENU"
  | "HELP";

const COMMAND_PATTERNS: { name: CommandName; re: RegExp }[] = [
  { name: "ADD_EMPLOYEE", re: /^add\s+employee\b/i },
  { name: "UPDATE_PHONE", re: /^(?:update|change|set)\s+(?:employee\s+)?(?:phone|whatsapp)\b/i },
  { name: "EMPLOYEE_LIST", re: /^employees?\s+list$/i },
  { name: "START_STANDUP", re: /^(?:start|trigger|run)\s+standup\b/i },
  { name: "START_CHECKIN", re: /^(?:start|trigger|run)\s+(?=(?:check[\s-]?out|mood|ice[\s-]?break(?:ing|er)?)$)/i },
  { name: "REPORT_CHECKIN", re: /^report\s+(?=(?:check[\s-]?out|mood|ice[\s-]?break(?:ing|er)?)$)/i },
  { name: "SHOW_SCHEDULE", re: /^(?:schedule|schedules)(?:\s+(?:show|list))?$/i },
  { name: "REPORT_TODAY", re: /^report\s+today\b/i },
  { name: "REPORT_WEEKLY", re: /^report\s+weekly\b/i },
  { name: "SET_SCHEDULE", re: /^set\s+schedule\b/i },
  { name: "SET_REMINDER", re: /^set\s+reminder\b/i },
  { name: "MENU", re: /^menu$/i },
  { name: "HELP", re: /^help$/i },
];

export const ADMIN_KEYWORD =
  /^\s*(MENU|HELP|EMPLOYEE|ADD\s+EMPLOYEE|UPDATE\s+PHONE|CHANGE\s+PHONE|START\s+STANDUP|TRIGGER\s+STANDUP|SET\s+(?:SCHEDULE|REMINDER)|SCHEDULE|REPORT|HOLIDAY|PAUSE|RESUME)\b/i;

export const MENU_TEXT = [
  "Menu admin:",
  "EMPLOYEE LIST - daftar karyawan aktif",
  "ADD EMPLOYEE - tambah karyawan",
  "UPDATE PHONE - ubah nomor WhatsApp karyawan",
  "START STANDUP - kirim prompt standup hari ini sekarang",
  "SCHEDULE - lihat jadwal standup",
  "SET SCHEDULE <HH:mm> [HARI] - ubah waktu standup",
  "SET REMINDER <siang> <sore>|OFF - ubah jam pengingat standup, contoh SET REMINDER 12:00 15:00",
  "START CHECKOUT / START MOOD - kirim check-out mingguan / ice breaking sekarang",
  "REPORT CHECKOUT / REPORT MOOD - hasil check-out / mood terakhir",
  "Atau ketik: jadwalkan standup senin sampai jumat jam 9 pagi WIB",
  "Dengan API key AI, cukup tulis biasa, mis. \"ganti nomor Budi jadi 0812...\", \"siapa saja anggota tim Design?\", \"liburkan standup tanggal 24\"",
  "CANCEL - batalkan langkah saat ini",
  "Standup pribadi: STANDUP, UBAH STANDUP (lihat BANTUAN)",
].join("\n");

/** Sent once when someone is given an admin role from the web dashboard. */
export function buildAdminWelcomeText(name: string, roleName: string, webUrl: string) {
  return [
    `Halo ${name}, kamu sekarang ${roleName} di Team Assistant.`,
    "Kamu bisa mengelola tim langsung dari WhatsApp ini. Ketik MENU kapan saja untuk melihat perintah.",
    "",
    MENU_TEXT,
    "",
    `Panduan lengkap di dashboard web: ${webUrl.replace(/\/$/, "")}/?page=guide`,
  ].join("\n");
}

export function parseCommand(text: string): { name: CommandName; rest: string } | null {
  for (const { name, re } of COMMAND_PATTERNS) {
    const match = text.match(re);
    if (match) {
      return { name, rest: text.slice(match[0].length).trim() };
    }
  }
  return null;
}
