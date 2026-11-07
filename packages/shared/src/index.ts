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
  return (input ?? "").replace(/\D/g, "");
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

export type CreateEmployeeInput = z.infer<typeof createEmployeeSchema>;
export type UpdateEmployeeInput = z.infer<typeof updateEmployeeSchema>;
export type UpdateEmployeePhoneInput = z.infer<
  typeof updateEmployeePhoneSchema
>;
export type CreateTeamInput = z.infer<typeof createTeamSchema>;
export type UpdateTeamInput = z.infer<typeof updateTeamSchema>;
