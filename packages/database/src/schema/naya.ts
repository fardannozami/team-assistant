import { boolean, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { workspaceRef } from "./workspaces.js";
import { users } from "./auth.js";
import { employees } from "./employees.js";

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

// The human half of the hybrid flow (blueprint v3): Hermes keeps the AI side of a card (triage →
// running → review), these tables keep who on the team owns it and what they decided per item.
// `board` is the Hermes board slug ("default" for the default board).

/**
 * The person in charge (PIC) of a Kanban card: someone on the team (an employee, reached over
 * WhatsApp), chosen when it is created in Naya or later. With `picPool` set and no PIC yet, the
 * most available member of that pool (sales/PM, design, development) is picked when the AI hands
 * the card over. With `picGroup` set instead, the card is the whole team's: everyone in that pool
 * is notified and may decide. A reviewed card can continue to design or development as a new card.
 */
export const nayaCards = pgTable(
  "naya_cards",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: workspaceRef(),
    board: text("board").notNull().default(""),
    taskId: text("task_id").notNull(),
    picEmployeeId: uuid("pic_employee_id").references(() => employees.id, { onDelete: "set null" }),
    /** "review" | "design" | "development": pick the PIC from this pool at handover. */
    picPool: text("pic_pool"),
    /** "design" | "development": the whole team is the PIC (no single person). */
    picGroup: text("pic_group"),
    /** The card this one continues (a reviewed card handed to design or development). */
    continuesFrom: text("continues_from"),
    /** The card created to continue this one, and to which pool ("design" | "development"). */
    continuedTo: text("continued_to"),
    continuedStep: text("continued_step"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("naya_cards_task_unique").on(t.workspaceId, t.board, t.taskId)],
);

/** One thing a person checks on a card the AI handed over: in_progress | done | feedback | rejected. */
export const nayaChecklistItems = pgTable(
  "naya_checklist_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: workspaceRef(),
    board: text("board").notNull().default(""),
    taskId: text("task_id").notNull(),
    /** The subtask whose result this item checks; null for the card's own result. */
    sourceTaskId: text("source_task_id"),
    title: text("title").notNull(),
    picEmployeeId: uuid("pic_employee_id").references(() => employees.id, { onDelete: "set null" }),
    status: text("status").notNull().default("in_progress"),
    /** Required for feedback (what to fix) and rejected (why); the agent reads it. */
    note: text("note"),
    /** Bumped each time the agent redoes the item after feedback (v1, v2, …). */
    version: integer("version").default(1).notNull(),
    /** When the AI handed this version to its PIC (WhatsApp sent); Tugas Saya counts waiting time from here. */
    handedAt: timestamp("handed_at", { withTimezone: true }),
    /** Last overdue reminder, so a waiting item is nudged at most once a day. */
    remindedAt: timestamp("reminded_at", { withTimezone: true }),
    decidedBy: uuid("decided_by").references(() => users.id, { onDelete: "set null" }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("naya_checklist_items_task_idx").on(t.workspaceId, t.board, t.taskId)],
);

/** Feedback and rejections kept as candidate rules for the agent; a person activates them. */
export const nayaLearnedRules = pgTable("naya_learned_rules", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: workspaceRef(),
  agent: text("agent"), // Hermes profile that did the work
  ruleText: text("rule_text").notNull(),
  sourceItemId: uuid("source_item_id").references(() => nayaChecklistItems.id, { onDelete: "set null" }),
  status: text("status").notNull().default("candidate"), // candidate | active
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
