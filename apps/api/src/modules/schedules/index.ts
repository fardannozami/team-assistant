import { Hono } from "hono";
import type { Context } from "hono";
import { createScheduleSchema, updateScheduleSchema } from "@repo/shared";
import { requireRole } from "../auth/index.js";
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

function actorId(c: Context): string | null {
  return (c.get("user") as { sub?: string } | undefined)?.sub ?? null;
}

schedulesApi.get("/", canView, async (c) => {
  return c.json({ schedules: await listSchedules() });
});

schedulesApi.post("/", canManage, async (c) => {
  const input = parseWith(createScheduleSchema, await c.req.json());
  return c.json(await createSchedule(input, actorId(c)), 201);
});

schedulesApi.get("/:id", canView, async (c) => {
  return c.json(await getSchedule(c.req.param("id")));
});

schedulesApi.patch("/:id", canManage, async (c) => {
  const input = parseWith(updateScheduleSchema, await c.req.json());
  return c.json(await updateSchedule(c.req.param("id"), input, actorId(c)));
});

schedulesApi.delete("/:id", canManage, async (c) => {
  await deleteSchedule(c.req.param("id"), actorId(c));
  return c.json({ deleted: true });
});

schedulesApi.post("/:id/trigger", canManage, async (c) => {
  return c.json(await triggerSchedule(c.req.param("id"), actorId(c)));
});
