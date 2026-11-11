import { pgTable, text, timestamp, uuid, jsonb, integer, unique } from "drizzle-orm/pg-core";
import { employees } from "./employees.js";
import { workspaceRef } from "./workspaces.js";

export const agentConfigs = pgTable("agent_configs", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: workspaceRef(),
  key: text("key").notNull(),
  value: jsonb("value"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [unique("agent_configs_workspace_key_uq").on(t.workspaceId, t.key)]);

export const agentMemories = pgTable("agent_memories", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: workspaceRef(),
  employeeId: uuid("employee_id").references(() => employees.id),
  scope: text("scope").notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const aiUsageLogs = pgTable("ai_usage_logs", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: workspaceRef(),
  employeeId: uuid("employee_id").references(() => employees.id),
  model: text("model"),
  promptTokens: integer("prompt_tokens"),
  completionTokens: integer("completion_tokens"),
  totalTokens: integer("total_tokens"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// Bring-your-own-key: each workspace pays for its own AI provider usage.
export const workspaceAiSettings = pgTable("workspace_ai_settings", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: workspaceRef().unique(),
  provider: text("provider").notNull(), // gemini | groq | openai | openrouter | custom
  baseUrl: text("base_url").notNull(),
  model: text("model").notNull(),
  apiKey: text("api_key").notNull(), // encrypted
  apiKeyHint: text("api_key_hint"), // last 4 characters, for display
  updatedBy: uuid("updated_by"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});
