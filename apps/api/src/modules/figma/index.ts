import { Hono } from "hono";
import { figmaAccountMapSchema, figmaFileSchema, figmaFileTrackSchema, figmaTokenSchema } from "@repo/shared";
import { requireInternalOrRole, requireRole } from "../auth/index.js";
import { parseWith } from "../../lib/validate.js";
import { getActorId, getWorkspaceId } from "../../lib/tenant.js";
import {
  addFigmaFile,
  connectFigma,
  disconnectFigma,
  getFigmaStatus,
  handleFigmaWebhook,
  listFigmaAccounts,
  listFigmaActivity,
  mapFigmaAccount,
  removeFigmaFile,
  setFigmaFileTracked,
  syncFigma,
} from "./service.js";

// Figma design activity (M9). Owner/Admin connect and choose files; Managers can read.
export const figmaApi = new Hono();

const canManage = requireRole("Owner", "Admin");
const canView = requireRole("Owner", "Admin", "Manager");

// ---- Figma -> us (public; the passcode in the body authenticates) ----

figmaApi.post("/webhook", async (c) => {
  const payload = await c.req.json<Record<string, unknown>>().catch(() => null);
  if (!payload || typeof payload !== "object") return c.json({ error: "Invalid JSON" }, 400);
  const outcome = await handleFigmaWebhook(payload);
  if (outcome.status === "unauthorized") return c.json({ error: "Invalid passcode" }, 401);
  return c.json(outcome);
});

// ---- Dashboard ----

figmaApi.get("/status", canView, async (c) => c.json(await getFigmaStatus(getWorkspaceId(c))));

figmaApi.put("/connection", canManage, async (c) => {
  const { token } = parseWith(figmaTokenSchema, await c.req.json());
  return c.json(await connectFigma(getWorkspaceId(c), token, getActorId(c)));
});

figmaApi.delete("/connection", canManage, async (c) => {
  await disconnectFigma(getWorkspaceId(c), getActorId(c));
  return c.json({ deleted: true });
});

figmaApi.post("/files", canManage, async (c) => {
  const { url } = parseWith(figmaFileSchema, await c.req.json());
  return c.json(await addFigmaFile(getWorkspaceId(c), url, getActorId(c)), 201);
});

figmaApi.patch("/files/:id", canManage, async (c) => {
  const { isActive } = parseWith(figmaFileTrackSchema, await c.req.json());
  return c.json(await setFigmaFileTracked(getWorkspaceId(c), c.req.param("id"), isActive, getActorId(c)));
});

figmaApi.delete("/files/:id", canManage, async (c) => {
  await removeFigmaFile(getWorkspaceId(c), c.req.param("id"), getActorId(c));
  return c.json({ deleted: true });
});

// Hourly from the worker, or the "Sinkronkan" button.
figmaApi.post("/sync", requireInternalOrRole("Owner", "Admin"), async (c) => c.json(await syncFigma(getWorkspaceId(c))));

figmaApi.get("/accounts", canView, async (c) => c.json({ accounts: await listFigmaAccounts(getWorkspaceId(c)) }));

figmaApi.put("/accounts/:figmaId", canManage, async (c) => {
  const { employeeId } = parseWith(figmaAccountMapSchema, await c.req.json());
  return c.json(await mapFigmaAccount(getWorkspaceId(c), c.req.param("figmaId"), employeeId, getActorId(c)));
});

figmaApi.get("/activity", canView, async (c) => {
  const limit = Number(c.req.query("limit") ?? 50) || 50;
  return c.json({ activity: await listFigmaActivity(getWorkspaceId(c), limit) });
});
