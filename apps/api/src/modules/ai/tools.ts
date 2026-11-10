import { and, eq, gte } from "drizzle-orm";
import {
  createDbClient,
  employees,
  schedules,
  standupAnswers,
  standupSessions,
  standups,
} from "@repo/database";
import {
  createScheduleSchema,
  dateInTimezone,
  DEFAULT_TIMEZONE,
  updateScheduleSchema,
} from "@repo/shared";
import { HttpError } from "../../lib/http-error.js";
import {
  findEmployeesByIdentifier,
  getEmployee,
  getEmployeeStandupHistory,
  listEmployees,
} from "../employees/service.js";
import { createSchedule, listSchedules, updateSchedule } from "../schedules/service.js";
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
];

export type EmployeeLookup =
  | { ok: true; employee: Awaited<ReturnType<typeof getEmployee>> }
  | { ok: false; error: string };

async function resolveTargetEmployee(
  args: any,
  ctx: ToolContext,
): Promise<EmployeeLookup> {
  const identifier = typeof args?.identifier === "string" ? args.identifier.trim() : "";
  if (!identifier) {
    return { ok: true, employee: await getEmployee(ctx.employee.id) };
  }

  const self = ctx.employee;
  if (identifier === self.name || identifier === self.phone) {
    return { ok: true, employee: await getEmployee(self.id) };
  }

  if (!canViewOthers(ctx.roleName)) {
    return {
      ok: false,
      error: "Your role is not allowed to view other employees.",
    };
  }

  const matches = await findEmployeesByIdentifier(identifier);
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

  return { ok: true, employee: await getEmployee(matches[0]!.id) };
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

export type StandupCollector = {
  id: string;
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

        const composed = `Yesterday: ${yesterday}. Today: ${today}. Blockers: ${blockers}`;
        const collector: StandupCollector = {
          id: ctx.employee.id,
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
        const rows = await listSchedules();
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
        const created = await createSchedule(parsed.data, ctx.actorId);
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
            .where(eq(schedules.id, id))
            .limit(1);
          target = row ?? null;
        } else if (name) {
          const [row] = await db
            .select()
            .from(schedules)
            .where(eq(schedules.name, name))
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

        const updated = await updateSchedule(target.id, parsed.data, ctx.actorId);
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

        const rosters = await listEmployees({ active: true });
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
          .where(and(gte(standups.date, startStr), eq(standupAnswers.questionKey, "blockers")))
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
        const report = await generateDailyReport(date);
        return { ok: true, data: report.text };
      }

      case "generate_weekly_report": {
        if (!canViewOthers(ctx.roleName)) {
          return {
            ok: false,
            error: "Only Manager, Admin or Owner can generate reports.",
          };
        }
        const report = await generateWeeklyReport();
        return { ok: true, data: report.text };
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
