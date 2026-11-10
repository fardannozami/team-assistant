import {
  isAdminRole,
  phoneNumberSchema,
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
  | "MENU"
  | "HELP";

const COMMAND_PATTERNS: { name: CommandName; re: RegExp }[] = [
  { name: "ADD_EMPLOYEE", re: /^add\s+employee\b/i },
  { name: "UPDATE_PHONE", re: /^(?:update|change|set)\s+(?:employee\s+)?(?:phone|whatsapp)\b/i },
  { name: "EMPLOYEE_LIST", re: /^employees?\s+list$/i },
  { name: "START_STANDUP", re: /^(?:start|trigger|run)\s+standup\b/i },
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
  "That phone number doesn't look valid. Send it with the country code, e.g. 628123456789.";

const MENU_TEXT = [
  "Admin menu:",
  "EMPLOYEE LIST - list active employees",
  "ADD EMPLOYEE - add an employee",
  "UPDATE PHONE - change an employee's WhatsApp number",
  "START STANDUP - send today's standup prompts now",
  "SCHEDULE - show the current standup schedule",
  "SET SCHEDULE <HH:mm> [DAYS] - change when standup runs",
  "SET REMINDER <minutes>|OFF - change the standup reminder",
  "Or say: schedule standup monday to friday at 9:00 am WIB",
  "CANCEL - abort the current step",
].join("\n");

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
      ? `\nReminder is sent ${schedule.reminderMinutes} min after.`
      : "";
  return `The schedule has been saved.\nStandup will run ${days} at ${schedule.timeOfDay} in the ${schedule.timezone} time zone.${reminder}`;
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

function standupTriggerReply(result: {
  sent: number;
  skipped: number;
  failed: number;
}) {
  if (result.sent > 0) {
    const parts = [`Standup prompts sent to ${result.sent} employee(s).`];
    if (result.skipped > 0) {
      parts.push(`${result.skipped} already had a session.`);
    }
    if (result.failed > 0) parts.push(`${result.failed} failed to send.`);
    return parts.join(" ");
  }
  if (result.failed > 0) {
    return `Could not send standup prompts (${result.failed} failed). Is WhatsApp connected?`;
  }
  return "No prompts sent - every employee already has a standup session for today.";
}

async function showSchedules(): Promise<string> {
  const rows = await listSchedules();
  if (rows.length === 0) {
    return "No schedules configured yet. Use SET SCHEDULE <HH:mm> [DAYS], e.g. SET SCHEDULE 09:00 MON-FRI.";
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

async function setScheduleCommand(rest: string): Promise<string> {
  const timeMatch = rest.match(/\b(\d{1,2}):(\d{2})\b/);
  if (!timeMatch) {
    return "Usage: SET SCHEDULE <HH:mm> [DAYS], e.g. SET SCHEDULE 08:45 MON-FRI";
  }

  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);
  if (hour > 23 || minute > 59) {
    return "That time doesn't look valid. Use 24-hour HH:mm, e.g. 08:45.";
  }
  const timeOfDay = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;

  const remainder = rest.replace(timeMatch[0], " ").trim();
  let weekdays: number[] | undefined;
  if (remainder) {
    const parsed = parseWeekdays(remainder);
    if (!parsed) {
      return "I couldn't read those days. Use day names (MON TUE), a range (MON-FRI), DAILY, or WEEKDAYS.";
    }
    weekdays = parsed;
  }

  const schedule = await upsertStandupSchedule({ timeOfDay, weekdays });
  return savedScheduleReply(schedule);
}

async function setReminderCommand(rest: string): Promise<string> {
  const token = rest.trim().toUpperCase();
  if (!token) {
    return "Usage: SET REMINDER <minutes> (minutes after standup) or SET REMINDER OFF";
  }

  if (/^(OFF|NONE|DISABLED?)$/.test(token)) {
    await upsertStandupSchedule({ reminderMinutes: null });
    return "Reminder disabled.";
  }

  if (!/^\d{1,4}$/.test(token)) {
    return "Usage: SET REMINDER <minutes> (minutes after standup) or SET REMINDER OFF";
  }

  const minutes = Number(token);
  if (minutes > 1440) {
    return "Reminder must be at most 1440 minutes (24 hours).";
  }

  await upsertStandupSchedule({ reminderMinutes: minutes });
  return `Reminder will be sent ${minutes} minutes after the standup.`;
}

const flows = new Map<string, { flow: PendingFlow; expiresAt: number }>();

function setFlow(phone: string, flow: PendingFlow) {
  flows.set(phone, { flow, expiresAt: Date.now() + FLOW_TTL_MS });
}

function clearFlow(phone: string) {
  flows.delete(phone);
}

function getFlow(phone: string): PendingFlow | null {
  const entry = flows.get(phone);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    flows.delete(phone);
    return null;
  }
  return entry.flow;
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
  return `I am about to add ${name} (${phone}). Is this correct? Reply YES or NO.`;
}

function phoneConfirmation(employeeName: string, phone: string) {
  return `I am about to update ${employeeName}'s WhatsApp number to ${phone}. Is this correct? Reply YES or NO.`;
}

async function renderEmployeeList() {
  const rows = await listEmployees({ active: true });
  if (rows.length === 0) return "No active employees found.";

  const lines = rows.slice(0, 50).map((employee, index) => {
    const details = [employee.phone];
    if (employee.teamName) details.push(employee.teamName);
    if (employee.roleName) details.push(employee.roleName);
    return `${index + 1}. ${employee.name} - ${details.join(" - ")}`;
  });

  const suffix =
    rows.length > 50 ? `\nShowing 50 of ${rows.length} employees.` : "";
  return [`Active employees (${rows.length}):`, ...lines].join("\n") + suffix;
}

async function startAddFlow(phone: string, rest: string): Promise<string> {
  const { name, phone: rawPhone } = splitNameAndPhone(rest);
  const parsedPhone = toValidPhone(rawPhone);

  if (rawPhone && !parsedPhone) return INVALID_PHONE;

  if (name && parsedPhone) {
    setFlow(phone, {
      kind: "add",
      step: "confirm",
      name,
      phone: parsedPhone,
    });
    return addConfirmation(name, parsedPhone);
  }

  if (parsedPhone) {
    setFlow(phone, { kind: "add", step: "name", phone: parsedPhone });
    return "What is the employee's name?";
  }

  if (name) {
    setFlow(phone, { kind: "add", step: "phone", name });
    return `What is ${name}'s WhatsApp number (with country code)?`;
  }

  setFlow(phone, { kind: "add", step: "name" });
  return "What is the employee's name?";
}

async function startPhoneFlow(phone: string, rest: string): Promise<string> {
  const numbers = extractPhones(rest);

  if (numbers.length >= 2) {
    const currentPhone = numbers[0];
    const newPhone = numbers[1];
    if (!currentPhone || !newPhone) return INVALID_PHONE;

    const target = await findEmployeeByPhone(currentPhone);
    if (!target) return "No employee found with that phone number.";

    setFlow(phone, {
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

    const target = await findEmployeeByPhone(currentPhone);
    if (!target) return "No employee found with that phone number.";

    setFlow(phone, {
      kind: "phone",
      step: "phone",
      employeeId: target.id,
      employeeName: target.name,
    });
    return `What is the new WhatsApp number for ${target.name}?`;
  }

  setFlow(phone, { kind: "phone", step: "employee" });
  return "Which employee? Send their name or current WhatsApp number.";
}

async function continueAddFlow(
  phone: string,
  flow: Extract<PendingFlow, { kind: "add" }>,
  text: string,
  sender: AdminSender,
): Promise<string> {
  if (flow.step === "name") {
    const name = text.trim();
    if (!name) return "What is the employee's name?";

    const existingPhone = toValidPhone(flow.phone);
    if (!existingPhone) {
      setFlow(phone, { kind: "add", step: "phone", name });
      return `What is ${name}'s WhatsApp number (with country code)?`;
    }

    setFlow(phone, {
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

    setFlow(phone, {
      kind: "add",
      step: "confirm",
      name: flow.name,
      phone: candidate,
    });
    return addConfirmation(flow.name, candidate);
  }

  if (isYes(text)) {
    clearFlow(phone);
    try {
      const created = await createEmployee(
        { name: flow.name, phone: flow.phone },
        sender.userId,
      );
      return created
        ? `Employee successfully added.\n${created.name} - ${created.phone}`
        : "Employee successfully added.";
    } catch (error) {
      if (error instanceof HttpError) return error.message;
      throw error;
    }
  }

  if (isNo(text)) {
    clearFlow(phone);
    return "Cancelled.";
  }

  return `Reply YES to confirm adding ${flow.name} (${flow.phone}), or NO to cancel.`;
}

async function continuePhoneFlow(
  phone: string,
  flow: Extract<PendingFlow, { kind: "phone" }>,
  text: string,
  sender: AdminSender,
): Promise<string> {
  if (flow.step === "employee") {
    const matches = await findEmployeesByIdentifier(text);
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
    if (!target) return "No employee found with that name or phone number.";

    setFlow(phone, {
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

    setFlow(phone, {
      kind: "phone",
      step: "confirm",
      employeeId: flow.employeeId,
      employeeName: flow.employeeName,
      phone: candidate,
    });
    return phoneConfirmation(flow.employeeName, candidate);
  }

  if (isYes(text)) {
    clearFlow(phone);
    try {
      await updateEmployeePhone(flow.employeeId, flow.phone, sender.userId);
      return "WhatsApp number updated.";
    } catch (error) {
      if (error instanceof HttpError) return error.message;
      throw error;
    }
  }

  if (isNo(text)) {
    clearFlow(phone);
    return "Cancelled.";
  }

  return `Reply YES to update ${flow.employeeName}'s number to ${flow.phone}, or NO to cancel.`;
}

export async function handleAdminMessage(args: {
  phone: string;
  body: string;
  employee: AdminSender | null;
  roleName: string | null;
}): Promise<string | null> {
  const text = args.body.trim();
  if (!text) return null;

  const command = parseCommand(text);
  const pending = getFlow(args.phone);

  if (!args.employee) {
    const looksAdmin = command || pending || ADMIN_KEYWORD.test(text);
    return looksAdmin ? "You are not a registered user." : null;
  }

  if (!isAdminRole(args.roleName)) {
    const looksAdmin = command || pending || ADMIN_KEYWORD.test(text);
    return looksAdmin ? "You are not an administrator." : null;
  }

  if (/^(cancel|batal|stop)$/i.test(text)) {
    clearFlow(args.phone);
    return "Cancelled.";
  }

  if (command) {
    clearFlow(args.phone);
    switch (command.name) {
      case "MENU":
      case "HELP":
        return MENU_TEXT;
      case "EMPLOYEE_LIST":
        return renderEmployeeList();
      case "SHOW_SCHEDULE":
        return showSchedules();
      case "SET_SCHEDULE":
        return setScheduleCommand(command.rest);
      case "SET_REMINDER":
        return setReminderCommand(command.rest);
      case "ADD_EMPLOYEE":
        return startAddFlow(args.phone, command.rest);
      case "UPDATE_PHONE":
        return startPhoneFlow(args.phone, command.rest);
      case "REPORT_TODAY": {
        const r = await generateDailyReport();
        return r.text;
      }
      case "REPORT_WEEKLY": {
        const r = await generateWeeklyReport();
        return r.text;
      }
      case "START_STANDUP": {
        if (command.rest) {
          const matches = await findEmployeesByIdentifier(command.rest);
          if (matches.length === 0) {
            return "No employee found with that name or phone number.";
          }
          if (matches.length > 1 || !matches[0]) {
            return "Multiple employees match. Reply with the exact name or WhatsApp number.";
          }
          const result = await sendStandupPrompts({
            employeeId: matches[0].id,
          });
          return standupTriggerReply(result);
        }
        const result = await sendStandupPrompts();
        return standupTriggerReply(result);
      }
    }
  }

  if (pending) {
    return pending.kind === "add"
      ? continueAddFlow(args.phone, pending, text, args.employee)
      : continuePhoneFlow(args.phone, pending, text, args.employee);
  }

  const natural = parseNaturalSchedule(text);
  if (natural) {
    const schedule = await upsertStandupSchedule(natural, args.employee.userId);
    return savedScheduleReply(schedule);
  }

  return null;
}
