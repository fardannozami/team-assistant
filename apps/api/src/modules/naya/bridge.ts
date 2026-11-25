import { HttpError } from "../../lib/http-error.js";

// Client for hermes-bridge (apps/hermes-bridge), which runs inside the Hermes container and
// wraps the `hermes` CLI: Kanban, agent states, usage and cron. Roles are checked here, in the
// API; the bridge trusts its token.

const bridgeUrl = () => (process.env.HERMES_BRIDGE_URL ?? "").replace(/\/+$/, "");
const READ_TIMEOUT_MS = 15_000;
const WRITE_TIMEOUT_MS = 30_000;

export const hermesConfigured = () => Boolean(bridgeUrl() && process.env.BRIDGE_TOKEN);

export type Actor = { id: string; name: string; role: string | null };

async function send(method: "GET" | "POST", path: string, body?: unknown): Promise<Response> {
  if (!hermesConfigured()) throw new HttpError(503, "Hermes belum terhubung (HERMES_BRIDGE_URL dan BRIDGE_TOKEN).");
  let response: Response;
  try {
    response = await fetch(`${bridgeUrl()}${path}`, {
      method,
      headers: { authorization: `Bearer ${process.env.BRIDGE_TOKEN}`, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(method === "GET" ? READ_TIMEOUT_MS : WRITE_TIMEOUT_MS),
    });
  } catch {
    throw new HttpError(503, "Hermes tidak bisa dihubungi. Apakah container hermes jalan?");
  }
  if (!response.ok) {
    const data = (await response.json().catch(() => undefined)) as { error?: string } | undefined;
    // A file too large to download (413) reaches the browser as a plain bad request.
    const status = response.status === 413 ? 400 : [400, 403, 404, 409].includes(response.status) ? (response.status as 400 | 403 | 404 | 409) : 503;
    throw new HttpError(status, data?.error ?? `Hermes menjawab HTTP ${response.status}.`);
  }
  return response;
}

async function call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  return (await (await send(method, path, body)).json().catch(() => undefined)) as T;
}

const query = (params: Record<string, string | undefined>) => {
  const search = new URLSearchParams(Object.entries(params).filter(([, v]) => v) as [string, string][]).toString();
  return search ? `?${search}` : "";
};

export const bridge = {
  runtime: (fresh?: boolean) => call<Record<string, unknown>>("GET", `/runtime${query({ fresh: fresh ? "1" : undefined })}`),
  office: (fresh?: boolean) => call<Record<string, unknown>>("GET", `/office${query({ fresh: fresh ? "1" : undefined })}`),
  tasks: (fresh?: boolean) => call<Record<string, unknown>>("GET", `/tasks${query({ fresh: fresh ? "1" : undefined })}`),
  task: (id: string, board?: string) => call<Record<string, unknown>>("GET", `/tasks/${encodeURIComponent(id)}${query({ board })}`),
  attachments: (id: string, board?: string) => call<{ attachments: Record<string, unknown>[] }>("GET", `/tasks/${encodeURIComponent(id)}/attachments${query({ board })}`),
  /** The bridge's response as is, so the file streams through with its type and name. */
  attachment: (id: string, attachmentId: string, board?: string) => send("GET", `/tasks/${encodeURIComponent(id)}/attachments/${encodeURIComponent(attachmentId)}${query({ board })}`),
  usage: (days: number) => call<Record<string, unknown>>("GET", `/usage${query({ days: String(days) })}`),
  calendar: () => call<Record<string, unknown>>("GET", "/calendar"),
  dashboard: (fresh?: boolean) => call<Record<string, unknown>>("GET", `/dashboard${query({ fresh: fresh ? "1" : undefined })}`),
  activity: (fresh?: boolean) => call<Record<string, unknown>>("GET", `/activity${query({ fresh: fresh ? "1" : undefined })}`),
  channels: (fresh?: boolean) => call<Record<string, unknown>>("GET", `/channels${query({ fresh: fresh ? "1" : undefined })}`),
  instruct: (input: Record<string, unknown>, actor: Actor) => call<{ id: string; board?: string }>("POST", "/tasks", { ...input, actor }),
  review: (id: string, action: string, input: { note?: string; board?: string }, actor: Actor) =>
    call<{ ok: true; assignee: string | null; status: string }>("POST", `/tasks/${encodeURIComponent(id)}/${action}`, { ...input, actor }),
  presence: (agent: string, forMs: number) => call<{ ok: true }>("POST", "/presence", { agent, forMs }).catch(() => undefined),
};
