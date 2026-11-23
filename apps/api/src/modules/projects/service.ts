import { createDbClient, employees, feePayoutItems, feePayouts, projectMembers, projects } from "@repo/database";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { ProjectInput } from "@repo/shared";
import { HttpError } from "../../lib/http-error.js";

const db = createDbClient(
  process.env.DATABASE_URL ??
    "postgres://teamassistant:teamassistant@localhost:5432/teamassistant",
);

const round2 = (n: number) => Math.round(n * 100) / 100;
const num = (v: string | null) => (v === null ? null : Number(v));
const dec = (n: number) => n.toFixed(2);

/**
 * The platform takes its cut from the fee received; what is left is split
 * between members (unless totalFee overrides it).
 */
export function projectFees(p: { feeReceived: number; platformFeePercent: number; totalFee: number | null }) {
  const platformFee = round2((p.feeReceived * p.platformFeePercent) / 100);
  const base = p.totalFee ?? round2(p.feeReceived - platformFee);
  return {
    platformFee,
    splitBase: base,
    memberFee: (sharePercent: number) => round2((base * sharePercent) / 100),
  };
}

/**
 * Each member's fee in cents, the leftover cents going to the largest
 * remainders, so shares adding up to 100% pay out exactly the split base
 * (3 x 33.33% of 100 = 100.00).
 */
export function splitFees(base: number, members: { sharePercent: number }[]) {
  const exact = members.map((m) => Math.round(base * m.sharePercent * 1e6) / 1e6); // cents
  const cents = exact.map(Math.floor);
  let left = Math.round(exact.reduce((s, c) => s + c, 0)) - cents.reduce((s, c) => s + c, 0);
  const order = exact.map((_, k) => k).sort((a, b) => exact[b]! - cents[b]! - (exact[a]! - cents[a]!));
  for (const k of order) {
    if (left <= 0) break;
    cents[k]! += 1;
    left -= 1;
  }
  return cents.map((c) => c / 100);
}

/** Employees a project can list, inactive ones marked so old projects still show them. */
export async function listProjectPeople(workspaceId: string) {
  return db
    .select({ id: employees.id, name: employees.name, isActive: employees.isActive, lead: employees.lead })
    .from(employees)
    .where(eq(employees.workspaceId, workspaceId))
    .orderBy(asc(employees.name));
}

export async function listProjects(workspaceId: string) {
  const rows = await db
    .select()
    .from(projects)
    .where(eq(projects.workspaceId, workspaceId))
    .orderBy(sql`${projects.startDate} desc nulls last`, desc(projects.createdAt));
  if (!rows.length) return [];

  const members = await db
    .select({
      projectId: projectMembers.projectId,
      employeeId: projectMembers.employeeId,
      employeeName: employees.name,
      role: projectMembers.role,
      sharePercent: projectMembers.sharePercent,
    })
    .from(projectMembers)
    .innerJoin(employees, eq(projectMembers.employeeId, employees.id))
    .where(inArray(projectMembers.projectId, rows.map((r) => r.id)))
    .orderBy(asc(employees.name));

  // Bonus payouts covering these projects, to show what is paid already.
  const paidItems = await db
    .select({
      projectId: feePayoutItems.projectId,
      employeeId: feePayoutItems.employeeId,
      employeeName: employees.name,
      group: feePayoutItems.group,
      paidAt: feePayouts.createdAt,
    })
    .from(feePayoutItems)
    .innerJoin(feePayouts, eq(feePayoutItems.payoutId, feePayouts.id))
    .innerJoin(employees, eq(feePayoutItems.employeeId, employees.id))
    .where(inArray(feePayoutItems.projectId, rows.map((r) => r.id)));
  const roleGroup = (role: string) => (role === "pm_sales" ? "pm" : "maker");

  return rows.map((p) => {
    const figures = {
      feeReceived: Number(p.feeReceived),
      platformFeePercent: Number(p.platformFeePercent),
      totalFee: num(p.totalFee),
    };
    const fees = projectFees(figures);
    const own = members
      .filter((m) => m.projectId === p.id)
      .map(({ projectId: _, ...m }) => ({ ...m, sharePercent: Number(m.sharePercent) }));
    const memberFees = splitFees(fees.splitBase, own);
    const paid = paidItems.filter((i) => i.projectId === p.id);
    return {
      id: p.id,
      platform: p.platform,
      name: p.name,
      type: p.type,
      startDate: p.startDate,
      endDate: p.endDate,
      status: p.status,
      paymentType: p.paymentType,
      currency: p.currency,
      ...figures,
      platformFee: fees.platformFee,
      splitBase: fees.splitBase,
      paymentStatus: p.paymentStatus,
      notes: p.notes,
      updatedAt: p.updatedAt,
      members: own.map((m, i) => ({
        ...m,
        fee: memberFees[i]!,
        bonusPaidAt: paid.find((x) => x.employeeId === m.employeeId && x.group === roleGroup(m.role))?.paidAt ?? null,
      })),
      leadPaid: paid
        .filter((x) => x.group.startsWith("lead_"))
        .map((x) => ({ employeeName: x.employeeName, group: x.group, paidAt: x.paidAt })),
    };
  });
}

async function assertEmployees(workspaceId: string, ids: string[]) {
  const unique = [...new Set(ids)];
  if (!unique.length) return;
  const found = await db
    .select({ id: employees.id })
    .from(employees)
    .where(and(eq(employees.workspaceId, workspaceId), inArray(employees.id, unique)));
  if (found.length !== unique.length) throw new HttpError(400, "Anggota project tidak ditemukan di workspace ini");
}

function columns(input: ProjectInput) {
  return {
    platform: input.platform,
    name: input.name,
    type: input.type,
    startDate: input.startDate ?? null,
    endDate: input.endDate ?? null,
    status: input.status,
    paymentType: input.paymentType,
    currency: input.currency,
    feeReceived: dec(input.feeReceived),
    platformFeePercent: dec(input.platformFeePercent),
    totalFee: input.totalFee == null ? null : dec(input.totalFee),
    paymentStatus: input.paymentStatus,
    notes: input.notes || null,
  };
}

async function getProject(workspaceId: string, id: string) {
  const project = (await listProjects(workspaceId)).find((p) => p.id === id);
  if (!project) throw new HttpError(404, "Project tidak ditemukan");
  return project;
}

export async function createProject(workspaceId: string, input: ProjectInput, actorId: string | null) {
  await assertEmployees(workspaceId, input.members.map((m) => m.employeeId));
  const id = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(projects)
      .values({ workspaceId, createdBy: actorId, ...columns(input) })
      .returning({ id: projects.id });
    if (input.members.length) {
      await tx.insert(projectMembers).values(
        input.members.map((m) => ({ projectId: row!.id, employeeId: m.employeeId, role: m.role, sharePercent: dec(m.sharePercent) })),
      );
    }
    return row!.id;
  });
  return getProject(workspaceId, id);
}

/** Replaces the project's fields and its whole member list. */
export async function updateProject(workspaceId: string, id: string, input: ProjectInput) {
  await assertEmployees(workspaceId, input.members.map((m) => m.employeeId));
  await db.transaction(async (tx) => {
    const [row] = await tx
      .update(projects)
      .set({ ...columns(input), updatedAt: new Date() })
      .where(and(eq(projects.id, id), eq(projects.workspaceId, workspaceId)))
      .returning({ id: projects.id });
    if (!row) throw new HttpError(404, "Project tidak ditemukan");
    await tx.delete(projectMembers).where(eq(projectMembers.projectId, id));
    if (input.members.length) {
      await tx.insert(projectMembers).values(
        input.members.map((m) => ({ projectId: id, employeeId: m.employeeId, role: m.role, sharePercent: dec(m.sharePercent) })),
      );
    }
  });
  return getProject(workspaceId, id);
}

export async function deleteProject(workspaceId: string, id: string) {
  const [row] = await db
    .delete(projects)
    .where(and(eq(projects.id, id), eq(projects.workspaceId, workspaceId)))
    .returning({ id: projects.id, name: projects.name });
  if (!row) throw new HttpError(404, "Project tidak ditemukan");
  return row;
}
