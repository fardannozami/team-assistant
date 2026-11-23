import { pgTable, text, timestamp, boolean, uuid } from "drizzle-orm/pg-core";
import { workspaceRef } from "./workspaces.js";

// Bot registry: one WhatsApp bot per workspace. Auth state lives on disk in
// the session directory named by session_key.
export const whatsappSessions = pgTable("whatsapp_sessions", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: workspaceRef().unique(),
  botPhone: text("bot_phone"),
  sessionKey: text("session_key").notNull().unique(),
  isActive: boolean("is_active").default(true).notNull(),
  lastConnectedAt: timestamp("last_connected_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

