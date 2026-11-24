import { boolean, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { workspaceRef } from "./workspaces.js";
import { users } from "./auth.js";

// Naya (naya.digdaya.co): the AI team's office on top of Hermes, sharing daily's API and login.

/** Bearer tokens for Hermes agents calling /mcp. Only the sha256 is stored. */
export const apiTokens = pgTable("api_tokens", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: workspaceRef(),
  name: text("name").notNull(), // usually the Hermes profile, e.g. "sales"
  tokenHash: text("token_hash").notNull().unique(), // sha256 hex
  tokenHint: text("token_hint").notNull(), // last 4 characters
  scopes: text("scopes").array().notNull().default([]),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

/** One-time sign-in links: "Buka Naya" in daily, or "NAYA" over WhatsApp. */
export const loginLinks = pgTable("login_links", {
  id: uuid("id").defaultRandom().primaryKey(),
  codeHash: text("code_hash").notNull().unique(), // sha256 hex
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  app: text("app").notNull(), // "naya" | "web"
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

/** Hermes profiles people can chat with in Naya, and who may. */
export const nayaAgents = pgTable(
  "naya_agents",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: workspaceRef(),
    profile: text("profile").notNull(), // Hermes profile name, e.g. "sales"
    displayName: text("display_name").notNull(),
    description: text("description"),
    apiKey: text("api_key"), // the profile's API_SERVER_KEY, encrypted (encryptSecret)
    apiKeyHint: text("api_key_hint"),
    chatRoles: text("chat_roles").array().notNull().default([]),
    isLead: boolean("is_lead").default(false).notNull(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("naya_agents_workspace_profile_unique").on(t.workspaceId, t.profile)],
);
