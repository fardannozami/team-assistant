import { existsSync } from "node:fs";
import { mkdir, rename } from "node:fs/promises";
import path from "node:path";
import { whatsappSessions } from "@repo/database";
import { eq } from "drizzle-orm";
import { db, logger, sessionDir, SESSIONS_ROOT } from "./state.js";

// Pre-multi-tenant single session directory, migrated on boot.
const LEGACY_SESSION_PATH = process.env.WHATSAPP_SESSION_PATH ?? "./data/whatsapp-session";

/**
 * Moves the pre-multi-tenant session directory to the workspace that the
 * migration assigned it to (whatsapp_sessions.session_key = 'legacy').
 */
export async function migrateLegacySession() {
  const [legacy] = await db
    .select()
    .from(whatsappSessions)
    .where(eq(whatsappSessions.sessionKey, "legacy"))
    .limit(1);
  if (!legacy) return;

  const target = sessionDir(legacy.workspaceId);
  const hasLegacyCreds = existsSync(path.join(LEGACY_SESSION_PATH, "creds.json"));
  if (hasLegacyCreds && !existsSync(target)) {
    await mkdir(SESSIONS_ROOT, { recursive: true });
    await rename(LEGACY_SESSION_PATH, target);
    logger.info({ workspaceId: legacy.workspaceId, target }, "Migrated legacy WhatsApp session");
  }

  // The directory may already have been moved by a run that crashed before this update.
  const hasCreds = existsSync(path.join(target, "creds.json"));
  await db
    .update(whatsappSessions)
    .set({
      sessionKey: legacy.workspaceId,
      ...(hasCreds ? {} : { isActive: false }),
      updatedAt: new Date(),
    })
    .where(eq(whatsappSessions.id, legacy.id));
}
