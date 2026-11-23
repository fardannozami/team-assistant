import { Hono } from "hono";
import { agencyProfileSchema, runBriefingSchema, searchKeySchema, updateBriefingItemSchema } from "@repo/shared";
import { requireInternalOrRole, requireRole } from "../auth/index.js";
import { parseWith } from "../../lib/validate.js";
import { getActorId, getWorkspaceId } from "../../lib/tenant.js";
import {
  getAgencyProfile,
  listBriefingItems,
  listBriefingRuns,
  runBriefings,
  saveAgencyProfile,
  updateBriefingItem,
} from "./service.js";
import { deleteSearchKey, getSearchKeyStatus, saveSearchKey } from "./search-key.js";

// Pre-standup briefings from apps/agents (CrewAI). PMs work the leads, so they can read and claim them.
export const briefingsApi = new Hono();

const canManage = requireRole("Owner", "Admin");
const canView = requireRole("Owner", "Admin", "Manager", "PM");

// Before the standup from the worker, or the "Jalankan sekarang" button.
briefingsApi.post("/run", requireInternalOrRole("Owner", "Admin"), async (c) => {
  const input = parseWith(runBriefingSchema, await c.req.json().catch(() => ({})));
  return c.json(await runBriefings(getWorkspaceId(c), input));
});

briefingsApi.get("/items", canView, async (c) => {
  const limit = Number(c.req.query("limit") ?? 100) || 100;
  const items = await listBriefingItems(getWorkspaceId(c), {
    audience: c.req.query("audience"),
    status: c.req.query("status"),
    limit,
  });
  return c.json({ items });
});

briefingsApi.patch("/items/:id", canView, async (c) => {
  const input = parseWith(updateBriefingItemSchema, await c.req.json());
  return c.json(await updateBriefingItem(getWorkspaceId(c), c.req.param("id"), input, getActorId(c)));
});

briefingsApi.get("/runs", canView, async (c) => c.json({ runs: await listBriefingRuns(getWorkspaceId(c)) }));

briefingsApi.get("/profile", canView, async (c) => c.json(await getAgencyProfile(getWorkspaceId(c))));

briefingsApi.put("/profile", canManage, async (c) => {
  const input = parseWith(agencyProfileSchema, await c.req.json());
  return c.json(await saveAgencyProfile(getWorkspaceId(c), input, getActorId(c)));
});

// Bring-your-own Tavily key for the sales briefing's web search; tested before it is stored.
briefingsApi.get("/search-key", canManage, async (c) => c.json(await getSearchKeyStatus(getWorkspaceId(c))));

briefingsApi.put("/search-key", canManage, async (c) => {
  const { apiKey } = parseWith(searchKeySchema, await c.req.json());
  return c.json(await saveSearchKey(getWorkspaceId(c), apiKey, getActorId(c)));
});

briefingsApi.delete("/search-key", canManage, async (c) => c.json(await deleteSearchKey(getWorkspaceId(c), getActorId(c))));
