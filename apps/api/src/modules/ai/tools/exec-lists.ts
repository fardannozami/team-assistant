import { dateInTimezone } from "@repo/shared";
import { listEmployees } from "../../employees/service.js";
import { listTeams } from "../../teams/service.js";
import { listExceptions, listUpcomingHolidays } from "../../holidays/service.js";
import { generateDailyReport, generateWeeklyReport } from "../../reports/service.js";
import { canViewOthers } from "../context.js";
import { getTeamActivity } from "./exec-activity.js";
import { findTeam } from "./lookup.js";
import { text, type ToolHandler } from "./shared.js";

export const LIST_TOOLS: Record<string, ToolHandler> = {
  get_team_activity: getTeamActivity,

  async generate_daily_report(args, ctx) {
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
  },

  async generate_weekly_report(_args, ctx) {
    if (!canViewOthers(ctx.roleName)) {
      return {
        ok: false,
        error: "Only Manager, Admin or Owner can generate reports.",
      };
    }
    const report = await generateWeeklyReport(ctx.workspaceId);
    return { ok: true, data: report.text };
  },

  async list_employees(args, ctx) {
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
  },

  async list_teams(_args, ctx) {
    if (!canViewOthers(ctx.roleName)) {
      return { ok: false, error: "Only Manager, Admin or Owner can list teams." };
    }
    const rows = await listTeams(ctx.workspaceId);
    if (rows.length === 0) return { ok: true, data: "Belum ada tim." };
    return { ok: true, data: rows.map((t) => `- ${t.name}: ${t.memberCount} anggota`).join("\n") };
  },

  async list_holidays(_args, ctx) {
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
  },
};
