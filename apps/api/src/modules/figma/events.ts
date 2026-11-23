/**
 * Figma versions, comments and webhook payloads as activity rows (FIG-007).
 * Polling and webhooks give the same versions and comments the same
 * externalId, so whichever arrives second is dropped.
 *
 * Identity (FIG-006): only a Figma user id carried by the source is kept.
 * FILE_UPDATE says a file changed but not who changed it, so it has no actor.
 */
import type { FigmaComment, FigmaVersion } from "./client.js";

export type FigmaActivity = {
  type: string;
  externalId: string;
  actorId: string | null; // Figma user id
  actorHandle: string | null;
  title: string;
  url: string;
  occurredAt: Date;
  metadata: Record<string, unknown>;
};

const KEY_RE = /^[A-Za-z0-9]{10,64}$/;

/** The file key from a figma.com link (design, file, board, proto, slides) or a bare key. */
export function parseFileKey(input: string): string | null {
  const value = input.trim();
  if (KEY_RE.test(value)) return value;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (!/(^|\.)figma\.com$/i.test(url.hostname)) return null;
  const [kind, key] = url.pathname.split("/").filter(Boolean);
  if (!kind || !["design", "file", "board", "proto", "slides"].includes(kind)) return null;
  return key && KEY_RE.test(key) ? key : null;
}

export const fileUrl = (fileKey: string, nodeId?: string | null) =>
  `https://www.figma.com/file/${fileKey}${nodeId ? `?node-id=${encodeURIComponent(nodeId.replace(/:/g, "-"))}` : ""}`;

const clip = (text: string, max = 200) => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

const validDate = (value: unknown) => {
  const date = new Date(String(value ?? ""));
  return Number.isNaN(date.getTime()) ? null : date;
};

/**
 * Named versions are saved on purpose; unnamed ones are Figma's autosaves
 * while someone edits, which still say who was editing.
 */
export function versionActivity(fileKey: string, v: FigmaVersion): FigmaActivity | null {
  const occurredAt = validDate(v.created_at);
  if (!v.id || !occurredAt) return null;
  const named = !!(v.label?.trim() || v.description?.trim());
  return {
    type: named ? "version_saved" : "file_edited",
    externalId: `version:${fileKey}:${v.id}`,
    actorId: v.user?.id ? String(v.user.id) : null,
    actorHandle: v.user?.handle ?? null,
    title: named ? clip(v.label?.trim() || v.description!) : "Mengedit file",
    url: fileUrl(fileKey),
    occurredAt,
    metadata: { fileKey, versionId: v.id, handle: v.user?.handle ?? null, description: v.description || null },
  };
}

export function commentActivity(fileKey: string, c: FigmaComment): FigmaActivity | null {
  const occurredAt = validDate(c.created_at);
  if (!c.id || !occurredAt) return null;
  return {
    type: c.parent_id ? "comment_replied" : "commented",
    externalId: `comment:${fileKey}:${c.id}`,
    actorId: c.user?.id ? String(c.user.id) : null,
    actorHandle: c.user?.handle ?? null,
    title: clip(c.message || "(komentar)"),
    url: fileUrl(fileKey),
    occurredAt,
    metadata: { fileKey, commentId: c.id, handle: c.user?.handle ?? null },
  };
}

type Payload = Record<string, any>;

/** Comment webhooks send the message as fragments of text and mentions. */
function commentText(fragments: unknown): string {
  if (!Array.isArray(fragments)) return "";
  return fragments
    .map((f) => (typeof f?.text === "string" ? f.text : typeof f?.mention === "string" ? `@${f.mention}` : ""))
    .join("");
}

/** One webhook delivery as activity; null for PING and events we don't keep. */
export function webhookActivity(payload: Payload): FigmaActivity | null {
  const fileKey = typeof payload.file_key === "string" ? payload.file_key : null;
  if (!fileKey) return null;
  const actor = payload.triggered_by;
  const actorId = actor?.id ? String(actor.id) : null;
  const actorHandle = typeof actor?.handle === "string" ? actor.handle : null;
  const at = validDate(payload.created_at ?? payload.timestamp) ?? new Date();

  switch (payload.event_type) {
    case "FILE_VERSION_UPDATE":
      if (!payload.version_id) return null;
      return versionActivity(fileKey, {
        id: String(payload.version_id),
        created_at: at.toISOString(),
        label: payload.label ?? null,
        description: payload.description ?? null,
        user: { id: actorId ?? "", handle: actorHandle ?? "" },
      });
    case "FILE_COMMENT":
      if (!payload.comment_id) return null;
      return commentActivity(fileKey, {
        id: String(payload.comment_id),
        parent_id: payload.parent_id ? String(payload.parent_id) : undefined,
        message: commentText(payload.comment),
        created_at: at.toISOString(),
        user: { id: actorId ?? "", handle: actorHandle ?? "" },
      });
    case "FILE_UPDATE":
      // No editor in this event: stored without an actor, never attributed.
      return {
        type: "file_updated",
        externalId: `update:${fileKey}:${at.toISOString()}`,
        actorId: null,
        actorHandle: null,
        title: "File diperbarui",
        url: fileUrl(fileKey),
        occurredAt: at,
        metadata: { fileKey },
      };
    case "DEV_MODE_STATUS_UPDATE": {
      const nodeId = typeof payload.node_id === "string" ? payload.node_id : null;
      return {
        type: "dev_status",
        externalId: `dev:${fileKey}:${nodeId ?? ""}:${at.toISOString()}`,
        actorId,
        actorHandle,
        title: `Status Dev Mode: ${String(payload.status ?? "").replace(/_/g, " ").toLowerCase() || "diubah"}`,
        url: fileUrl(fileKey, nodeId),
        occurredAt: at,
        metadata: { fileKey, nodeId, status: payload.status ?? null, handle: actorHandle },
      };
    }
    default:
      return null;
  }
}
