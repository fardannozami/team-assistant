import { HttpError } from "../../lib/http-error.js";

// The ops agent's view of this VPS: status, recent logs and restarts of the app's own compose
// services, through a Docker API proxy (tecnativa/docker-socket-proxy: containers read-only plus
// restarts) that only this API can reach. Nothing else on the host is visible to the agent.

const proxyUrl = (env: NodeJS.ProcessEnv) => (env.DOCKER_PROXY_URL ?? "").replace(/\/+$/, "");
const TIMEOUT_MS = 10_000;
export const MAX_LOG_LINES = 200;

/** Compose services the ops agent may see and restart (OPS_SERVICES). */
export function opsServices(env: NodeJS.ProcessEnv = process.env): string[] {
  return (env.OPS_SERVICES ?? "api,web,worker,agents,naya")
    .split(",")
    .map((name) => name.trim())
    .filter((name) => /^[a-z0-9][a-z0-9_-]{0,63}$/.test(name));
}

type DockerContainer = { Id: string; Names: string[]; State: string; Status: string; Image: string; Labels: Record<string, string> };

async function docker(method: "GET" | "POST", path: string, env: NodeJS.ProcessEnv): Promise<Response> {
  if (!proxyUrl(env)) throw new HttpError(503, "Akses ops belum diatur (DOCKER_PROXY_URL).");
  try {
    return await fetch(`${proxyUrl(env)}${path}`, { method, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    throw new HttpError(503, "Docker proxy tidak bisa dihubungi.");
  }
}

/** The whitelisted services' containers (of OPS_COMPOSE_PROJECT, when set). */
export async function opsContainers(env: NodeJS.ProcessEnv = process.env) {
  const response = await docker("GET", "/containers/json?all=1", env);
  if (!response.ok) throw new HttpError(503, `Docker menjawab HTTP ${response.status}.`);
  const allowed = opsServices(env);
  const project = env.OPS_COMPOSE_PROJECT?.trim();
  return ((await response.json()) as DockerContainer[])
    .map((container) => ({ container, service: container.Labels?.["com.docker.compose.service"] ?? "" }))
    .filter(({ container, service }) => allowed.includes(service) && (!project || container.Labels?.["com.docker.compose.project"] === project));
}

export async function opsStatus(env: NodeJS.ProcessEnv = process.env) {
  return (await opsContainers(env)).map(({ container, service }) => ({
    service,
    state: container.State,
    status: container.Status,
    // The tag only: image names can carry registry paths.
    image: container.Image.split("/").pop() ?? container.Image,
  }));
}

async function containerFor(service: string, env: NodeJS.ProcessEnv) {
  if (!opsServices(env).includes(service)) throw new HttpError(403, `Service "${service}" tidak termasuk OPS_SERVICES.`);
  const found = (await opsContainers(env)).find((item) => item.service === service);
  if (!found) throw new HttpError(404, `Container service "${service}" tidak ditemukan.`);
  return found.container;
}

const SECRET_PATTERNS: [RegExp, string][] = [
  [/\b(sk-[A-Za-z0-9_-]{12,}|ta_agent_[A-Za-z0-9_-]{8,}|ta_login_[A-Za-z0-9_-]{8,}|tvly-[A-Za-z0-9_-]{8,}|AIza[0-9A-Za-z_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|xox[abprs]-[A-Za-z0-9-]{10,})/g, "[redacted]"],
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, "$1 [redacted]"],
  [/\b(eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,})/g, "[redacted-jwt]"],
  [/([a-z][a-z0-9+.-]*:\/\/[^:\s/@]+:)[^@\s/]+@/gi, "$1[redacted]@"],
  [/\b([A-Za-z0-9_]*(?:password|passwd|secret|token|api[_-]?key|private[_-]?key|encryption[_-]?key)[A-Za-z0-9_]*)(\s*[=:]\s*)("[^"]*"|'[^']*'|\S+)/gi, "$1$2[redacted]"],
  [/(\+?62|0)8\d{7,12}\b/g, "[phone]"],
];

/** Secrets, credentials in URLs, JWTs and phone numbers out of a log line. */
export function redactSecrets(line: string): string {
  return SECRET_PATTERNS.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), line).slice(0, 1_000);
}

/** Docker's multiplexed log stream (8-byte frame headers) or plain text for TTY containers. */
export function demuxLogs(buffer: Uint8Array): string {
  const decoder = new TextDecoder();
  if (buffer.length < 8 || ![0, 1, 2].includes(buffer[0]!) || buffer[1] !== 0 || buffer[2] !== 0 || buffer[3] !== 0) return decoder.decode(buffer);
  let text = "";
  let offset = 0;
  while (offset + 8 <= buffer.length) {
    const size = ((buffer[offset + 4]! << 24) | (buffer[offset + 5]! << 16) | (buffer[offset + 6]! << 8) | buffer[offset + 7]!) >>> 0;
    text += decoder.decode(buffer.subarray(offset + 8, offset + 8 + size));
    offset += 8 + size;
  }
  return text;
}

export async function opsLogs(service: string, lines = 100, env: NodeJS.ProcessEnv = process.env): Promise<string[]> {
  const container = await containerFor(service, env);
  const tail = Math.min(Math.max(Math.floor(lines) || 100, 1), MAX_LOG_LINES);
  const response = await docker("GET", `/containers/${container.Id}/logs?stdout=1&stderr=1&timestamps=1&tail=${tail}`, env);
  if (!response.ok) throw new HttpError(503, `Docker menjawab HTTP ${response.status}.`);
  return demuxLogs(new Uint8Array(await response.arrayBuffer()))
    .split("\n")
    .filter(Boolean)
    .map(redactSecrets);
}

export async function opsRestart(service: string, env: NodeJS.ProcessEnv = process.env) {
  const container = await containerFor(service, env);
  const response = await docker("POST", `/containers/${container.Id}/restart?t=10`, env);
  if (response.status !== 204 && !response.ok) throw new HttpError(503, `Restart ditolak Docker (HTTP ${response.status}).`);
  return { service, restarted: true };
}
