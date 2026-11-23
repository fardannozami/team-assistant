import { agencyProfiles, briefingItems, briefingRuns, createDbClient, employees, projects } from "@repo/database";
import {
  BRIEFING_AUDIENCES,
  briefingAudienceFor,
  type AgencyProfileInput,
  type BriefingAudience,
} from "@repo/shared";
import { and, desc, eq, gte, inArray, isNull, ne, or } from "drizzle-orm";
import pino from "pino";
import { audit } from "../auth/index.js";
import { HttpError } from "../../lib/http-error.js";
import { secretEnv } from "../../lib/env.js";
import { resolveAiConfig } from "../ai/settings.js";
import { listEmployees } from "../employees/service.js";
import { standupToday } from "../standups/engine.js";
import { excludedDay, jidFor, NOT_CONNECTED, notConnected, senderFor, type SendFn } from "../standups/service/delivery.js";
import { formatBriefing, type AgentItem } from "./format.js";
import { resolveSearchKey } from "./search-key.js";

const logger = pino({ level: process.env.LOG_LEVEL ?? "info" });

const db = createDbClient(
  process.env.DATABASE_URL ??
    "postgres://teamassistant:teamassistant@localhost:5432/teamassistant",
);

const AGENTS_URL = (process.env.AGENTS_URL ?? "http://localhost:8100").replace(/\/$/, "");
const INTERNAL_API_TOKEN = secretEnv("INTERNAL_API_TOKEN", "dev-internal-token");
// A crew makes a few LLM calls over ~60 candidates; free tiers can be slow.
const AGENTS_TIMEOUT_MS = Number(process.env.AGENTS_TIMEOUT_MS ?? 300_000);
// Recently offered links the crews must not offer again.
const SEEN_URL_LIMIT = 500;

// Ended projects older than this get no upsell ideas.
const UPSELL_LOOKBACK_DAYS = 120;

const DEFAULT_PROFILE = {
  isActive: true,
  services: [] as string[],
  keywords: [] as string[],
  excludedKeywords: [] as string[],
  targetCountries: [] as string[],
  minBudgetUsd: null as number | null,
  tendersEnabled: true,
  offsetMinutes: 30,
  itemsPerBriefing: 5,
  salesItemsPerBriefing: 10,
};

/** The profile without the search key: it is read on its own, only by sales runs (search-key.ts). */
export async function getAgencyProfile(workspaceId: string) {
  const [row] = await db.select().from(agencyProfiles).where(eq(agencyProfiles.workspaceId, workspaceId)).limit(1);
  if (!row) return { ...DEFAULT_PROFILE, workspaceId };
  const { searchApiKey: _key, ...profile } = row;
  return profile;
}

export async function saveAgencyProfile(workspaceId: string, input: AgencyProfileInput, actorId: string | null) {
  const values = { ...input, updatedAt: new Date() };
  const [row] = await db
    .insert(agencyProfiles)
    .values({ workspaceId, ...values })
    .onConflictDoUpdate({ target: agencyProfiles.workspaceId, set: values })
    .returning({ id: agencyProfiles.id });
  await audit(workspaceId, actorId, "briefings.profile.update", "agency_profile", row?.id);
  return getAgencyProfile(workspaceId);
}

async function callAgents(body: Record<string, unknown>): Promise<{ items: AgentItem[]; candidates: number; model: string }> {
  let response: Response;
  try {
    response = await fetch(`${AGENTS_URL}/crews/run`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-internal-token": INTERNAL_API_TOKEN },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(AGENTS_TIMEOUT_MS),
    });
  } catch (error) {
    throw new Error(`Agents service unreachable at ${AGENTS_URL}: ${error instanceof Error ? error.message : error}`);
  }
  const json = (await response.json().catch(() => null)) as { detail?: unknown } | null;
  if (!response.ok) throw new Error(`Agents service ${response.status}: ${JSON.stringify(json?.detail ?? json)}`);
  return json as { items: AgentItem[]; candidates: number; model: string };
}

async function recentUrls(workspaceId: string) {
  const rows = await db
    .select({ url: briefingItems.url })
    .from(briefingItems)
    .where(eq(briefingItems.workspaceId, workspaceId))
    .orderBy(desc(briefingItems.createdAt))
    .limit(SEEN_URL_LIMIT);
  return rows.map((r) => r.url);
}

/** Client projects the sales crew may suggest follow-up work for: ongoing, or ended recently. */
async function upsellProjects(workspaceId: string) {
  const since = new Date(Date.now() - UPSELL_LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return db
    .select({
      id: projects.id,
      name: projects.name,
      platform: projects.platform,
      type: projects.type,
      status: projects.status,
      endDate: projects.endDate,
      notes: projects.notes,
    })
    .from(projects)
    .where(
      and(
        eq(projects.workspaceId, workspaceId),
        ne(projects.status, "cancelled"),
        or(eq(projects.status, "ongoing"), isNull(projects.endDate), gte(projects.endDate, since)),
      ),
    )
    .orderBy(desc(projects.updatedAt))
    .limit(20);
}

async function completedRun(workspaceId: string, audience: BriefingAudience, date: string) {
  const [run] = await db
    .select()
    .from(briefingRuns)
    .where(
      and(
        eq(briefingRuns.workspaceId, workspaceId),
        eq(briefingRuns.audience, audience),
        eq(briefingRuns.date, date),
        eq(briefingRuns.status, "completed"),
      ),
    )
    .orderBy(desc(briefingRuns.startedAt))
    .limit(1);
  return run ?? null;
}

type Recipient = { id: string; name: string; phone: string };
type AudienceResult = { audience: BriefingAudience; recipients: number; items?: number; sent?: number; failed?: number; skipped?: string; error?: string };

/** Every message to every recipient, in order; a recipient counts as sent once all of theirs went out. */
async function deliver(send: SendFn, recipients: Recipient[], texts: string[]) {
  let sent = 0;
  let failed = 0;
  for (const r of recipients) {
    try {
      for (const text of texts) await send(jidFor(r.phone), text);
      sent++;
    } catch (error) {
      logger.warn({ err: error, employeeId: r.id }, "Briefing send failed");
      failed++;
    }
  }
  return { sent, failed };
}

async function runAudience(
  workspaceId: string,
  audience: BriefingAudience,
  date: string,
  recipients: Recipient[],
  profile: Awaited<ReturnType<typeof getAgencyProfile>>,
  send: SendFn,
  options: { resend?: boolean; force?: boolean },
): Promise<AudienceResult> {
  const base = { audience, recipients: recipients.length };

  // Once a day per audience; a resend repeats the stored items without spending tokens again.
  const done = options.force ? null : await completedRun(workspaceId, audience, date);
  if (done && !options.resend) return { ...base, skipped: "already sent today (resend: true repeats it, force: true runs again)" };
  if (done) {
    const items = await db.select().from(briefingItems).where(eq(briefingItems.runId, done.id));
    if (items.length === 0) return { ...base, items: 0, sent: 0, failed: 0 };
    const sorted = items.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    const texts = formatBriefing(audience, date, sorted.map((i) => ({ ...i, summary: i.summary ?? "", score: i.score ?? 0 })));
    return { ...base, items: items.length, ...(await deliver(send, recipients, texts)) };
  }

  const ai = await resolveAiConfig(workspaceId);
  if (!ai) return { ...base, skipped: "AI belum diatur untuk workspace ini" };

  const [run] = await db.insert(briefingRuns).values({ workspaceId, audience, date }).returning({ id: briefingRuns.id });
  const runId = run!.id;
  try {
    const result = await callAgents({
      workspaceId,
      audience,
      limit: audience === "sales" ? profile.salesItemsPerBriefing : profile.itemsPerBriefing,
      llm: { baseUrl: ai.baseUrl, apiKey: ai.apiKey, model: ai.model },
      context: { profile, projects: audience === "sales" ? await upsellProjects(workspaceId) : [] },
      seenUrls: await recentUrls(workspaceId),
      ...(audience === "sales" ? { searchKey: await resolveSearchKey(workspaceId) } : {}),
    });

    // The unique (workspace, url) key drops anything a parallel run already stored.
    const stored = result.items.length
      ? await db
          .insert(briefingItems)
          .values(
            result.items.map((i) => ({
              workspaceId,
              runId,
              audience,
              type: i.type,
              title: i.title,
              url: i.url,
              source: i.source,
              summary: i.summary,
              score: i.score,
              country: i.country ?? null,
              budget: i.budget ?? null,
              pitch: i.pitch ?? null,
            })),
          )
          .onConflictDoNothing()
          .returning({ id: briefingItems.id, url: briefingItems.url })
      : [];
    const storedUrls = new Set(stored.map((s) => s.url));
    const items = result.items.filter((i) => storedUrls.has(i.url));

    const delivery = items.length
      ? await deliver(send, recipients, formatBriefing(audience, date, items))
      : { sent: 0, failed: 0 };
    if (delivery.sent > 0) {
      await db.update(briefingItems).set({ status: "sent" }).where(inArray(briefingItems.id, stored.map((s) => s.id)));
    }
    await db
      .update(briefingRuns)
      .set({ status: "completed", model: result.model, candidates: result.candidates, items: items.length, sent: delivery.sent, finishedAt: new Date() })
      .where(eq(briefingRuns.id, runId));
    return { ...base, items: items.length, ...delivery };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ err: error, workspaceId, audience }, "Briefing run failed");
    await db.update(briefingRuns).set({ status: "failed", error: message.slice(0, 2000), finishedAt: new Date() }).where(eq(briefingRuns.id, runId));
    return { ...base, error: message };
  }
}

/** Runs the crews and sends each employee the briefing for their position (employees.lead). */
export async function runBriefings(
  workspaceId: string,
  options: { audience?: BriefingAudience; date?: string; resend?: boolean; force?: boolean; send?: SendFn } = {},
) {
  const date = options.date ?? (await standupToday(workspaceId));
  if (notConnected(workspaceId, options.send)) return { date, ...NOT_CONNECTED, results: [] };
  if ((await excludedDay(workspaceId, date)).excluded) return { date, excluded: true, results: [] };

  const profile = await getAgencyProfile(workspaceId);
  if (!profile.isActive && !options.audience) return { date, disabled: true, results: [] };

  const byAudience = new Map<BriefingAudience, Recipient[]>();
  for (const e of await listEmployees(workspaceId, { active: true })) {
    const audience = briefingAudienceFor(e.lead);
    if (audience) byAudience.set(audience, [...(byAudience.get(audience) ?? []), e]);
  }

  const send = senderFor(workspaceId, options.send);
  const audiences = options.audience ? [options.audience] : [...BRIEFING_AUDIENCES];
  const results: AudienceResult[] = [];
  // One after another: free-tier keys hit per-minute limits when crews run in parallel.
  for (const audience of audiences) {
    const recipients = byAudience.get(audience) ?? [];
    results.push(
      recipients.length
        ? await runAudience(workspaceId, audience, date, recipients, profile, send, options)
        : { audience, recipients: 0, skipped: "no employees with this position" },
    );
  }
  return { date, results };
}

export async function listBriefingItems(
  workspaceId: string,
  filters: { audience?: string; status?: string; limit?: number } = {},
) {
  const conditions = [eq(briefingItems.workspaceId, workspaceId)];
  if (filters.audience) conditions.push(eq(briefingItems.audience, filters.audience));
  if (filters.status) conditions.push(eq(briefingItems.status, filters.status));
  return db
    .select()
    .from(briefingItems)
    .where(and(...conditions))
    .orderBy(desc(briefingItems.createdAt), desc(briefingItems.score))
    .limit(Math.min(filters.limit ?? 100, 500));
}

export async function listBriefingRuns(workspaceId: string, limit = 30) {
  return db
    .select()
    .from(briefingRuns)
    .where(eq(briefingRuns.workspaceId, workspaceId))
    .orderBy(desc(briefingRuns.startedAt))
    .limit(Math.min(limit, 200));
}

export async function updateBriefingItem(
  workspaceId: string,
  id: string,
  input: { status: string; claimedBy?: string | null },
  actorId: string | null,
) {
  if (input.claimedBy) {
    const [employee] = await db
      .select({ id: employees.id })
      .from(employees)
      .where(and(eq(employees.id, input.claimedBy), eq(employees.workspaceId, workspaceId)))
      .limit(1);
    if (!employee) throw new HttpError(400, "Employee not found");
  }
  const [row] = await db
    .update(briefingItems)
    .set({ status: input.status, ...(input.claimedBy !== undefined ? { claimedBy: input.claimedBy } : {}) })
    .where(and(eq(briefingItems.id, id), eq(briefingItems.workspaceId, workspaceId)))
    .returning();
  if (!row) throw new HttpError(404, "Briefing item not found");
  await audit(workspaceId, actorId, "briefings.item.update", "briefing_item", id, { status: input.status });
  return row;
}
