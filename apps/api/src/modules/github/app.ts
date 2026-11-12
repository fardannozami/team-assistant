import { createHmac, createSign, timingSafeEqual } from "node:crypto";

/**
 * Minimal GitHub App client: app JWT, installation tokens and the OAuth
 * exchange used to prove who is linking an installation. The private key and
 * secrets only live in env and never leave this module (or reach the LLM).
 */
const API = "https://api.github.com";

export function githubEnv() {
  return {
    appId: process.env.GITHUB_APP_ID ?? "",
    slug: process.env.GITHUB_APP_SLUG ?? "",
    privateKey: (process.env.GITHUB_APP_PRIVATE_KEY ?? "").replace(/\\n/g, "\n"),
    webhookSecret: process.env.GITHUB_WEBHOOK_SECRET ?? "",
    clientId: process.env.GITHUB_CLIENT_ID ?? "",
    clientSecret: process.env.GITHUB_CLIENT_SECRET ?? "",
  };
}

export function githubConfigured() {
  const e = githubEnv();
  return Boolean(e.appId && e.slug && e.privateKey && e.webhookSecret && e.clientId && e.clientSecret);
}

/** GIT-002: X-Hub-Signature-256 over the raw body, compared in constant time. */
export function verifyWebhookSignature(rawBody: string, header: string | undefined, secret = githubEnv().webhookSecret) {
  if (!secret || !header?.startsWith("sha256=")) return false;
  const expected = Buffer.from(`sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`);
  const received = Buffer.from(header);
  return expected.length === received.length && timingSafeEqual(expected, received);
}

function base64url(input: string | Buffer) {
  return Buffer.from(input).toString("base64url");
}

function appJwt() {
  const now = Math.floor(Date.now() / 1000);
  // iat 60s in the past absorbs clock drift; GitHub caps exp at 10 minutes.
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64url(JSON.stringify({ iat: now - 60, exp: now + 540, iss: githubEnv().appId }));
  const signature = createSign("RSA-SHA256").update(`${header}.${payload}`).sign(githubEnv().privateKey);
  return `${header}.${payload}.${base64url(signature)}`;
}

export class GitHubApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function call<T>(path: string, token: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path.startsWith("http") ? path : `${API}${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "team-assistant",
      Authorization: `Bearer ${token}`,
      ...init.headers,
    },
  });
  if (!response.ok) {
    throw new GitHubApiError(response.status, `GitHub ${init.method ?? "GET"} ${path} failed: ${response.status}`);
  }
  return (await response.json()) as T;
}

export type GitHubInstallation = {
  id: number;
  account: { login: string; type: string } | null;
  repository_selection: "all" | "selected";
  suspended_at: string | null;
};

export function getInstallation(installationId: string) {
  return call<GitHubInstallation>(`/app/installations/${installationId}`, appJwt());
}

const tokenCache = new Map<string, { token: string; expiresAt: number }>();

async function installationToken(installationId: string) {
  const cached = tokenCache.get(installationId);
  if (cached && cached.expiresAt - 5 * 60_000 > Date.now()) return cached.token;
  const created = await call<{ token: string; expires_at: string }>(
    `/app/installations/${installationId}/access_tokens`,
    appJwt(),
    { method: "POST" },
  );
  tokenCache.set(installationId, { token: created.token, expiresAt: Date.parse(created.expires_at) });
  return created.token;
}

export type GitHubRepo = {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  owner: { login: string };
};

export async function listInstallationRepos(installationId: string) {
  const token = await installationToken(installationId);
  const repos: GitHubRepo[] = [];
  for (let page = 1; page <= 10; page++) {
    const res = await call<{ repositories: GitHubRepo[]; total_count: number }>(
      `/installation/repositories?per_page=100&page=${page}`,
      token,
    );
    repos.push(...res.repositories);
    if (repos.length >= res.total_count || res.repositories.length === 0) break;
  }
  return repos;
}

/** The account behind a login, or null when it does not exist. */
export async function findUser(installationId: string, login: string) {
  try {
    return await call<{ id: number; login: string; type: string }>(
      `/users/${encodeURIComponent(login)}`,
      await installationToken(installationId),
    );
  } catch (error) {
    if (error instanceof GitHubApiError && error.status === 404) return null;
    throw error;
  }
}

/**
 * Exchanges the OAuth code GitHub sends after installation and returns the
 * installation ids that user can access, so a workspace can only link an
 * installation its admin actually has on GitHub.
 */
export async function userInstallationIds(code: string) {
  const response = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: githubEnv().clientId, client_secret: githubEnv().clientSecret, code }),
  });
  const body = (await response.json().catch(() => ({}))) as { access_token?: string };
  if (!response.ok || !body.access_token) throw new GitHubApiError(response.status, "GitHub OAuth exchange failed");

  const ids = new Set<string>();
  for (let page = 1; page <= 5; page++) {
    const res = await call<{ installations: { id: number }[]; total_count: number }>(
      `/user/installations?per_page=100&page=${page}`,
      body.access_token,
    );
    for (const i of res.installations) ids.add(String(i.id));
    if (ids.size >= res.total_count || res.installations.length === 0) break;
  }
  return ids;
}
