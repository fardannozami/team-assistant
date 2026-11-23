/**
 * Figma REST API, authenticated with a personal access token. The token
 * needs the scopes current_user:read, file_content:read, file_versions:read,
 * file_comments:read and, for webhooks, webhooks:write.
 */
import { HttpError } from "../../lib/http-error.js";

const API = "https://api.figma.com";
const TIMEOUT_MS = 15_000;

export class FigmaApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "FigmaApiError";
  }
}

async function figma<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { "X-Figma-Token": token, "content-type": "application/json", ...init.headers },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { err?: string; message?: string } | null;
    throw new FigmaApiError(res.status, body?.err ?? body?.message ?? `Figma API ${res.status}`);
  }
  return (await res.json()) as T;
}

/** Turns a Figma error into a message an admin can act on. */
export function figmaErrorMessage(error: unknown): string {
  if (!(error instanceof FigmaApiError)) return "Figma tidak bisa dihubungi. Coba lagi sebentar.";
  if (error.status === 401) return "Token Figma tidak valid atau sudah kedaluwarsa.";
  if (error.status === 403) return "Token Figma tidak punya akses (cek scope token dan izin file).";
  if (error.status === 404) return "File Figma tidak ditemukan atau token tidak punya akses ke file itu.";
  if (error.status === 429) return "Batas permintaan Figma tercapai. Coba lagi beberapa menit lagi.";
  return `Figma menolak permintaan: ${error.message}`;
}

// Figma's own failures are 503: the request was fine, Figma wasn't.
export const asHttpError = (error: unknown) =>
  new HttpError(error instanceof FigmaApiError && error.status < 500 && error.status !== 429 ? 400 : 503, figmaErrorMessage(error));

export type FigmaUser = { id: string; handle: string; email?: string; img_url?: string };

export type FigmaFileInfo = {
  name: string;
  lastModified: string;
  editorType?: string;
};

export type FigmaVersion = {
  id: string;
  created_at: string;
  label: string | null;
  description: string | null;
  user: FigmaUser;
};

export type FigmaComment = {
  id: string;
  parent_id?: string;
  message: string;
  created_at: string;
  resolved_at?: string | null;
  user: FigmaUser;
};

export const getMe = (token: string) => figma<FigmaUser>(token, "/v1/me");

// depth=1 keeps the response small: only the document's top-level pages.
export const getFileInfo = (token: string, fileKey: string) =>
  figma<FigmaFileInfo>(token, `/v1/files/${encodeURIComponent(fileKey)}?depth=1`);

export const listVersions = (token: string, fileKey: string) =>
  figma<{ versions: FigmaVersion[] }>(token, `/v1/files/${encodeURIComponent(fileKey)}/versions?page_size=50`).then(
    (r) => r.versions,
  );

export const listComments = (token: string, fileKey: string) =>
  figma<{ comments: FigmaComment[] }>(token, `/v1/files/${encodeURIComponent(fileKey)}/comments`).then((r) => r.comments);

export const WEBHOOK_EVENTS = ["FILE_VERSION_UPDATE", "FILE_COMMENT", "FILE_UPDATE", "DEV_MODE_STATUS_UPDATE"] as const;

/** Registers one webhook per event on a file (Figma webhooks take a single event type). */
export async function createFileWebhooks(token: string, fileKey: string, endpoint: string, passcode: string) {
  const ids: string[] = [];
  try {
    for (const eventType of WEBHOOK_EVENTS) {
      const hook = await figma<{ id: string }>(token, "/v2/webhooks", {
        method: "POST",
        body: JSON.stringify({
          event_type: eventType,
          context: "file",
          context_id: fileKey,
          endpoint,
          passcode,
          description: "Team Assistant",
        }),
      });
      ids.push(String(hook.id));
    }
  } catch (error) {
    // All or nothing: half the events would look like a working setup.
    await deleteWebhooks(token, ids);
    throw error;
  }
  return ids;
}

export async function deleteWebhooks(token: string, ids: string[]) {
  for (const id of ids) {
    // Already gone on Figma's side is fine.
    await figma(token, `/v2/webhooks/${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => undefined);
  }
}
