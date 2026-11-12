import { createDbClient, employees, teams } from "@repo/database";
import { and, eq, sql } from "drizzle-orm";
import type { CreateTeamInput, UpdateTeamInput } from "@repo/shared";
import { audit } from "../auth/index.js";
import { HttpError } from "../../lib/http-error.js";
import {
  getEmployee,
  listEmployees,
} from "../employees/service.js";

const db = createDbClient(
  process.env.DATABASE_URL ??
    "postgres://teamassistant:teamassistant@localhost:5432/teamassistant",
);

function teamWhere(workspaceId: string, id: string) {
  return and(eq(teams.id, id), eq(teams.workspaceId, workspaceId));
}

function employeeWhere(workspaceId: string, id: string) {
  return and(eq(employees.id, id), eq(employees.workspaceId, workspaceId));
}

export async function listTeams(workspaceId: string) {
  return db
    .select({
      id: teams.id,
      name: teams.name,
      description: teams.description,
      createdAt: teams.createdAt,
      memberCount: sql<number>`count(${employees.id})`.mapWith(Number),
    })
    .from(teams)
    .leftJoin(
      employees,
      and(
        eq(employees.teamId, teams.id),
        eq(employees.workspaceId, workspaceId),
      ),
    )
    .where(eq(teams.workspaceId, workspaceId))
    .groupBy(teams.id)
    .orderBy(teams.name);
}

export async function getTeam(workspaceId: string, id: string) {
  const [team] = await db
    .select()
    .from(teams)
    .where(teamWhere(workspaceId, id))
    .limit(1);
  if (!team) throw new HttpError(404, "Team not found");

  const members = await listEmployees(workspaceId, { teamId: id });
  return { ...team, members };
}

export async function createTeam(
  workspaceId: string,
  input: CreateTeamInput,
  actorId?: string | null,
) {
  const [created] = await db
    .insert(teams)
    .values({
      workspaceId,
      name: input.name,
      description: input.description ?? null,
    })
    .returning();
  if (!created) throw new Error("Failed to create team");

  await audit(workspaceId, actorId ?? null, "team.create", "team", created.id, {
    name: input.name,
  });

  return created;
}

export async function updateTeam(
  workspaceId: string,
  id: string,
  input: UpdateTeamInput,
  actorId?: string | null,
) {
  const team = await getTeam(workspaceId, id);

  const changes: Partial<typeof teams.$inferInsert> = {};
  if (input.name !== undefined) changes.name = input.name;
  if (input.description !== undefined) {
    changes.description = input.description;
  }

  if (Object.keys(changes).length === 0) {
    return { ...team };
  }

  const [updated] = await db
    .update(teams)
    .set(changes)
    .where(teamWhere(workspaceId, id))
    .returning();

  await audit(workspaceId, actorId ?? null, "team.update", "team", id, input);
  return { ...updated, members: team.members };
}

export async function deleteTeam(
  workspaceId: string,
  id: string,
  actorId?: string | null,
) {
  const team = await getTeam(workspaceId, id);

  if (team.members.length > 0) {
    throw new HttpError(409, "Team still has members");
  }

  await db.delete(teams).where(teamWhere(workspaceId, id));
  await audit(workspaceId, actorId ?? null, "team.delete", "team", id, {
    name: team.name,
  });
}

export async function addTeamMember(
  workspaceId: string,
  teamId: string,
  employeeId: string,
  actorId?: string | null,
) {
  const team = await getTeam(workspaceId, teamId);
  const employee = await getEmployee(workspaceId, employeeId);
  if (!employee) throw new HttpError(404, "Employee not found");

  await db
    .update(employees)
    .set({ teamId, updatedAt: new Date() })
    .where(employeeWhere(workspaceId, employeeId));

  await audit(workspaceId, actorId ?? null, "team.member.add", "team", teamId, {
    employeeId,
  });

  return { ...team, members: await listEmployees(workspaceId, { teamId }) };
}

export async function removeTeamMember(
  workspaceId: string,
  teamId: string,
  employeeId: string,
  actorId?: string | null,
) {
  const team = await getTeam(workspaceId, teamId);
  const employee = await getEmployee(workspaceId, employeeId);
  if (!employee) throw new HttpError(404, "Employee not found");
  if (employee.teamId !== teamId) {
    throw new HttpError(404, "Employee is not in this team");
  }

  await db
    .update(employees)
    .set({ teamId: null, updatedAt: new Date() })
    .where(employeeWhere(workspaceId, employeeId));

  await audit(
    workspaceId,
    actorId ?? null,
    "team.member.remove",
    "team",
    teamId,
    { employeeId },
  );

  return { ...team, members: await listEmployees(workspaceId, { teamId }) };
}
