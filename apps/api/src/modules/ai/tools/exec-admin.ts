import { createEmployee, updateEmployee, updateEmployeePhone } from "../../employees/service.js";
import { deleteSchedule } from "../../schedules/service.js";
import { createTeam, deleteTeam, updateTeam } from "../../teams/service.js";
import { createException, deleteException, listExceptions } from "../../holidays/service.js";
import { sendStandupPrompts, sendStandupReminders } from "../../standups/service.js";
import { standupTriggerReply } from "../../whatsapp/admin.js";
import { ADMIN_ONLY, ownerOrAdmin, type ToolHandler } from "./shared.js";

// These run only after prepareTool and a YES; their args carry resolved ids,
// and every service call is workspace-scoped.
const HANDLERS: Record<string, ToolHandler> = {
  async add_employee(args, ctx) {
    const created = await createEmployee(
      ctx.workspaceId,
      { name: args.name, phone: args.phone, roleId: args.roleId, teamId: args.teamId },
      ctx.actorId,
    );
    return { ok: true, data: `${created!.name} (${created!.phone}) ditambahkan sebagai ${created!.roleName ?? "karyawan"}.` };
  },

  async update_employee(args, ctx) {
    const updated = await updateEmployee(ctx.workspaceId, args.employeeId, args.changes, ctx.actorId);
    return { ok: true, data: `Data ${updated!.name} diperbarui: tim ${updated!.teamName ?? "-"}, role ${updated!.roleName ?? "-"}.` };
  },

  async update_employee_phone(args, ctx) {
    const updated = await updateEmployeePhone(ctx.workspaceId, args.employeeId, args.phone, ctx.actorId);
    return { ok: true, data: `Nomor ${updated!.name} sekarang ${updated!.phone}.` };
  },

  async set_employee_active(args, ctx) {
    const updated = await updateEmployee(ctx.workspaceId, args.employeeId, { isActive: args.active }, ctx.actorId);
    return { ok: true, data: `${updated!.name} sekarang ${updated!.isActive ? "aktif" : "nonaktif"}.` };
  },

  async create_team(args, ctx) {
    const created = await createTeam(ctx.workspaceId, args, ctx.actorId);
    return { ok: true, data: `Tim "${created.name}" dibuat.` };
  },

  async update_team(args, ctx) {
    const updated = await updateTeam(ctx.workspaceId, args.teamId, args.changes, ctx.actorId);
    return { ok: true, data: `Tim "${updated.name}" diperbarui.` };
  },

  async delete_team(args, ctx) {
    await deleteTeam(ctx.workspaceId, args.teamId, ctx.actorId);
    return { ok: true, data: "Tim dihapus." };
  },

  async delete_schedule(args, ctx) {
    await deleteSchedule(ctx.workspaceId, args.scheduleId, ctx.actorId);
    return { ok: true, data: "Jadwal dihapus." };
  },

  async start_standup(args, ctx) {
    const result = await sendStandupPrompts(ctx.workspaceId, {
      employeeId: args.employeeId,
      resend: true,
    });
    return { ok: true, data: standupTriggerReply(result) };
  },

  async send_standup_reminder(_args, ctx) {
    const result = await sendStandupReminders(ctx.workspaceId);
    if ("whatsappConnected" in result && result.whatsappConnected === false) {
      return { ok: false, error: "WhatsApp workspace ini belum terhubung." };
    }
    return {
      ok: true,
      data: result.sent > 0 ? `Pengingat terkirim ke ${result.sent} karyawan.` : "Semua sudah menyelesaikan standup, tidak ada pengingat dikirim.",
    };
  },

  async add_calendar_exception(args, ctx) {
    const created = await createException(
      ctx.workspaceId,
      { date: args.date, skip: args.skip, reason: args.reason },
      ctx.actorId,
    );
    return { ok: true, data: `${created.date} dicatat sebagai ${created.skip ? "hari libur standup" : "hari kerja"}.` };
  },

  async delete_calendar_exception(args, ctx) {
    const matches = (await listExceptions(ctx.workspaceId)).filter((e) => e.date === args.date);
    for (const e of matches) await deleteException(ctx.workspaceId, e.id, ctx.actorId);
    return { ok: true, data: `Pengecualian kalender ${args.date} dihapus.` };
  },
};

/** Every admin handler re-checks the role, since args arrive from a pending action. */
export const ADMIN_TOOLS: Record<string, ToolHandler> = Object.fromEntries(
  Object.entries(HANDLERS).map(([name, run]) => [
    name,
    (args, ctx) => (ownerOrAdmin(ctx.roleName) ? run(args, ctx) : Promise.resolve({ ok: false, error: ADMIN_ONLY })),
  ]),
);
