// Shared package: Zod schemas, types, constants, time-zone helpers.

import { z } from "zod";

export const DEFAULT_TIMEZONE = "Asia/Jakarta";
export const CORE_STANDUP_ELEMENTS = [
  "yesterday",
  "today",
  "blockers",
] as const;

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
});

export const updateEmployeeSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200).optional(),
  teamId: z.string().uuid().nullable().optional(),
  roleId: z.string().uuid().nullable().optional(),
  isActive: z.boolean().optional(),
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
export type UpdateWebUserInput = z.infer<typeof updateWebUserSchema>;

export const githubLoginSchema = z.object({
  login: z.string().trim().max(40).nullable(),
});

export const githubRepoTrackSchema = z.object({
  isActive: z.boolean(),
});

export const MOOD_EMOJI = ["😫", "😕", "😐", "🙂", "🤩"] as const;

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
