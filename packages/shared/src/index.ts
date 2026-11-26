// Shared package: Zod schemas, types, constants, time-zone helpers.

import { z } from "zod";
import { EMPLOYEE_LEADS, FEE_GROUPS, type EmployeeLead } from "./fees.js";

export * from "./fees.js";
export * from "./naya-roster.js";

export const DEFAULT_TIMEZONE = "Asia/Jakarta";
export const CORE_STANDUP_ELEMENTS = [
  "yesterday",
  "today",
  "blockers",
] as const;

// The morning standup only asks for today's plan: "kemarin" comes from the
// previous checkout (or GitHub), and blockers are asked at the checkout.
export const MORNING_STANDUP_ELEMENTS = ["today"] as const;

// Work shifts. Siang follows the standup schedule's time (09:00 by default)
// and checks out at 17:00; malam starts at 19:00 and checks out at 07:00 the
// next morning, for the shift that started the evening before. All in the
// standup schedule's timezone, on its weekdays.
export const EMPLOYEE_SHIFTS = ["day", "night"] as const;
export type EmployeeShift = (typeof EMPLOYEE_SHIFTS)[number];
export const SHIFT_TIMES: Record<EmployeeShift, { standup: string; checkout: string }> = {
  day: { standup: "09:00", checkout: "17:00" },
  night: { standup: "19:00", checkout: "07:00" },
};
/** Hours the night shift's work window sits after the day's: noon to noon. */
export const NIGHT_SHIFT_OFFSET_HOURS = 12;

/**
 * The standup date a moment belongs to for a shift: a night shift's morning
 * (before noon) still belongs to the shift that started the evening before.
 */
export function shiftDate(shift: string | null | undefined, timezone: string = DEFAULT_TIMEZONE, at: Date = new Date()) {
  if (shift !== "night") return dateInTimezone(timezone, at);
  return dateInTimezone(timezone, new Date(at.getTime() - NIGHT_SHIFT_OFFSET_HOURS * 60 * 60 * 1000));
}

export const ROLE_NAMES = ["Owner", "Admin", "Manager", "Employee", "PM"] as const;
export const ADMIN_ROLES = ["Owner", "Admin"] as const;

export function isAdminRole(role: string | null | undefined): boolean {
  return !!role && (ADMIN_ROLES as readonly string[]).includes(role);
}

export function normalizePhoneNumber(input: string): string {
  const withoutDevice = ((input ?? "").split(":")[0] ?? "");
  return withoutDevice.replace(/\D/g, "");
}

export const phoneNumberSchema = z
  .string()
  .trim()
  .transform(normalizePhoneNumber)
  .pipe(
    z
      .string()
      .regex(
        /^\d{7,15}$/,
        "Phone number must include the country code (7-15 digits)",
      ),
  );

export const createEmployeeSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200),
  phone: phoneNumberSchema,
  teamId: z.string().uuid().nullish(),
  roleId: z.string().uuid().nullish(),
  // Optional: designers on Figma have no GitHub account.
  githubLogin: z.string().trim().max(40).nullish(),
  shift: z.enum(EMPLOYEE_SHIFTS).optional(), // day when left out
  lead: z.enum(EMPLOYEE_LEADS).nullish(), // lead of design or development projects
});

export const updateEmployeeSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200).optional(),
  teamId: z.string().uuid().nullable().optional(),
  roleId: z.string().uuid().nullable().optional(),
  isActive: z.boolean().optional(),
  shift: z.enum(EMPLOYEE_SHIFTS).optional(),
  lead: z.enum(EMPLOYEE_LEADS).nullable().optional(),
});

export const updateEmployeePhoneSchema = z.object({
  phone: phoneNumberSchema,
});

export const createTeamSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200),
  description: z.string().trim().max(1000).nullish(),
});

export const updateTeamSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200).optional(),
  description: z.string().trim().max(1000).nullable().optional(),
});

export const teamMemberSchema = z.object({
  employeeId: z.string().uuid(),
});

/** YYYY-MM-DD that is a real calendar day (not 2024-02-31 or 2024-13-45). */
export function isRealIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export const standupDateSchema = z
  .string()
  .refine(isRealIsoDate, "Date must be a real date in YYYY-MM-DD format");

export const triggerStandupSchema = z.object({
  employeeId: z.string().uuid().optional(),
  // Which shift's employees to prompt; day when left out.
  shift: z.enum(EMPLOYEE_SHIFTS).optional(),
  date: standupDateSchema.optional(),
  force: z.boolean().optional(),
  resend: z.boolean().optional(),
});

export const remindStandupSchema = z.object({
  date: standupDateSchema.optional(),
});

export const STANDUP_SCHEDULE_NAME = "standup";

export const timeOfDaySchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Time must be HH:mm (24-hour)");

export const weekdaysSchema = z
  .array(z.number().int().min(0).max(6))
  .min(1, "Pick at least one weekday (0=Sunday .. 6=Saturday)");

export function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

export const timezoneNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .refine(isValidTimezone, (tz) => ({ message: `Unknown time zone: ${tz}` }));

export const updateCalendarSettingsSchema = z.object({
  country: z.string().trim().min(1).max(64).optional(),
  timezone: timezoneNameSchema.optional(),
  skipWeekends: z.boolean().optional(),
  skipNationalHolidays: z.boolean().optional(),
  skipJointHolidays: z.boolean().optional(),
  config: z.unknown().optional(),
});

/** "siang 12:00, sore 15:00" for the standup reminders that are set, or null. */
export function describeStandupReminders(s: {
  reminderMiddayTime: string | null;
  reminderAfternoonTime: string | null;
}): string | null {
  const parts = [
    s.reminderMiddayTime && `siang ${s.reminderMiddayTime}`,
    s.reminderAfternoonTime && `sore ${s.reminderAfternoonTime}`,
  ].filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}

export const createScheduleSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100),
  timeOfDay: timeOfDaySchema,
  weekdays: weekdaysSchema,
  timezone: timezoneNameSchema.optional(),
  reminderMiddayTime: timeOfDaySchema.nullish(),
  reminderAfternoonTime: timeOfDaySchema.nullish(),
  closeTime: timeOfDaySchema.nullish(),
  summaryTime: timeOfDaySchema.nullish(),
});

export const updateScheduleSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100).optional(),
  timeOfDay: timeOfDaySchema.optional(),
  weekdays: weekdaysSchema.optional(),
  timezone: timezoneNameSchema.optional(),
  reminderMiddayTime: timeOfDaySchema.nullable().optional(),
  reminderAfternoonTime: timeOfDaySchema.nullable().optional(),
  closeTime: timeOfDaySchema.nullable().optional(),
  summaryTime: timeOfDaySchema.nullable().optional(),
  isActive: z.boolean().optional(),
});

export type CreateScheduleInput = z.infer<typeof createScheduleSchema>;
export type UpdateScheduleInput = z.infer<typeof updateScheduleSchema>;

// Check-ins besides the standup: end-of-week check-out, start-of-week ice breaker.
export const CHECKIN_KINDS = ["checkout", "icebreaker"] as const;
export type CheckinKind = (typeof CHECKIN_KINDS)[number];
export const checkinKindSchema = z.enum(CHECKIN_KINDS);

export const checkinQuestionSchema = z.object({
  key: z.string().trim().min(1).max(40).regex(/^[a-z0-9_]+$/, "Key: lowercase letters, digits, _"),
  text: z.string().trim().min(1, "Question text is required").max(300),
  // mood: answered with a 1-5 score (digits or emoji); text: free answer.
  type: z.enum(["text", "mood"]).default("text"),
});
export type CheckinQuestion = z.infer<typeof checkinQuestionSchema>;

export const saveCheckinConfigSchema = z
  .object({
    weekdays: weekdaysSchema,
    timeOfDay: timeOfDaySchema,
    timezone: timezoneNameSchema.optional(),
    reminderMinutes: z.number().int().min(1).max(1440).nullish(),
    closeTime: timeOfDaySchema.nullish(),
    questions: z.array(checkinQuestionSchema).min(1, "Add at least one question").max(10),
    isActive: z.boolean(),
  })
  .refine((c) => new Set(c.questions.map((q) => q.key)).size === c.questions.length, {
    message: "Question keys must be unique",
    path: ["questions"],
  });
export type SaveCheckinConfigInput = z.infer<typeof saveCheckinConfigSchema>;

// Worker runs send `configId`; dashboard runs send `kind`.
export const runCheckinSchema = z.object({
  kind: checkinKindSchema.optional(),
  configId: z.string().uuid().optional(),
  resend: z.boolean().optional(),
  force: z.boolean().optional(),
});

// Web dashboard users invited by email (Owner stays the workspace creator).
// PM is web-only: projects and fee splits, nothing else.
export const INVITABLE_ROLES = ["Admin", "Manager", "PM"] as const;

export const inviteUserSchema = z.object({
  email: z.string().trim().toLowerCase().email("Email tidak valid").max(254),
  role: z.enum(INVITABLE_ROLES),
});

export const updateWebUserSchema = z
  .object({
    role: z.enum(INVITABLE_ROLES).optional(),
    isActive: z.boolean().optional(),
  })
  .refine((v) => v.role !== undefined || v.isActive !== undefined, "Nothing to update");

export type InviteUserInput = z.infer<typeof inviteUserSchema>;

// ---- Projects & fee splits (PM) ----

export const PROJECT_TYPES = ["development", "design"] as const;
export const PROJECT_STATUSES = ["ongoing", "completed", "cancelled"] as const;
export const PAYMENT_TYPES = ["fixed", "hourly"] as const;
export const PAYMENT_STATUSES = ["pending", "accepted", "paid"] as const;
export const PROJECT_MEMBER_ROLES = ["pm_sales", "designer", "developer"] as const;

const isoDate = z.string().refine(isRealIsoDate, "Tanggal harus YYYY-MM-DD yang valid");
const money = z.number().finite().min(0).max(1_000_000_000);
const percent = z.number().finite().min(0).max(100);

export const projectInputSchema = z
  .object({
    platform: z.string().trim().min(1, "Platform wajib diisi").max(100),
    name: z.string().trim().min(1, "Nama project wajib diisi").max(300),
    type: z.enum(PROJECT_TYPES).default("development"),
    startDate: isoDate.nullish(),
    endDate: isoDate.nullish(),
    status: z.enum(PROJECT_STATUSES),
    paymentType: z.enum(PAYMENT_TYPES),
    currency: z.string().trim().toUpperCase().length(3, "Kode mata uang 3 huruf").default("USD"),
    feeReceived: money,
    platformFeePercent: z.number().finite().min(0).max(99).default(10),
    totalFee: money.nullish(),
    paymentStatus: z.enum(PAYMENT_STATUSES),
    notes: z.string().trim().max(2000).nullish(),
    members: z
      .array(
        z.object({
          employeeId: z.string().uuid(),
          role: z.enum(PROJECT_MEMBER_ROLES),
          sharePercent: percent,
        }),
      )
      .max(50),
  })
  .superRefine((p, ctx) => {
    if (p.startDate && p.endDate && p.endDate < p.startDate) {
      ctx.addIssue({ code: "custom", path: ["endDate"], message: "End date sebelum start date" });
    }
    if (p.totalFee != null && p.totalFee > p.feeReceived) {
      ctx.addIssue({ code: "custom", path: ["totalFee"], message: "Fee diterima tidak boleh lebih dari fee" });
    }
    const seen = new Set<string>();
    for (const m of p.members) {
      const key = `${m.role}:${m.employeeId}`;
      if (seen.has(key)) ctx.addIssue({ code: "custom", path: ["members"], message: "Anggota yang sama tercatat dua kali di peran yang sama" });
      seen.add(key);
    }
  });

export type ProjectInput = z.infer<typeof projectInputSchema>;

// ---- Bonus fees (Owner/Admin) ----

export const feeRangeSchema = z
  .object({ from: isoDate, to: isoDate })
  .refine((r) => r.from <= r.to, { message: "Tanggal sampai sebelum tanggal dari", path: ["to"] });

export const feeStatementInputSchema = z.object({
  from: isoDate,
  to: isoDate,
  employeeId: z.string().uuid(),
  // Percents replacing the tier table's, per group.
  percents: z.record(z.enum(FEE_GROUPS), z.number().finite().min(0).max(100)).optional(),
});

export const feeSettingsSchema = z.object({
  // Projects ending before this were paid outside the app: never carried over.
  startDate: isoDate.nullable(),
});

export type FeeStatementInput = z.infer<typeof feeStatementInputSchema>;
export type UpdateWebUserInput = z.infer<typeof updateWebUserSchema>;

export const githubLoginSchema = z.object({
  login: z.string().trim().max(40).nullable(),
});

export const githubRepoTrackSchema = z.object({
  isActive: z.boolean(),
});

export const figmaTokenSchema = z.object({
  token: z.string().trim().min(10, "Token Figma wajib diisi").max(200),
});

export const figmaFileSchema = z.object({
  // A figma.com link to the file, or just its key.
  url: z.string().trim().min(1, "Link file Figma wajib diisi").max(500),
});

export const figmaFileTrackSchema = z.object({
  isActive: z.boolean(),
});

export const figmaAccountMapSchema = z.object({
  employeeId: z.string().uuid().nullable(),
});

/** Scopes of Naya agent tokens (Hermes agents calling /mcp). */
/**
 * Scopes of Naya agent tokens (Hermes agents calling /mcp):
 * mcp:read  projects, team, standups, reports, idle members, leads
 * ops:read  status and (redacted) logs of the app's containers
 * ops:restart  restart one of OPS_SERVICES
 */
export const API_TOKEN_SCOPES = ["mcp:read", "ops:read", "ops:restart"] as const;
/** Only the Owner may hand out these. */
export const OWNER_ONLY_SCOPES = ["ops:read", "ops:restart"] as const;
export type ApiTokenScope = (typeof API_TOKEN_SCOPES)[number];

export const createApiTokenSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Nama agent wajib diisi")
    .max(60)
    .regex(/^[\w .-]+$/, "Nama hanya huruf, angka, spasi, titik, minus dan garis bawah"),
  scopes: z.array(z.enum(API_TOKEN_SCOPES)).min(1).default(["mcp:read"]),
});

/* ---------- Naya (naya.digdaya.co): the AI team on Hermes ---------- */

/** Who may do what in Naya, by web role. Chat is per agent (naya_agents.chatRoles). */
export const NAYA_POLICY = {
  instruct: ["Owner", "Admin", "PM"],
  review: ["Owner", "Admin", "Manager", "PM"],
  comment: ["Owner", "Admin", "Manager", "PM", "Employee"],
} as const satisfies Record<string, readonly (typeof ROLE_NAMES)[number][]>;
export type NayaAction = keyof typeof NAYA_POLICY;

export function nayaCan(role: string | null | undefined, action: NayaAction): boolean {
  return !!role && (NAYA_POLICY[action] as readonly string[]).includes(role);
}

/**
 * What each role may see in Naya (blueprint v3 access matrix). The office, Tugas Saya and settings
 * are for everyone; the rest only for those who run the team. Everyone else sees on the task board
 * only the cards they are the PIC of (the API filters; the menu hides the rest).
 */
export const NAYA_VIEWS = {
  /** Every card on the task board, not only one's own. */
  allTasks: ["Owner", "Admin", "Manager", "PM"],
  /** Agents: Hermes profiles, models, gateways and the roster. */
  agents: ["Owner", "Admin", "Manager", "PM"],
  /** Kalender: the agents' cron jobs. */
  calendar: ["Owner", "Admin", "Manager", "PM"],
  /** Pemakaian: tokens and AI cost (PM and Manager may look, nothing there changes anything). */
  usage: ["Owner", "Admin", "Manager", "PM"],
} as const satisfies Record<string, readonly (typeof ROLE_NAMES)[number][]>;
export type NayaView = keyof typeof NAYA_VIEWS;

export function nayaSees(role: string | null | undefined, view: NayaView): boolean {
  return !!role && (NAYA_VIEWS[view] as readonly string[]).includes(role);
}

/** A Hermes profile name (as `hermes profile list` shows it). */
export const HERMES_PROFILE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;

export const nayaAgentSchema = z.object({
  displayName: z.string().trim().min(1, "Nama tampilan wajib diisi").max(60),
  description: z.string().trim().max(300).optional().nullable(),
  /** The profile's API_SERVER_KEY; omitted keeps the stored one. */
  apiKey: z.string().trim().min(8, "API key terlalu pendek").max(300).optional(),
  chatRoles: z.array(z.enum(ROLE_NAMES)).default(["Owner", "Admin"]),
  isLead: z.boolean().default(false),
});
export type NayaAgentInput = z.infer<typeof nayaAgentSchema>;

export const nayaInstructionSchema = z.object({
  title: z.string().trim().min(1, "Judul wajib diisi").max(200),
  body: z.string().max(4000).optional(),
  board: z.string().max(64).optional(),
  assignee: z.string().regex(HERMES_PROFILE).optional(),
  /** Who reviews the result: a team member's id, or "auto" (the most available sales/PM member). */
  pic: z.union([z.literal("auto"), z.string().uuid()]).default("auto"),
});

export const nayaReviewSchema = z.object({
  note: z.string().max(4000).optional(),
  board: z.string().max(64).optional(),
});

/** The four human states of a checklist item (blueprint v3). */
export const CHECKLIST_STATUSES = ["in_progress", "done", "feedback", "rejected"] as const;
export type ChecklistStatus = (typeof CHECKLIST_STATUSES)[number];

/** A decision on one checklist item; feedback needs what to fix, a rejection needs why. */
export const nayaChecklistDecisionSchema = z
  .object({
    status: z.enum(CHECKLIST_STATUSES),
    note: z.string().trim().max(4000).optional(),
    board: z.string().max(64).optional(),
  })
  .refine((value) => !["feedback", "rejected"].includes(value.status) || !!value.note, {
    message: "Catatan wajib diisi untuk Feedback dan Ditolak.",
    path: ["note"],
  });

/** Hand a card, or one item of it, to someone else on the team (an employee id). */
export const nayaPicSchema = z.object({
  pic: z.string().uuid().nullable(),
  board: z.string().max(64).optional(),
});

/**
 * Who picks up a card at each stage: sales/PM review what the AI made; a reviewed card continues to
 * design or development. An employee's position (employees.lead) decides; without one, the name of
 * their team, matched in this order.
 */
export const NAYA_POOLS = {
  design: { label: "Designer", pattern: /desain|design|\bui\b|\bux\b|ui\/ux|kreatif|creative|grafis/i },
  development: { label: "Developer", pattern: /dev|engineer|program|front.?end|back.?end|full.?stack|mobile|software|\bit\b|tech/i },
  review: { label: "Sales/PM", pattern: /sales|\bpm\b|project|product|bisnis|business|marketing|account|manager/i },
} as const;
export type NayaPool = keyof typeof NAYA_POOLS;

const POOL_OF_LEAD: Record<EmployeeLead, NayaPool> = {
  pm_sales: "review",
  design: "design",
  designer: "design",
  development: "development",
  developer: "development",
};

/** The pool a member belongs to, from their position, else their team's name; null when neither fits. */
export function nayaPoolOf(lead: string | null | undefined, team?: string | null): NayaPool | null {
  if (lead && lead in POOL_OF_LEAD) return POOL_OF_LEAD[lead as EmployeeLead];
  if (!team) return null;
  for (const pool of Object.keys(NAYA_POOLS) as NayaPool[]) if (NAYA_POOLS[pool].pattern.test(team)) return pool;
  return null;
}

/** Continue a reviewed card to design or development. */
export const nayaContinueSchema = z.object({
  step: z.enum(["design", "development"]),
  note: z.string().trim().max(2000).optional(),
  board: z.string().max(64).optional(),
});

export const nayaChatSchema = z.object({
  messages: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(8000) }))
    .min(1)
    .max(40),
});

export const MOOD_EMOJI =["😫", "😕", "😐", "🙂", "🤩"] as const;

/** 1-5 from replies like "4", "4 capek tapi oke", "🙂". Null when absent. */
export function parseMoodScore(answer: string): number | null {
  const digit = answer.trim().match(/^([1-5])(?!\d)/);
  if (digit) return Number(digit[1]);
  const emoji = MOOD_EMOJI.findIndex((e) => answer.includes(e));
  return emoji >= 0 ? emoji + 1 : null;
}

export type StandupElement = (typeof CORE_STANDUP_ELEMENTS)[number];

const NO_BLOCKER_PHRASE =
  "(?:(?:tidak|tdk|ga|gak|nggak|ngga|enggak|belum)\\s+ada(?:\\s+(?:kendala|blocker|blockers|masalah|hambatan|issue|apa[\\s-]*apa))?" +
  "|none|no|no\\s+blockers?|nothing|nihil|kosong|n\\/?a|aman(?:\\s+(?:kok|semua|terkendali))?|lancar(?:\\s+jaya)?|-)";
const NO_BLOCKER_RE = new RegExp(`^${NO_BLOCKER_PHRASE}(?:[\\s,]+${NO_BLOCKER_PHRASE})*$`, "i");

/**
 * True when a blocker answer means "no blocker": "tidak ada", "- tidak ada",
 * "Tidak ada kendala.", "aman 👍", "none", "-". List markers, punctuation and
 * emoji around the words are ignored, so a bulleted reply still counts.
 */
export function isNoBlocker(answer: string | null | undefined): boolean {
  if (!answer) return true;
  const text = answer
    .trim()
    .replace(/^[\s\-–—*•·>]+(?=\p{L})/u, "")
    .replace(/[^\p{L}\p{N}\-]+$/u, "")
    .replace(/\s+/g, " ");
  return text === "" || NO_BLOCKER_RE.test(text);
}

export function dateInTimezone(
  timezone: string = DEFAULT_TIMEZONE,
  at: Date = new Date(),
): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

export type CreateEmployeeInput = z.infer<typeof createEmployeeSchema>;
export type UpdateEmployeeInput = z.infer<typeof updateEmployeeSchema>;
export type UpdateEmployeePhoneInput = z.infer<
  typeof updateEmployeePhoneSchema
>;
export type CreateTeamInput = z.infer<typeof createTeamSchema>;
export type UpdateTeamInput = z.infer<typeof updateTeamSchema>;
