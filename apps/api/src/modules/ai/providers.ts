import { isIP } from "node:net";
import { HttpError } from "../../lib/http-error.js";
import { assertPublicHost } from "../../lib/net.js";
import type { AiProviderError } from "./client.js";

type ModelOption = { id: string; note: string };

export type AiProvider = "gemini" | "groq" | "openai" | "openrouter" | "custom";

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

/** A short Indonesian explanation of why the provider refused a request. */
export function providerMessage(error: AiProviderError): string {
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
 * Custom endpoints must be public https URLs: the server fetches them. The
 * name has to resolve to public addresses too ("127.0.0.1.nip.io" is not a
 * literal IP but still points at the server itself).
 */
export async function validateBaseUrl(raw: string, custom: boolean): Promise<string> {
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
  // Preset URLs are ours; only an admin-typed one needs resolving.
  if (custom) {
    try {
      await assertPublicHost(host);
    } catch {
      throw new HttpError(400, "Base URL harus berupa alamat https publik.");
    }
  }
  return url.toString().replace(/\/+$/, "");
}
