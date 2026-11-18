import { createTeamSchema } from "@repo/shared";
import { listExceptions } from "../../holidays/service.js";
import { listSchedules } from "../../schedules/service.js";
import { findOneEmployee, findTeam } from "./lookup.js";
import { parseDate, text, type PrepareHandler } from "./shared.js";

export const PREPARE_WORKSPACE_TOOLS: Record<string, PrepareHandler> = {
  async create_team(args) {
    const parsed = createTeamSchema.safeParse({ name: text(args?.name), description: text(args?.description) || null });
    if (!parsed.success) return { ok: false, error: "Nama tim belum disebutkan." };
    return { ok: true, args: parsed.data, summary: `Buat tim "${parsed.data.name}"?` };
  },

  async update_team(args, ctx) {
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
  },

  async delete_team(args, ctx) {
    const team = await findTeam(ctx, text(args?.team));
    if (!team.ok) return team;
    if (team.team.memberCount > 0) {
      return { ok: false, error: `Tim ${team.team.name} masih punya ${team.team.memberCount} anggota; pindahkan dulu.` };
    }
    return { ok: true, args: { teamId: team.team.id }, summary: `Hapus tim ${team.team.name}?` };
  },

  async delete_schedule(args, ctx) {
    const scheduleName = text(args?.name);
    const target = (await listSchedules(ctx.workspaceId)).find((r) => r.name.toLowerCase() === scheduleName.toLowerCase());
    if (!target) return { ok: false, error: `Jadwal "${scheduleName}" tidak ditemukan.` };
    return { ok: true, args: { scheduleId: target.id }, summary: `Hapus jadwal "${target.name}"?` };
  },

  async start_standup(args, ctx) {
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
  },

  async send_standup_reminder() {
    return { ok: true, args: {}, summary: "Kirim pengingat ke semua yang belum menyelesaikan standup hari ini?" };
  },

  async add_calendar_exception(args) {
    const date = parseDate(args?.date);
    if (!date) return { ok: false, error: "Tanggal harus berformat YYYY-MM-DD." };
    const skip = args?.skip !== false;
    const reason = text(args?.reason);
    return {
      ok: true,
      args: { date, skip, reason: reason || undefined },
      summary: `${skip ? "Liburkan standup" : "Tetap jalankan standup"} pada ${date}${reason ? ` (${reason})` : ""}?`,
    };
  },

  async delete_calendar_exception(args, ctx) {
    const date = parseDate(args?.date);
    if (!date) return { ok: false, error: "Tanggal harus berformat YYYY-MM-DD." };
    const existing = (await listExceptions(ctx.workspaceId)).filter((e) => e.date === date);
    if (existing.length === 0) return { ok: false, error: `Tidak ada pengecualian kalender pada ${date}.` };
    return { ok: true, args: { date }, summary: `Hapus pengecualian kalender pada ${date}?` };
  },
};
