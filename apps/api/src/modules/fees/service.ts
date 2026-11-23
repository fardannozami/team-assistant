import { createDbClient, employees, feePayoutItems, feePayouts, feeSettings, projects } from "@repo/database";
import { feeStatement, type FeeGroup, type FeeStatementInput } from "@repo/shared";
import { and, desc, eq } from "drizzle-orm";
import { isUniqueViolation } from "../../lib/db.js";
import { HttpError } from "../../lib/http-error.js";
import { getEmployee, listEmployees } from "../employees/service.js";
import { listProjects } from "../projects/service.js";

const db = createDbClient(
  process.env.DATABASE_URL ??
    "postgres://teamassistant:teamassistant@localhost:5432/teamassistant",
);

const dec = (n: number) => n.toFixed(2);

export async function getFeeSettings(workspaceId: string) {
  const [row] = await db.select().from(feeSettings).where(eq(feeSettings.workspaceId, workspaceId)).limit(1);
  return { startDate: row?.startDate ?? null };
}

export async function saveFeeSettings(workspaceId: string, startDate: string | null) {
  await db
    .insert(feeSettings)
    .values({ workspaceId, startDate })
    .onConflictDoUpdate({ target: feeSettings.workspaceId, set: { startDate, updatedAt: new Date() } });
  return { startDate };
}

/** "<group>:<projectId>" already paid out, per employee. */
async function paidKeys(workspaceId: string) {
  const rows = await db
    .select({ employeeId: feePayoutItems.employeeId, group: feePayoutItems.group, projectId: feePayoutItems.projectId })
    .from(feePayoutItems)
    .innerJoin(feePayouts, eq(feePayoutItems.payoutId, feePayouts.id))
    .where(eq(feePayouts.workspaceId, workspaceId));
  const byEmployee = new Map<string, Set<string>>();
  for (const r of rows) {
    const keys = byEmployee.get(r.employeeId) ?? new Set<string>();
    keys.add(`${r.group}:${r.projectId}`);
    byEmployee.set(r.employeeId, keys);
  }
  return byEmployee;
}

type Range = { from: string; to: string };

const isLead = (lead: string | null) => lead === "design" || lead === "development";

/**
 * Everyone's statement for the period: who has unpaid contributions (this
 * period or carried over) or leads a project type.
 */
export async function feeOverview(workspaceId: string, range: Range) {
  const [allProjects, people, paid, settings] = await Promise.all([
    listProjects(workspaceId),
    listEmployees(workspaceId),
    paidKeys(workspaceId),
    getFeeSettings(workspaceId),
  ]);
  const statements = people
    .map((employee) => ({
      employee: { id: employee.id, name: employee.name, phone: employee.phone, lead: employee.lead, isActive: employee.isActive },
      statement: feeStatement({
        projects: allProjects,
        employee,
        ...range,
        startDate: settings.startDate,
        paid: paid.get(employee.id),
      }),
    }))
    .filter((s) => s.statement.rows.length || (isLead(s.employee.lead) && s.employee.isActive));
  return { ...range, startDate: settings.startDate, people: statements };
}

/** One person's statement, with the percents the owner set. */
export async function statementFor(workspaceId: string, input: FeeStatementInput) {
  const employee = await getEmployee(workspaceId, input.employeeId);
  if (!employee) throw new HttpError(404, "Anggota tidak ditemukan");
  const [allProjects, paid, settings] = await Promise.all([
    listProjects(workspaceId),
    paidKeys(workspaceId),
    getFeeSettings(workspaceId),
  ]);
  const statement = feeStatement({
    projects: allProjects,
    employee,
    from: input.from,
    to: input.to,
    startDate: settings.startDate,
    paid: paid.get(employee.id),
    overrides: input.percents,
  });
  return { employee, statement };
}

/**
 * Records the eligible groups of a statement as paid: their projects leave
 * the carry-over. Groups below $500 are left alone and carry on.
 */
export async function finalizeStatement(workspaceId: string, input: FeeStatementInput, actorId: string | null) {
  const { employee, statement } = await statementFor(workspaceId, input);
  const eligible = statement.groups.filter((g) => g.eligible);
  if (!eligible.length) throw new HttpError(400, "Belum ada fee yang eligible (minimal $500) untuk difinalisasi.");

  try {
    const payouts = await db.transaction(async (tx) => {
      const created = [];
      for (const g of eligible) {
        const [payout] = await tx
          .insert(feePayouts)
          .values({
            workspaceId,
            employeeId: employee.id,
            group: g.group,
            periodFrom: input.from,
            periodTo: input.to,
            base: dec(g.base),
            percent: dec(g.percent),
            bonus: dec(g.bonus),
            createdBy: actorId,
          })
          .returning({ id: feePayouts.id });
        const items = statement.rows
          .filter((r) => r.amounts[g.group] !== undefined)
          .map((r) => ({
            payoutId: payout!.id,
            employeeId: employee.id,
            group: g.group,
            projectId: r.projectId,
            amount: dec(r.amounts[g.group]!),
          }));
        if (items.length) await tx.insert(feePayoutItems).values(items);
        created.push({ id: payout!.id, group: g.group, bonus: g.bonus });
      }
      return created;
    });
    return { employee: { id: employee.id, name: employee.name }, payouts, total: statement.total };
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new HttpError(409, "Sebagian project sudah difinalisasi sebelumnya. Muat ulang halaman Fee.");
    }
    throw error;
  }
}

/** Finalized payouts, newest first, each with the projects it covered. */
export async function listPayouts(workspaceId: string, employeeId?: string) {
  const conditions = [eq(feePayouts.workspaceId, workspaceId)];
  if (employeeId) conditions.push(eq(feePayouts.employeeId, employeeId));
  const rows = await db
    .select({ payout: feePayouts, employeeName: employees.name })
    .from(feePayouts)
    .innerJoin(employees, eq(feePayouts.employeeId, employees.id))
    .where(and(...conditions))
    .orderBy(desc(feePayouts.createdAt));
  const items = rows.length
    ? await db
        .select({ payoutId: feePayoutItems.payoutId, projectName: projects.name, amount: feePayoutItems.amount })
        .from(feePayoutItems)
        .innerJoin(projects, eq(feePayoutItems.projectId, projects.id))
        .innerJoin(feePayouts, eq(feePayoutItems.payoutId, feePayouts.id))
        .where(and(...conditions))
    : [];
  return rows.map(({ payout, employeeName }) => ({
    id: payout.id,
    employeeId: payout.employeeId,
    employeeName,
    group: payout.group as FeeGroup,
    periodFrom: payout.periodFrom,
    periodTo: payout.periodTo,
    base: Number(payout.base),
    percent: Number(payout.percent),
    bonus: Number(payout.bonus),
    createdAt: payout.createdAt,
    projects: items
      .filter((i) => i.payoutId === payout.id)
      .map((i) => ({ name: i.projectName, amount: Number(i.amount) })),
  }));
}

/** Takes a finalized payout back: its projects carry over again. */
export async function undoPayout(workspaceId: string, id: string) {
  const [row] = await db
    .delete(feePayouts)
    .where(and(eq(feePayouts.id, id), eq(feePayouts.workspaceId, workspaceId)))
    .returning({ id: feePayouts.id, employeeId: feePayouts.employeeId, group: feePayouts.group });
  if (!row) throw new HttpError(404, "Pembayaran tidak ditemukan");
  return row;
}
