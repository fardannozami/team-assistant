import {
  MOOD_EMOJI,
  isAdminRole,
  phoneNumberSchema,
  type CheckinKind,
} from "@repo/shared";
import { HttpError } from "../../lib/http-error.js";
import {
  createEmployee,
  findEmployeeByPhone,
  findEmployeesByIdentifier,
  listEmployees,
  updateEmployeePhone,
} from "../employees/service.js";
import { sendStandupPrompts } from "../standups/service.js";
import { generateDailyReport, generateWeeklyReport } from "../reports/service.js";
import {
  listSchedules,
  upsertStandupSchedule,
} from "../schedules/service.js";
import { listCheckinResponses, sendCheckinPrompts } from "../checkins/service.js";
import { CHECKIN_LABEL } from "../checkins/defaults.js";

type AdminSender = {
  id: string;
  userId: string | null;
  name: string;
  phone: string;
  roleId: string | null;
};

type PendingFlow =
  | { kind: "add"; step: "name"; phone?: string }
  | { kind: "add"; step: "phone"; name: string }
  | { kind: "add"; step: "confirm"; name: string; phone: string }
  | { kind: "phone"; step: "employee" }
  | {
      kind: "phone";
      step: "phone";
      employeeId: string;
      employeeName: string;
    }
  | {
      kind: "phone";
      step: "confirm";
      employeeId: string;
      employeeName: string;
      phone: string;
    };

type CommandName =
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

const ADMIN_KEYWORD =
  /^\s*(MENU|HELP|EMPLOYEE|ADD\s+EMPLOYEE|UPDATE\s+PHONE|CHANGE\s+PHONE|START\s+STANDUP|TRIGGER\s+STANDUP|SET\s+(?:SCHEDULE|REMINDER)|SCHEDULE|REPORT|HOLIDAY|PAUSE|RESUME)\b/i;

const YES = /^(yes|y|ya|iya|ok|oke|correct|benar|betul)$/i;
const NO = /^(no|n|tidak|bukan|salah|batal|cancel)$/i;

const FLOW_TTL_MS = 10 * 60 * 1000;
const INVALID_PHONE =
  "Nomor itu sepertinya tidak valid. Kirim dengan kode negara, contoh 628123456789.";

const MENU_TEXT = [
  "Menu admin:",
  "EMPLOYEE LIST - daftar karyawan aktif",
  "ADD EMPLOYEE - tambah karyawan",
  "UPDATE PHONE - ubah nomor WhatsApp karyawan",
  "START STANDUP - kirim prompt standup hari ini sekarang",
  "SCHEDULE - lihat jadwal standup",
  "SET SCHEDULE <HH:mm> [HARI] - ubah waktu standup",
  "SET REMINDER <menit>|OFF - ubah pengingat standup",
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

const DAY_INDEX: Record<string, number> = {
  SUN: 0,
  MON: 1,
  TUE: 2,
  WED: 3,
  THU: 4,
  FRI: 5,
  SAT: 6,
};

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const DAY_WORDS: { pattern: string; day: number }[] = [
  { pattern: "sunday|sun|minggu", day: 0 },
  { pattern: "monday|mon|senin", day: 1 },
  { pattern: "tuesday|tue|selasa", day: 2 },
  { pattern: "wednesday|wed|rabu", day: 3 },
  { pattern: "thursday|thu|kamis", day: 4 },
  { pattern: "friday|fri|jumat|jum'at", day: 5 },
  { pattern: "saturday|sat|sabtu", day: 6 },
];

const DAY_PATTERN = DAY_WORDS.map((d) => `(?:${d.pattern})`).join("|");
const DAY_RANGE_RE = new RegExp(
  `\\b(${DAY_PATTERN})\\b\\s*(?:to|through|thru|sampai|-|–)\\s*\\b(${DAY_PATTERN})\\b`,
  "i",
);

function dayFromToken(token: string): number | null {
  const normalized = token.trim().toLowerCase();
  for (const { pattern, day } of DAY_WORDS) {
    if (new RegExp(`^(?:${pattern})$`).test(normalized)) return day;
  }
  return null;
}

function parseWeekdays(input: string): number[] | null {
  const token = input.trim().toUpperCase();
  if (!token) return null;

  if (/^(DAILY|EVERYDAY|EVERY DAY)$/.test(token)) return [0, 1, 2, 3, 4, 5, 6];
  if (/^(WEEKDAYS?|WORKDAYS?)$/.test(token)) return [1, 2, 3, 4, 5];

  const days = new Set<number>();
  for (const part of token.split(/[\s,]+/).filter(Boolean)) {
    const range = part.match(/^([A-Z]{3})-([A-Z]{3})$/);
    if (range) {
      const start = DAY_INDEX[range[1]!];
      const end = DAY_INDEX[range[2]!];
      if (start === undefined || end === undefined) return null;
      let cursor = start;
      days.add(cursor);
      while (cursor !== end) {
        cursor = (cursor + 1) % 7;
        days.add(cursor);
      }
      continue;
    }
    const day = DAY_INDEX[part];
    if (day === undefined) return null;
    days.add(day);
  }
  return days.size ? [...days].sort((a, b) => a - b) : null;
}

function formatWeekdays(days: number[]): string {
  const sorted = [...days].sort((a, b) => a - b);
  if (sorted.join(",") === "1,2,3,4,5") return "Mon-Fri";
  if (sorted.join(",") === "0,1,2,3,4,5,6") return "every day";
  return sorted.map((day) => DAY_NAMES[day]).join(", ");
}

function savedScheduleReply(schedule: {
  timeOfDay: string | null;
  weekdays: unknown;
  timezone: string;
  reminderMinutes: number | null;
}): string {
  const days = Array.isArray(schedule.weekdays)
    ? formatWeekdays(schedule.weekdays as number[])
    : "custom days";
  const reminder =
    schedule.reminderMinutes != null
      ? `\nPengingat dikirim ${schedule.reminderMinutes} menit setelahnya.`
      : "";
  return `Jadwal tersimpan.\nStandup berjalan ${days} pukul ${schedule.timeOfDay} (${schedule.timezone}).${reminder}`;
}

function parseNaturalTime(text: string): string | null {
  const withMinutes = text.match(/\b(\d{1,2})[:.](\d{2})\s*(am|pm)?\b/i);
  if (withMinutes) {
    let hour = Number(withMinutes[1]);
    const minute = Number(withMinutes[2]);
    const suffix = withMinutes[3]?.toLowerCase();
    if (suffix === "pm" && hour < 12) hour += 12;
    if (suffix === "am" && hour === 12) hour = 0;
    if (hour <= 23 && minute <= 59) {
      return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
    }
  }

  const hourOnly = text.match(/\b(\d{1,2})\s*(am|pm)\b/i);
  if (hourOnly) {
    let hour = Number(hourOnly[1]);
    const suffix = hourOnly[2]?.toLowerCase();
    if (suffix === "pm" && hour < 12) hour += 12;
    if (suffix === "am" && hour === 12) hour = 0;
    if (hour <= 23) return `${String(hour).padStart(2, "0")}:00`;
  }

  return null;
}

/**
 * Narrow natural-language schedule parsing (PRD §5.4 example):
 * "Schedule standup from Monday to Friday at 9:00 AM WIB".
 * The M7 agent replaces this with full LLM understanding.
 */
function parseNaturalSchedule(text: string): {
  timeOfDay: string;
  weekdays: number[];
  timezone?: string;
} | null {
  if (!/\b(standup|jadwal)\b/i.test(text)) return null;

  const timeOfDay = parseNaturalTime(text);
  if (!timeOfDay) return null;

  let weekdays: number[] = [];
  const range = text.match(DAY_RANGE_RE);
  if (range) {
    const start = range[1] ? dayFromToken(range[1]) : null;
    const end = range[2] ? dayFromToken(range[2]) : null;
    if (start === null || end === null) return null;
    const days = new Set<number>([start]);
    let cursor = start;
    while (cursor !== end) {
      cursor = (cursor + 1) % 7;
      days.add(cursor);
    }
    weekdays = [...days].sort((a, b) => a - b);
  } else if (/\b(every\s*day|daily|setiap hari|tiap hari)\b/i.test(text)) {
    weekdays = [0, 1, 2, 3, 4, 5, 6];
  } else {
    const found = new Set<number>();
    const dayRe = new RegExp(`\\b(${DAY_PATTERN})\\b`, "gi");
    for (const match of text.matchAll(dayRe)) {
      const day = match[1] ? dayFromToken(match[1]) : null;
      if (day !== null) found.add(day);
    }
    weekdays = [...found].sort((a, b) => a - b);
  }

  if (weekdays.length === 0) return null;

  const timezone = /\bWIB\b|\bAsia\/Jakarta\b/i.test(text)
    ? "Asia/Jakarta"
    : /\bWITA\b/i.test(text)
      ? "Asia/Makassar"
      : /\bWIT\b/i.test(text)
        ? "Asia/Jayapura"
        : undefined;

  return { timeOfDay, weekdays, timezone };
}

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

async function showSchedules(workspaceId: string): Promise<string> {
  const rows = await listSchedules(workspaceId);
  if (rows.length === 0) {
    return "Belum ada jadwal. Gunakan SET SCHEDULE <HH:mm> [HARI], contoh SET SCHEDULE 09:00 MON-FRI.";
  }
  return rows
    .map((schedule) => {
      const weekdays = Array.isArray(schedule.weekdays)
        ? (schedule.weekdays as number[])
        : null;
      const when = schedule.timeOfDay ?? schedule.cronExpression ?? "?";
      const days = weekdays ? formatWeekdays(weekdays) : "custom cron";
      const reminder =
        schedule.reminderMinutes != null
          ? `, reminder ${schedule.reminderMinutes} min after`
          : "";
      return `- ${schedule.name} (${schedule.isActive ? "active" : "disabled"}): ${when} ${days}, ${schedule.timezone}${reminder}`;
    })
    .join("\n");
}

async function setScheduleCommand(workspaceId: string, rest: string): Promise<string> {
  const timeMatch = rest.match(/\b(\d{1,2}):(\d{2})\b/);
  if (!timeMatch) {
    return "Format: SET SCHEDULE <HH:mm> [HARI], contoh SET SCHEDULE 08:45 MON-FRI";
  }

  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);
  if (hour > 23 || minute > 59) {
    return "Jam itu tidak valid. Gunakan format 24 jam HH:mm, contoh 08:45.";
  }
  const timeOfDay = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;

  const remainder = rest.replace(timeMatch[0], " ").trim();
  let weekdays: number[] | undefined;
  if (remainder) {
    const parsed = parseWeekdays(remainder);
    if (!parsed) {
      return "Hari tidak terbaca. Gunakan nama hari (MON TUE), rentang (MON-FRI), DAILY, atau WEEKDAYS.";
    }
    weekdays = parsed;
  }

  const schedule = await upsertStandupSchedule(workspaceId, { timeOfDay, weekdays });
  return savedScheduleReply(schedule);
}

async function setReminderCommand(workspaceId: string, rest: string): Promise<string> {
  const token = rest.trim().toUpperCase();
  if (!token) {
    return "Format: SET REMINDER <menit> (setelah standup) atau SET REMINDER OFF";
  }

  if (/^(OFF|NONE|DISABLED?)$/.test(token)) {
    await upsertStandupSchedule(workspaceId, { reminderMinutes: null });
    return "Pengingat dimatikan.";
  }

  if (!/^\d{1,4}$/.test(token)) {
    return "Format: SET REMINDER <menit> (setelah standup) atau SET REMINDER OFF";
  }

  const minutes = Number(token);
  if (minutes > 1440) {
    return "Pengingat maksimal 1440 menit (24 jam).";
  }

  await upsertStandupSchedule(workspaceId, { reminderMinutes: minutes });
  return `Pengingat akan dikirim ${minutes} menit setelah standup.`;
}

// Keyed by `${workspaceId}:${phone}`.
const flows = new Map<string, { flow: PendingFlow; expiresAt: number }>();

function setFlow(key: string, flow: PendingFlow) {
  flows.set(key, { flow, expiresAt: Date.now() + FLOW_TTL_MS });
}

function clearFlow(key: string) {
  flows.delete(key);
}

function getFlow(key: string): PendingFlow | null {
  const entry = flows.get(key);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    flows.delete(key);
    return null;
  }
  return entry.flow;
}

function checkinKindFrom(rest: string): CheckinKind {
  return /^check/i.test(rest) ? "checkout" : "icebreaker";
}

async function checkinReportText(ws: string, kind: CheckinKind) {
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

function parseCommand(text: string): { name: CommandName; rest: string } | null {
  for (const { name, re } of COMMAND_PATTERNS) {
    const match = text.match(re);
    if (match) {
      return { name, rest: text.slice(match[0].length).trim() };
    }
  }
  return null;
}

function toValidPhone(input: string | null | undefined): string | null {
  if (!input) return null;
  const result = phoneNumberSchema.safeParse(input);
  return result.success ? result.data : null;
}

function splitNameAndPhone(input: string): {
  name: string | null;
  phone: string | null;
} {
  const trimmed = input.trim();
  if (!trimmed) return { name: null, phone: null };

  const phoneAtEnd = trimmed.match(/^(.+?)[\s,;]+(\+?\d[\d\s\-()]{5,}\d)$/);
  if (phoneAtEnd) {
    const name = phoneAtEnd[1];
    const phone = phoneAtEnd[2];
    if (name && phone) return { name: name.trim(), phone };
  }

  const phoneAtStart = trimmed.match(/^(\+?\d[\d\s\-()]{5,}\d)[\s,;]+(.+)$/);
  if (phoneAtStart) {
    const phone = phoneAtStart[1];
    const name = phoneAtStart[2];
    if (name && phone) return { name: name.trim(), phone };
  }

  if (/^\+?\d[\d\s\-()]{5,}\d$/.test(trimmed)) {
    return { name: null, phone: trimmed };
  }

  return { name: trimmed, phone: null };
}

function extractPhones(text: string): string[] {
  const matches = text.match(/\+?\d[\d\-()]{5,}/g) ?? [];
  return matches
    .map(toValidPhone)
    .filter((phone): phone is string => phone !== null);
}

function isYes(text: string) {
  return YES.test(text.trim().replace(/[.!,\s]+$/, ""));
}

function isNo(text: string) {
  return NO.test(text.trim().replace(/[.!,\s]+$/, ""));
}

function addConfirmation(name: string, phone: string) {
  return `Saya akan menambahkan ${name} (${phone}). Sudah benar? Balas YA atau TIDAK.`;
}

function phoneConfirmation(employeeName: string, phone: string) {
  return `Saya akan mengubah nomor WhatsApp ${employeeName} menjadi ${phone}. Sudah benar? Balas YA atau TIDAK.`;
}

async function renderEmployeeList(workspaceId: string) {
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

async function startAddFlow(flowKey: string, rest: string): Promise<string> {
  const { name, phone: rawPhone } = splitNameAndPhone(rest);
  const parsedPhone = toValidPhone(rawPhone);

  if (rawPhone && !parsedPhone) return INVALID_PHONE;

  if (name && parsedPhone) {
    setFlow(flowKey, {
      kind: "add",
      step: "confirm",
      name,
      phone: parsedPhone,
    });
    return addConfirmation(name, parsedPhone);
  }

  if (parsedPhone) {
    setFlow(flowKey, { kind: "add", step: "name", phone: parsedPhone });
    return "Siapa nama karyawannya?";
  }

  if (name) {
    setFlow(flowKey, { kind: "add", step: "phone", name });
    return `Berapa nomor WhatsApp ${name} (dengan kode negara)?`;
  }

  setFlow(flowKey, { kind: "add", step: "name" });
  return "Siapa nama karyawannya?";
}

async function startPhoneFlow(
  workspaceId: string,
  flowKey: string,
  rest: string,
): Promise<string> {
  const numbers = extractPhones(rest);

  if (numbers.length >= 2) {
    const currentPhone = numbers[0];
    const newPhone = numbers[1];
    if (!currentPhone || !newPhone) return INVALID_PHONE;

    const target = await findEmployeeByPhone(workspaceId, currentPhone);
    if (!target) return "Karyawan dengan nomor itu tidak ditemukan.";

    setFlow(flowKey, {
      kind: "phone",
      step: "confirm",
      employeeId: target.id,
      employeeName: target.name,
      phone: newPhone,
    });
    return phoneConfirmation(target.name, newPhone);
  }

  if (numbers.length === 1) {
    const currentPhone = numbers[0];
    if (!currentPhone) return INVALID_PHONE;

    const target = await findEmployeeByPhone(workspaceId, currentPhone);
    if (!target) return "Karyawan dengan nomor itu tidak ditemukan.";

    setFlow(flowKey, {
      kind: "phone",
      step: "phone",
      employeeId: target.id,
      employeeName: target.name,
    });
    return `What is the new WhatsApp number for ${target.name}?`;
  }

  setFlow(flowKey, { kind: "phone", step: "employee" });
  return "Karyawan yang mana? Kirim nama atau nomor WhatsApp saat ini.";
}

async function continueAddFlow(
  workspaceId: string,
  flowKey: string,
  flow: Extract<PendingFlow, { kind: "add" }>,
  text: string,
  sender: AdminSender,
): Promise<string> {
  if (flow.step === "name") {
    const name = text.trim();
    if (!name) return "Siapa nama karyawannya?";

    const existingPhone = toValidPhone(flow.phone);
    if (!existingPhone) {
      setFlow(flowKey, { kind: "add", step: "phone", name });
      return `Berapa nomor WhatsApp ${name} (dengan kode negara)?`;
    }

    setFlow(flowKey, {
      kind: "add",
      step: "confirm",
      name,
      phone: existingPhone,
    });
    return addConfirmation(name, existingPhone);
  }

  if (flow.step === "phone") {
    const candidate = toValidPhone(text);
    if (!candidate) return INVALID_PHONE;

    setFlow(flowKey, {
      kind: "add",
      step: "confirm",
      name: flow.name,
      phone: candidate,
    });
    return addConfirmation(flow.name, candidate);
  }

  if (isYes(text)) {
    clearFlow(flowKey);
    try {
      const created = await createEmployee(
        workspaceId,
        { name: flow.name, phone: flow.phone },
        sender.userId,
      );
      return created
        ? `Employee successfully added.\n${created.name} - ${created.phone}`
        : "Karyawan berhasil ditambahkan.";
    } catch (error) {
      if (error instanceof HttpError) return error.message;
      throw error;
    }
  }

  if (isNo(text)) {
    clearFlow(flowKey);
    return "Dibatalkan.";
  }

  return `Reply YES to confirm adding ${flow.name} (${flow.phone}), or NO to cancel.`;
}

async function continuePhoneFlow(
  workspaceId: string,
  flowKey: string,
  flow: Extract<PendingFlow, { kind: "phone" }>,
  text: string,
  sender: AdminSender,
): Promise<string> {
  if (flow.step === "employee") {
    const matches = await findEmployeesByIdentifier(workspaceId, text);
    if (matches.length === 0) {
      return "No employee found with that name or phone number. Send a name or current WhatsApp number, or reply CANCEL.";
    }
    if (matches.length > 1) {
      const list = matches
        .slice(0, 10)
        .map((employee) => `- ${employee.name} (${employee.phone})`)
        .join("\n");
      return `Multiple employees match:\n${list}\nReply with the exact current WhatsApp number.`;
    }

    const target = matches[0];
    if (!target) return "Karyawan dengan nama atau nomor itu tidak ditemukan.";

    setFlow(flowKey, {
      kind: "phone",
      step: "phone",
      employeeId: target.id,
      employeeName: target.name,
    });
    return `What is the new WhatsApp number for ${target.name}?`;
  }

  if (flow.step === "phone") {
    const candidate = toValidPhone(text);
    if (!candidate) return INVALID_PHONE;

    setFlow(flowKey, {
      kind: "phone",
      step: "confirm",
      employeeId: flow.employeeId,
      employeeName: flow.employeeName,
      phone: candidate,
    });
    return phoneConfirmation(flow.employeeName, candidate);
  }

  if (isYes(text)) {
    clearFlow(flowKey);
    try {
      await updateEmployeePhone(workspaceId, flow.employeeId, flow.phone, sender.userId);
      return "Nomor WhatsApp diperbarui.";
    } catch (error) {
      if (error instanceof HttpError) return error.message;
      throw error;
    }
  }

  if (isNo(text)) {
    clearFlow(flowKey);
    return "Dibatalkan.";
  }

  return `Reply YES to update ${flow.employeeName}'s number to ${flow.phone}, or NO to cancel.`;
}

export async function handleAdminMessage(args: {
  workspaceId: string;
  phone: string;
  body: string;
  employee: AdminSender | null;
  roleName: string | null;
}): Promise<string | null> {
  const text = args.body.trim();
  if (!text) return null;

  const ws = args.workspaceId;
  const flowKey = `${ws}:${args.phone}`;
  const command = parseCommand(text);
  const pending = getFlow(flowKey);

  if (!args.employee) {
    const looksAdmin = command || pending || ADMIN_KEYWORD.test(text);
    return looksAdmin ? "Kamu bukan pengguna terdaftar." : null;
  }

  if (!isAdminRole(args.roleName)) {
    // Employees get their own menu from the standup engine.
    if (command?.name === "MENU" || command?.name === "HELP") return null;
    const looksAdmin = command || pending || ADMIN_KEYWORD.test(text);
    return looksAdmin ? "Kamu bukan administrator." : null;
  }

  if (/^(cancel|batal|stop)$/i.test(text)) {
    clearFlow(flowKey);
    return "Dibatalkan.";
  }

  if (command) {
    clearFlow(flowKey);
    switch (command.name) {
      case "MENU":
      case "HELP":
        return MENU_TEXT;
      case "EMPLOYEE_LIST":
        return renderEmployeeList(ws);
      case "SHOW_SCHEDULE":
        return showSchedules(ws);
      case "SET_SCHEDULE":
        return setScheduleCommand(ws, command.rest);
      case "SET_REMINDER":
        return setReminderCommand(ws, command.rest);
      case "ADD_EMPLOYEE":
        return startAddFlow(flowKey, command.rest);
      case "UPDATE_PHONE":
        return startPhoneFlow(ws, flowKey, command.rest);
      case "REPORT_TODAY": {
        const r = await generateDailyReport(ws);
        return r.text;
      }
      case "REPORT_WEEKLY": {
        const r = await generateWeeklyReport(ws);
        return r.text;
      }
      case "START_CHECKIN": {
        const kind = checkinKindFrom(command.rest);
        const result = await sendCheckinPrompts(ws, { kind, resend: true }).catch((error: Error) => error);
        if (result instanceof Error) {
          return `${CHECKIN_LABEL[kind]} belum diatur. Aktifkan dulu di dashboard web: Pengaturan → Check-in.`;
        }
        if ("whatsappConnected" in result) return "WhatsApp belum terhubung.";
        if ("excluded" in result) return `Hari ini hari libur (${result.reason ?? "dikecualikan"}), ${CHECKIN_LABEL[kind].toLowerCase()} tidak dikirim.`;
        return `${CHECKIN_LABEL[kind]} dikirim ke ${result.sent} orang${result.skipped ? `, ${result.skipped} sudah selesai` : ""}${result.failed ? `, ${result.failed} gagal` : ""}.`;
      }
      case "REPORT_CHECKIN":
        return checkinReportText(ws, checkinKindFrom(command.rest));
      case "START_STANDUP": {
        if (command.rest) {
          const matches = await findEmployeesByIdentifier(ws, command.rest);
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
    }
  }

  if (pending) {
    return pending.kind === "add"
      ? continueAddFlow(ws, flowKey, pending, text, args.employee)
      : continuePhoneFlow(ws, flowKey, pending, text, args.employee);
  }

  const natural = parseNaturalSchedule(text);
  if (natural) {
    const schedule = await upsertStandupSchedule(ws, natural, args.employee.userId);
    return savedScheduleReply(schedule);
  }

  return null;
}
