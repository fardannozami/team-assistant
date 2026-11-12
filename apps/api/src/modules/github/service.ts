import {
  activityEvents,
  createDbClient,
  employeeIntegrations,
  employees,
  githubInstallations,
  trackedRepositories,
  webhookDeliveries,
} from "@repo/database";
import { and, desc, eq, gte, inArray, isNull, lt, notInArray, sql } from "drizzle-orm";
import pino from "pino";
import { audit } from "../auth/index.js";
import { HttpError } from "../../lib/http-error.js";
import { findUser, getInstallation, listInstallationRepos, type GitHubRepo } from "./app.js";
import { normalizeEvent } from "./events.js";

const logger = pino({ level: process.env.LOG_LEVEL ?? "info" });

const db = createDbClient(
  process.env.DATABASE_URL ??
    "postgres://teamassistant:teamassistant@localhost:5432/teamassistant",
);

const PROVIDER = "github";
const LOGIN_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;

// ---- Installations & repositories (GIT-001, GIT-009) ----

/** Links an installation to a workspace, refusing one already owned by another workspace. */
export async function linkInstallation(workspaceId: string, installationId: string, actorId: string | null) {
  const [existing] = await db
    .select()
    .from(githubInstallations)
    .where(eq(githubInstallations.installationId, installationId))
    .limit(1);
  if (existing && existing.workspaceId !== workspaceId) {
    throw new HttpError(409, "This GitHub installation is linked to another workspace");
  }

  const info = await getInstallation(installationId);
  const values = {
    accountLogin: info.account?.login ?? null,
    accountType: info.account?.type ?? null,
    repositorySelection: info.repository_selection,
    isActive: !info.suspended_at,
    updatedAt: new Date(),
  };
  const [row] = await db
    .insert(githubInstallations)
    .values({ workspaceId, installationId, ...values })
    .onConflictDoUpdate({ target: githubInstallations.installationId, set: values })
    .returning();

  await syncRepositories(workspaceId, row!.id);
  await audit(workspaceId, actorId, "github.install", "github_installation", row!.id, {
    installationId,
    account: values.accountLogin,
  });
  return row!;
}

async function upsertRepos(workspaceId: string, installationRowId: string, repos: Pick<GitHubRepo, "id" | "name" | "full_name" | "private">[]) {
  for (const repo of repos) {
    const [owner = "", name = repo.name] = repo.full_name.split("/");
    await db
      .insert(trackedRepositories)
      .values({
        workspaceId,
        installationId: installationRowId,
        githubRepoId: String(repo.id),
        owner,
        name,
        fullName: repo.full_name,
        isPrivate: !!repo.private,
      })
      .onConflictDoUpdate({
        target: trackedRepositories.githubRepoId,
        set: { owner, name, fullName: repo.full_name, isPrivate: !!repo.private, installationId: installationRowId, workspaceId },
      });
  }
}

/** Mirrors the repositories the installation can see; tracking choices are kept. */
export async function syncRepositories(workspaceId: string, installationRowId: string) {
  const [installation] = await db
    .select()
    .from(githubInstallations)
    .where(and(eq(githubInstallations.id, installationRowId), eq(githubInstallations.workspaceId, workspaceId)))
    .limit(1);
  if (!installation) throw new HttpError(404, "GitHub installation not found");

  const repos = await listInstallationRepos(installation.installationId);
  await upsertRepos(workspaceId, installation.id, repos);
  const keep = repos.map((r) => String(r.id));
  await db
    .delete(trackedRepositories)
    .where(
      and(
        eq(trackedRepositories.installationId, installation.id),
        keep.length ? notInArray(trackedRepositories.githubRepoId, keep) : sql`true`,
      ),
    );
  return repos.length;
}

export async function getGithubStatus(workspaceId: string) {
  const installations = await db
    .select()
    .from(githubInstallations)
    .where(eq(githubInstallations.workspaceId, workspaceId))
    .orderBy(githubInstallations.createdAt);
  const repositories = await db
    .select()
    .from(trackedRepositories)
    .where(eq(trackedRepositories.workspaceId, workspaceId))
    .orderBy(trackedRepositories.fullName);
  return { installations, repositories };
}

export async function setRepositoryTracked(workspaceId: string, id: string, isActive: boolean, actorId: string | null) {
  const [row] = await db
    .update(trackedRepositories)
    .set({ isActive })
    .where(and(eq(trackedRepositories.id, id), eq(trackedRepositories.workspaceId, workspaceId)))
    .returning();
  if (!row) throw new HttpError(404, "Repository not found");
  await audit(workspaceId, actorId, isActive ? "github.repo.track" : "github.repo.untrack", "tracked_repository", id, {
    fullName: row.fullName,
  });
  return row;
}

/** Forgets the installation here; the app stays installed on GitHub until removed there. */
export async function unlinkInstallation(workspaceId: string, id: string, actorId: string | null) {
  const [row] = await db
    .delete(githubInstallations)
    .where(and(eq(githubInstallations.id, id), eq(githubInstallations.workspaceId, workspaceId)))
    .returning();
  if (!row) throw new HttpError(404, "GitHub installation not found");
  await audit(workspaceId, actorId, "github.uninstall", "github_installation", id, { account: row.accountLogin });
}

// ---- Identity mapping (GIT-007) ----

export async function listGithubMembers(workspaceId: string) {
  const rows = await db
    .select({
      employeeId: employees.id,
      name: employees.name,
      isActive: employees.isActive,
      login: sql<string | null>`${employeeIntegrations.metadata}->>'login'`,
    })
    .from(employees)
    .leftJoin(
      employeeIntegrations,
      and(eq(employeeIntegrations.employeeId, employees.id), eq(employeeIntegrations.provider, PROVIDER)),
    )
    .where(eq(employees.workspaceId, workspaceId))
    .orderBy(employees.name);
  return rows;
}

async function loginMap(workspaceId: string) {
  const rows = await db
    .select({ employeeId: employeeIntegrations.employeeId, login: employeeIntegrations.externalId })
    .from(employeeIntegrations)
    .innerJoin(employees, eq(employeeIntegrations.employeeId, employees.id))
    .where(and(eq(employees.workspaceId, workspaceId), eq(employeeIntegrations.provider, PROVIDER)));
  return new Map(rows.map((r) => [r.login!, r.employeeId]));
}

/**
 * Sets (or clears, with null) an employee's GitHub login. The login is
 * checked against GitHub when an installation exists. Past activity follows
 * the mapping: the old login's events are detached, the new login's
 * unattributed events are claimed.
 */
export async function setGithubLogin(workspaceId: string, employeeId: string, input: string | null, actorId: string | null) {
  const [employee] = await db
    .select({ id: employees.id })
    .from(employees)
    .where(and(eq(employees.id, employeeId), eq(employees.workspaceId, workspaceId)))
    .limit(1);
  if (!employee) throw new HttpError(404, "Employee not found");

  let login = input?.trim().replace(/^@/, "") || null;
  let githubId: number | null = null;
  if (login) {
    if (!LOGIN_RE.test(login)) throw new HttpError(400, "Username GitHub tidak valid");
    const owner = (await loginMap(workspaceId)).get(login.toLowerCase());
    if (owner && owner !== employeeId) throw new HttpError(409, `@${login} sudah dipetakan ke anggota lain`);

    const [installation] = await db
      .select()
      .from(githubInstallations)
      .where(and(eq(githubInstallations.workspaceId, workspaceId), eq(githubInstallations.isActive, true)))
      .limit(1);
    if (installation) {
      const user = await findUser(installation.installationId, login).catch(() => undefined);
      if (user === null) throw new HttpError(400, `Akun GitHub @${login} tidak ditemukan`);
      if (user) {
        login = user.login;
        githubId = user.id;
      }
    }
  }

  await db.transaction(async (tx) => {
    await tx
      .delete(employeeIntegrations)
      .where(and(eq(employeeIntegrations.employeeId, employeeId), eq(employeeIntegrations.provider, PROVIDER)));
    await tx
      .update(activityEvents)
      .set({ employeeId: null })
      .where(and(eq(activityEvents.workspaceId, workspaceId), eq(activityEvents.provider, PROVIDER), eq(activityEvents.employeeId, employeeId)));
    if (!login) return;
    await tx.insert(employeeIntegrations).values({
      employeeId,
      provider: PROVIDER,
      externalId: login.toLowerCase(),
      metadata: { login, id: githubId },
    });
    await tx
      .update(activityEvents)
      .set({ employeeId })
      .where(
        and(
          eq(activityEvents.workspaceId, workspaceId),
          eq(activityEvents.provider, PROVIDER),
          isNull(activityEvents.employeeId),
          sql`lower(${activityEvents.actorLogin}) = ${login.toLowerCase()}`,
        ),
      );
  });
  await audit(workspaceId, actorId, "github.member.map", "employee", employeeId, { login });
  return { employeeId, login };
}

// ---- Webhooks (GIT-001..006, GIT-010) ----

type Payload = Record<string, any>;
export type WebhookOutcome = { status: "duplicate" | "ignored" | "processed"; reason?: string; stored?: number };

/**
 * Claims the delivery id first so a redelivery is a no-op; if processing
 * fails the claim is released so GitHub's retry can try again.
 */
export async function handleWebhook(deliveryId: string, event: string, payload: Payload): Promise<WebhookOutcome> {
  const [claimed] = await db
    .insert(webhookDeliveries)
    .values({ provider: PROVIDER, deliveryId, event })
    .onConflictDoNothing()
    .returning({ id: webhookDeliveries.id });
  if (!claimed) return { status: "duplicate" };

  try {
    return await processWebhook(event, payload);
  } catch (error) {
    await db.delete(webhookDeliveries).where(eq(webhookDeliveries.id, claimed.id));
    throw error;
  }
}

async function processWebhook(event: string, payload: Payload): Promise<WebhookOutcome> {
  const installationId = payload.installation?.id ? String(payload.installation.id) : null;
  if (!installationId) return { status: "ignored", reason: "no installation" };

  const [installation] = await db
    .select()
    .from(githubInstallations)
    .where(eq(githubInstallations.installationId, installationId))
    .limit(1);
  // Not linked yet: the setup callback links it and syncs repositories.
  if (!installation) return { status: "ignored", reason: "installation not linked" };

  if (event === "installation") {
    if (payload.action === "deleted") {
      await db.delete(githubInstallations).where(eq(githubInstallations.id, installation.id));
      await audit(installation.workspaceId, null, "github.uninstalled", "github_installation", installation.id, {});
    } else if (payload.action === "suspend" || payload.action === "unsuspend") {
      await db
        .update(githubInstallations)
        .set({ isActive: payload.action === "unsuspend", updatedAt: new Date() })
        .where(eq(githubInstallations.id, installation.id));
    }
    return { status: "processed" };
  }

  if (event === "installation_repositories") {
    await upsertRepos(installation.workspaceId, installation.id, payload.repositories_added ?? []);
    const removed = (payload.repositories_removed ?? []).map((r: { id: number }) => String(r.id));
    if (removed.length) {
      await db
        .delete(trackedRepositories)
        .where(and(eq(trackedRepositories.installationId, installation.id), inArray(trackedRepositories.githubRepoId, removed)));
    }
    if (payload.repository_selection) {
      await db
        .update(githubInstallations)
        .set({ repositorySelection: payload.repository_selection, updatedAt: new Date() })
        .where(eq(githubInstallations.id, installation.id));
    }
    return { status: "processed" };
  }

  if (!installation.isActive) return { status: "ignored", reason: "installation suspended" };
  const repo = payload.repository;
  if (!repo?.id) return { status: "ignored", reason: "no repository" };

  const [tracked] = await db
    .select()
    .from(trackedRepositories)
    .where(and(eq(trackedRepositories.githubRepoId, String(repo.id)), eq(trackedRepositories.installationId, installation.id)))
    .limit(1);
  if (!tracked?.isActive) return { status: "ignored", reason: "repository not tracked" };
  if (repo.full_name && repo.full_name !== tracked.fullName) {
    const [owner = tracked.owner, name = tracked.name] = String(repo.full_name).split("/");
    await db.update(trackedRepositories).set({ fullName: repo.full_name, owner, name }).where(eq(trackedRepositories.id, tracked.id));
  }

  const activities = normalizeEvent(event, payload);
  if (activities.length === 0) return { status: "ignored", reason: `unsupported ${event}.${payload.action ?? ""}` };

  const logins = await loginMap(installation.workspaceId);
  const inserted = await db
    .insert(activityEvents)
    .values(
      activities.map((a) => ({
        workspaceId: installation.workspaceId,
        employeeId: a.actorLogin ? (logins.get(a.actorLogin.toLowerCase()) ?? null) : null,
        provider: PROVIDER,
        type: a.type,
        externalId: a.externalId,
        actorLogin: a.actorLogin,
        repository: repo.full_name ?? tracked.fullName,
        title: a.title,
        url: a.url,
        metadata: a.metadata,
        occurredAt: a.occurredAt,
      })),
    )
    .onConflictDoNothing()
    .returning({ id: activityEvents.id });
  logger.info({ workspaceId: installation.workspaceId, event, stored: inserted.length }, "GitHub activity stored");
  return { status: "processed", stored: inserted.length };
}

// ---- Timeline ----

export async function listActivity(
  workspaceId: string,
  filters: { employeeId?: string; repository?: string; before?: Date; limit?: number } = {},
) {
  const conditions = [eq(activityEvents.workspaceId, workspaceId), eq(activityEvents.provider, PROVIDER)];
  if (filters.employeeId) conditions.push(eq(activityEvents.employeeId, filters.employeeId));
  if (filters.repository) conditions.push(eq(activityEvents.repository, filters.repository));
  if (filters.before) conditions.push(lt(activityEvents.occurredAt, filters.before));
  return db
    .select({
      id: activityEvents.id,
      type: activityEvents.type,
      actorLogin: activityEvents.actorLogin,
      employeeId: activityEvents.employeeId,
      employeeName: employees.name,
      repository: activityEvents.repository,
      title: activityEvents.title,
      url: activityEvents.url,
      metadata: activityEvents.metadata,
      occurredAt: activityEvents.occurredAt,
    })
    .from(activityEvents)
    .leftJoin(employees, eq(activityEvents.employeeId, employees.id))
    .where(and(...conditions))
    .orderBy(desc(activityEvents.occurredAt))
    .limit(Math.min(filters.limit ?? 50, 200));
}

/** Per-employee counts since `since`: observed activity, not a ranking. */
export async function summarizeActivity(workspaceId: string, since: Date) {
  const rows = await db
    .select({
      employeeId: activityEvents.employeeId,
      employeeName: employees.name,
      type: activityEvents.type,
      count: sql<number>`count(*)::int`,
    })
    .from(activityEvents)
    .innerJoin(employees, eq(activityEvents.employeeId, employees.id))
    .where(
      and(
        eq(activityEvents.workspaceId, workspaceId),
        eq(activityEvents.provider, PROVIDER),
        gte(activityEvents.occurredAt, since),
      ),
    )
    .groupBy(activityEvents.employeeId, employees.name, activityEvents.type)
    .orderBy(employees.name);

  const byEmployee = new Map<string, { employeeId: string; employeeName: string; counts: Record<string, number> }>();
  for (const row of rows) {
    const entry = byEmployee.get(row.employeeId!) ?? { employeeId: row.employeeId!, employeeName: row.employeeName, counts: {} };
    entry.counts[row.type] = row.count;
    byEmployee.set(row.employeeId!, entry);
  }
  return [...byEmployee.values()];
}
