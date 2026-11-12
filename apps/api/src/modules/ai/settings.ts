import { isIP } from "node:net";
import { eq } from "drizzle-orm";
import { createDbClient, workspaceAiSettings } from "@repo/database";
import { audit } from "../auth/index.js";
import { HttpError } from "../../lib/http-error.js";
import { decryptSecret, encryptSecret } from "../../lib/secrets.js";
import { AiProviderError, chatWithTools, type AiConfig } from "./client.js";

const db = createDbClient(
  process.env.DATABASE_URL ??
    "postgres://teamassistant:teamassistant@localhost:5432/teamassistant",
);

type ModelOption = { id: string; note: string };

/**
 * OpenAI-compatible endpoints offered in the settings form. `models` lists
 * free-tier models with tool calling (the bot needs it), taken from each
 * provider's docs as of Nov 2026; providers change these often, so any model
 * id can still be typed in.
 */
export const AI_PROVIDERS: Record<AiProvider, { baseUrl: string; model: string; models: ModelOption[] }> = {
  gemini: {
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    model: "gemini-3.5-flash-lite",
    models: [
      { id: "gemini-3.5-flash-lite", note: "Paling hemat kuota" },
      { id: "gemini-3.6-flash", note: "Lebih pintar" },
      { id: "gemini-3.8-flash", note: "Terbaru; data free tier dipakai Google" },
    ],
  },
  groq: {
    baseUrl: "https://api.groq.com/openai/v1",
    model: "openai/gpt-oss-20b",
    models: [
      { id: "openai/gpt-oss-20b", note: "Cepat · 30/menit, 1.000/hari" },
      { id: "openai/gpt-oss-120b", note: "Lebih pintar · 30/menit, 1.000/hari" },
      { id: "qwen/qwen3.8-27b", note: "Preview · bisa dihentikan sewaktu-waktu" },
    ],
  },
  openai: { baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini", models: [] },
  openrouter: { baseUrl: "https://openrouter.ai/api/v1", model: "google/gemini-3.5-flash-lite", models: [] },
  custom: { baseUrl: "", model: "", models: [] },
};

export type AiProvider = "gemini" | "groq" | "openai" | "openrouter" | "custom";

// The server's own AI_API_KEY is only used for workspaces without a key when
// explicitly allowed, so sign-ups can't spend the operator's quota.
const SHARED_KEY_FALLBACK = process.env.AI_SHARED_KEY_FALLBACK === "true";

function sharedConfig(): AiConfig | null {
  if (!SHARED_KEY_FALLBACK || !process.env.AI_API_KEY) return null;
  return {
    baseUrl: process.env.AI_BASE_URL ?? AI_PROVIDERS.openai.baseUrl,
    apiKey: process.env.AI_API_KEY,
    model: process.env.AI_MODEL ?? AI_PROVIDERS.openai.model,
  };
}

/** The AI endpoint a workspace's messages go to, or null when it has none. */
export async function resolveAiConfig(workspaceId: string): Promise<AiConfig | null> {
  const [row] = await db
    .select()
    .from(workspaceAiSettings)
    .where(eq(workspaceAiSettings.workspaceId, workspaceId))
    .limit(1);
  if (!row) return sharedConfig();
  try {
    return { baseUrl: row.baseUrl, model: row.model, apiKey: await decryptSecret(row.apiKey) };
  } catch {
    // ENCRYPTION_KEY changed since the key was saved; admins must re-enter it.
    return null;
  }
}

/** Settings as shown to admins; never includes the key itself. */
export async function getAiSettings(workspaceId: string) {
  const [row] = await db
    .select()
    .from(workspaceAiSettings)
    .where(eq(workspaceAiSettings.workspaceId, workspaceId))
    .limit(1);
  return {
    configured: Boolean(row),
    provider: (row?.provider ?? null) as AiProvider | null,
    baseUrl: row?.baseUrl ?? null,
    model: row?.model ?? null,
    apiKeyHint: row?.apiKeyHint ?? null,
    updatedAt: row?.updatedAt ?? null,
    sharedKeyAvailable: !row && Boolean(sharedConfig()),
    providers: AI_PROVIDERS,
  };
}

export type SaveAiSettingsInput = {
  provider?: string;
  baseUrl?: string;
  model?: string;
  apiKey?: string;
};

/** Custom endpoints must be public https URLs: the server fetches them. */
function validateBaseUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new HttpError(400, "Base URL tidak valid.");
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (url.protocol !== "https:" || host === "localhost" || host.endsWith(".local") || isIP(host)) {
    throw new HttpError(400, "Base URL harus berupa alamat https publik.");
  }
  return url.toString().replace(/\/+$/, "");
}

function providerMessage(error: AiProviderError): string {
  let detail = "";
  try {
    const body = JSON.parse(error.detail);
    const first = Array.isArray(body) ? body[0] : body;
    detail = String(first?.error?.message ?? "").slice(0, 200);
  } catch {
    // Non-JSON body: fall back to the status alone.
  }
  const reason =
    error.isKeyRejected
      ? "API key ditolak oleh penyedia."
      : error.status === 404
        ? "Model atau base URL tidak ditemukan."
        : error.status === 429
          ? "Kuota atau batas permintaan API key ini habis."
          : `Penyedia AI mengembalikan error ${error.status}.`;
  return detail ? `${reason} (${detail})` : reason;
}

/**
 * Tests the key with a tiny request, then stores it encrypted. A rate-limited
 * key (429) is still saved, since quota usually comes back on its own.
 */
export async function saveAiSettings(workspaceId: string, input: SaveAiSettingsInput, actorId: string | null) {
  const provider = (input.provider ?? "") as AiProvider;
  const preset = Object.hasOwn(AI_PROVIDERS, provider) ? AI_PROVIDERS[provider] : undefined;
  if (!preset) throw new HttpError(400, "Pilih penyedia AI.");

  const [existing] = await db
    .select()
    .from(workspaceAiSettings)
    .where(eq(workspaceAiSettings.workspaceId, workspaceId))
    .limit(1);

  const baseUrl = validateBaseUrl(provider === "custom" ? (input.baseUrl ?? "") : preset.baseUrl);
  const model = (input.model ?? "").trim() || preset.model;
  if (!model) throw new HttpError(400, "Isi nama model.");

  const newKey = (input.apiKey ?? "").trim();
  // Keeping the stored key is only safe while it goes to the same endpoint.
  if (!newKey && (!existing || existing.baseUrl !== baseUrl)) throw new HttpError(400, "Masukkan API key.");
  const apiKey = newKey || (await decryptSecret(existing!.apiKey));

  let warning: string | null = null;
  try {
    await chatWithTools({ baseUrl, apiKey, model }, [{ role: "user", content: "Reply with OK." }], []);
  } catch (error) {
    if (!(error instanceof AiProviderError)) throw new HttpError(400, "Penyedia AI tidak dapat dihubungi.");
    if (error.status !== 429) throw new HttpError(400, providerMessage(error));
    warning = providerMessage(error);
  }

  const values = {
    provider,
    baseUrl,
    model,
    apiKey: await encryptSecret(apiKey),
    apiKeyHint: apiKey.slice(-4),
    updatedBy: actorId,
    updatedAt: new Date(),
  };
  await db
    .insert(workspaceAiSettings)
    .values({ workspaceId, ...values })
    .onConflictDoUpdate({ target: workspaceAiSettings.workspaceId, set: values });
  await audit(workspaceId, actorId, "ai_settings.update", "workspace_ai_settings", workspaceId, {
    provider,
    model,
    keyChanged: Boolean(newKey),
  });
  return { settings: await getAiSettings(workspaceId), warning };
}

export async function deleteAiSettings(workspaceId: string, actorId: string | null) {
  await db.delete(workspaceAiSettings).where(eq(workspaceAiSettings.workspaceId, workspaceId));
  await audit(workspaceId, actorId, "ai_settings.delete", "workspace_ai_settings", workspaceId);
  return getAiSettings(workspaceId);
}
