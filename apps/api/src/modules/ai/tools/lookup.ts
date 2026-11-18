import { findEmployeesByIdentifier, getEmployee } from "../../employees/service.js";
import { listTeams } from "../../teams/service.js";
import { canViewOthers } from "../context.js";
import type { ToolContext } from "./shared.js";

export type EmployeeLookup =
  | { ok: true; employee: Awaited<ReturnType<typeof getEmployee>> }
  | { ok: false; error: string };

export async function resolveTargetEmployee(
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

export async function findOneEmployee(ctx: ToolContext, identifier: string) {
  if (!identifier) return { ok: false as const, error: "Sebutkan nama atau nomor karyawan." };
  const matches = await findEmployeesByIdentifier(ctx.workspaceId, identifier);
  if (matches.length === 0) return { ok: false as const, error: `Tidak ada karyawan "${identifier}".` };
  if (matches.length > 1) {
    const list = matches.slice(0, 5).map((m) => `${m.name} (${m.phone})`).join(", ");
    return { ok: false as const, error: `Ada beberapa yang cocok dengan "${identifier}": ${list}. Tanyakan yang mana.` };
  }
  return { ok: true as const, employee: matches[0]! };
}

export async function findTeam(ctx: ToolContext, name: string) {
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
