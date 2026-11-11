import { Hono } from "hono";
import {
  dateInTimezone,
  remindStandupSchema,
  standupDateSchema,
  triggerStandupSchema,
} from "@repo/shared";
import { requireInternalOrRole, requireRole } from "../auth/index.js";
import { HttpError } from "../../lib/http-error.js";
import { parseWith } from "../../lib/validate.js";
import { getWorkspaceId } from "../../lib/tenant.js";
import {
  listStandupsByDate,
  sendStandupPrompts,
  sendStandupReminders,
  sendStandupSummary,
  closeStandups,
} from "./service.js";

export const standupsApi = new Hono();

const canManage = requireInternalOrRole("Owner", "Admin");
const canView = requireRole("Owner", "Admin", "Manager");

standupsApi.post("/trigger", canManage, async (c) => {
  const input = parseWith(
    triggerStandupSchema,
    await c.req.json().catch(() => ({})),
  );
  return c.json(
    await sendStandupPrompts(getWorkspaceId(c), { ...input, force: input.force }),
  );
});

standupsApi.post("/reminders", canManage, async (c) => {
  const input = parseWith(
    remindStandupSchema,
    await c.req.json().catch(() => ({})),
  );
  return c.json(await sendStandupReminders(getWorkspaceId(c), input));
});

standupsApi.post("/summary", canManage, async (c) => {
  const input = parseWith(remindStandupSchema, await c.req.json().catch(() => ({})));
  return c.json(await sendStandupSummary(getWorkspaceId(c), input));
});

standupsApi.post("/close", canManage, async (c) => {
  const input = parseWith(remindStandupSchema, await c.req.json().catch(() => ({})));
  return c.json(await closeStandups(getWorkspaceId(c), input));
});

standupsApi.get("/", canView, async (c) => {
  const ws = getWorkspaceId(c);
  const date = c.req.query("date") ?? dateInTimezone();
  if (!standupDateSchema.safeParse(date).success) {
    throw new HttpError(400, "date must be in YYYY-MM-DD format");
  }
  return c.json({ date, standups: await listStandupsByDate(ws, date) });
});
