import { createDbClient, employees, roles, users } from "@repo/database";
import { and, eq, isNull } from "drizzle-orm";
import { audit } from "../auth/index.js";
import { normalizePhoneNumber } from "../whatsapp/service.js";

// Team members sign in to Naya with their WhatsApp number: it is already who they are in daily
// (they send their standup from it). The first time one needs Naya, they get a daily account of
// their own with the Employee role, linked to their employee record; nobody has to invite them.
// An admin can still give them more (Settings › Users) or invite their Google email as before.

const db = createDbClient(
  process.env.DATABASE_URL ?? "postgres://teamassistant:teamassistant@localhost:5432/teamassistant",
);

/**
 * Accounts made from a WhatsApp number have no real email: a placeholder under a reserved domain.
 * Emails are unique across workspaces and a number may be on two, so it carries the workspace.
 */
export function whatsappEmail(phone: string, workspaceId: string): string {
  return `wa.${normalizePhoneNumber(phone)}.${workspaceId.replace(/-/g, "").slice(0, 12)}@naya.invalid`;
}

export interface EmployeeRef { id: string; workspaceId: string; name: string; phone: string; userId: string | null }

/**
 * The daily account of a team member, created (role Employee) and linked on first use. Null when
 * their linked account has been deactivated: an admin turned it off, so no link is made.
 */
export async function ensureEmployeeAccount(employee: EmployeeRef): Promise<string | null> {
  if (employee.userId) {
    const [user] = await db.select({ id: users.id }).from(users).where(and(eq(users.id, employee.userId), eq(users.isActive, true))).limit(1);
    return user?.id ?? null;
  }
  const [role] = await db.select({ id: roles.id }).from(roles).where(eq(roles.name, "Employee")).limit(1);
  const email = whatsappEmail(employee.phone, employee.workspaceId);
  const [created] = await db
    .insert(users)
    .values({ workspaceId: employee.workspaceId, email, name: employee.name, roleId: role?.id })
    .onConflictDoNothing()
    .returning({ id: users.id });
  // Two messages at once: the other one made the account.
  const userId = created?.id ?? (await db.select({ id: users.id }).from(users).where(and(eq(users.email, email), eq(users.workspaceId, employee.workspaceId), eq(users.isActive, true))).limit(1))[0]?.id;
  if (!userId) return null;
  const [linked] = await db
    .update(employees)
    .set({ userId, updatedAt: new Date() })
    .where(and(eq(employees.id, employee.id), isNull(employees.userId)))
    .returning({ userId: employees.userId });
  if (created) await audit(employee.workspaceId, null, "naya.account.create", "user", userId, { employeeId: employee.id, via: "whatsapp" });
  // Linked meanwhile to another account (e.g. by an admin): use that one.
  if (!linked) return (await db.select({ userId: employees.userId }).from(employees).where(eq(employees.id, employee.id)).limit(1))[0]?.userId ?? null;
  return userId;
}

/** An employee by id, for ensureEmployeeAccount. */
export async function employeeRef(workspaceId: string, id: string): Promise<EmployeeRef | null> {
  const [row] = await db
    .select({ id: employees.id, workspaceId: employees.workspaceId, name: employees.name, phone: employees.phone, userId: employees.userId })
    .from(employees)
    .where(and(eq(employees.id, id), eq(employees.workspaceId, workspaceId), eq(employees.isActive, true)))
    .limit(1);
  return row ?? null;
}
