import { pgTable, text, timestamp, uuid, boolean, unique } from "drizzle-orm/pg-core";
import { users } from "./auth.js";
import { workspaceRef } from "./workspaces.js";

// One Figma account per workspace, connected with a personal access token
// (FIG-001). Activity lands in activity_events with provider "figma".
export const figmaConnections = pgTable("figma_connections", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: workspaceRef().unique(),
  accessToken: text("access_token").notNull(), // encrypted
  tokenHint: text("token_hint"), // last 4 characters, for display
  accountId: text("account_id").notNull(),
  accountHandle: text("account_handle"),
  accountEmail: text("account_email"),
  webhookPasscode: text("webhook_passcode").notNull(), // encrypted; Figma echoes it in every webhook
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
  lastSyncError: text("last_sync_error"),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const trackedFigmaFiles = pgTable(
  "tracked_figma_files",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: workspaceRef(),
    fileKey: text("file_key").notNull(),
    name: text("name").notNull(),
    editorType: text("editor_type"), // figma | figjam | slides
    lastModified: timestamp("last_modified", { withTimezone: true }),
    // Figma webhook ids registered for this file; empty when webhooks are off.
    webhookIds: text("webhook_ids").array().notNull().default([]),
    isActive: boolean("is_active").default(true).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [unique("tracked_figma_files_workspace_file_uq").on(t.workspaceId, t.fileKey)],
);
