import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { workspaceRef } from "./workspaces.js";
import { users } from "./auth.js";

// Naya (the Hermes mission-control app on naya.digdaya.co) signs people in
// with their daily account and lets Hermes agents read daily data over MCP.

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

/** One-time codes a signed-in user hands to Naya, which swaps them for who they are. */
export const ssoCodes = pgTable("sso_codes", {
  id: uuid("id").defaultRandom().primaryKey(),
  codeHash: text("code_hash").notNull().unique(), // sha256 hex
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  client: text("client").notNull(), // "naya"
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
