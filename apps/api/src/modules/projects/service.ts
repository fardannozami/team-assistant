import { createDbClient, employees, projectMembers, projects } from "@repo/database";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
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
 * The fee figures of the project sheet: the client-side price is what arrived
 * grossed up by the platform's cut, and each member gets their share of
 * totalFee (all of feeReceived unless set).
 */
export function projectFees(p: { feeReceived: number; platformFeePercent: number; totalFee: number | null }) {
  const base = p.totalFee ?? p.feeReceived;
  return {
    feeGross: round2(p.feeReceived / (1 - p.platformFeePercent / 100)),
    splitBase: base,
    memberFee: (sharePercent: number) => round2((base * sharePercent) / 100),
  };
}

/** Employees a project can list, inactive ones marked so old projects still show them. */
export async function listProjectPeople(workspaceId: string) {
  return db
    .select({ id: employees.id, name: employees.name, isActive: employees.isActive })
    .from(employees)
    .where(eq(employees.workspaceId, workspaceId))
    .orderBy(asc(employees.name));
}

export async function listProjects(workspaceId: string) {
  const rows = await db
    .select()
    .from(projects)
    .where(eq(projects.workspaceId, workspaceId))
    .orderBy(desc(projects.startDate), desc(projects.createdAt));
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

  return rows.map((p) => {
    const figures = {
      feeReceived: Number(p.feeReceived),
      platformFeePercent: Number(p.platformFeePercent),
      totalFee: num(p.totalFee),
    };
    const fees = projectFees(figures);
    return {
      id: p.id,
      platform: p.platform,
      name: p.name,
      startDate: p.startDate,
      endDate: p.endDate,
      status: p.status,
      paymentType: p.paymentType,
      currency: p.currency,
      ...figures,
      feeGross: fees.feeGross,
      splitBase: fees.splitBase,
      paymentStatus: p.paymentStatus,
      notes: p.notes,
      updatedAt: p.updatedAt,
      members: members
        .filter((m) => m.projectId === p.id)
        .map(({ projectId: _, ...m }) => {
          const share = Number(m.sharePercent);
          return { ...m, sharePercent: share, fee: fees.memberFee(share) };
        }),
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
