import { and, eq, gte } from "drizzle-orm";
import {
  createDbClient,
  employees,
  roles,
  schedules,
  standupAnswers,
  standupSessions,
  standups,
} from "@repo/database";
import {
  createScheduleSchema,
  createTeamSchema,
  dateInTimezone,
  DEFAULT_TIMEZONE,
  phoneNumberSchema,
  standupDateSchema,
  updateScheduleSchema,
} from "@repo/shared";
import { HttpError } from "../../lib/http-error.js";
import {
  createEmployee,
  findEmployeesByIdentifier,
  getEmployee,
  getEmployeeStandupHistory,
  listEmployees,
  updateEmployee,
  updateEmployeePhone,
} from "../employees/service.js";
import { createSchedule, deleteSchedule, listSchedules, updateSchedule } from "../schedules/service.js";
import { createTeam, deleteTeam, listTeams, updateTeam } from "../teams/service.js";
import {
  createException,
  deleteException,
  listExceptions,
  listUpcomingHolidays,
} from "../holidays/service.js";
import { sendStandupPrompts, sendStandupReminders } from "../standups/service.js";
import { standupTriggerReply } from "../whatsapp/admin.js";
import { generateDailyReport, generateWeeklyReport } from "../reports/service.js";
import { handleStandupMessage, getStandupSession } from "../standups/engine.js";
import { canViewOthers, type AgentEmployee } from "./context.js";
import type { ToolSpec } from "./client.js";

const db = createDbClient(
  process.env.DATABASE_URL ??
    "postgres://teamassistant:teamassistant@localhost:5432/teamassistant",
);

function ownerOrAdmin(roleName: string | null): boolean {
  return !!roleName && ["Owner", "Admin"].includes(roleName);
}

export type ToolContext = {
  workspaceId: string;
  employee: AgentEmployee;
  roleName: string | null;
  actorId: string | null;
};

export type ToolResult = { ok: boolean; data?: string; error?: string };

const TOOL_DESCRIPTIONS = {
  getEmployeeOnly: "Only admin/manager roles may look up other employees.",
  mutating:
    "This changes data and requires the user's explicit confirmation before it is executed.",
};

export const AI_TOOLS: ToolSpec[] = [
  {
    type: "function",
    function: {
      name: "get_employee",
      description: `Look up an employee's profile (name, WhatsApp, team, role, active status). Without arguments returns the current user. ${TOOL_DESCRIPTIONS.getEmployeeOnly}`,
      parameters: {
        type: "object",
        properties: {
          identifier: {
            type: "string",
            description:
              "Employee name or WhatsApp phone number. Omit for the current user.",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_standup_history",
      description: `Read an employee's recorded standups (most recent first). Defaults to the current user. ${TOOL_DESCRIPTIONS.getEmployeeOnly}`,
      parameters: {
        type: "object",
        properties: {
          identifier: {
            type: "string",
            description:
              "Employee name or phone. Omit for the current user.",
          },
          limit: {
            type: "integer",
            description: "Maximum standups to return (default 5).",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_standup",
      description: `Save the current user's standup for today with exactly three answers (yesterday, today, blockers). Only for the current user. ${TOOL_DESCRIPTIONS.mutating}`,
      parameters: {
        type: "object",
        properties: {
          yesterday: { type: "string", description: "What was worked on yesterday." },
          today: { type: "string", description: "What is planned for today." },
          blockers: {
            type: "string",
            description: "Blockers or issues; use 'none' when everything is fine.",
          },
        },
        required: ["yesterday", "today", "blockers"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_schedule",
      description: "List the current standup schedules (name, time, weekdays, timezone, reminder).",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "create_schedule",
      description: `Create a standup schedule. Owner/Admin only. ${TOOL_DESCRIPTIONS.mutating}`,
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Unique schedule name." },
          timeOfDay: { type: "string", description: "HH:mm 24-hour time." },
          weekdays: {
            type: "array",
            items: { type: "integer" },
            description: "0=Sunday..6=Saturday.",
          },
          timezone: { type: "string", description: "IANA timezone, e.g. Asia/Jakarta." },
          reminderMinutes: {
            type: "integer",
            description: "Optional reminder, minutes after the standup (0-1440).",
          },
        },
        required: ["name", "timeOfDay", "weekdays"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_schedule",
      description: `Update an existing standup schedule by id or name. Owner/Admin only. ${TOOL_DESCRIPTIONS.mutating}`,
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "Schedule id (takes priority over name)." },
          name: { type: "string", description: "Current schedule name to find (also the new name when renaming)." },
          timeOfDay: { type: "string", description: "HH:mm 24-hour time." },
          weekdays: { type: "array", items: { type: "integer" }, description: "0=Sunday..6=Saturday." },
          timezone: { type: "string", description: "IANA timezone, e.g. Asia/Jakarta." },
          reminderMinutes: { type: "integer", description: "Reminder minutes after the standup (0-1440), or null to disable." },
          isActive: { type: "boolean", description: "Enable or disable the schedule." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_team_activity",
      description:
        "Aggregated standup activity for active employees over the last 7 days: completed counts and recurring blockers. Manager/Admin only; no raw standings are returned.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "generate_daily_report",
      description:
        "Generate the daily standup report (submissions, blockers). Manager/Admin only.",
      parameters: {
        type: "object",
        properties: {
          date: { type: "string", description: "Optional date in YYYY-MM-DD; defaults to today." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "generate_weekly_report",
      description:
        "Generate the weekly standup report (daily completion, repeated blockers). Manager/Admin only.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "list_employees",
      description: `List employees (name, WhatsApp, team, role, active). ${TOOL_DESCRIPTIONS.getEmployeeOnly}`,
      parameters: {
        type: "object",
        properties: {
          status: { type: "string", enum: ["active", "inactive", "all"], description: "Default active." },
          team: { type: "string", description: "Only employees of this team (name)." },
          search: { type: "string", description: "Filter by part of a name or phone." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_employee",
      description: `Add a new employee. Owner/Admin only. Ask for the name and WhatsApp number if missing. ${TOOL_DESCRIPTIONS.mutating}`,
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Full name." },
          phone: { type: "string", description: "WhatsApp number, e.g. 0812... or 62812..." },
          team: { type: "string", description: "Optional team name." },
          role: { type: "string", enum: ["Employee", "Manager", "Admin"], description: "Default Employee." },
        },
        required: ["name", "phone"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_employee",
      description: `Change an employee's name, team or role. Owner/Admin only. ${TOOL_DESCRIPTIONS.mutating}`,
      parameters: {
        type: "object",
        properties: {
          identifier: { type: "string", description: "Current employee name or phone." },
          name: { type: "string", description: "New name." },
          team: { type: "string", description: "New team name, or 'none' to remove from the team." },
          role: { type: "string", enum: ["Employee", "Manager", "Admin"] },
        },
        required: ["identifier"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_employee_phone",
      description: `Change an employee's WhatsApp number. Owner/Admin only. ${TOOL_DESCRIPTIONS.mutating}`,
      parameters: {
        type: "object",
        properties: {
          identifier: { type: "string", description: "Employee name or current phone." },
          phone: { type: "string", description: "New WhatsApp number." },
        },
        required: ["identifier", "phone"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "set_employee_active",
      description: `Deactivate an employee (no more standup prompts) or reactivate them. Owner/Admin only. ${TOOL_DESCRIPTIONS.mutating}`,
      parameters: {
        type: "object",
        properties: {
          identifier: { type: "string", description: "Employee name or phone." },
          active: { type: "boolean", description: "false to deactivate, true to reactivate." },
        },
        required: ["identifier", "active"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_teams",
      description: "List teams with their member counts. Manager/Admin only.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "create_team",
      description: `Create a team. Owner/Admin only. ${TOOL_DESCRIPTIONS.mutating}`,
      parameters: {
        type: "object",
        properties: {
          name: { type: "string" },
          description: { type: "string" },
        },
        required: ["name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_team",
      description: `Rename a team or change its description. Owner/Admin only. ${TOOL_DESCRIPTIONS.mutating}`,
      parameters: {
        type: "object",
        properties: {
          team: { type: "string", description: "Current team name." },
          name: { type: "string", description: "New name." },
          description: { type: "string" },
        },
        required: ["team"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_team",
      description: `Delete an empty team. Owner/Admin only. ${TOOL_DESCRIPTIONS.mutating}`,
      parameters: {
        type: "object",
        properties: { team: { type: "string", description: "Team name." } },
        required: ["team"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_schedule",
      description: `Delete a standup schedule by name. Owner/Admin only. ${TOOL_DESCRIPTIONS.mutating}`,
      parameters: {
        type: "object",
        properties: { name: { type: "string", description: "Schedule name." } },
        required: ["name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "start_standup",
      description: `Send today's standup prompt now, to everyone or to one employee. Owner/Admin only. ${TOOL_DESCRIPTIONS.mutating}`,
      parameters: {
        type: "object",
        properties: {
          identifier: { type: "string", description: "Optional employee name or phone; omit for everyone." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "send_standup_reminder",
      description: `Remind everyone who has not finished today's standup. Owner/Admin only. ${TOOL_DESCRIPTIONS.mutating}`,
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "list_holidays",
      description: "Upcoming public holidays plus this workspace's own day-off / workday exceptions.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "add_calendar_exception",
      description: `Mark a date as a day off (no standup) or as a working day despite a holiday. Owner/Admin only. ${TOOL_DESCRIPTIONS.mutating}`,
      parameters: {
        type: "object",
        properties: {
          date: { type: "string", description: "YYYY-MM-DD." },
          skip: { type: "boolean", description: "true = day off (default), false = standup still runs." },
          reason: { type: "string" },
        },
        required: ["date"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_calendar_exception",
      description: `Remove this workspace's exception for a date. Owner/Admin only. ${TOOL_DESCRIPTIONS.mutating}`,
      parameters: {
        type: "object",
        properties: { date: { type: "string", description: "YYYY-MM-DD." } },
        required: ["date"],
      },
    },
  },
];

/** Tools that change data: they are prepared, confirmed with YES, then run. */
export const MUTATING_TOOLS = new Set([
  "create_schedule",
  "update_schedule",
  "create_standup",
  "add_employee",
  "update_employee",
  "update_employee_phone",
  "set_employee_active",
  "create_team",
  "update_team",
  "delete_team",
  "delete_schedule",
  "start_standup",
  "send_standup_reminder",
  "add_calendar_exception",
  "delete_calendar_exception",
]);

export type EmployeeLookup =
  | { ok: true; employee: Awaited<ReturnType<typeof getEmployee>> }
  | { ok: false; error: string };

async function resolveTargetEmployee(
  args: any,
  ctx: ToolContext,
): Promise<EmployeeLookup> {
  const identifier = typeof args?.identifier === "string" ? args.identifier.trim() : "";
  if (!identifier) {
    return { ok: true, employee: await getEmployee(ctx.workspaceId, ctx.employee.id) };
  }

  const self = ctx.employee;
  if (identifier === self.name || identifier === self.phone) {
    return { ok: true, employee: await getEmployee(ctx.workspaceId, self.id) };
  }

  if (!canViewOthers(ctx.roleName)) {
    return {
      ok: false,
      error: "Your role is not allowed to view other employees.",
    };
  }

  const matches = await findEmployeesByIdentifier(ctx.workspaceId, identifier);
  if (matches.length === 0) {
    return { ok: false, error: `No employee found for "${identifier}".` };
  }
  if (matches.length > 1) {
    const list = matches
      .slice(0, 5)
      .map((m) => `${m.name} (${m.phone})`)
      .join(", ");
    return {
      ok: false,
      error: `Multiple employees match "${identifier}": ${list}. Be more specific.`,
    };
  }

  return { ok: true, employee: await getEmployee(ctx.workspaceId, matches[0]!.id) };
}

function formatEmployee(e: Awaited<ReturnType<typeof getEmployee>>): ToolResult {
  if (!e) return { ok: false, error: "Employee not found." };
  return {
    ok: true,
    data: `Name: ${e.name}\nWhatsApp: ${e.phone}\nTeam: ${e.teamName ?? "none"}\nRole: ${e.roleName ?? "-"}\nActive: ${e.isActive ? "yes" : "no"}`,
  };
}

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function describeSchedule(row: {
  name: string;
  isActive: boolean;
  timeOfDay: string | null;
  cronExpression: string | null;
  weekdays: unknown;
  timezone: string;
  reminderMinutes: number | null;
}): string {
  const when = row.timeOfDay ?? row.cronExpression ?? "?";
  const days = Array.isArray(row.weekdays)
    ? (row.weekdays as number[]).map((d) => DAY_NAMES[d] ?? String(d)).join(", ")
    : "custom days";
  const reminder =
    row.reminderMinutes != null ? `, reminder ${row.reminderMinutes} min after` : "";
  return `- ${row.name} (${row.isActive ? "active" : "disabled"}): ${when} ${days}, ${row.timezone}${reminder}`;
}

const ADMIN_ONLY = "Hanya Owner atau Admin yang bisa melakukan ini.";
const ASSIGNABLE_ROLES = ["Employee", "Manager", "Admin"];

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** WhatsApp needs the international form; local 08xx numbers default to Indonesia. */
function toWhatsAppPhone(input: string): string | null {
  const parsed = phoneNumberSchema.safeParse(input);
  if (!parsed.success) return null;
  const digits = parsed.data;
  if (digits.startsWith("0")) return `62${digits.slice(1)}`;
  if (digits.startsWith("8")) return `62${digits}`;
  return digits;
}

async function findOneEmployee(ctx: ToolContext, identifier: string) {
  if (!identifier) return { ok: false as const, error: "Sebutkan nama atau nomor karyawan." };
  const matches = await findEmployeesByIdentifier(ctx.workspaceId, identifier);
  if (matches.length === 0) return { ok: false as const, error: `Tidak ada karyawan "${identifier}".` };
  if (matches.length > 1) {
    const list = matches.slice(0, 5).map((m) => `${m.name} (${m.phone})`).join(", ");
    return { ok: false as const, error: `Ada beberapa yang cocok dengan "${identifier}": ${list}. Tanyakan yang mana.` };
  }
  return { ok: true as const, employee: matches[0]! };
}

async function findTeam(ctx: ToolContext, name: string) {
  if (!name) return { ok: false as const, error: "Sebutkan nama tim." };
  const all = await listTeams(ctx.workspaceId);
  const lower = name.toLowerCase();
  const exact = all.filter((t) => t.name.toLowerCase() === lower);
  const matches = exact.length ? exact : all.filter((t) => t.name.toLowerCase().includes(lower));
  if (matches.length === 1) return { ok: true as const, team: matches[0]! };
  const names = all.map((t) => t.name).join(", ") || "belum ada tim";
  return {
    ok: false as const,
    error: matches.length ? `Ada beberapa tim yang cocok dengan "${name}".` : `Tim "${name}" tidak ditemukan. Tim yang ada: ${names}.`,
  };
}

async function roleIdByName(name: string) {
  if (!ASSIGNABLE_ROLES.includes(name)) return null;
  const [row] = await db.select({ id: roles.id }).from(roles).where(eq(roles.name, name)).limit(1);
  return row?.id ?? null;
}

function parseDate(value: unknown) {
  const parsed = standupDateSchema.safeParse(text(value));
  return parsed.success ? parsed.data : null;
}

export type PreparedAction =
  | { ok: true; args: Record<string, unknown>; summary: string }
  | { ok: false; error: string };

const CONFIRM = "Balas YA untuk melanjutkan atau TIDAK untuk membatalkan.";

/**
 * Validates a mutating tool call and resolves names to ids before asking for
 * confirmation, so the user confirms exactly what will run. Returns null for
 * tools that confirm with their raw arguments.
 */
export async function prepareTool(
  name: string,
  args: any,
  ctx: ToolContext,
): Promise<PreparedAction | null> {
  const adminTools = MUTATING_TOOLS.has(name) && !["create_standup", "create_schedule", "update_schedule"].includes(name);
  if (!adminTools) return null;
  if (!ownerOrAdmin(ctx.roleName)) return { ok: false, error: ADMIN_ONLY };

  try {
    switch (name) {
      case "add_employee": {
        const employeeName = text(args?.name);
        const phone = toWhatsAppPhone(text(args?.phone));
        if (!employeeName) return { ok: false, error: "Nama karyawan belum disebutkan." };
        if (!phone) return { ok: false, error: "Nomor WhatsApp belum ada atau tidak valid." };
        const role = text(args?.role) || "Employee";
        const roleId = await roleIdByName(role);
        if (!roleId) return { ok: false, error: `Role harus salah satu dari: ${ASSIGNABLE_ROLES.join(", ")}.` };
        let teamId: string | null = null;
        let teamName = "";
        if (text(args?.team)) {
          const team = await findTeam(ctx, text(args.team));
          if (!team.ok) return team;
          teamId = team.team.id;
          teamName = team.team.name;
        }
        return {
          ok: true,
          args: { name: employeeName, phone, roleId, teamId },
          summary: `Tambah karyawan ${employeeName} (${phone}) sebagai ${role}${teamName ? ` di tim ${teamName}` : ""}?`,
        };
      }

      case "update_employee": {
        const found = await findOneEmployee(ctx, text(args?.identifier));
        if (!found.ok) return found;
        const changes: Record<string, unknown> = {};
        const parts: string[] = [];
        if (text(args?.name)) {
          changes.name = text(args.name);
          parts.push(`nama jadi ${changes.name}`);
        }
        if (text(args?.team)) {
          if (/^(none|tidak ada|-)$/i.test(text(args.team))) {
            changes.teamId = null;
            parts.push("keluarkan dari tim");
          } else {
            const team = await findTeam(ctx, text(args.team));
            if (!team.ok) return team;
            changes.teamId = team.team.id;
            parts.push(`pindah ke tim ${team.team.name}`);
          }
        }
        if (text(args?.role)) {
          if (found.employee.roleName === "Owner") return { ok: false, error: "Role Owner tidak bisa diubah lewat chat." };
          const roleId = await roleIdByName(text(args.role));
          if (!roleId) return { ok: false, error: `Role harus salah satu dari: ${ASSIGNABLE_ROLES.join(", ")}.` };
          changes.roleId = roleId;
          parts.push(`role jadi ${text(args.role)}`);
        }
        if (parts.length === 0) return { ok: false, error: "Tidak ada perubahan yang disebutkan (nama, tim, atau role)." };
        return {
          ok: true,
          args: { employeeId: found.employee.id, changes },
          summary: `Ubah ${found.employee.name}: ${parts.join(", ")}?`,
        };
      }

      case "update_employee_phone": {
        const found = await findOneEmployee(ctx, text(args?.identifier));
        if (!found.ok) return found;
        const phone = toWhatsAppPhone(text(args?.phone));
        if (!phone) return { ok: false, error: "Nomor WhatsApp baru belum ada atau tidak valid." };
        return {
          ok: true,
          args: { employeeId: found.employee.id, phone },
          summary: `Ganti nomor WhatsApp ${found.employee.name} dari ${found.employee.phone} ke ${phone}?`,
        };
      }

      case "set_employee_active": {
        const found = await findOneEmployee(ctx, text(args?.identifier));
        if (!found.ok) return found;
        const active = args?.active !== false;
        if (!active && found.employee.id === ctx.employee.id) {
          return { ok: false, error: "Anda tidak bisa menonaktifkan diri sendiri." };
        }
        if (!active && found.employee.roleName === "Owner") {
          return { ok: false, error: "Owner tidak bisa dinonaktifkan lewat chat." };
        }
        return {
          ok: true,
          args: { employeeId: found.employee.id, active },
          summary: active
            ? `Aktifkan kembali ${found.employee.name}?`
            : `Nonaktifkan ${found.employee.name}? Ia tidak akan menerima prompt standup lagi.`,
        };
      }

      case "create_team": {
        const parsed = createTeamSchema.safeParse({ name: text(args?.name), description: text(args?.description) || null });
        if (!parsed.success) return { ok: false, error: "Nama tim belum disebutkan." };
        return { ok: true, args: parsed.data, summary: `Buat tim "${parsed.data.name}"?` };
      }

      case "update_team": {
        const team = await findTeam(ctx, text(args?.team));
        if (!team.ok) return team;
        const changes: Record<string, unknown> = {};
        if (text(args?.name)) changes.name = text(args.name);
        if (text(args?.description)) changes.description = text(args.description);
        if (Object.keys(changes).length === 0) return { ok: false, error: "Sebutkan nama baru atau deskripsinya." };
        return {
          ok: true,
          args: { teamId: team.team.id, changes },
          summary: changes.name ? `Ganti nama tim ${team.team.name} jadi "${changes.name}"?` : `Ubah deskripsi tim ${team.team.name}?`,
        };
      }

      case "delete_team": {
        const team = await findTeam(ctx, text(args?.team));
        if (!team.ok) return team;
        if (team.team.memberCount > 0) {
          return { ok: false, error: `Tim ${team.team.name} masih punya ${team.team.memberCount} anggota; pindahkan dulu.` };
        }
        return { ok: true, args: { teamId: team.team.id }, summary: `Hapus tim ${team.team.name}?` };
      }

      case "delete_schedule": {
        const scheduleName = text(args?.name);
        const target = (await listSchedules(ctx.workspaceId)).find((r) => r.name.toLowerCase() === scheduleName.toLowerCase());
        if (!target) return { ok: false, error: `Jadwal "${scheduleName}" tidak ditemukan.` };
        return { ok: true, args: { scheduleId: target.id }, summary: `Hapus jadwal "${target.name}"?` };
      }

      case "start_standup": {
        if (!text(args?.identifier)) {
          return { ok: true, args: {}, summary: "Kirim prompt standup hari ini ke semua karyawan aktif sekarang?" };
        }
        const found = await findOneEmployee(ctx, text(args.identifier));
        if (!found.ok) return found;
        return {
          ok: true,
          args: { employeeId: found.employee.id },
          summary: `Kirim prompt standup hari ini ke ${found.employee.name} sekarang?`,
        };
      }

      case "send_standup_reminder":
        return { ok: true, args: {}, summary: "Kirim pengingat ke semua yang belum menyelesaikan standup hari ini?" };

      case "add_calendar_exception": {
        const date = parseDate(args?.date);
        if (!date) return { ok: false, error: "Tanggal harus berformat YYYY-MM-DD." };
        const skip = args?.skip !== false;
        const reason = text(args?.reason);
        return {
          ok: true,
          args: { date, skip, reason: reason || undefined },
          summary: `${skip ? "Liburkan standup" : "Tetap jalankan standup"} pada ${date}${reason ? ` (${reason})` : ""}?`,
        };
      }

      case "delete_calendar_exception": {
        const date = parseDate(args?.date);
        if (!date) return { ok: false, error: "Tanggal harus berformat YYYY-MM-DD." };
        const existing = (await listExceptions(ctx.workspaceId)).filter((e) => e.date === date);
        if (existing.length === 0) return { ok: false, error: `Tidak ada pengecualian kalender pada ${date}.` };
        return { ok: true, args: { date }, summary: `Hapus pengecualian kalender pada ${date}?` };
      }
    }
    return null;
  } catch (error) {
    if (error instanceof HttpError) return { ok: false, error: error.message };
    throw error;
  }
}

/** Appends the YES/NO instruction to a prepared summary. */
export function confirmationText(summary: string): string {
  return `${summary}\n${CONFIRM}`;
}

export type StandupCollector = {
  id: string;
  workspaceId: string;
  name: string;
  phone: string;
  isActive: boolean;
};

/**
 * Executes an agent tool with backend-side authorization and validation.
 * Never throws for business errors: unknown tools and unauthorized calls are
 * returned as structured errors so the model can react.
 */
export async function executeTool(
  name: string,
  args: any,
  ctx: ToolContext,
): Promise<ToolResult> {
  try {
    switch (name) {
      case "get_employee": {
        const target = await resolveTargetEmployee(args, ctx);
        if (!target.ok) return target;
        return formatEmployee(target.employee);
      }

      case "get_standup_history": {
        const target = await resolveTargetEmployee(args, ctx);
        if (!target.ok) return target;
        if (!target.employee) return { ok: false, error: "Employee not found." };

        const limit = Math.min(Math.max(Number(args?.limit ?? 5), 1), 20);
        const { standups: history } = await getEmployeeStandupHistory(
          ctx.workspaceId,
          target.employee.id,
        );
        if (history.length === 0) {
          return { ok: true, data: "No recorded standups yet." };
        }
        return {
          ok: true,
          data: history
            .slice(0, limit)
            .map(
              (s) =>
                `- ${s.date}: yesterday="${s.answers.yesterday ?? "-"}", today="${s.answers.today ?? "-"}", blockers="${s.answers.blockers ?? "-"}"`,
            )
            .join("\n"),
        };
      }

      case "create_standup": {
        if (args?.identifier || args?.employeeId || args?.phone) {
          return { ok: false, error: "Standups can only be saved for yourself." };
        }
        if (!ctx.employee.isActive) {
          return { ok: false, error: "Only active employees can send standups." };
        }

        const yesterday = String(args?.yesterday ?? "").trim();
        const today = String(args?.today ?? "").trim();
        const blockers = String(args?.blockers ?? "").trim();
        const missing = [
          ["yesterday", yesterday],
          ["today", today],
          ["blockers", blockers],
        ]
          .filter(([, value]) => !value)
          .map(([key]) => key);
        if (missing.length > 0) {
          return {
            ok: false,
            error: `Missing answer(s): ${missing.join(", ")}. Ask the user for them.`,
          };
        }

        // STANDUP opens today's session on demand, like the WhatsApp keyword.
        const composed = `STANDUP Yesterday: ${yesterday}. Today: ${today}. Blockers: ${blockers}`;
        const collector: StandupCollector = {
          id: ctx.employee.id,
          workspaceId: ctx.workspaceId,
          name: ctx.employee.name,
          phone: ctx.employee.phone,
          isActive: ctx.employee.isActive,
        };
        const reply = await handleStandupMessage({ employee: collector, body: composed });
        if (reply) return { ok: true, data: reply };

        const session = await getStandupSession(
          ctx.employee.id,
          dateInTimezone(),
        );
        if (!session) {
          return {
            ok: false,
            error:
              "There is no open standup session for today yet. An admin needs to start the standup first.",
          };
        }
        if (session.status === "completed") {
          return {
            ok: false,
            error: "Today's standup was already completed. Nothing to save.",
          };
        }
        return { ok: false, error: "The standup answers could not be saved." };
      }

      case "get_schedule": {
        const rows = await listSchedules(ctx.workspaceId);
        if (rows.length === 0) {
          return { ok: true, data: "No schedules configured yet." };
        }
        return { ok: true, data: rows.map(describeSchedule).join("\n") };
      }

      case "create_schedule": {
        if (!ownerOrAdmin(ctx.roleName)) {
          return {
            ok: false,
            error: "Only Owner or Admin can create schedules.",
          };
        }
        const parsed = createScheduleSchema.safeParse(args);
        if (!parsed.success) {
          return {
            ok: false,
            error: parsed.error.issues
              .map((i) => `${i.path.join(".") || "body"}: ${i.message}`)
              .join("; "),
          };
        }
        const created = await createSchedule(ctx.workspaceId, parsed.data, ctx.actorId);
        return {
          ok: true,
          data: `Schedule "${created!.name}" created: ${created!.timeOfDay} ${Array.isArray(created!.weekdays) ? (created!.weekdays as number[]).map((d) => DAY_NAMES[d]).join(", ") : ""} ${created!.timezone}`,
        };
      }

      case "update_schedule": {
        if (!ownerOrAdmin(ctx.roleName)) {
          return {
            ok: false,
            error: "Only Owner or Admin can update schedules.",
          };
        }

        const id = typeof args?.id === "string" ? args.id : "";
        const name = typeof args?.name === "string" ? args.name.trim() : "";
        let target = null;
        if (id) {
          const [row] = await db
            .select()
            .from(schedules)
            .where(and(eq(schedules.id, id), eq(schedules.workspaceId, ctx.workspaceId)))
            .limit(1);
          target = row ?? null;
        } else if (name) {
          const [row] = await db
            .select()
            .from(schedules)
            .where(and(eq(schedules.name, name), eq(schedules.workspaceId, ctx.workspaceId)))
            .limit(1);
          target = row ?? null;
        } else {
          return {
            ok: false,
            error: "Provide the schedule id or name to update.",
          };
        }
        if (!target) {
          return { ok: false, error: "Schedule not found." };
        }

        const parsed = updateScheduleSchema.safeParse(args);
        if (!parsed.success) {
          return {
            ok: false,
            error: parsed.error.issues
              .map((i) => `${i.path.join(".") || "body"}: ${i.message}`)
              .join("; "),
          };
        }

        const updated = await updateSchedule(
          ctx.workspaceId,
          target.id,
          parsed.data,
          ctx.actorId,
        );
        return { ok: true, data: `Schedule updated.\n${describeSchedule(updated)}` };
      }

      case "get_team_activity": {
        if (!canViewOthers(ctx.roleName)) {
          return {
            ok: false,
            error: "Only Manager, Admin or Owner can view team activity.",
          };
        }

        const until = new Date();
        const since = new Date();
        since.setDate(since.getDate() - 6);
        const startStr = dateInTimezone(DEFAULT_TIMEZONE, since);
        const todayStr = dateInTimezone();

        const rosters = await listEmployees(ctx.workspaceId, { active: true });
        const rosterIds = new Set(rosters.map((r) => r.id));

        const rows = await db
          .select({
            employeeId: standupSessions.employeeId,
            date: standupSessions.date,
            status: standupSessions.status,
          })
          .from(standupSessions)
          .innerJoin(employees, eq(standupSessions.employeeId, employees.id))
          .where(
            and(
              eq(standupSessions.workspaceId, ctx.workspaceId),
              eq(employees.workspaceId, ctx.workspaceId),
              gte(standupSessions.date, startStr),
              eq(employees.isActive, true),
            ),
          );

        const perEmployee = new Map<string, { recorded: number; completed: number }>();
        for (const row of rows) {
          if (!rosterIds.has(row.employeeId)) continue;
          const entry = perEmployee.get(row.employeeId) ?? {
            recorded: 0,
            completed: 0,
          };
          entry.recorded++;
          if (row.status === "completed") entry.completed++;
          perEmployee.set(row.employeeId, entry);
        }

        const blockerRows = await db
          .select({
            block: standupAnswers.answer,
          })
          .from(standupAnswers)
          .innerJoin(standups, eq(standupAnswers.standupId, standups.id))
          .where(
            and(
              eq(standups.workspaceId, ctx.workspaceId),
              gte(standups.date, startStr),
              eq(standupAnswers.questionKey, "blockers"),
            ),
          )
          .limit(500);

        const blockers = new Map<string, number>();
        for (const row of blockerRows) {
          const value = row.block?.trim().toLowerCase();
          if (!value || value === "none") continue;
          blockers.set(row.block.trim(), (blockers.get(row.block.trim()) ?? 0) + 1);
        }

        const lines = [
          `Team activity (${startStr} to ${todayStr}):`,
          `Active employees: ${rosters.length}`,
          ...rosters.map((r) => {
            const stats = perEmployee.get(r.id);
            return stats
              ? `- ${r.name}: standups recorded ${stats.recorded}, completed ${stats.completed}`
              : `- ${r.name}: no standups recorded`;
          }),
        ];
        if (blockers.size > 0) {
          lines.push(
            "Blockers mentioned:",
            ...[...blockers.entries()]
              .sort((a, b) => b[1] - a[1])
              .slice(0, 5)
              .map(([text, count]) => `- "${text}" (${count}x)`),
          );
        }
        return { ok: true, data: lines.join("\n") };
      }

      case "generate_daily_report": {
        if (!canViewOthers(ctx.roleName)) {
          return {
            ok: false,
            error: "Only Manager, Admin or Owner can generate reports.",
          };
        }
        const date =
          typeof args?.date === "string" && args.date.trim()
            ? args.date.trim()
            : undefined;
        const report = await generateDailyReport(ctx.workspaceId, date);
        return { ok: true, data: report.text };
      }

      case "generate_weekly_report": {
        if (!canViewOthers(ctx.roleName)) {
          return {
            ok: false,
            error: "Only Manager, Admin or Owner can generate reports.",
          };
        }
        const report = await generateWeeklyReport(ctx.workspaceId);
        return { ok: true, data: report.text };
      }

      case "list_employees": {
        if (!canViewOthers(ctx.roleName)) {
          return { ok: false, error: "Only Manager, Admin or Owner can list employees." };
        }
        const status = text(args?.status) || "active";
        let teamId: string | undefined;
        if (text(args?.team)) {
          const team = await findTeam(ctx, text(args.team));
          if (!team.ok) return team;
          teamId = team.team.id;
        }
        const rows = await listEmployees(ctx.workspaceId, {
          active: status === "all" ? undefined : status !== "inactive",
          teamId,
          search: text(args?.search) || undefined,
        });
        if (rows.length === 0) return { ok: true, data: "Tidak ada karyawan yang cocok." };
        return {
          ok: true,
          data: [
            `${rows.length} karyawan:`,
            ...rows.map(
              (e) =>
                `- ${e.name} (${e.phone})${e.teamName ? ` · tim ${e.teamName}` : ""} · ${e.roleName ?? "-"}${e.isActive ? "" : " · nonaktif"}`,
            ),
          ].join("\n"),
        };
      }

      case "list_teams": {
        if (!canViewOthers(ctx.roleName)) {
          return { ok: false, error: "Only Manager, Admin or Owner can list teams." };
        }
        const rows = await listTeams(ctx.workspaceId);
        if (rows.length === 0) return { ok: true, data: "Belum ada tim." };
        return { ok: true, data: rows.map((t) => `- ${t.name}: ${t.memberCount} anggota`).join("\n") };
      }

      case "list_holidays": {
        const [upcoming, exceptions] = await Promise.all([
          listUpcomingHolidays(8),
          listExceptions(ctx.workspaceId),
        ]);
        const today = dateInTimezone();
        const lines = upcoming.length
          ? ["Hari libur mendatang:", ...upcoming.map((h) => `- ${h.date}: ${h.name}`)]
          : ["Belum ada data hari libur mendatang."];
        const own = exceptions.filter((e) => e.date >= today);
        if (own.length) {
          lines.push(
            "Pengecualian workspace:",
            ...own.map((e) => `- ${e.date}: ${e.skip ? "libur" : "tetap standup"}${e.reason ? ` (${e.reason})` : ""}`),
          );
        }
        return { ok: true, data: lines.join("\n") };
      }

      // Mutating admin tools below run only after prepareTool and a YES; their
      // args carry resolved ids, and every service call is workspace-scoped.
      case "add_employee": {
        if (!ownerOrAdmin(ctx.roleName)) return { ok: false, error: ADMIN_ONLY };
        const created = await createEmployee(
          ctx.workspaceId,
          { name: args.name, phone: args.phone, roleId: args.roleId, teamId: args.teamId },
          ctx.actorId,
        );
        return { ok: true, data: `${created!.name} (${created!.phone}) ditambahkan sebagai ${created!.roleName ?? "karyawan"}.` };
      }

      case "update_employee": {
        if (!ownerOrAdmin(ctx.roleName)) return { ok: false, error: ADMIN_ONLY };
        const updated = await updateEmployee(ctx.workspaceId, args.employeeId, args.changes, ctx.actorId);
        return { ok: true, data: `Data ${updated!.name} diperbarui: tim ${updated!.teamName ?? "-"}, role ${updated!.roleName ?? "-"}.` };
      }

      case "update_employee_phone": {
        if (!ownerOrAdmin(ctx.roleName)) return { ok: false, error: ADMIN_ONLY };
        const updated = await updateEmployeePhone(ctx.workspaceId, args.employeeId, args.phone, ctx.actorId);
        return { ok: true, data: `Nomor ${updated!.name} sekarang ${updated!.phone}.` };
      }

      case "set_employee_active": {
        if (!ownerOrAdmin(ctx.roleName)) return { ok: false, error: ADMIN_ONLY };
        const updated = await updateEmployee(ctx.workspaceId, args.employeeId, { isActive: args.active }, ctx.actorId);
        return { ok: true, data: `${updated!.name} sekarang ${updated!.isActive ? "aktif" : "nonaktif"}.` };
      }

      case "create_team": {
        if (!ownerOrAdmin(ctx.roleName)) return { ok: false, error: ADMIN_ONLY };
        const created = await createTeam(ctx.workspaceId, args, ctx.actorId);
        return { ok: true, data: `Tim "${created.name}" dibuat.` };
      }

      case "update_team": {
        if (!ownerOrAdmin(ctx.roleName)) return { ok: false, error: ADMIN_ONLY };
        const updated = await updateTeam(ctx.workspaceId, args.teamId, args.changes, ctx.actorId);
        return { ok: true, data: `Tim "${updated.name}" diperbarui.` };
      }

      case "delete_team": {
        if (!ownerOrAdmin(ctx.roleName)) return { ok: false, error: ADMIN_ONLY };
        await deleteTeam(ctx.workspaceId, args.teamId, ctx.actorId);
        return { ok: true, data: "Tim dihapus." };
      }

      case "delete_schedule": {
        if (!ownerOrAdmin(ctx.roleName)) return { ok: false, error: ADMIN_ONLY };
        await deleteSchedule(ctx.workspaceId, args.scheduleId, ctx.actorId);
        return { ok: true, data: "Jadwal dihapus." };
      }

      case "start_standup": {
        if (!ownerOrAdmin(ctx.roleName)) return { ok: false, error: ADMIN_ONLY };
        const result = await sendStandupPrompts(ctx.workspaceId, {
          employeeId: args.employeeId,
          resend: true,
        });
        return { ok: true, data: standupTriggerReply(result) };
      }

      case "send_standup_reminder": {
        if (!ownerOrAdmin(ctx.roleName)) return { ok: false, error: ADMIN_ONLY };
        const result = await sendStandupReminders(ctx.workspaceId);
        if ("whatsappConnected" in result && result.whatsappConnected === false) {
          return { ok: false, error: "WhatsApp workspace ini belum terhubung." };
        }
        return {
          ok: true,
          data: result.sent > 0 ? `Pengingat terkirim ke ${result.sent} karyawan.` : "Semua sudah menyelesaikan standup, tidak ada pengingat dikirim.",
        };
      }

      case "add_calendar_exception": {
        if (!ownerOrAdmin(ctx.roleName)) return { ok: false, error: ADMIN_ONLY };
        const created = await createException(
          ctx.workspaceId,
          { date: args.date, skip: args.skip, reason: args.reason },
          ctx.actorId,
        );
        return { ok: true, data: `${created.date} dicatat sebagai ${created.skip ? "hari libur standup" : "hari kerja"}.` };
      }

      case "delete_calendar_exception": {
        if (!ownerOrAdmin(ctx.roleName)) return { ok: false, error: ADMIN_ONLY };
        const matches = (await listExceptions(ctx.workspaceId)).filter((e) => e.date === args.date);
        for (const e of matches) await deleteException(ctx.workspaceId, e.id, ctx.actorId);
        return { ok: true, data: `Pengecualian kalender ${args.date} dihapus.` };
      }

      default:
        return { ok: false, error: `Unknown tool: ${name}` };
    }
  } catch (error) {
    if (error instanceof HttpError) return { ok: false, error: error.message };
    return {
      ok: false,
      error: `Tool failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
