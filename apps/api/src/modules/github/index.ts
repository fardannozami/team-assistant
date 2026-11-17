import { Hono } from "hono";
import { sign, verify } from "hono/jwt";
import { githubLoginSchema, githubRepoTrackSchema } from "@repo/shared";
import pino from "pino";
import { requireRole } from "../auth/index.js";
import { HttpError } from "../../lib/http-error.js";
import { parseWith } from "../../lib/validate.js";
import { getActorId, getWorkspaceId } from "../../lib/tenant.js";
import { secretEnv } from "../../lib/env.js";
import { githubConfigured, githubEnv, userInstallationIds, verifyWebhookSignature } from "./app.js";
import {
  getGithubStatus,
  handleWebhook,
  linkInstallation,
  listActivity,
  listGithubMembers,
  setGithubLogin,
  setRepositoryTracked,
  summarizeActivity,
  syncRepositories,
  unlinkInstallation,
} from "./service.js";

const logger = pino({ level: process.env.LOG_LEVEL ?? "info" });

export const githubApi = new Hono();

const canManage = requireRole("Owner", "Admin");
const canView = requireRole("Owner", "Admin", "Manager");

const WEB_URL = (process.env.WEB_URL ?? "http://localhost:3000").replace(/\/$/, "");
// Its own key: an install `state` passes through GitHub's URLs and must never
// be accepted as a login token.
const STATE_SECRET = `${secretEnv("JWT_SECRET", "dev-secret-change-me")}:github-install`;
const STATE_TTL_SECONDS = 15 * 60;
const LINK_TTL_SECONDS = 10 * 60;

function assertConfigured() {
  if (!githubConfigured()) throw new HttpError(503, "GitHub integration is not configured on this server");
}

// ---- GitHub -> us (public) ----

githubApi.post("/webhook", async (c) => {
  if (!githubEnv().webhookSecret) return c.json({ error: "GitHub webhooks are not configured" }, 503);
  const raw = await c.req.text();
  if (!verifyWebhookSignature(raw, c.req.header("x-hub-signature-256"))) {
    return c.json({ error: "Invalid signature" }, 401);
  }
  const event = c.req.header("x-github-event") ?? "";
  const delivery = c.req.header("x-github-delivery") ?? "";
  if (!event || !delivery) return c.json({ error: "Missing GitHub headers" }, 400);
  if (event === "ping") return c.json({ ok: true });

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(raw);
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }
  const outcome = await handleWebhook(delivery, event, payload);
  return c.json(outcome);
});

/**
 * Where GitHub sends the admin after installing (the App's Callback URL, with
 * "Request user authorization during installation" on). The OAuth code proves
 * the person installing can access the installation.
 *
 * It does not prove that person belongs to the workspace in `state`: an admin
 * could hand their install link to another org's owner and get that org's
 * repos linked to their own workspace. So nothing is linked here. The browser
 * gets a short-lived link token, and the web app (logged in as the admin who
 * started the install) redeems it at POST /link.
 */
githubApi.get("/setup", async (c) => {
  const done = (query: string) => c.redirect(`${WEB_URL}/?page=github&${query}`);
  const { installation_id: installationId, setup_action: action, state, code } = c.req.query();

  if (action === "request") return done("github=requested");
  if (!state) return done("github=updated"); // "Redirect on update": repo changes arrive by webhook
  if (!githubConfigured() || !installationId || !code) return done("github_error=invalid_request");

  let workspaceId: string;
  let actorId: string | null;
  try {
    const payload = await verify(state, STATE_SECRET);
    if (payload.purpose !== "github-install" || typeof payload.workspaceId !== "string") throw new Error("bad state");
    workspaceId = payload.workspaceId;
    actorId = typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return done("github_error=invalid_state");
  }

  try {
    if (!(await userInstallationIds(code)).has(installationId)) return done("github_error=not_yours");
  } catch (error) {
    logger.error({ err: error, installationId }, "GitHub setup failed");
    return done("github_error=github_error");
  }
  const link = await sign(
    {
      purpose: "github-link",
      workspaceId,
      sub: actorId,
      installationId,
      exp: Math.floor(Date.now() / 1000) + LINK_TTL_SECONDS,
    },
    STATE_SECRET,
  );
  return done(`github_link=${encodeURIComponent(link)}`);
});

/** Second half of /setup: only the admin who started the install can finish it. */
githubApi.post("/link", canManage, async (c) => {
  const { token } = await c.req.json<{ token?: unknown }>().catch(() => ({ token: undefined }));
  let payload: Record<string, unknown>;
  try {
    if (typeof token !== "string") throw new Error("missing token");
    payload = await verify(token, STATE_SECRET);
    if (payload.purpose !== "github-link" || typeof payload.installationId !== "string") throw new Error("bad token");
  } catch {
    throw new HttpError(400, "Tautan pemasangan GitHub tidak valid atau kedaluwarsa. Coba hubungkan lagi.");
  }
  if (payload.workspaceId !== getWorkspaceId(c) || (payload.sub ?? null) !== getActorId(c)) {
    throw new HttpError(403, "Pemasangan GitHub ini dimulai dari akun atau workspace lain.");
  }
  await linkInstallation(getWorkspaceId(c), payload.installationId, getActorId(c));
  return c.json({ connected: true });
});

// ---- Dashboard ----

githubApi.get("/status", canView, async (c) => {
  return c.json({
    configured: githubConfigured(),
    appSlug: githubEnv().slug || null,
    ...(await getGithubStatus(getWorkspaceId(c))),
  });
});

githubApi.post("/install", canManage, async (c) => {
  assertConfigured();
  const state = await sign(
    {
      purpose: "github-install",
      workspaceId: getWorkspaceId(c),
      sub: getActorId(c),
      exp: Math.floor(Date.now() / 1000) + STATE_TTL_SECONDS,
    },
    STATE_SECRET,
  );
  const url = `https://github.com/apps/${encodeURIComponent(githubEnv().slug)}/installations/new?state=${encodeURIComponent(state)}`;
  return c.json({ url });
});

githubApi.post("/installations/:id/sync", canManage, async (c) => {
  assertConfigured();
  const count = await syncRepositories(getWorkspaceId(c), c.req.param("id"));
  return c.json({ repositories: count });
});

githubApi.delete("/installations/:id", canManage, async (c) => {
  await unlinkInstallation(getWorkspaceId(c), c.req.param("id"), getActorId(c));
  return c.json({ deleted: true });
});

githubApi.patch("/repositories/:id", canManage, async (c) => {
  const { isActive } = parseWith(githubRepoTrackSchema, await c.req.json());
  return c.json(await setRepositoryTracked(getWorkspaceId(c), c.req.param("id"), isActive, getActorId(c)));
});

githubApi.get("/members", canView, async (c) => {
  return c.json({ members: await listGithubMembers(getWorkspaceId(c)) });
});

githubApi.put("/members/:employeeId", canManage, async (c) => {
  const { login } = parseWith(githubLoginSchema, await c.req.json());
  return c.json(await setGithubLogin(getWorkspaceId(c), c.req.param("employeeId"), login, getActorId(c)));
});

githubApi.get("/activity", canView, async (c) => {
  const { employeeId, repository, before, limit } = c.req.query();
  const beforeDate = before ? new Date(before) : undefined;
  if (beforeDate && Number.isNaN(beforeDate.getTime())) throw new HttpError(400, "before must be an ISO date");
  return c.json({
    activity: await listActivity(getWorkspaceId(c), {
      employeeId: employeeId || undefined,
      repository: repository || undefined,
      before: beforeDate,
      limit: limit ? Number(limit) || undefined : undefined,
    }),
  });
});

githubApi.get("/activity/summary", canView, async (c) => {
  const days = Math.min(Math.max(Number(c.req.query("days") ?? 7) || 7, 1), 90);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return c.json({ days, summary: await summarizeActivity(getWorkspaceId(c), since) });
});
