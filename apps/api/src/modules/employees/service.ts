import {
  checkinSessions,
  createDbClient,
  employees,
  projectMembers,
  roles,
  standupAnswers,
  standupSessions,
  standups,
  teams,
} from "@repo/database";
import { and, desc, eq, ilike, inArray, or, type SQL } from "drizzle-orm";
import type {
  CreateEmployeeInput,
  UpdateEmployeeInput,
} from "@repo/shared";
import { normalizePhoneNumber } from "@repo/shared";
import { audit } from "../auth/index.js";
import { HttpError } from "../../lib/http-error.js";
import { isForeignKeyViolation, isUniqueViolation } from "../../lib/db.js";

const db = createDbClient(
  process.env.DATABASE_URL ??
    "postgres://teamassistant:teamassistant@localhost:5432/teamassistant",
);

const employeeColumns = {
  id: employees.id,
  name: employees.name,
  phone: employees.phone,
  teamId: employees.teamId,
  teamName: teams.name,
  roleId: employees.roleId,
  roleName: roles.name,
  shift: employees.shift,
  isActive: employees.isActive,
  userId: employees.userId,
  createdAt: employees.createdAt,
  updatedAt: employees.updatedAt,
};

export type EmployeeRecord = Awaited<
  ReturnType<typeof listEmployees>
>[number];

export type EmployeeFilters = {
  teamId?: string;
  roleId?: string;
  active?: boolean;
  search?: string;
};

function baseEmployeeQuery() {
  return db
    .select(employeeColumns)
    .from(employees)
    .leftJoin(teams, eq(employees.teamId, teams.id))
    .leftJoin(roles, eq(employees.roleId, roles.id));
}

async function assertTeamExists(
  workspaceId: string,
  teamId: string | null | undefined,
) {
  if (!teamId) return;
  const [team] = await db
    .select({ id: teams.id })
    .from(teams)
    .where(and(eq(teams.id, teamId), eq(teams.workspaceId, workspaceId)))
    .limit(1);
  if (!team) throw new HttpError(400, "Team not found");
}

async function assertRoleExists(roleId: string | null | undefined) {
  if (!roleId) return;
  const [role] = await db
    .select({ id: roles.id, name: roles.name })
    .from(roles)
    .where(eq(roles.id, roleId))
    .limit(1);
  if (!role) throw new HttpError(400, "Role not found");
  // PM is a web-only login role, never a WhatsApp member's role.
  if (role.name === "PM") throw new HttpError(400, "Role PM hanya untuk pengguna web");
}

export async function listEmployees(
  workspaceId: string,
  filters: EmployeeFilters = {},
) {
  const conditions: SQL[] = [eq(employees.workspaceId, workspaceId)];

  if (filters.teamId) conditions.push(eq(employees.teamId, filters.teamId));
  if (filters.roleId) conditions.push(eq(employees.roleId, filters.roleId));
  if (filters.active !== undefined) {
    conditions.push(eq(employees.isActive, filters.active));
  }
  if (filters.search) {
    const term = `%${filters.search}%`;
    const search = or(
      ilike(employees.name, term),
      ilike(employees.phone, term),
    );
    if (search) conditions.push(search);
  }

  return baseEmployeeQuery()
    .where(and(...conditions))
    .orderBy(employees.name);
}

export async function getEmployee(workspaceId: string, id: string) {
  const [employee] = await baseEmployeeQuery()
    .where(and(eq(employees.id, id), eq(employees.workspaceId, workspaceId)))
    .limit(1);
  return employee ?? null;
}

export async function findEmployeeByPhone(
  workspaceId: string,
  phone: string,
) {
  const normalized = normalizePhoneNumber(phone);
  if (!normalized) return null;
  const variants = new Set<string>([normalized]);
  if (normalized.startsWith("0")) variants.add(`62${normalized.slice(1)}`);
  if (normalized.startsWith("62")) variants.add(`0${normalized.slice(2)}`);
  if (normalized.startsWith("8")) variants.add(`62${normalized}`);
  const [employee] = await baseEmployeeQuery()
    .where(
      and(
        eq(employees.workspaceId, workspaceId),
        inArray(employees.phone, [...variants]),
      ),
    )
    .limit(1);
  return employee ?? null;
}

export async function findEmployeesByIdentifier(
  workspaceId: string,
  identifier: string,
) {
  const byPhone = await findEmployeeByPhone(workspaceId, identifier);
  if (byPhone) return [byPhone];
  return listEmployees(workspaceId, { search: identifier.trim() });
}

export async function createEmployee(
  workspaceId: string,
  input: CreateEmployeeInput,
  actorId?: string | null,
) {
  await assertTeamExists(workspaceId, input.teamId);

  const [defaultRole] = input.roleId
    ? []
    : await db
        .select({ id: roles.id })
        .from(roles)
        .where(eq(roles.name, "Employee"))
        .limit(1);
  const roleId = input.roleId ?? defaultRole?.id ?? null;
  if (!roleId) throw new HttpError(400, "Default Employee role not found");
  await assertRoleExists(roleId);

  let createdId: string;
  try {
    const [created] = await db
      .insert(employees)
      .values({
        workspaceId,
        name: input.name,
        phone: input.phone,
        teamId: input.teamId ?? null,
        roleId,
        shift: input.shift ?? "day",
      })
      .returning({ id: employees.id });
    if (!created) throw new Error("Failed to create employee");
    createdId = created.id;
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new HttpError(
        409,
        "An employee with that phone number already exists in this workspace",
      );
    }
    throw error;
  }

  await audit(workspaceId, actorId ?? null, "employee.create", "employee", createdId, {
    name: input.name,
    phone: input.phone,
    teamId: input.teamId ?? null,
    roleId,
  });

  return getEmployee(workspaceId, createdId);
}

export async function updateEmployee(
  workspaceId: string,
  id: string,
  input: UpdateEmployeeInput,
  actorId?: string | null,
) {
  const existing = await getEmployee(workspaceId, id);
  if (!existing) throw new HttpError(404, "Employee not found");

  await assertTeamExists(workspaceId, input.teamId);
  await assertRoleExists(input.roleId);

  const changes: Partial<typeof employees.$inferInsert> = {
    updatedAt: new Date(),
  };
  if (input.name !== undefined) changes.name = input.name;
  if (input.teamId !== undefined) changes.teamId = input.teamId;
  if (input.roleId !== undefined) changes.roleId = input.roleId;
  if (input.isActive !== undefined) changes.isActive = input.isActive;
  if (input.shift !== undefined) changes.shift = input.shift;

  await db
    .update(employees)
    .set(changes)
    .where(and(eq(employees.id, id), eq(employees.workspaceId, workspaceId)));

  const action =
    input.isActive === undefined
      ? "employee.update"
      : input.isActive
        ? "employee.activate"
        : "employee.deactivate";
  await audit(workspaceId, actorId ?? null, action, "employee", id, input);

  return getEmployee(workspaceId, id);
}

export async function updateEmployeePhone(
  workspaceId: string,
  id: string,
  phone: string,
  actorId?: string | null,
) {
  const existing = await getEmployee(workspaceId, id);
  if (!existing) throw new HttpError(404, "Employee not found");

  try {
    await db
      .update(employees)
      .set({ phone, updatedAt: new Date() })
      .where(
        and(eq(employees.id, id), eq(employees.workspaceId, workspaceId)),
      );
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new HttpError(
        409,
        "An employee with that phone number already exists in this workspace",
      );
    }
    throw error;
  }

  await audit(
    workspaceId,
    actorId ?? null,
    "employee.update_phone",
    "employee",
    id,
    { from: existing.phone, to: phone },
  );

  return getEmployee(workspaceId, id);
}

const HAS_HISTORY_MESSAGE =
  "Anggota ini sudah punya riwayat (standup, check-in, proyek, atau percakapan). Nonaktifkan saja.";

// Hard delete is only for mistaken entries: anything with history must be
// deactivated instead, otherwise cascades would erase standups/check-ins.
export async function deleteEmployee(
  workspaceId: string,
  id: string,
  actorId?: string | null,
) {
  const existing = await getEmployee(workspaceId, id);
  if (!existing) throw new HttpError(404, "Employee not found");

  const [history] = await Promise.all([
    db.select({ id: standups.id }).from(standups).where(eq(standups.employeeId, id)).limit(1),
    db.select({ id: standupSessions.id }).from(standupSessions).where(eq(standupSessions.employeeId, id)).limit(1),
    db.select({ id: checkinSessions.id }).from(checkinSessions).where(eq(checkinSessions.employeeId, id)).limit(1),
    db.select({ id: projectMembers.id }).from(projectMembers).where(eq(projectMembers.employeeId, id)).limit(1),
  ]).then((results) => results.flat());
  if (history) throw new HttpError(409, HAS_HISTORY_MESSAGE);

  try {
    await db
      .delete(employees)
      .where(and(eq(employees.id, id), eq(employees.workspaceId, workspaceId)));
  } catch (error) {
    // Remaining non-cascading references (AI logs, conversations, reports…).
    if (isForeignKeyViolation(error)) throw new HttpError(409, HAS_HISTORY_MESSAGE);
    throw error;
  }

  await audit(workspaceId, actorId ?? null, "employee.delete", "employee", id, {
    name: existing.name,
    phone: existing.phone,
  });
}

export async function getEmployeeStandupHistory(
  workspaceId: string,
  id: string,
) {
  const employee = await getEmployee(workspaceId, id);
  if (!employee) throw new HttpError(404, "Employee not found");

  const rows = await db
    .select({
      standupId: standups.id,
      date: standups.date,
      questionKey: standupAnswers.questionKey,
      answer: standupAnswers.answer,
    })
    .from(standups)
    .leftJoin(standupAnswers, eq(standupAnswers.standupId, standups.id))
    .where(
      and(eq(standups.employeeId, id), eq(standups.workspaceId, workspaceId)),
    )
    .orderBy(desc(standups.date));

  const history = new Map<
    string,
    { id: string; date: string; answers: Record<string, string> }
  >();

  for (const row of rows) {
    const entry = history.get(row.standupId) ?? {
      id: row.standupId,
      date: row.date,
      answers: {},
    };
    if (row.questionKey && row.answer) {
      entry.answers[row.questionKey] = row.answer;
    }
    history.set(row.standupId, entry);
  }

  return { employee, standups: [...history.values()] };
}
