import { Hono } from "hono";
import {
  checkinKindSchema,
  runCheckinSchema,
  saveCheckinConfigSchema,
  standupDateSchema,
} from "@repo/shared";
import { requireInternalOrRole, requireRole } from "../auth/index.js";
import { HttpError } from "../../lib/http-error.js";
import { parseWith } from "../../lib/validate.js";
import { getActorId, getWorkspaceId } from "../../lib/tenant.js";
import {
  closeCheckins,
  getCheckinConfigs,
  listCheckinResponses,
  saveCheckinConfig,
  sendCheckinPrompts,
  sendCheckinReminders,
} from "./service.js";

export const checkinsApi = new Hono();

const canRun = requireInternalOrRole("Owner", "Admin");
const canManage = requireRole("Owner", "Admin");
const canView = requireRole("Owner", "Admin", "Manager");

function kindParam(value: string) {
  const parsed = checkinKindSchema.safeParse(value);
  if (!parsed.success) throw new HttpError(404, "Unknown check-in");
  return parsed.data;
}

checkinsApi.get("/config", canView, async (c) => {
  return c.json({ configs: await getCheckinConfigs(getWorkspaceId(c)) });
});

checkinsApi.put("/config/:kind", canManage, async (c) => {
  const input = parseWith(saveCheckinConfigSchema, await c.req.json());
  return c.json(
    await saveCheckinConfig(getWorkspaceId(c), kindParam(c.req.param("kind")), input, getActorId(c)),
  );
});

checkinsApi.post("/trigger", canRun, async (c) => {
  const input = parseWith(runCheckinSchema, await c.req.json().catch(() => ({})));
  return c.json(await sendCheckinPrompts(getWorkspaceId(c), input));
});

checkinsApi.post("/reminders", canRun, async (c) => {
  const input = parseWith(runCheckinSchema, await c.req.json().catch(() => ({})));
  return c.json(await sendCheckinReminders(getWorkspaceId(c), input));
});

checkinsApi.post("/close", canRun, async (c) => {
  const input = parseWith(runCheckinSchema, await c.req.json().catch(() => ({})));
  return c.json(await closeCheckins(getWorkspaceId(c), input));
});

checkinsApi.get("/:kind/responses", canView, async (c) => {
  const date = c.req.query("date");
  if (date && !standupDateSchema.safeParse(date).success) {
    throw new HttpError(400, "date must be in YYYY-MM-DD format");
  }
  return c.json(await listCheckinResponses(getWorkspaceId(c), kindParam(c.req.param("kind")), date));
});
