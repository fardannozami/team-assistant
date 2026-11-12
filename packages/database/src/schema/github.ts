import { pgTable, text, timestamp, uuid, boolean, unique } from "drizzle-orm/pg-core";
import { workspaceRef } from "./workspaces.js";

// One GitHub App for the platform; each workspace links its own installation.
export const githubInstallations = pgTable("github_installations", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: workspaceRef(),
  installationId: text("installation_id").notNull().unique(),
  accountLogin: text("account_login"),
  accountType: text("account_type"),
  repositorySelection: text("repository_selection"), // all | selected
  isActive: boolean("is_active").default(true).notNull(), // false while suspended
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// Repositories the installation can see. Only `isActive` (tracked) ones
// produce activity; keyed by GitHub's repo id so renames keep the row.
export const trackedRepositories = pgTable("tracked_repositories", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: workspaceRef(),
  installationId: uuid("installation_id")
    .notNull()
    .references(() => githubInstallations.id, { onDelete: "cascade" }),
  githubRepoId: text("github_repo_id").notNull().unique(),
  owner: text("owner").notNull(),
  name: text("name").notNull(),
  fullName: text("full_name").notNull(),
  isPrivate: boolean("is_private").default(false).notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// GIT-010: every delivery is processed once; redeliveries of the same GUID are skipped.
export const webhookDeliveries = pgTable(
  "webhook_deliveries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    provider: text("provider").notNull(),
    deliveryId: text("delivery_id").notNull(),
    event: text("event").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [unique("webhook_deliveries_provider_delivery_uq").on(t.provider, t.deliveryId)],
);
