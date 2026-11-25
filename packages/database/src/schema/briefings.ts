import { pgTable, text, timestamp, uuid, integer, boolean, unique, index } from "drizzle-orm/pg-core";
import { employees } from "./employees.js";
import { workspaceRef } from "./workspaces.js";

// Retired pre-standup briefings (the apps/agents CrewAI service is gone): leads
// for sales/PM, UI/UX trends for designers, dev news for developers. The tables
// stay for their existing data; nothing writes them any more.
export const agencyProfiles = pgTable("agency_profiles", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: workspaceRef().unique(),
  isActive: boolean("is_active").default(true).notNull(),
  services: text("services").array().notNull().default([]),
  keywords: text("keywords").array().notNull().default([]),
  excludedKeywords: text("excluded_keywords").array().notNull().default([]),
  targetCountries: text("target_countries").array().notNull().default([]), // empty: every country
  minBudgetUsd: integer("min_budget_usd"),
  tendersEnabled: boolean("tenders_enabled").default(true).notNull(),
  // Minutes before the standup schedule's time the briefings go out.
  offsetMinutes: integer("offset_minutes").default(30).notNull(),
  itemsPerBriefing: integer("items_per_briefing").default(5).notNull(), // design and dev news
  salesItemsPerBriefing: integer("sales_items_per_briefing").default(10).notNull(),
  // Bring-your-own Tavily key for the sales crew's web search (Upwork, LinkedIn, ...).
  searchApiKey: text("search_api_key"), // encrypted
  searchApiKeyHint: text("search_api_key_hint"), // last 4 characters, for display
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const briefingRuns = pgTable("briefing_runs", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: workspaceRef(),
  audience: text("audience").notNull(), // sales | design | dev
  date: text("date").notNull(), // YYYY-MM-DD in the workspace's timezone
  status: text("status").notNull().default("running"), // running | completed | failed
  model: text("model"),
  candidates: integer("candidates"),
  items: integer("items"),
  sent: integer("sent"),
  error: text("error"),
  startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
}, (t) => [index("briefing_runs_workspace_date_idx").on(t.workspaceId, t.date)]);

export const briefingItems = pgTable(
  "briefing_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: workspaceRef(),
    runId: uuid("run_id").references(() => briefingRuns.id, { onDelete: "set null" }),
    audience: text("audience").notNull(),
    type: text("type").notNull(), // lead | tender | funding | hiring | upsell | news
    title: text("title").notNull(),
    url: text("url").notNull(),
    source: text("source").notNull(),
    summary: text("summary"),
    score: integer("score"),
    country: text("country"),
    budget: text("budget"),
    pitch: text("pitch"),
    status: text("status").notNull().default("new"), // new | sent | claimed | dismissed | won
    claimedBy: uuid("claimed_by").references(() => employees.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  // A link is offered to a workspace once, whichever day it shows up again.
  (t) => [
    unique("briefing_items_workspace_url_uq").on(t.workspaceId, t.url),
    index("briefing_items_workspace_audience_idx").on(t.workspaceId, t.audience, t.createdAt),
  ],
);
