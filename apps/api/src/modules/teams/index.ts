import { Hono } from "hono";
import {
  createTeamSchema,
  teamMemberSchema,
  updateTeamSchema,
} from "@repo/shared";
import { requireRole } from "../auth/index.js";
import { getActorId, getWorkspaceId } from "../../lib/tenant.js";
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

teamsApi.get("/", canView, async (c) => {
  return c.json({ teams: await listTeams(getWorkspaceId(c)) });
});

teamsApi.post("/", canManage, async (c) => {
  const input = parseWith(createTeamSchema, await c.req.json());
  return c.json(
    await createTeam(getWorkspaceId(c), input, getActorId(c)),
    201,
  );
});

teamsApi.get("/:id", canView, async (c) => {
  return c.json(await getTeam(getWorkspaceId(c), c.req.param("id")));
});

teamsApi.patch("/:id", canManage, async (c) => {
  const input = parseWith(updateTeamSchema, await c.req.json());
  return c.json(
    await updateTeam(getWorkspaceId(c), c.req.param("id"), input, getActorId(c)),
  );
});

teamsApi.delete("/:id", canManage, async (c) => {
  await deleteTeam(getWorkspaceId(c), c.req.param("id"), getActorId(c));
  return c.json({ deleted: true });
});

teamsApi.post("/:id/members", canManage, async (c) => {
  const { employeeId } = parseWith(teamMemberSchema, await c.req.json());
  return c.json(
    await addTeamMember(
      getWorkspaceId(c),
      c.req.param("id"),
      employeeId,
      getActorId(c),
    ),
  );
});

teamsApi.delete("/:id/members/:employeeId", canManage, async (c) => {
  return c.json(
    await removeTeamMember(
      getWorkspaceId(c),
      c.req.param("id"),
      c.req.param("employeeId"),
      getActorId(c),
    ),
  );
});
