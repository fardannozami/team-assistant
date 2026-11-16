import { Hono } from "hono";
import { projectInputSchema } from "@repo/shared";
import { audit, requireRole } from "../auth/index.js";
import { parseWith } from "../../lib/validate.js";
import { getActorId, getWorkspaceId } from "../../lib/tenant.js";
import {
  createProject,
  deleteProject,
  listProjectPeople,
  listProjects,
  updateProject,
} from "./service.js";

// Projects and fee splits. Fees are sensitive: PMs, Admins and the Owner only.
export const projectsApi = new Hono();

const canManage = requireRole("Owner", "Admin", "PM");

projectsApi.get("/", canManage, async (c) => {
  return c.json({ projects: await listProjects(getWorkspaceId(c)) });
});

// PMs cannot open /employees, so the member picker gets its names here.
projectsApi.get("/people", canManage, async (c) => {
  return c.json({ people: await listProjectPeople(getWorkspaceId(c)) });
});

projectsApi.post("/", canManage, async (c) => {
  const input = parseWith(projectInputSchema, await c.req.json());
  const project = await createProject(getWorkspaceId(c), input, getActorId(c));
  await audit(getWorkspaceId(c), getActorId(c), "project.create", "projects", project.id, { name: project.name });
  return c.json(project, 201);
});

projectsApi.put("/:id", canManage, async (c) => {
  const input = parseWith(projectInputSchema, await c.req.json());
  const project = await updateProject(getWorkspaceId(c), c.req.param("id"), input);
  await audit(getWorkspaceId(c), getActorId(c), "project.update", "projects", project.id, { name: project.name });
  return c.json(project);
});

projectsApi.delete("/:id", canManage, async (c) => {
  const row = await deleteProject(getWorkspaceId(c), c.req.param("id"));
  await audit(getWorkspaceId(c), getActorId(c), "project.delete", "projects", row.id, { name: row.name });
  return c.json({ deleted: true });
});
