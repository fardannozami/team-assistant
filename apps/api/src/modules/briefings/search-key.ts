import { agencyProfiles, createDbClient } from "@repo/database";
import { eq } from "drizzle-orm";
import { audit } from "../auth/index.js";
import { HttpError } from "../../lib/http-error.js";
import { decryptSecret, encryptSecret } from "../../lib/secrets.js";

// Bring-your-own Tavily key: the sales crew's web search (public Upwork, LinkedIn and
// Freelancer.com posts, RFPs). Without one, sales still runs on the free job boards and tenders.

const db = createDbClient(
  process.env.DATABASE_URL ??
    "postgres://teamassistant:teamassistant@localhost:5432/teamassistant",
);

export const TAVILY_KEY_URL = "https://app.tavily.com/home";

// The server's own key is only for workspaces without one, and only when allowed,
// so sign-ups can't spend the operator's credits (as with AI_SHARED_KEY_FALLBACK).
function sharedKey(): string | null {
  return process.env.TAVILY_SHARED_KEY_FALLBACK === "true" ? process.env.TAVILY_API_KEY || null : null;
}

async function profileRow(workspaceId: string) {
  const [row] = await db
    .select({ id: agencyProfiles.id, key: agencyProfiles.searchApiKey, hint: agencyProfiles.searchApiKeyHint })
    .from(agencyProfiles)
    .where(eq(agencyProfiles.workspaceId, workspaceId))
    .limit(1);
  return row ?? null;
}

/** As shown to admins; never includes the key itself. */
export async function getSearchKeyStatus(workspaceId: string) {
  const row = await profileRow(workspaceId);
  return {
    configured: Boolean(row?.key),
    apiKeyHint: row?.key ? row.hint : null,
    sharedKeyAvailable: !row?.key && Boolean(sharedKey()),
    keyUrl: TAVILY_KEY_URL,
  };
}

/** The key a sales run searches with, or null to skip web search. */
export async function resolveSearchKey(workspaceId: string): Promise<string | null> {
  const row = await profileRow(workspaceId);
  if (!row?.key) return sharedKey();
  try {
    return await decryptSecret(row.key);
  } catch {
    // ENCRYPTION_KEY changed since the key was saved; admins must re-enter it.
    return null;
  }
}

/** One tiny search (1 credit). Returns a warning for a valid key that is out of credits. */
async function testKey(apiKey: string): Promise<string | null> {
  let response: Response;
  try {
    response = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ query: "web design agency", max_results: 1 }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new HttpError(400, "Tavily tidak dapat dihubungi. Coba lagi sebentar lagi.");
  }
  if (response.ok) return null;
  if (response.status === 401 || response.status === 403) throw new HttpError(400, "API key ditolak oleh Tavily.");
  // 429: rate limit; 432/433: plan or pay-as-you-go limit reached. The key itself is fine.
  if (response.status === 429 || response.status === 432 || response.status === 433) {
    return "Kuota atau batas permintaan key Tavily ini sedang habis.";
  }
  throw new HttpError(400, `Tavily mengembalikan error ${response.status}.`);
}

export async function saveSearchKey(workspaceId: string, rawKey: string, actorId: string | null) {
  const apiKey = rawKey.trim();
  const warning = await testKey(apiKey);
  const values = { searchApiKey: await encryptSecret(apiKey), searchApiKeyHint: apiKey.slice(-4), updatedAt: new Date() };
  await db
    .insert(agencyProfiles)
    .values({ workspaceId, ...values })
    .onConflictDoUpdate({ target: agencyProfiles.workspaceId, set: values });
  await audit(workspaceId, actorId, "briefings.search_key.update", "agency_profile", workspaceId, { provider: "tavily" });
  return { status: await getSearchKeyStatus(workspaceId), warning };
}

export async function deleteSearchKey(workspaceId: string, actorId: string | null) {
  await db
    .update(agencyProfiles)
    .set({ searchApiKey: null, searchApiKeyHint: null, updatedAt: new Date() })
    .where(eq(agencyProfiles.workspaceId, workspaceId));
  await audit(workspaceId, actorId, "briefings.search_key.delete", "agency_profile", workspaceId, { provider: "tavily" });
  return getSearchKeyStatus(workspaceId);
}
