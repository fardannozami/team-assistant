import { pgTable, text, timestamp, boolean, uuid, jsonb } from "drizzle-orm/pg-core";
import { employees } from "./employees.js";

export const whatsappSessions = pgTable("whatsapp_sessions", {
  id: uuid("id").defaultRandom().primaryKey(),
  sessionKey: text("session_key").notNull().unique(),
  authState: jsonb("auth_state"),
  isActive: boolean("is_active").default(true).notNull(),
  lastConnectedAt: timestamp("last_connected_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const whatsappMessages = pgTable("whatsapp_messages", {
  id: uuid("id").defaultRandom().primaryKey(),
  messageId: text("message_id").notNull().unique(),
  fromPhone: text("from_phone").notNull(),
  toPhone: text("to_phone"),
  direction: text("direction").notNull(), // inbound | outbound
  body: text("body"),
  raw: jsonb("raw"),
  employeeId: uuid("employee_id").references(() => employees.id),
  processed: boolean("processed").default(false).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
