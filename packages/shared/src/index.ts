// Shared package: Zod schemas, types, constants, time-zone helpers.

import { z } from "zod";

export const DEFAULT_TIMEZONE = "Asia/Jakarta";
export const CORE_STANDUP_ELEMENTS = [
  "yesterday",
  "today",
  "blockers",
] as const;

export const ROLE_NAMES = ["Owner", "Admin", "Manager", "Employee"] as const;
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

export const standupDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format");

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

export const timezoneNameSchema = z.string().trim().min(1).max(64);

export const createScheduleSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100),
  timeOfDay: timeOfDaySchema,
  weekdays: weekdaysSchema,
  timezone: timezoneNameSchema.optional(),
  reminderMinutes: z.number().int().min(0).max(1440).nullish(),
  reminderRepeatMinutes: z.number().int().min(15).max(720).nullish(),
  closeTime: timeOfDaySchema.nullish(),
  summaryTime: timeOfDaySchema.nullish(),
});

export const updateScheduleSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100).optional(),
  timeOfDay: timeOfDaySchema.optional(),
  weekdays: weekdaysSchema.optional(),
  timezone: timezoneNameSchema.optional(),
  reminderMinutes: z.number().int().min(0).max(1440).nullable().optional(),
  reminderRepeatMinutes: z.number().int().min(15).max(720).nullable().optional(),
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
