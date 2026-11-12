import { Hono } from "hono";
import { createScheduleSchema, updateScheduleSchema } from "@repo/shared";
import { requireRole } from "../auth/index.js";
import { getActorId, getWorkspaceId } from "../../lib/tenant.js";
import { parseWith } from "../../lib/validate.js";
import {
  createSchedule,
  deleteSchedule,
  getSchedule,
  listSchedules,
  triggerSchedule,
  updateSchedule,
} from "./service.js";

export const schedulesApi = new Hono();

const canManage = requireRole("Owner", "Admin");
const canView = requireRole("Owner", "Admin", "Manager");

schedulesApi.get("/", canView, async (c) => {
  return c.json({ schedules: await listSchedules(getWorkspaceId(c)) });
});

schedulesApi.post("/", canManage, async (c) => {
  const input = parseWith(createScheduleSchema, await c.req.json());
  return c.json(await createSchedule(getWorkspaceId(c), input, getActorId(c)), 201);
});

schedulesApi.get("/:id", canView, async (c) => {
  return c.json(await getSchedule(getWorkspaceId(c), c.req.param("id")));
});

schedulesApi.patch("/:id", canManage, async (c) => {
  const input = parseWith(updateScheduleSchema, await c.req.json());
  return c.json(
    await updateSchedule(
      getWorkspaceId(c),
      c.req.param("id"),
      input,
      getActorId(c),
    ),
  );
});

schedulesApi.delete("/:id", canManage, async (c) => {
  await deleteSchedule(getWorkspaceId(c), c.req.param("id"), getActorId(c));
  return c.json({ deleted: true });
});

schedulesApi.post("/:id/trigger", canManage, async (c) => {
  return c.json(
    await triggerSchedule(getWorkspaceId(c), c.req.param("id"), getActorId(c)),
  );
});
