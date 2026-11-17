import { Hono } from "hono";
import { isRealIsoDate, updateCalendarSettingsSchema } from "@repo/shared";
import { requireRole } from "../auth/index.js";
import { getActorId, getWorkspaceId } from "../../lib/tenant.js";
import { HttpError } from "../../lib/http-error.js";
import { parseWith } from "../../lib/validate.js";
import {
  createException,
  deleteException,
  getCalendarSettings,
  isExcludedDate,
  listExceptions,
  listHolidays,
  listUpcomingHolidays,
  notifyAdminsBeforeHolidays,
  syncHolidays,
  updateCalendarSettings,
} from "./service.js";

export const holidaysApi = new Hono();

const canManage = requireRole("Owner", "Admin");
const canView = requireRole("Owner", "Admin", "Manager");

holidaysApi.get("/settings", canView, async (c) => {
  return c.json(await getCalendarSettings(getWorkspaceId(c)));
});

holidaysApi.patch("/settings", canManage, async (c) => {
  const patch = parseWith(updateCalendarSettingsSchema, await c.req.json().catch(() => ({})));
  return c.json(await updateCalendarSettings(getWorkspaceId(c), patch, getActorId(c)));
});

holidaysApi.get("/", canView, async (c) => {
  const yearParam = c.req.query("year");
  const type = c.req.query("type");
  const year = yearParam ? Number(yearParam) : undefined;
  return c.json({ holidays: await listHolidays({ year, type }) });
});

holidaysApi.get("/upcoming", canView, async (c) => {
  const limit = Number(c.req.query("limit") ?? 10);
  return c.json({ holidays: await listUpcomingHolidays(limit) });
});

holidaysApi.post("/sync", canManage, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  // Holidays are shared by every workspace: only the years around now.
  const thisYear = new Date().getFullYear();
  const year = body?.year ? Number(body.year) : thisYear;
  if (!Number.isInteger(year) || year < thisYear - 1 || year > thisYear + 1) {
    throw new HttpError(400, `year must be between ${thisYear - 1} and ${thisYear + 1}`);
  }
  return c.json(await syncHolidays(year, getActorId(c), getWorkspaceId(c)));
});

holidaysApi.get("/check", canView, async (c) => {
  const date = c.req.query("date");
  if (!date || !isRealIsoDate(date)) throw new HttpError(400, "date must be in YYYY-MM-DD format");
  return c.json(await isExcludedDate(getWorkspaceId(c), date));
});

holidaysApi.get("/exceptions", canView, async (c) => {
  return c.json({ exceptions: await listExceptions(getWorkspaceId(c)) });
});

holidaysApi.post("/exceptions", canManage, async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as any;
  if (typeof body?.date !== "string" || !isRealIsoDate(body.date)) {
    throw new HttpError(400, "date must be YYYY-MM-DD");
  }
  const input = {
    date: body.date,
    reason: body.reason,
    skip: body.skip,
  };
  return c.json(await createException(getWorkspaceId(c), input, getActorId(c)), 201);
});

holidaysApi.delete("/exceptions/:id", canManage, async (c) => {
  await deleteException(getWorkspaceId(c), c.req.param("id"), getActorId(c));
  return c.json({ deleted: true });
});

holidaysApi.post("/notify", canManage, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const days = body?.days ? Number(body.days) : 7;
  return c.json(await notifyAdminsBeforeHolidays(getWorkspaceId(c), days));
});