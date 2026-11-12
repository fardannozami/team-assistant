import { pgTable, text, timestamp, boolean, uuid, jsonb, unique } from "drizzle-orm/pg-core";
import { employees } from "./employees.js";
import { workspaceRef } from "./workspaces.js";

// Bot registry: one WhatsApp bot per workspace. Auth state lives on disk in
// the session directory named by session_key.
export const whatsappSessions = pgTable("whatsapp_sessions", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: workspaceRef().unique(),
  botPhone: text("bot_phone"),
  sessionKey: text("session_key").notNull().unique(),
  authState: jsonb("auth_state"),
  isActive: boolean("is_active").default(true).notNull(),
  lastConnectedAt: timestamp("last_connected_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const whatsappMessages = pgTable("whatsapp_messages", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: workspaceRef(),
  messageId: text("message_id").notNull(),
  fromPhone: text("from_phone").notNull(),
  toPhone: text("to_phone"),
  direction: text("direction").notNull(), // inbound | outbound
  body: text("body"),
  raw: jsonb("raw"),
  employeeId: uuid("employee_id").references(() => employees.id),
  processed: boolean("processed").default(false).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [unique("whatsapp_messages_workspace_message_uq").on(t.workspaceId, t.messageId)]);
