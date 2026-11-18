import { and, eq } from "drizzle-orm";
import { schedules } from "@repo/database";
import { createScheduleSchema, updateScheduleSchema } from "@repo/shared";
import { createSchedule, listSchedules, updateSchedule } from "../../schedules/service.js";
import { DAY_NAMES, db, describeSchedule, ownerOrAdmin, type ToolHandler } from "./shared.js";

type Issue = { path: PropertyKey[]; message: string };

function formatIssues(issues: Issue[]): string {
  return issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ");
}

export const SCHEDULE_TOOLS: Record<string, ToolHandler> = {
  async get_schedule(_args, ctx) {
    const rows = await listSchedules(ctx.workspaceId);
    if (rows.length === 0) {
      return { ok: true, data: "No schedules configured yet." };
    }
    return { ok: true, data: rows.map(describeSchedule).join("\n") };
  },

  async create_schedule(args, ctx) {
    if (!ownerOrAdmin(ctx.roleName)) {
      return {
        ok: false,
        error: "Only Owner or Admin can create schedules.",
      };
    }
    const parsed = createScheduleSchema.safeParse(args);
    if (!parsed.success) {
      return { ok: false, error: formatIssues(parsed.error.issues) };
    }
    const created = await createSchedule(ctx.workspaceId, parsed.data, ctx.actorId);
    return {
      ok: true,
      data: `Schedule "${created!.name}" created: ${created!.timeOfDay} ${Array.isArray(created!.weekdays) ? (created!.weekdays as number[]).map((d) => DAY_NAMES[d]).join(", ") : ""} ${created!.timezone}`,
    };
  },

  async update_schedule(args, ctx) {
    if (!ownerOrAdmin(ctx.roleName)) {
      return {
        ok: false,
        error: "Only Owner or Admin can update schedules.",
      };
    }

    // `name` finds the schedule and `newName` renames it; the model never
    // sees ids, so a non-UUID "id" is treated as a name.
    const rawId = typeof args?.id === "string" ? args.id.trim() : "";
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rawId);
    const name = (typeof args?.name === "string" ? args.name.trim() : "") || (isUuid ? "" : rawId);
    let target = null;
    if (isUuid) {
      const [row] = await db
        .select()
        .from(schedules)
        .where(and(eq(schedules.id, rawId), eq(schedules.workspaceId, ctx.workspaceId)))
        .limit(1);
      target = row ?? null;
    } else if (name) {
      // Same case-insensitive match as delete_schedule.
      target = (await listSchedules(ctx.workspaceId)).find((r) => r.name.toLowerCase() === name.toLowerCase()) ?? null;
    } else {
      return {
        ok: false,
        error: "Provide the schedule id or name to update.",
      };
    }
    if (!target) {
      return { ok: false, error: "Schedule not found." };
    }

    const { id: _id, name: _name, newName, ...changes } = args ?? {};
    const parsed = updateScheduleSchema.safeParse({ ...changes, ...(newName ? { name: newName } : {}) });
    if (!parsed.success) {
      return { ok: false, error: formatIssues(parsed.error.issues) };
    }

    const updated = await updateSchedule(
      ctx.workspaceId,
      target.id,
      parsed.data,
      ctx.actorId,
    );
    return { ok: true, data: `Schedule updated.\n${describeSchedule(updated)}` };
  },
};
