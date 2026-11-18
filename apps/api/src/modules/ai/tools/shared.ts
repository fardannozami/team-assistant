import { eq } from "drizzle-orm";
import { createDbClient, roles } from "@repo/database";
import { describeStandupReminders, phoneNumberSchema, standupDateSchema } from "@repo/shared";
import type { getEmployee } from "../../employees/service.js";
import type { AgentEmployee } from "../context.js";
import type { ToolSpec } from "../client.js";

export const db = createDbClient(
  process.env.DATABASE_URL ??
    "postgres://teamassistant:teamassistant@localhost:5432/teamassistant",
);

export type ToolContext = {
  workspaceId: string;
  employee: AgentEmployee;
  roleName: string | null;
  actorId: string | null;
};

export type ToolResult = { ok: boolean; data?: string; error?: string };

export type PreparedAction =
  | { ok: true; args: Record<string, unknown>; summary: string }
  | { ok: false; error: string };

export type ToolHandler = (args: any, ctx: ToolContext) => Promise<ToolResult>;
export type PrepareHandler = (args: any, ctx: ToolContext) => Promise<PreparedAction>;

export const TOOL_DESCRIPTIONS = {
  getEmployeeOnly: "Only admin/manager roles may look up other employees.",
  mutating:
    "This changes data and requires the user's explicit confirmation before it is executed.",
};

export const ADMIN_ONLY = "Hanya Owner atau Admin yang bisa melakukan ini.";
export const ASSIGNABLE_ROLES = ["Employee", "Manager", "Admin"];
export const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function toolSpec(name: string, description: string, parameters: Record<string, unknown>): ToolSpec {
  return { type: "function", function: { name, description, parameters } };
}

export function ownerOrAdmin(roleName: string | null): boolean {
  return !!roleName && ["Owner", "Admin"].includes(roleName);
}

export function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** WhatsApp needs the international form; local 08xx numbers default to Indonesia. */
export function toWhatsAppPhone(input: string): string | null {
  const parsed = phoneNumberSchema.safeParse(input);
  if (!parsed.success) return null;
  const digits = parsed.data;
  if (digits.startsWith("0")) return `62${digits.slice(1)}`;
  if (digits.startsWith("8")) return `62${digits}`;
  return digits;
}

export function parseDate(value: unknown) {
  const parsed = standupDateSchema.safeParse(text(value));
  return parsed.success ? parsed.data : null;
}

export async function roleIdByName(name: string) {
  if (!ASSIGNABLE_ROLES.includes(name)) return null;
  const [row] = await db.select({ id: roles.id }).from(roles).where(eq(roles.name, name)).limit(1);
  return row?.id ?? null;
}

export function formatEmployee(e: Awaited<ReturnType<typeof getEmployee>>): ToolResult {
  if (!e) return { ok: false, error: "Employee not found." };
  return {
    ok: true,
    data: `Name: ${e.name}\nWhatsApp: ${e.phone}\nTeam: ${e.teamName ?? "none"}\nRole: ${e.roleName ?? "-"}\nActive: ${e.isActive ? "yes" : "no"}`,
  };
}

export function describeSchedule(row: {
  name: string;
  isActive: boolean;
  timeOfDay: string | null;
  cronExpression: string | null;
  weekdays: unknown;
  timezone: string;
  reminderMiddayTime: string | null;
  reminderAfternoonTime: string | null;
  closeTime: string | null;
  summaryTime: string | null;
}): string {
  const when = row.timeOfDay ?? row.cronExpression ?? "?";
  const days = Array.isArray(row.weekdays)
    ? (row.weekdays as number[]).map((d) => DAY_NAMES[d] ?? String(d)).join(", ")
    : "custom days";
  const reminders = describeStandupReminders(row);
  const reminder = reminders ? `, reminders ${reminders}` : "";
  const close = row.closeTime ? `, closes ${row.closeTime}` : "";
  const summary = row.summaryTime ? `, admin summary ${row.summaryTime}` : "";
  return `- ${row.name} (${row.isActive ? "active" : "disabled"}): ${when} ${days}, ${row.timezone}${reminder}${close}${summary}`;
}
