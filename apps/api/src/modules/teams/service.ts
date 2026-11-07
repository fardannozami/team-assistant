import { createDbClient, employees, teams } from "@repo/database";
import { eq, sql } from "drizzle-orm";
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

export async function listTeams() {
  return db
    .select({
      id: teams.id,
      name: teams.name,
      description: teams.description,
      createdAt: teams.createdAt,
      memberCount: sql<number>`count(${employees.id})`.mapWith(Number),
    })
    .from(teams)
    .leftJoin(employees, eq(employees.teamId, teams.id))
    .groupBy(teams.id)
    .orderBy(teams.name);
}

export async function getTeam(id: string) {
  const [team] = await db
    .select()
    .from(teams)
    .where(eq(teams.id, id))
    .limit(1);
  if (!team) throw new HttpError(404, "Team not found");

  const members = await listEmployees({ teamId: id });
  return { ...team, members };
}

export async function createTeam(
  input: CreateTeamInput,
  actorId?: string | null,
) {
  const [created] = await db
    .insert(teams)
    .values({ name: input.name, description: input.description ?? null })
    .returning();
  if (!created) throw new Error("Failed to create team");

  await audit(actorId ?? null, "team.create", "team", created.id, {
    name: input.name,
  });

  return created;
}

export async function updateTeam(
  id: string,
  input: UpdateTeamInput,
  actorId?: string | null,
) {
  const team = await getTeam(id);

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
    .where(eq(teams.id, id))
    .returning();

  await audit(actorId ?? null, "team.update", "team", id, input);
  return { ...updated, members: team.members };
}

export async function deleteTeam(id: string, actorId?: string | null) {
  const team = await getTeam(id);

  if (team.members.length > 0) {
    throw new HttpError(409, "Team still has members");
  }

  await db.delete(teams).where(eq(teams.id, id));
  await audit(actorId ?? null, "team.delete", "team", id, { name: team.name });
}

export async function addTeamMember(
  teamId: string,
  employeeId: string,
  actorId?: string | null,
) {
  const team = await getTeam(teamId);
  const employee = await getEmployee(employeeId);
  if (!employee) throw new HttpError(404, "Employee not found");

  await db
    .update(employees)
    .set({ teamId, updatedAt: new Date() })
    .where(eq(employees.id, employeeId));

  await audit(actorId ?? null, "team.member.add", "team", teamId, {
    employeeId,
  });

  return { ...team, members: await listEmployees({ teamId }) };
}

export async function removeTeamMember(
  teamId: string,
  employeeId: string,
  actorId?: string | null,
) {
  const team = await getTeam(teamId);
  const employee = await getEmployee(employeeId);
  if (!employee) throw new HttpError(404, "Employee not found");
  if (employee.teamId !== teamId) {
    throw new HttpError(404, "Employee is not in this team");
  }

  await db
    .update(employees)
    .set({ teamId: null, updatedAt: new Date() })
    .where(eq(employees.id, employeeId));

  await audit(actorId ?? null, "team.member.remove", "team", teamId, {
    employeeId,
  });

  return { ...team, members: await listEmployees({ teamId }) };
}
