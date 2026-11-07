# Team Assistant — Task Breakdown

Source of truth: `team-assistant-prd.md`. Tasks are grouped by development milestone (M1–M11) from PRD §13. Each task references requirement IDs where applicable (e.g. `WA-001`). Priorities follow PRD §5 (P0/P1/P2).

Status legend: `[ ]` todo · `[~]` in progress · `[x]` done

---

## M1 — Project Foundation and Infrastructure (1–2 days)

### Monorepo & workspace
- [x] **T-M1-01** Add `apps/worker` app (BullMQ worker entrypoint, jobs/processors/schedulers) per PRD §7.2.
- [x] **T-M1-02** Add `packages/database` (Drizzle ORM + schema + migrations).
- [x] **T-M1-03** Add `packages/shared` (Zod schemas, types, constants, time-zone helpers).
- [x] **T-M1-04** Add `packages/config` (env validation, shared eslint/tsconfig re-exports if needed).
- [x] **T-M1-05** Wire workspace dependencies (`@repo/*`) in `apps/api`, `apps/worker`, `apps/web`.
- [x] **T-M1-06** Configure Turborepo pipeline for `build`, `dev`, `lint`, `check-types`, `db:migrate`, `db:generate`.

### Infrastructure
- [x] **T-M1-07** Create `docker-compose.yml` with PostgreSQL, Redis, (optional) Nginx.
- [x] **T-M1-08** Add `docker/` with Dockerfiles for api, worker, web.
- [x] **T-M1-09** Add `.env.example` documenting all required secrets/vars.
- [x] **T-M1-10** Implement structured logging (pino) and request IDs in Hono.
- [x] **T-M1-11** Add health endpoints (`/health`, readiness including DB/Redis).

**Acceptance:** `bun install` at root; `docker compose up` brings up DB+Redis; `bun run dev` starts api+worker+web.

---

## M2 — Database and Authentication (2–3 days)

### Schema (Drizzle)
- [x] **T-M2-01** Define tables: `users`, `admins`, `roles`, `permissions`.
- [x] **T-M2-02** Define `employees`, `teams`, `team_members`.
- [x] **T-M2-03** Define WhatsApp tables: `whatsapp_sessions`, `whatsapp_messages`.
- [x] **T-M2-04** Define conversation tables: `conversations`, `conversation_messages`.
- [x] **T-M2-05** Define AI tables: `agent_configs`, `agent_memories`, `ai_usage_logs`.
- [x] **T-M2-06** Define standup tables: `standups`, `standup_answers`, `standup_sessions`.
- [x] **T-M2-07** Define scheduling tables: `schedules`, `scheduled_jobs`, `job_executions`.
- [x] **T-M2-08** Define holiday tables: `holidays`, `calendar_settings`, `calendar_exceptions`.
- [x] **T-M2-09** Define integration tables: `integrations`, `employee_integrations`, `integration_credentials`.
- [x] **T-M2-10** Define activity tables: `activity_events`, `daily_activity_summaries`.
- [x] **T-M2-11** Define GitHub tables: `github_installations`, `tracked_repositories`.
- [x] **T-M2-12** Define Figma tables: `tracked_figma_files`.
- [x] **T-M2-13** Define `reports`, `audit_logs`.
- [ ] **T-M2-14** Add migrations + seed script for default roles/owner. (drizzle config added; run `db:generate` against live Postgres)

### Auth & RBAC
- [ ] **T-M2-15** Implement auth module (login/session/JWT or cookie).
- [ ] **T-M2-16** Implement RBAC middleware (Owner/Admin/Manager/Employee).
- [ ] **T-M2-17** Phone-number → employee identity mapping for WhatsApp senders.
- [ ] **T-M2-18** Audit logging helper for administrative actions.

**Acceptance:** migrations run cleanly; RBAC enforced on protected routes; timestamps stored UTC.

---

## M3 — WhatsApp Integration (Baileys) (2–4 days) — P0

- [ ] **T-M3-01** Create WhatsApp adapter module in `apps/api/src/modules/whatsapp` (or worker). (WA-001)
- [ ] **T-M3-02** QR-code pairing flow + expose QR to dashboard/API. (WA-001)
- [ ] **T-M3-03** Persist auth state to DB/filesystem and restore on restart. (WA-002)
- [ ] **T-M3-04** Incoming message handler with sender phone extraction. (WA-003)
- [ ] **T-M3-05** Outgoing message queue (async send). (WA-004, WA-010)
- [ ] **T-M3-06** Identify registered admins/employees by phone. (WA-005, WA-006)
- [ ] **T-M3-07** Reconnect/disconnection handling with backoff. (WA-007)
- [ ] **T-M3-08** Deduplicate incoming messages by message id. (WA-008)
- [ ] **T-M3-09** Store conversation history. (WA-009)
- [ ] **T-M3-10** Unknown senders cannot run admin commands (authorization check).

**Acceptance (WA):** bot pairs via QR; session restores after restart; duplicate messages processed once; unknown senders blocked.

---

## M4 — Employee Management (1–2 days) — P0

- [ ] **T-M4-01** CRUD endpoints for employees (add/edit/deactivate). (EMP-001..004)
- [ ] **T-M4-02** Team management and membership. (EMP-005)
- [ ] **T-M4-03** Role assignment. (EMP-006)
- [ ] **T-M4-04** Employee directory listing. (EMP-007)
- [ ] **T-M4-05** Standup history per employee. (EMP-008)
- [ ] **T-M4-06** WhatsApp conversational flow for add-employee (multi-step + single-message input).
- [ ] **T-M4-07** Phone number update flow.

**Acceptance:** admin can add employee via WhatsApp with confirmation; directory queryable via API.

---

## M5 — Daily Standup Engine (2–3 days) — P0

- [ ] **T-M5-01** Standup session model (per employee per date, dedup). (STD-010)
- [ ] **T-M5-02** Send standup prompts automatically (triggered by scheduler). (STD-001)
- [ ] **T-M5-03** Collect responses across multiple messages. (STD-003)
- [ ] **T-M5-04** Free-form natural language parsing into 3 core elements. (STD-002, STD-004)
- [ ] **T-M5-05** Blocker detection and recording. (STD-005)
- [ ] **T-M5-06** Persist standup answers by date. (STD-006)
- [ ] **T-M5-07** Retrieve standup history. (STD-007)
- [ ] **T-M5-08** Reminder sending for incomplete standups. (STD-008)
- [ ] **T-M5-09** Manual trigger by admin. (STD-009)
- [ ] **T-M5-10** Hybrid AI conversation: ask contextual follow-ups, avoid re-asking answered items.

**Acceptance:** all three core elements collected; blockers stored; no duplicate sessions.

---

## M6 — Scheduler and Holiday Calendar (2–3 days) — P0

### Scheduling
- [ ] **T-M6-01** Schedule CRUD (create/update/delete/disable). (SCH-001..003)
- [ ] **T-M6-02** Configure active weekdays. (SCH-004)
- [ ] **T-M6-03** Time zone support (default Asia/Jakarta). (SCH-005)
- [ ] **T-M6-04** Reminder configuration. (SCH-006)
- [ ] **T-M6-05** Manual trigger. (SCH-007)
- [ ] **T-M6-06** Retry failed jobs. (SCH-008)
- [ ] **T-M6-07** Job execution history. (SCH-009)
- [ ] **T-M6-08** Prevent duplicate job execution (idempotency keys). (SCH-010)
- [ ] **T-M6-09** BullMQ workers + Redis queue; reconcile jobs from DB on restart.
- [ ] **T-M6-10** Natural-language schedule config via WhatsApp.

### Holiday calendar
- [ ] **T-M6-11** Sync Indonesian holiday data (SKB 3 Menteri source; API as delivery). (HOL-001)
- [ ] **T-M6-12** Store holiday data locally; retain last successful dataset. (HOL-002)
- [ ] **T-M6-13** Distinguish national vs joint leave. (HOL-003)
- [ ] **T-M6-14** Independent config for joint-leave behavior. (HOL-004)
- [ ] **T-M6-15** Skip standup on excluded dates. (HOL-005)
- [ ] **T-M6-16** Manual date exceptions. (HOL-006)
- [ ] **T-M6-17** Display upcoming holidays. (HOL-007)
- [ ] **T-M6-18** Notify admins before holidays. (HOL-008)

**Acceptance:** schedules configurable via chat; jobs recover after restart; no duplicate standup messages; holiday skip 100% against validated data.

---

## M7 — AI Conversational Agent (3–5 days) — P0

- [ ] **T-M7-01** LLM provider client (OpenAI-compatible) with tool calling.
- [ ] **T-M7-02** Agent context assembly (sender identity, role, profile, history, standups, activity, config) with RBAC filtering.
- [ ] **T-M7-03** Indonesian language understanding + conversational style.
- [ ] **T-M7-04** Implement tools: `get_employee`, `get_standup_history`, `create_standup`, `get_schedule`, `create_schedule`, `update_schedule`, `get_team_activity`, `generate_daily_report`, `generate_weekly_report`.
- [ ] **T-M7-05** Backend authorization + validation on every tool call (LLM never trusted).
- [ ] **T-M7-06** Confirmation flow for mutating actions (summarize + confirm).
- [ ] **T-M7-07** Conversation state/memory persistence (`agent_memories`).
- [ ] **T-M7-08** Usage logging and token budgets (`ai_usage_logs`).
- [ ] **T-M7-09** Admin command shortcuts mapping (MENU, HELP, etc.) → structured actions.

**Acceptance:** AI collects standup elements contextually; tool calls authorized; mutating actions confirmed.

---

## M8 — GitHub Integration (2–4 days) — P1

- [ ] **T-M8-01** GitHub App setup + webhook endpoint. (GIT-001)
- [ ] **T-M8-02** Webhook signature verification. (GIT-002)
- [ ] **T-M8-03** Process push events. (GIT-003)
- [ ] **T-M8-04** Process PR events (create/update/merge/close). (GIT-004)
- [ ] **T-M8-05** Process PR review events. (GIT-005)
- [ ] **T-M8-06** Process issue events. (GIT-006)
- [ ] **T-M8-07** Identity mapping GitHub → employee (careful pusher/author/committer). (GIT-007)
- [ ] **T-M8-08** Normalized activity timeline storage. (GIT-008)
- [ ] **T-M8-09** Tracked repository configuration. (GIT-009)
- [ ] **T-M8-10** Webhook event deduplication. (GIT-010)

**Acceptance:** events ingested and deduped; activity attributed only with sufficient identity evidence.

---

## M9 — Figma Integration (2–4 days) — P1

- [ ] **T-M9-01** Figma account connection. (FIG-001)
- [ ] **T-M9-02** Figma webhook endpoint. (FIG-002)
- [ ] **T-M9-03** Retrieve file info. (FIG-003)
- [ ] **T-M9-04** Collect file versions. (FIG-004)
- [ ] **T-M9-05** Collect comments. (FIG-005)
- [ ] **T-M9-06** Figma identity → employee mapping (only when reliable). (FIG-006)
- [ ] **T-M9-07** Design activity timeline storage. (FIG-007)

**Acceptance:** Figma activity stored; no attribution without reliable identity.

---

## M10 — Reporting and Dashboard (3–5 days) — P1

### Reports
- [ ] **T-M10-01** Daily report generation (submitted/not, summaries, blockers, GitHub/Figma activity). (REP)
- [ ] **T-M10-02** Weekly report (progress, active projects, repeated blockers, PRs awaiting review, in-progress work).
- [ ] **T-M10-03** WhatsApp `REPORT TODAY` / `REPORT WEEKLY` commands.
- [ ] **T-M10-04** Report delivery under 1 minute.

### Vue 3 dashboard
- [ ] **T-M10-05** Dashboard scaffold (Vue 3 + Vite) with auth.
- [ ] **T-M10-06** Employee management UI.
- [ ] **T-M10-07** Schedule management UI.
- [ ] **T-M10-08** Holiday calendar UI.
- [ ] **T-M10-09** Integrations management UI.
- [ ] **T-M10-10** Analytics: standup completion rate, response rate, blocker trends, PR/review activity, activity by project, standup history.
- [ ] **T-M10-11** Standup history views.
- [ ] **T-M10-12** Audit log viewer.

**Acceptance:** no employee ranking by raw activity; dashboard usable for admin + analytics.

---

## M11 — Production Hardening (2–4 days)

- [ ] **T-M11-01** Rate limiting on WhatsApp sends and API.
- [ ] **T-M11-02** Credential encryption at rest (GitHub/Figma secrets).
- [ ] **T-M11-03** Retention policies documented + implemented for conversations/activity.
- [ ] **T-M11-04** Observability: structured logs, error monitoring, metrics.
- [ ] **T-M11-05** Backup/restore procedures for Postgres.
- [ ] **T-M11-06** Load/perf validation (p95 < 500ms ordinary endpoints).
- [ ] **T-M11-07** Security review (RBAC, webhook sigs, secret handling).
- [ ] **T-M11-08** Documentation: setup, deployment, operations.

---

## Cross-cutting constraints (apply to all tasks)

- All timestamps stored UTC, displayed in configured TZ (default Asia/Jakarta).
- Redis is not sole source of truth for schedules; Postgres is.
- Jobs must be idempotent and recover after restart.
- AI tool calls must pass backend auth + validation; LLM never authorization layer.
- Never rank employees by raw activity counts.
- Activity attribution requires sufficient identity evidence.
- Credentials/secrets never sent to LLM.

## MVP Definition of Done (PRD §12)

- [ ] Admin can pair WhatsApp bot.
- [ ] Admins can add/deactivate employees.
- [ ] Admins can configure standup schedules via WhatsApp.
- [ ] Bot sends standup prompts automatically.
- [ ] AI collects all three core standup elements.
- [ ] AI asks relevant follow-up questions.
- [ ] Scheduler skips national holidays + configured joint-leave.
- [ ] Admins can request daily report.
- [ ] Data persisted in PostgreSQL.
- [ ] Scheduled jobs recover after restart.
- [ ] Job retries do not cause duplicate standup messages.
