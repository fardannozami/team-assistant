import { Hono } from "hono";
import type { Context } from "hono";
import {
  createTeamSchema,
  teamMemberSchema,
  updateTeamSchema,
} from "@repo/shared";
import { requireRole } from "../auth/index.js";
import { parseWith } from "../../lib/validate.js";
import {
  addTeamMember,
  createTeam,
  deleteTeam,
  getTeam,
  listTeams,
  removeTeamMember,
  updateTeam,
} from "./service.js";

export const teamsApi = new Hono();

const canManage = requireRole("Owner", "Admin");
const canView = requireRole("Owner", "Admin", "Manager");

function actorId(c: Context): string | null {
  return (c.get("user") as { sub?: string } | undefined)?.sub ?? null;
}

teamsApi.get("/", canView, async (c) => {
  return c.json({ teams: await listTeams() });
});

teamsApi.post("/", canManage, async (c) => {
  const input = parseWith(createTeamSchema, await c.req.json());
  return c.json(await createTeam(input, actorId(c)), 201);
});

teamsApi.get("/:id", canView, async (c) => {
  return c.json(await getTeam(c.req.param("id")));
});

teamsApi.patch("/:id", canManage, async (c) => {
  const input = parseWith(updateTeamSchema, await c.req.json());
  return c.json(await updateTeam(c.req.param("id"), input, actorId(c)));
});

teamsApi.delete("/:id", canManage, async (c) => {
  await deleteTeam(c.req.param("id"), actorId(c));
  return c.json({ deleted: true });
});

teamsApi.post("/:id/members", canManage, async (c) => {
  const { employeeId } = parseWith(teamMemberSchema, await c.req.json());
  return c.json(
    await addTeamMember(c.req.param("id"), employeeId, actorId(c)),
  );
});

teamsApi.delete("/:id/members/:employeeId", canManage, async (c) => {
  return c.json(
    await removeTeamMember(
      c.req.param("id"),
      c.req.param("employeeId"),
      actorId(c),
    ),
  );
});
