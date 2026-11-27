import { createDbClient, employees, nayaChecklistItems, teams } from "@repo/database";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { nayaPoolOf, type NayaPool } from "@repo/shared";
import { HttpError } from "../../lib/http-error.js";
import { teamToday, type TeamPresence } from "./team.js";

// The people a card can go to: the team's employees (daily), each with their position's pool
// (sales/PM, design, development) and how they are doing today by their standup. "Auto" picks the
// most available member of a pool: santai (standby) first, then those working, then those who
// have not sent a standup yet; nobody who has checked out. Ties go to whoever has fewer items
// waiting on them.

const db = createDbClient(
  process.env.DATABASE_URL ?? "postgres://teamassistant:teamassistant@localhost:5432/teamassistant",
);

export interface Member {
  id: string;
  name: string;
  team: string | null;
  lead: string | null;
  pool: NayaPool | null;
  presence: TeamPresence;
  /** Their daily login, when they have one: they can then open Naya and decide themselves. */
  userId: string | null;
  /** Checklist items still waiting on them. */
  load: number;
}

const PRESENCE_RANK: Record<TeamPresence, number> = { standby: 0, working: 1, absent: 2, resting: 3 };

/** The most available member of a pool, or undefined when nobody in it can take work today. */
export function mostAvailable(members: Member[], pool: NayaPool): Member | undefined {
  return members
    .filter((member) => member.pool === pool && member.presence !== "resting")
    .sort((a, b) => PRESENCE_RANK[a.presence] - PRESENCE_RANK[b.presence] || a.load - b.load || a.name.localeCompare(b.name))[0];
}

/** Every active employee with their pool, today's presence and how much waits on them. */
export async function listMembers(workspaceId: string): Promise<Member[]> {
  const [rows, today, loads] = await Promise.all([
    db
      .select({ id: employees.id, name: employees.name, lead: employees.lead, userId: employees.userId, team: teams.name })
      .from(employees)
      .leftJoin(teams, eq(teams.id, employees.teamId))
      .where(and(eq(employees.workspaceId, workspaceId), eq(employees.isActive, true)))
      .orderBy(asc(employees.name)),
    teamToday(workspaceId).catch(() => ({ members: [] })),
    db
      .select({ pic: nayaChecklistItems.picEmployeeId, count: sql<number>`count(*)::int` })
      .from(nayaChecklistItems)
      .where(and(eq(nayaChecklistItems.workspaceId, workspaceId), eq(nayaChecklistItems.status, "in_progress")))
      .groupBy(nayaChecklistItems.picEmployeeId),
  ]);
  const presence = new Map(today.members.map((member) => [member.id, member.presence]));
  const load = new Map(loads.map((row) => [row.pic, row.count]));
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    team: row.team ?? null,
    lead: row.lead ?? null,
    pool: nayaPoolOf(row.lead, row.team),
    // Not a standup target (e.g. an admin): counted as not in yet.
    presence: presence.get(row.id) ?? "absent",
    userId: row.userId ?? null,
    load: load.get(row.id) ?? 0,
  }));
}

export async function pickAvailable(workspaceId: string, pool: NayaPool): Promise<string | null> {
  return mostAvailable(await listMembers(workspaceId), pool)?.id ?? null;
}

/** Every active employee's pool, by id: who a whole-team card waits on. */
export async function memberPools(workspaceId: string): Promise<Map<string, NayaPool | null>> {
  const rows = await db
    .select({ id: employees.id, lead: employees.lead, team: teams.name })
    .from(employees)
    .leftJoin(teams, eq(teams.id, employees.teamId))
    .where(and(eq(employees.workspaceId, workspaceId), eq(employees.isActive, true)));
  return new Map(rows.map((row) => [row.id, nayaPoolOf(row.lead, row.team)]));
}

/** The employee's pool, or null (also for nobody). */
export async function poolOf(workspaceId: string, employeeId: string | null): Promise<NayaPool | null> {
  return employeeId ? ((await memberPools(workspaceId)).get(employeeId) ?? null) : null;
}

/** The employee record of a signed-in person, if their account is linked to one. */
export async function employeeOf(workspaceId: string, userId: string): Promise<string | null> {
  const [row] = await db.select({ id: employees.id }).from(employees).where(and(eq(employees.workspaceId, workspaceId), eq(employees.userId, userId), eq(employees.isActive, true))).limit(1);
  return row?.id ?? null;
}

export async function assertMember(workspaceId: string, employeeId: string) {
  const [row] = await db.select({ id: employees.id }).from(employees).where(and(eq(employees.id, employeeId), eq(employees.workspaceId, workspaceId), eq(employees.isActive, true))).limit(1);
  if (!row) throw new HttpError(400, "Anggota tim tidak dikenal.");
}

/** Names of the given employees, for labels. */
export async function memberNames(workspaceId: string, ids: string[]): Promise<Map<string, string>> {
  if (!ids.length) return new Map();
  const rows = await db.select({ id: employees.id, name: employees.name }).from(employees).where(and(eq(employees.workspaceId, workspaceId), inArray(employees.id, ids)));
  return new Map(rows.map((row) => [row.id, row.name]));
}
