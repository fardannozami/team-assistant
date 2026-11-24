import { pgTable, text, timestamp, boolean, uuid, integer } from "drizzle-orm/pg-core";
import { workspaceRef } from "./workspaces.js";

export const roles = pgTable("roles", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull().unique(),
  description: text("description"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: workspaceRef(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  roleId: uuid("role_id").references(() => roles.id),
  isActive: boolean("is_active").default(true).notNull(),
  // Raised by "sign out of every device" in Naya: older Naya sessions stop working.
  nayaSessionVersion: integer("naya_session_version").default(0).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// Web dashboard invites: the invitee joins this workspace by signing in with
// Google as `email`. The link only carries the token for the landing page;
// the verified Google email is what grants access.
export const workspaceInvites = pgTable("workspace_invites", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: workspaceRef(),
  email: text("email").notNull(), // lowercase
  roleId: uuid("role_id").notNull().references(() => roles.id),
  tokenHash: text("token_hash").notNull().unique(), // sha256 hex of the link token
  invitedBy: uuid("invited_by").references(() => users.id, { onDelete: "set null" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
