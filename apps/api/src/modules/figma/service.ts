import { timingSafeEqual } from "node:crypto";
import {
  activityEvents,
  createDbClient,
  employeeIntegrations,
  employees,
  figmaConnections,
  trackedFigmaFiles,
} from "@repo/database";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import pino from "pino";
import { audit } from "../auth/index.js";
import { HttpError } from "../../lib/http-error.js";
import { decryptSecret, encryptSecret } from "../../lib/secrets.js";
import {
  asHttpError,
  createFileWebhooks,
  deleteWebhooks,
  figmaErrorMessage,
  getFileInfo,
  getMe,
  listComments,
  listVersions,
} from "./client.js";
import { commentActivity, parseFileKey, versionActivity, webhookActivity, type FigmaActivity } from "./events.js";

const logger = pino({ level: process.env.LOG_LEVEL ?? "info" });

const db = createDbClient(
  process.env.DATABASE_URL ??
    "postgres://teamassistant:teamassistant@localhost:5432/teamassistant",
);

const PROVIDER = "figma";
// Polling looks this far back; older history is not imported.
const LOOKBACK_DAYS = 30;

/** Where Figma posts webhooks; webhooks stay off without a public API URL. */
export function webhookEndpoint(): string | null {
  const base = process.env.PUBLIC_API_URL?.replace(/\/$/, "");
  return base ? `${base}/figma/webhook` : null;
}

async function getConnection(workspaceId: string) {
  const [row] = await db.select().from(figmaConnections).where(eq(figmaConnections.workspaceId, workspaceId)).limit(1);
  return row ?? null;
}

async function requireToken(workspaceId: string) {
  const connection = await getConnection(workspaceId);
  if (!connection) throw new HttpError(400, "Figma belum terhubung.");
  try {
    return { connection, token: await decryptSecret(connection.accessToken) };
  } catch {
    throw new HttpError(400, "Token Figma tidak bisa dibaca (ENCRYPTION_KEY berubah). Hubungkan ulang Figma.");
  }
}

// ---- Connection (FIG-001) ----

export async function getFigmaStatus(workspaceId: string) {
  const connection = await getConnection(workspaceId);
  const files = await db
    .select({
      id: trackedFigmaFiles.id,
      fileKey: trackedFigmaFiles.fileKey,
      name: trackedFigmaFiles.name,
      editorType: trackedFigmaFiles.editorType,
      lastModified: trackedFigmaFiles.lastModified,
      isActive: trackedFigmaFiles.isActive,
      webhooks: sql<number>`cardinality(${trackedFigmaFiles.webhookIds})`.mapWith(Number),
    })
    .from(trackedFigmaFiles)
    .where(eq(trackedFigmaFiles.workspaceId, workspaceId))
    .orderBy(trackedFigmaFiles.name);
  return {
    connected: !!connection,
    account: connection
      ? { id: connection.accountId, handle: connection.accountHandle, email: connection.accountEmail }
      : null,
    tokenHint: connection?.tokenHint ?? null,
    lastSyncedAt: connection?.lastSyncedAt ?? null,
    lastSyncError: connection?.lastSyncError ?? null,
    webhooksEnabled: !!webhookEndpoint(),
    files,
  };
}

/** Checks the token with Figma, then stores it encrypted. */
export async function connectFigma(workspaceId: string, token: string, actorId: string | null) {
  let me;
  try {
    me = await getMe(token);
  } catch (error) {
    throw asHttpError(error);
  }
  const existing = await getConnection(workspaceId);
  const values = {
    accessToken: await encryptSecret(token),
    tokenHint: token.slice(-4),
    accountId: String(me.id),
    accountHandle: me.handle ?? null,
    accountEmail: me.email ?? null,
    lastSyncError: null,
    updatedAt: new Date(),
  };
  if (existing) {
    // The passcode stays: webhooks already registered keep matching.
    await db.update(figmaConnections).set(values).where(eq(figmaConnections.id, existing.id));
  } else {
    const passcode = Buffer.from(crypto.getRandomValues(new Uint8Array(24))).toString("base64url");
    await db
      .insert(figmaConnections)
      .values({ workspaceId, ...values, webhookPasscode: await encryptSecret(passcode), createdBy: actorId });
  }
  await audit(workspaceId, actorId, "figma.connect", "figma_connection", workspaceId, { account: me.handle });
  return getFigmaStatus(workspaceId);
}

/** Removes the token, the tracked files and their webhooks. Stored activity stays. */
export async function disconnectFigma(workspaceId: string, actorId: string | null) {
  const connection = await getConnection(workspaceId);
  if (!connection) return;
  const files = await db.select().from(trackedFigmaFiles).where(eq(trackedFigmaFiles.workspaceId, workspaceId));
  const token = await decryptSecret(connection.accessToken).catch(() => null);
  if (token) await deleteWebhooks(token, files.flatMap((f) => f.webhookIds));
  await db.delete(trackedFigmaFiles).where(eq(trackedFigmaFiles.workspaceId, workspaceId));
  await db.delete(figmaConnections).where(eq(figmaConnections.id, connection.id));
  await audit(workspaceId, actorId, "figma.disconnect", "figma_connection", workspaceId, { account: connection.accountHandle });
}

// ---- Files (FIG-003) ----

export async function addFigmaFile(workspaceId: string, input: string, actorId: string | null) {
  const fileKey = parseFileKey(input);
  if (!fileKey) throw new HttpError(400, "Link file Figma tidak valid. Salin link dari tombol Share di Figma.");
  const { connection, token } = await requireToken(workspaceId);

  let info;
  try {
    info = await getFileInfo(token, fileKey);
  } catch (error) {
    throw asHttpError(error);
  }
  const [row] = await db
    .insert(trackedFigmaFiles)
    .values({
      workspaceId,
      fileKey,
      name: info.name,
      editorType: info.editorType ?? null,
      lastModified: new Date(info.lastModified),
    })
    .onConflictDoNothing()
    .returning();
  if (!row) throw new HttpError(409, `"${info.name}" sudah dipantau.`);

  // Webhooks are a bonus (they need a paid Figma plan); hourly polling covers the rest.
  const endpoint = webhookEndpoint();
  let webhookError: string | null = null;
  if (endpoint) {
    try {
      const ids = await createFileWebhooks(token, fileKey, endpoint, await decryptSecret(connection.webhookPasscode));
      await db.update(trackedFigmaFiles).set({ webhookIds: ids }).where(eq(trackedFigmaFiles.id, row.id));
    } catch (error) {
      webhookError = figmaErrorMessage(error);
      logger.warn({ err: error, workspaceId, fileKey }, "Figma webhook registration failed");
    }
  }

  await audit(workspaceId, actorId, "figma.file.track", "tracked_figma_file", row.id, { fileKey, name: info.name });
  const stored = await syncFile(workspaceId, token, { ...row, name: info.name }).catch(() => 0);
  return { file: row, stored, webhookError };
}

export async function setFigmaFileTracked(workspaceId: string, id: string, isActive: boolean, actorId: string | null) {
  const [row] = await db
    .update(trackedFigmaFiles)
    .set({ isActive })
    .where(and(eq(trackedFigmaFiles.id, id), eq(trackedFigmaFiles.workspaceId, workspaceId)))
    .returning();
  if (!row) throw new HttpError(404, "File Figma tidak ditemukan");
  await audit(workspaceId, actorId, isActive ? "figma.file.track" : "figma.file.untrack", "tracked_figma_file", id, {
    name: row.name,
  });
  return row;
}

export async function removeFigmaFile(workspaceId: string, id: string, actorId: string | null) {
  const [row] = await db
    .delete(trackedFigmaFiles)
    .where(and(eq(trackedFigmaFiles.id, id), eq(trackedFigmaFiles.workspaceId, workspaceId)))
    .returning();
  if (!row) throw new HttpError(404, "File Figma tidak ditemukan");
  if (row.webhookIds.length) {
    const { token } = await requireToken(workspaceId).catch(() => ({ token: null }));
    if (token) await deleteWebhooks(token, row.webhookIds);
  }
  await audit(workspaceId, actorId, "figma.file.remove", "tracked_figma_file", id, { name: row.name });
}

// ---- Sync: versions & comments (FIG-004, FIG-005) ----

type TrackedFile = typeof trackedFigmaFiles.$inferSelect;

async function syncFile(workspaceId: string, token: string, file: TrackedFile) {
  const info = await getFileInfo(token, file.fileKey);
  await db
    .update(trackedFigmaFiles)
    .set({ name: info.name, editorType: info.editorType ?? file.editorType, lastModified: new Date(info.lastModified) })
    .where(eq(trackedFigmaFiles.id, file.id));

  const since = Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000;
  const [versions, comments] = await Promise.all([listVersions(token, file.fileKey), listComments(token, file.fileKey)]);
  const activities = [
    ...versions.map((v) => versionActivity(file.fileKey, v)),
    ...comments.map((c) => commentActivity(file.fileKey, c)),
  ].filter((a): a is FigmaActivity => !!a && a.occurredAt.getTime() >= since);
  return storeActivities(workspaceId, info.name, activities);
}

/**
 * Pulls every active file's recent versions and comments. One file failing
 * (no access any more, say) doesn't stop the rest; the last error is shown
 * in Settings.
 */
export async function syncFigma(workspaceId: string) {
  const connection = await getConnection(workspaceId);
  if (!connection) return { skipped: true, reason: "not connected" };
  const { token } = await requireToken(workspaceId);
  const files = await db
    .select()
    .from(trackedFigmaFiles)
    .where(and(eq(trackedFigmaFiles.workspaceId, workspaceId), eq(trackedFigmaFiles.isActive, true)));

  let stored = 0;
  const errors: string[] = [];
  for (const file of files) {
    try {
      stored += await syncFile(workspaceId, token, file);
    } catch (error) {
      logger.warn({ err: error, workspaceId, fileKey: file.fileKey }, "Figma sync failed");
      errors.push(`${file.name}: ${figmaErrorMessage(error)}`);
    }
  }
  await db
    .update(figmaConnections)
    .set({ lastSyncedAt: new Date(), lastSyncError: errors.join("\n") || null })
    .where(eq(figmaConnections.id, connection.id));
  return { files: files.length, stored, errors };
}

/** Figma user id → employee, from the mappings admins made. */
async function accountMap(workspaceId: string) {
  const rows = await db
    .select({ employeeId: employeeIntegrations.employeeId, figmaId: employeeIntegrations.externalId })
    .from(employeeIntegrations)
    .innerJoin(employees, eq(employeeIntegrations.employeeId, employees.id))
    .where(and(eq(employees.workspaceId, workspaceId), eq(employeeIntegrations.provider, PROVIDER)));
  return new Map(rows.map((r) => [r.figmaId!, r.employeeId]));
}

async function storeActivities(workspaceId: string, fileName: string, activities: FigmaActivity[]) {
  if (!activities.length) return 0;
  const accounts = await accountMap(workspaceId);
  const inserted = await db
    .insert(activityEvents)
    .values(
      activities.map((a) => ({
        workspaceId,
        employeeId: a.actorId ? (accounts.get(a.actorId) ?? null) : null,
        provider: PROVIDER,
        type: a.type,
        externalId: a.externalId,
        actorLogin: a.actorId,
        repository: fileName,
        title: a.title,
        url: a.url,
        metadata: a.metadata,
        occurredAt: a.occurredAt,
      })),
    )
    .onConflictDoNothing()
    .returning({ id: activityEvents.id });
  return inserted.length;
}

// ---- Webhooks (FIG-002) ----

function samePasscode(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export type FigmaWebhookOutcome = { status: "ignored" | "processed" | "unauthorized"; stored?: number; reason?: string };

/**
 * A file can be tracked by several workspaces; the passcode tells which one
 * registered this webhook. Nothing is stored for a passcode that matches none.
 */
export async function handleFigmaWebhook(payload: Record<string, any>): Promise<FigmaWebhookOutcome> {
  const fileKey = typeof payload.file_key === "string" ? payload.file_key : null;
  const passcode = typeof payload.passcode === "string" ? payload.passcode : "";
  if (!passcode) return { status: "unauthorized" };
  if (payload.event_type === "PING" || !fileKey) return { status: "ignored", reason: "ping" };

  const candidates = await db
    .select({ file: trackedFigmaFiles, passcode: figmaConnections.webhookPasscode })
    .from(trackedFigmaFiles)
    .innerJoin(figmaConnections, eq(figmaConnections.workspaceId, trackedFigmaFiles.workspaceId))
    .where(eq(trackedFigmaFiles.fileKey, fileKey));

  for (const { file, passcode: stored } of candidates) {
    const expected = await decryptSecret(stored).catch(() => null);
    if (!expected || !samePasscode(expected, passcode)) continue;
    if (!file.isActive) return { status: "ignored", reason: "file not tracked" };
    const activity = webhookActivity(payload);
    if (!activity) return { status: "ignored", reason: `unsupported ${payload.event_type}` };
    const name = typeof payload.file_name === "string" && payload.file_name ? payload.file_name : file.name;
    return { status: "processed", stored: await storeActivities(file.workspaceId, name, [activity]) };
  }
  return { status: "unauthorized" };
}

// ---- Identity mapping (FIG-006) ----

/**
 * Figma accounts seen in this workspace's activity, plus the connected
 * account, with who they are mapped to. Only accounts Figma identified by id
 * can be mapped.
 */
export async function listFigmaAccounts(workspaceId: string) {
  const seen = await db
    .select({
      figmaId: activityEvents.actorLogin,
      handle: sql<string | null>`(array_agg(${activityEvents.metadata}->>'handle' order by ${activityEvents.occurredAt} desc))[1]`,
      events: sql<number>`count(*)::int`,
      lastSeen: sql<Date>`max(${activityEvents.occurredAt})`,
    })
    .from(activityEvents)
    .where(
      and(
        eq(activityEvents.workspaceId, workspaceId),
        eq(activityEvents.provider, PROVIDER),
        sql`${activityEvents.actorLogin} is not null`,
      ),
    )
    .groupBy(activityEvents.actorLogin);

  const mapped = await db
    .select({ figmaId: employeeIntegrations.externalId, employeeId: employees.id, employeeName: employees.name, metadata: employeeIntegrations.metadata })
    .from(employeeIntegrations)
    .innerJoin(employees, eq(employeeIntegrations.employeeId, employees.id))
    .where(and(eq(employees.workspaceId, workspaceId), eq(employeeIntegrations.provider, PROVIDER)));
  const byId = new Map(mapped.map((m) => [m.figmaId!, m]));

  const accounts = new Map<string, { figmaId: string; handle: string | null; events: number; lastSeen: Date | null }>();
  for (const s of seen) accounts.set(s.figmaId!, { figmaId: s.figmaId!, handle: s.handle, events: s.events, lastSeen: s.lastSeen });
  const connection = await getConnection(workspaceId);
  if (connection && !accounts.has(connection.accountId)) {
    accounts.set(connection.accountId, { figmaId: connection.accountId, handle: connection.accountHandle, events: 0, lastSeen: null });
  }
  for (const m of mapped) {
    if (!accounts.has(m.figmaId!)) {
      const handle = (m.metadata as { handle?: string } | null)?.handle ?? null;
      accounts.set(m.figmaId!, { figmaId: m.figmaId!, handle, events: 0, lastSeen: null });
    }
  }
  return [...accounts.values()]
    .map((a) => ({ ...a, employeeId: byId.get(a.figmaId)?.employeeId ?? null, employeeName: byId.get(a.figmaId)?.employeeName ?? null }))
    .sort((a, b) => (a.handle ?? a.figmaId).localeCompare(b.handle ?? b.figmaId));
}

/**
 * Maps (or unmaps, with null) a Figma account to an employee. Past activity
 * follows: the account's events move to the new employee.
 */
export async function mapFigmaAccount(workspaceId: string, figmaId: string, employeeId: string | null, actorId: string | null) {
  if (!/^[0-9]{1,30}$/.test(figmaId)) throw new HttpError(400, "ID akun Figma tidak valid");
  if (employeeId) {
    const [employee] = await db
      .select({ id: employees.id })
      .from(employees)
      .where(and(eq(employees.id, employeeId), eq(employees.workspaceId, workspaceId)))
      .limit(1);
    if (!employee) throw new HttpError(404, "Anggota tidak ditemukan");
  }
  const [latest] = await db
    .select({ handle: sql<string | null>`${activityEvents.metadata}->>'handle'` })
    .from(activityEvents)
    .where(and(eq(activityEvents.workspaceId, workspaceId), eq(activityEvents.provider, PROVIDER), eq(activityEvents.actorLogin, figmaId)))
    .orderBy(desc(activityEvents.occurredAt))
    .limit(1);
  const connection = await getConnection(workspaceId);
  const handle = latest?.handle ?? (connection?.accountId === figmaId ? connection.accountHandle : null);

  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`figma-account:${workspaceId}`}))`);
    const workspaceEmployees = tx.select({ id: employees.id }).from(employees).where(eq(employees.workspaceId, workspaceId));
    await tx
      .delete(employeeIntegrations)
      .where(
        and(
          eq(employeeIntegrations.provider, PROVIDER),
          eq(employeeIntegrations.externalId, figmaId),
          inArray(employeeIntegrations.employeeId, workspaceEmployees),
        ),
      );
    if (employeeId) {
      await tx.insert(employeeIntegrations).values({ employeeId, provider: PROVIDER, externalId: figmaId, metadata: { handle } });
    }
    await tx
      .update(activityEvents)
      .set({ employeeId })
      .where(and(eq(activityEvents.workspaceId, workspaceId), eq(activityEvents.provider, PROVIDER), eq(activityEvents.actorLogin, figmaId)));
  });
  await audit(workspaceId, actorId, "figma.account.map", "employee", employeeId ?? figmaId, { figmaId, handle });
  return { figmaId, employeeId };
}

// ---- Timeline (FIG-007) ----

export async function listFigmaActivity(workspaceId: string, limit = 50) {
  return db
    .select({
      id: activityEvents.id,
      type: activityEvents.type,
      actorId: activityEvents.actorLogin,
      handle: sql<string | null>`${activityEvents.metadata}->>'handle'`,
      employeeId: activityEvents.employeeId,
      employeeName: employees.name,
      file: activityEvents.repository,
      title: activityEvents.title,
      url: activityEvents.url,
      occurredAt: activityEvents.occurredAt,
    })
    .from(activityEvents)
    .leftJoin(employees, eq(activityEvents.employeeId, employees.id))
    .where(and(eq(activityEvents.workspaceId, workspaceId), eq(activityEvents.provider, PROVIDER)))
    .orderBy(desc(activityEvents.occurredAt))
    .limit(Math.min(Math.max(Math.trunc(limit), 1), 200));
}
