import { HttpError } from "../../lib/http-error.js";

// Chat with a Hermes agent through its OpenAI-compatible API server. One listener serves every
// profile (`gateway.multiplex_profiles`): /v1 for "default", /p/<profile>/v1 for the others,
// each with that profile's own API_SERVER_KEY. The browser gets a simplified SSE stream of
// `delta` (answer text), `tool` (progress), `done` and `error`; reasoning stays out.

const CONNECT_TIMEOUT_MS = 15_000;
/** A whole agent turn, tools included. */
const TURN_TIMEOUT_MS = 10 * 60_000;

export type ChatMessage = { role: "user" | "assistant"; content: string };
export type Speaker = { id: string; name: string; email: string; role: string | null };

export function chatEndpoint(profile: string): string {
  const base = (process.env.HERMES_API_URL ?? "").replace(/\/+$/, "");
  if (!base) throw new HttpError(503, "Hermes belum terhubung (HERMES_API_URL).");
  return profile === "default" ? `${base}/v1` : `${base}/p/${encodeURIComponent(profile)}/v1`;
}

/** Layered on top of the agent's own system prompt, so it knows who is talking. */
export function speakerNote(user: Speaker): string {
  return `Pesan ini datang lewat Naya (kantor tim AI PT Digdaya Inovasi Gemilang) dari ${user.name}${user.role ? `, ${user.role}` : ""} <${user.email}>. Jawab dalam Bahasa Indonesia kecuali diminta lain. Jangan mengirim email, merge kode, atau mempublikasikan konten atas nama Digdaya tanpa persetujuan manusia.`;
}

const SECRETS = /\b(sk-[A-Za-z0-9_-]{12,}|ta_agent_[A-Za-z0-9_-]{8,}|tvly-[A-Za-z0-9_-]{8,}|AIza[0-9A-Za-z_-]{20,}|ghp_[A-Za-z0-9]{20,}|Bearer\s+[A-Za-z0-9._-]{12,})/g;
const redact = (text: string) => text.replace(SECRETS, "[redacted]").slice(0, 200);

type Emit = (event: "delta" | "tool" | "done" | "error", data: Record<string, unknown>) => void;

/** Reads Hermes' SSE stream and passes on answer text and tool progress. */
export async function relayStream(body: ReadableStream<Uint8Array>, emit: Emit): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let event = "message";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    buffer += decoder.decode(value, { stream: true });
    let newline: number;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline).replace(/\r$/, "");
      buffer = buffer.slice(newline + 1);
      if (line === "") { event = "message"; continue; }
      if (line.startsWith(":")) continue;
      if (line.startsWith("event:")) { event = line.slice(6).trim(); continue; }
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (data === "[DONE]") return;
      let payload: Record<string, unknown>;
      try {
        payload = JSON.parse(data) as Record<string, unknown>;
      } catch {
        continue;
      }
      if (event === "hermes.tool.progress") {
        const label = [payload.emoji, payload.label ?? payload.tool ?? payload.name].filter((part) => typeof part === "string" && part).join(" ");
        if (label) emit("tool", { label: redact(label) });
        continue;
      }
      const delta = (payload.choices as { delta?: { content?: unknown } }[] | undefined)?.[0]?.delta;
      if (typeof delta?.content === "string" && delta.content) emit("delta", { text: delta.content });
    }
  }
}

/** Opens the agent's stream and returns the browser's SSE response. */
export async function proxyChat(profile: string, key: string, user: Speaker, messages: ChatMessage[], signal: AbortSignal): Promise<Response> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener("abort", abort);
  const turn = setTimeout(abort, TURN_TIMEOUT_MS);
  const connect = setTimeout(abort, CONNECT_TIMEOUT_MS);
  let upstream: Response;
  try {
    upstream = await fetch(`${chatEndpoint(profile)}/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
        // Long-term memory per person, independent of this conversation.
        "x-hermes-session-key": `naya:user:${user.id}`,
      },
      body: JSON.stringify({ model: "hermes-agent", stream: true, messages: [{ role: "system", content: speakerNote(user) }, ...messages] }),
      signal: controller.signal,
    });
  } catch {
    clearTimeout(turn);
    throw new HttpError(503, "Agent tidak bisa dihubungi. Apakah gateway Hermes dan API server-nya jalan?");
  } finally {
    clearTimeout(connect);
  }
  if (!upstream.ok || !upstream.body) {
    clearTimeout(turn);
    throw new HttpError(503, upstream.status === 401 ? "API key Hermes agent ini ditolak. Periksa di Pengaturan › AI › Agent Naya." : `Agent menjawab HTTP ${upstream.status}.`);
  }
  const body = upstream.body;
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(out) {
      const emit: Emit = (event, data) => out.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      try {
        await relayStream(body, emit);
        emit("done", {});
      } catch {
        if (!controller.signal.aborted) emit("error", { error: "Jawaban agent terputus." });
      } finally {
        clearTimeout(turn);
        signal.removeEventListener("abort", abort);
        out.close();
      }
    },
    cancel() {
      controller.abort();
    },
  });
  return new Response(stream, {
    headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no" },
  });
}
