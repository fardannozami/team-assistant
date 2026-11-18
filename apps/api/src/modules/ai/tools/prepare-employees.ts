import { findOneEmployee, findTeam } from "./lookup.js";
import { ASSIGNABLE_ROLES, roleIdByName, text, toWhatsAppPhone, type PrepareHandler } from "./shared.js";

export const PREPARE_EMPLOYEE_TOOLS: Record<string, PrepareHandler> = {
  async add_employee(args, ctx) {
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
  },

  async update_employee(args, ctx) {
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
  },

  async update_employee_phone(args, ctx) {
    const found = await findOneEmployee(ctx, text(args?.identifier));
    if (!found.ok) return found;
    const phone = toWhatsAppPhone(text(args?.phone));
    if (!phone) return { ok: false, error: "Nomor WhatsApp baru belum ada atau tidak valid." };
    return {
      ok: true,
      args: { employeeId: found.employee.id, phone },
      summary: `Ganti nomor WhatsApp ${found.employee.name} dari ${found.employee.phone} ke ${phone}?`,
    };
  },

  async set_employee_active(args, ctx) {
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
  },
};
