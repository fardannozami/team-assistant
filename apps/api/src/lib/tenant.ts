import type { Context } from "hono";
import { HttpError } from "./http-error.js";

/** Workspace of the authenticated caller, set by requireRole / requireInternalOrRole. */
export function getWorkspaceId(c: Context): string {
  const workspaceId = c.get("workspaceId" as never) as string | undefined;
  if (!workspaceId) throw new HttpError(401, "Unauthorized");
  return workspaceId;
}

/** User id of the caller, or null for internal (worker) calls. */
export function getActorId(c: Context): string | null {
  return (c.get("user" as never) as { sub?: string | null } | undefined)?.sub ?? null;
}
