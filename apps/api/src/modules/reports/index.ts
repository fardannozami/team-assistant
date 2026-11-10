import { Hono } from "hono";
import type { Context } from "hono";
import { requireRole } from "../auth/index.js";
import { generateDailyReport, generateWeeklyReport } from "./service.js";

export const reportsApi = new Hono();

const canView = requireRole("Owner", "Admin", "Manager");

function actorId(c: Context): string | null {
  return (c.get("user") as { sub?: string } | undefined)?.sub ?? null;
}

reportsApi.get("/daily", canView, async (c) => {
  const date = c.req.query("date");
  return c.json(await generateDailyReport(date));
});

reportsApi.get("/weekly", canView, async (c) => {
  return c.json(await generateWeeklyReport());
});