# Product Requirements Document (PRD)

# Team Assistant

**AI-Powered Team Collaboration & Standup Automation Platform**

  Document field   Value
  ---------------- -------------------------------
  Product          Team Assistant
  Version          1.0
  Status           Initial draft
  Date             November 7, 2026
  Product type     Self-hosted internal platform

> **Product vision:** Build an AI-powered team assistant that automates
> daily standups, collects work activity from connected tools,
> understands employee and team context, and allows administrators to
> manage team workflows through WhatsApp conversations.

------------------------------------------------------------------------

## 1. Executive Summary

Team Assistant is an internal platform designed as a simpler,
self-hosted alternative to Dailybot.

The platform integrates WhatsApp, an AI conversational agent, GitHub,
Figma, and the Indonesian national holiday calendar to help companies
coordinate daily standups and understand team progress.

Unlike conventional standup bots that send the same fixed questions on a
schedule, Team Assistant uses AI to conduct contextual conversations
based on:

-   Previous standup responses.
-   Employee-reported work and blockers.
-   GitHub activity.
-   Figma activity.
-   Project and team information.
-   Relevant conversation history.

Administrators can manage the system through natural-language WhatsApp
conversations. A web dashboard provides more comprehensive management,
configuration, and analytics capabilities.

## 2. Problem Statement

The product aims to address the following problems:

  -----------------------------------------------------------------------
  Problem                             Impact
  ----------------------------------- -----------------------------------
  Manual daily standups               Require time and coordination

  Inconsistent status reports         Make actual progress difficult to
                                      understand

  Fragmented work information         Data is spread across GitHub,
                                      Figma, WhatsApp, and spreadsheets

  Blockers discovered too late        Delay team delivery

  Manual monitoring and reporting     Managers must collect updates
                                      themselves

  Inflexible schedules                Standup messages may be sent on
                                      public holidays

  Repetitive standup bots             Employees receive generic,
                                      monotonous questions
  -----------------------------------------------------------------------

**Proposed solution:** A single team assistant that combines natural
conversations, work activity integrations, automation, and AI-assisted
reporting.

## 3. Goals and Non-Goals

### 3.1. Product Goals

1.  Automate daily standups through WhatsApp.
2.  Allow administrators to manage the system through conversations.
3.  Use AI to generate contextual standup questions.
4.  Integrate GitHub and Figma activity.
5.  Generate daily and weekly reports.
6.  Identify blockers and work that may need attention.
7.  Prevent standup messages from being sent on Indonesian public
    holidays and company-designated days off.
8.  Provide a web dashboard for administration and analytics.

### 3.2. Non-Goals

The following are outside the initial product scope:

-   Full project management capabilities comparable to Jira or Linear.
-   Automatic time tracking.
-   Payroll and attendance management.
-   Automated employee performance scoring.
-   AI making HR decisions.
-   Pushing code or merging pull requests through GitHub.
-   Editing Figma designs.
-   Employee screen or device monitoring.

**Core principle:** Digital activity is not an absolute measure of an
individual's productivity.

## 4. Target Users and Roles

  -----------------------------------------------------------------------
  Role                    Description             Access
  ----------------------- ----------------------- -----------------------
  Owner                   System owner            Full system
                                                  configuration

  Admin                   Operational             Employee, schedule, and
                          administrator           integration management

  Manager                 Team supervisor         Team reports and
                                                  activity

  Employee                Team member             Standup and personal
                                                  conversations
  -----------------------------------------------------------------------

### 4.1. Owner and Admin

Administrators can use WhatsApp and the web dashboard to:

-   Add, edit, and deactivate employees.
-   Update employee WhatsApp numbers.
-   Configure standup schedules and reminders.
-   Request reports.
-   Manage integrations.
-   Configure AI behavior.
-   Manage teams and permissions.

The Owner has full control over system-level configuration and
administrative access.

### 4.2. Manager

Managers can:

-   View daily and weekly reports.
-   Review team blockers.
-   Request project summaries.
-   View relevant GitHub and Figma activity.
-   Review standup completion.

### 4.3. Employee

Employees interact with the assistant through WhatsApp. They can:

-   Receive and answer standup questions.
-   Explain blockers.
-   View their own standup history.
-   Ask questions about their own recorded updates.

## 5. Functional Requirements

Priority definitions:

-   **P0:** Required for the initial MVP.
-   **P1:** Planned after the core MVP.
-   **P2:** Later enhancement.

### 5.1. WhatsApp Integration

**Priority: P0**

The system uses one dedicated WhatsApp number as its bot identity. The
initial implementation uses Baileys.

  ID       Requirement                                Priority
  -------- ------------------------------------------ ----------
  WA-001   Pair the bot using a QR code               P0
  WA-002   Persist WhatsApp authentication sessions   P0
  WA-003   Receive incoming messages                  P0
  WA-004   Send outgoing messages                     P0
  WA-005   Identify registered administrators         P0
  WA-006   Identify registered employees              P0
  WA-007   Handle reconnects and disconnections       P0
  WA-008   Prevent duplicate message processing       P0
  WA-009   Store conversation history                 P0
  WA-010   Send messages asynchronously               P0

**Acceptance criteria**

-   The bot can be paired using a QR code.
-   The WhatsApp session can be restored after an application restart.
-   Incoming messages are associated with the sender's phone number.
-   Unknown senders cannot execute administrative commands.
-   Duplicate incoming messages are not processed more than once.

**Implementation note:** Baileys is an unofficial WhatsApp Web
integration. Protocol changes and account restrictions are operational
risks. For business-critical production use, evaluate the official
WhatsApp Business Platform and its pricing and policy requirements.

### 5.2. Employee Management

**Priority: P0**

Administrators can manage employees through WhatsApp and the web
dashboard.

  ID        Requirement
  --------- --------------------------------------
  EMP-001   Add an employee
  EMP-002   Edit employee information
  EMP-003   Update an employee's WhatsApp number
  EMP-004   Activate or deactivate an employee
  EMP-005   Organize employees by team
  EMP-006   Assign roles
  EMP-007   View the employee directory
  EMP-008   View an employee's standup history

**Example WhatsApp interaction**

``` text
Admin:
Add a new employee.

Bot:
What is the employee's name?

Admin:
Budi Santoso.

Bot:
What is the employee's WhatsApp number?

Admin:
628123456789.

Bot:
I am about to add Budi Santoso with that phone number.
Is this correct?

Admin:
Yes.

Bot:
Employee successfully added.
```

The assistant should also support a single-message input containing both
the employee's name and phone number.

### 5.3. Daily Standup Engine

**Priority: P0**

The system sends standup questions to employees according to the
configured schedule.

The standup must collect three core pieces of information:

1.  What did you work on yesterday?
2.  What are you planning to work on today?
3.  Are there any blockers or issues?

  ID        Requirement
  --------- ----------------------------------------------------
  STD-001   Send standup prompts automatically
  STD-002   Collect employee responses
  STD-003   Support responses sent across multiple messages
  STD-004   Support natural, free-form responses
  STD-005   Identify and record blockers
  STD-006   Store standup responses by date
  STD-007   Retrieve standup history
  STD-008   Send reminders
  STD-009   Allow administrators to trigger a standup manually
  STD-010   Prevent duplicate standup sessions and messages

#### Conversation mode: Hybrid AI

The product uses a hybrid conversation model. The AI can converse
naturally, but it must still collect the three required standup
elements.

Example:

``` text
AI Assistant:
How did the authentication feature progress yesterday?
I noticed an authentication pull request was created.
Is the implementation complete?

Employee:
Yes, implementation is complete. It is waiting for review.

AI Assistant:
Great. Are you focusing on getting the review completed
today, or do you have another task planned?

Employee:
I will focus on the review and API integration.

AI Assistant:
Are there any blockers that might delay that work?
```

The AI must distinguish between complete answers and answers that
require clarification. It should avoid asking questions that have
already been answered.

### 5.4. Scheduler and Automation

**Priority: P0**

Schedules must be configurable without requiring a new deployment.

  ID        Requirement
  --------- ---------------------------------
  SCH-001   Create standup schedules
  SCH-002   Update schedules
  SCH-003   Delete or disable schedules
  SCH-004   Configure active weekdays
  SCH-005   Configure time zones
  SCH-006   Configure reminders
  SCH-007   Trigger standups manually
  SCH-008   Retry failed jobs
  SCH-009   Store job execution history
  SCH-010   Prevent duplicate job execution

Administrators should be able to configure schedules through
natural-language WhatsApp messages.

Example:

``` text
Admin:
Schedule standup from Monday to Friday at 9:00 AM WIB.

Bot:
The schedule has been saved.
Standup will run Monday through Friday at 9:00 AM
in the Asia/Jakarta time zone.
```

#### Indonesian National Holiday Calendar

**Priority: P0**

The scheduler must recognize:

-   Indonesian national public holidays.
-   Joint leave days (*cuti bersama*).
-   Weekends.
-   Company-specific calendar exceptions.

  ID        Requirement
  --------- ------------------------------------------------
  HOL-001   Synchronize Indonesian holiday data
  HOL-002   Store holiday data locally
  HOL-003   Distinguish national holidays from joint leave
  HOL-004   Configure joint-leave behavior independently
  HOL-005   Skip standup on excluded dates
  HOL-006   Support manual date exceptions
  HOL-007   Display upcoming holidays
  HOL-008   Notify administrators before holidays

The primary reference for official holiday data should be the applicable
Indonesian government Joint Ministerial Decree (*SKB 3 Menteri*). A
third-party API may be used as a data delivery mechanism, but imported
data should be validated against the official source.

Example configuration:

``` json
{
  "country": "ID",
  "timezone": "Asia/Jakarta",
  "skipWeekends": true,
  "skipNationalHolidays": true,
  "skipJointHolidays": true
}
```

Joint leave must be configurable separately because private-sector
companies may apply their own policies.

The system should retain the last successfully synchronized dataset so
that temporary API outages do not prevent the scheduler from making
decisions.

### 5.5. AI Conversational Agent

**Priority: P0**

The AI agent is one of the product's primary differentiators.

The agent must be able to:

-   Understand natural-language Indonesian.
-   Maintain relevant conversation context.
-   Retrieve standup history.
-   Use relevant GitHub and Figma activity.
-   Ask contextual follow-up questions.
-   Adapt its conversational style.
-   Summarize work updates.
-   Identify reported blockers.
-   Invoke authorized backend tools.

#### AI tools

  Tool                       Purpose
  -------------------------- ---------------------------------
  `get_employee`             Retrieve employee information
  `get_standup_history`      Retrieve standup history
  `create_standup`           Save a standup response
  `get_schedule`             Retrieve schedule configuration
  `create_schedule`          Create a schedule
  `update_schedule`          Update a schedule
  `get_team_activity`        Retrieve team activity
  `generate_daily_report`    Generate a daily report
  `generate_weekly_report`   Generate a weekly report

All tool calls must pass backend authorization, input validation, and
business-rule checks. The LLM must never be trusted as the authorization
layer.

#### AI context hierarchy

The agent may use the following context, subject to role-based access:

1.  Sender identity.
2.  Role and permissions.
3.  Employee profile and team.
4.  Relevant conversation history.
5.  Standup history.
6.  Relevant GitHub and Figma activity.
7.  Company schedules and configuration.

The agent must not treat GitHub or Figma activity as conclusive evidence
of employee productivity.

### 5.6. GitHub Integration

**Priority: P1**

The initial integration uses a GitHub App owned by the company's
operational GitHub account, `repodigithub`.

The integration must support selected private repositories.

Events to collect:

-   Pushes and commits.
-   Pull request creation and updates.
-   Pull request merges and closures.
-   Pull request reviews.
-   Issues.
-   Issue comments.

  ID        Requirement
  --------- --------------------------------------
  GIT-001   Receive GitHub webhooks
  GIT-002   Verify webhook signatures
  GIT-003   Process push events
  GIT-004   Process pull request events
  GIT-005   Process pull request review events
  GIT-006   Process issue events
  GIT-007   Map GitHub identities to employees
  GIT-008   Store a normalized activity timeline
  GIT-009   Configure tracked repositories
  GIT-010   Deduplicate webhook events

Example activity summary:

``` text
GitHub Activity

Employee: Budi Santoso

- 3 commits pushed
- PR #24 created
- PR #21 reviewed
- PR #19 merged
```

These records describe observed activity; they are not employee
performance scores.

Identity mapping must be careful: the pusher, commit author, and
committer may be different people. The system must not attribute
activity to an employee without sufficient identity evidence.

### 5.7. Figma Integration

**Priority: P1**

The system collects design activity through the Figma API and supported
webhooks.

Planned events:

-   File updates.
-   File version updates.
-   File comments.
-   Dev Mode status updates.

  ID        Requirement
  --------- -----------------------------------
  FIG-001   Connect Figma accounts
  FIG-002   Receive Figma webhooks
  FIG-003   Retrieve file information
  FIG-004   Collect file versions
  FIG-005   Collect comments
  FIG-006   Map Figma identities to employees
  FIG-007   Store a design activity timeline

Not every Figma event identifies the individual who made a change. The
system must not attribute activity to a person unless the source
provides reliable identity information.

### 5.8. Reporting and Analytics

**Priority: P1**

#### Daily report

The daily report should include:

-   Employees who submitted standups.
-   Employees who have not submitted standups.
-   Work summaries.
-   Reported blockers.
-   Relevant GitHub and Figma activity.

#### Weekly report

The weekly report should include:

-   Team progress summary.
-   Active projects.
-   Repeated or unresolved blockers.
-   Pull requests awaiting review.
-   Work that remains in progress.

#### Analytics dashboard

The dashboard should provide:

-   Standup completion rate.
-   Response rate.
-   Blocker count and trends.
-   Pull request and review activity.
-   Activity distribution by project.
-   Standup history.

The product must not rank employees by commit count, message count, or
other raw activity volume.

## 6. WhatsApp Admin Interface

Administrators can use simple commands or natural-language instructions.

  Command            Purpose
  ------------------ ---------------------------
  `MENU`             Show the main menu
  `HELP`             Show help
  `EMPLOYEE LIST`    List employees
  `ADD EMPLOYEE`     Add an employee
  `SCHEDULE`         Show schedules
  `REPORT TODAY`     Request today's report
  `REPORT WEEKLY`    Request the weekly report
  `HOLIDAY`          Show upcoming holidays
  `PAUSE STANDUP`    Pause standup schedules
  `RESUME STANDUP`   Resume standup schedules

Commands are optional shortcuts, not the only supported interaction
method.

Example natural-language instruction:

> Do not send standup next Monday because the company is observing a day
> off.

The AI should translate the request into a structured action, summarize
the proposed change, ask for confirmation, and let the backend validate
and persist it.

## 7. System Architecture

### 7.1. High-Level Architecture

``` text
                         WhatsApp
                         Baileys
                            |
                            v
                       Hono API
                            |
          +-----------------+------------------+
          |                 |                  |
          v                 v                  v
       AI Agent          Scheduler         Integrations
     LLM + Tools       BullMQ + Rules     GitHub + Figma
          |                 |                  |
          +-----------------+------------------+
                            |
                            v
                    PostgreSQL + Redis
                            |
                            v
                    Vue 3 Admin Dashboard
```

Responsibilities:

-   **WhatsApp adapter:** Handles WhatsApp sessions and messages.
-   **Hono API:** Provides HTTP APIs, webhook endpoints, authorization,
    and business logic.
-   **AI agent:** Interprets conversations and invokes approved tools.
-   **Scheduler and worker:** Executes scheduled and asynchronous jobs.
-   **Integration services:** Receive and normalize external activity
    events.
-   **PostgreSQL:** Stores application data.
-   **Redis:** Supports background job processing and queue
    coordination.
-   **Vue dashboard:** Provides administration and analytics interfaces.

### 7.2. Monorepo Structure

``` text
team-assistant/
├── apps/
│   ├── api/
│   │   └── src/
│   │       ├── modules/
│   │       │   ├── auth/
│   │       │   ├── employees/
│   │       │   ├── teams/
│   │       │   ├── standups/
│   │       │   ├── schedules/
│   │       │   ├── holidays/
│   │       │   ├── integrations/
│   │       │   ├── reports/
│   │       │   └── ai/
│   │       └── index.ts
│   ├── worker/
│   │   └── src/
│   │       ├── jobs/
│   │       ├── processors/
│   │       ├── schedulers/
│   │       └── index.ts
│   └── web/
│       └── src/
├── packages/
│   ├── database/
│   ├── shared/
│   └── config/
├── docker/
├── docker-compose.yml
└── package.json
```

## 8. Technology Stack

  Component         Technology
  ----------------- --------------------------------------------------
  Runtime           Node.js 22+
  Package manager   pnpm
  Monorepo          pnpm Workspaces
  Backend           Hono + TypeScript
  WhatsApp          Baileys
  Frontend          Vue 3 + Vite
  Database          PostgreSQL
  ORM               Drizzle ORM
  Background jobs   Redis + BullMQ
  Validation        Zod
  AI                OpenAI-compatible API provider
  Scheduling        BullMQ with database-backed schedule definitions
  Deployment        Docker Compose + Nginx

**Architecture note:** Schedule definitions and execution records must
be persisted in PostgreSQL. BullMQ/Redis handles asynchronous execution,
retries, and queue coordination. The system must reconcile scheduled
jobs after restarts and prevent duplicate execution. Redis must not be
the sole source of truth for business schedules.

## 9. Database Design

The following are the primary proposed tables. Exact columns, indexes,
constraints, and relationships will be specified in the technical design
document.

  -----------------------------------------------------------------------
  Domain                              Tables
  ----------------------------------- -----------------------------------
  Authentication                      `users`, `admins`, `roles`,
                                      `permissions`

  Employees                           `employees`, `teams`,
                                      `team_members`

  WhatsApp                            `whatsapp_sessions`,
                                      `whatsapp_messages`

  Conversations                       `conversations`,
                                      `conversation_messages`

  AI                                  `agent_configs`, `agent_memories`,
                                      `ai_usage_logs`

  Standups                            `standups`, `standup_answers`,
                                      `standup_sessions`

  Scheduling                          `schedules`, `scheduled_jobs`,
                                      `job_executions`

  Holidays                            `holidays`, `calendar_settings`,
                                      `calendar_exceptions`

  Integrations                        `integrations`,
                                      `employee_integrations`,
                                      `integration_credentials`

  Activity                            `activity_events`,
                                      `daily_activity_summaries`

  GitHub                              `github_installations`,
                                      `tracked_repositories`

  Figma                               `tracked_figma_files`

  Reporting                           `reports`

  Security                            `audit_logs`
  -----------------------------------------------------------------------

Conceptual relationships:

``` text
Employee
  ├── Standups
  ├── Conversations
  ├── Employee Integrations
  │     ├── GitHub Identity
  │     └── Figma Identity
  └── Activity Events

Schedule
  └── Scheduled Jobs
        └── Job Executions

Team
  ├── Team Members
  └── Team Reports
```

All timestamps must be stored in UTC and displayed using the configured
time zone. The default time zone is `Asia/Jakarta`.

## 10. Non-Functional Requirements

  -----------------------------------------------------------------------
  ID                      Requirement             Initial target
  ----------------------- ----------------------- -----------------------
  NFR-001                 API availability        99.5% target

  NFR-002                 API response time       p95 below 500 ms for
                                                  ordinary endpoints

  NFR-003                 Job reliability         Persistent job records
                                                  and retries

  NFR-004                 Duplicate prevention    Idempotent event and
                                                  job processing

  NFR-005                 Security                RBAC and encrypted
                                                  credentials

  NFR-006                 Time zone               `Asia/Jakarta` by
                                                  default

  NFR-007                 Auditability            Record administrative
                                                  changes

  NFR-008                 Scalability             API and workers can
                                                  scale independently

  NFR-009                 Data access             Employees can access
                                                  only authorized data

  NFR-010                 Observability           Structured logs and
                                                  error monitoring
  -----------------------------------------------------------------------

These are initial engineering targets and should be validated under
realistic workloads.

## 11. Security and Privacy

Because the system stores employee communications and work activity,
security and privacy are core requirements.

1.  WhatsApp phone numbers must be verified and mapped to employee
    identities.
2.  Administrative actions must be authorized by the backend using RBAC.
3.  GitHub and Figma credentials must be encrypted at rest.
4.  Webhook signatures must be verified.
5.  GitHub private keys and provider secrets must never be sent to the
    LLM.
6.  AI tool calls must not bypass authorization or business validation.
7.  Conversation and activity data must have documented retention
    policies.
8.  Employees must be informed about the categories of activity data
    being collected.
9.  The system must not automatically evaluate employee performance from
    raw activity counts.
10. Administrative actions must be recorded in an audit log.

## 12. MVP Scope and Prioritization

  Feature                                 MVP   Later phase
  -------------------------------------- ----- -------------
  WhatsApp pairing                        P0   
  Employee management                     P0   
  Daily standup                           P0   
  Reminders                               P0   
  Schedule management through WhatsApp    P0   
  Indonesian holiday calendar             P0   
  AI conversations                        P0   
  Daily report                            P0   
  GitHub integration                                P1
  Figma integration                                 P1
  Advanced analytics                                P1
  Weekly report                                     P1
  Advanced AI memory                                P2
  Multiple teams and schedules                      P2

### MVP Definition of Done

The MVP is considered complete when:

-   An administrator can pair the WhatsApp bot.
-   Administrators can add and deactivate employees.
-   Administrators can configure standup schedules through WhatsApp.
-   The bot sends standup prompts automatically.
-   The AI collects all three core standup elements.
-   The AI can ask relevant follow-up questions.
-   The scheduler skips national holidays and configured joint-leave
    dates.
-   Administrators can request a daily report.
-   Application data is persisted in PostgreSQL.
-   Scheduled jobs recover correctly after a server restart.
-   Job retries do not cause duplicate standup messages.

## 13. Development Milestones

The following estimates assume one developer working with reasonable
focus. They are planning estimates, not delivery guarantees.

  Milestone   Deliverable                                Estimate
  ----------- --------------------------------------- -----------
  M1          Project foundation and infrastructure     1--2 days
  M2          Database and authentication               2--3 days
  M3          WhatsApp integration                      2--4 days
  M4          Employee management                       1--2 days
  M5          Standup engine                            2--3 days
  M6          Scheduler and holiday calendar            2--3 days
  M7          AI conversational agent                   3--5 days
  M8          GitHub integration                        2--4 days
  M9          Figma integration                         2--4 days
  M10         Reporting and dashboard                   3--5 days
  M11         Production hardening                      2--4 days

Indicative total: approximately **22--39 working days**, depending on
integration complexity, testing requirements, and implementation
quality.

## 14. Product Success Metrics

Success should be measured by product outcomes, not simply by the number
of features delivered.

  Metric                                                 Initial target
  ------------------------------ --------------------------------------
  Standup completion rate                                  At least 85%
  Duplicate standup messages                                          0
  Scheduler execution success                              At least 99%
  Successful WhatsApp delivery                             At least 98%
  Admin schedule management                100% manageable through chat
  Daily report generation                                Under 1 minute
  Holiday skip accuracy            100% against validated calendar data

These are initial targets. They should be reviewed after the product has
been used by the team.

## 15. Risks and Mitigations

  -----------------------------------------------------------------------
  Risk                                Mitigation
  ----------------------------------- -----------------------------------
  Baileys disconnects                 Reconnect handling, session
                                      persistence, and monitoring

  WhatsApp account restrictions       Rate limiting and evaluation of the
                                      official API

  AI misunderstands an instruction    Confirmation flow and schema
                                      validation

  Jobs execute more than once         Idempotency and distributed
                                      coordination

  Holiday API becomes unavailable     Local cache and validated fallback
                                      data

  Duplicate GitHub webhooks           Event ID deduplication

  Figma does not identify an          Do not attribute activity without
  individual editor                   evidence

  AI usage costs increase             Usage logging, token budgets, and
                                      model routing

  Credential exposure                 Encryption and secret management
  -----------------------------------------------------------------------

## 16. Open Product Decisions

The following decisions should be confirmed before implementation. The
proposed defaults reflect the current product direction.

  -----------------------------------------------------------------------
  Decision                Recommended default     Alternatives
  ----------------------- ----------------------- -----------------------
  Standup interaction     Hybrid AI               Structured form; free
                                                  conversation

  Employee scope          All active employees    Selected teams

  Daily report recipients All administrators      Admins and managers;
                                                  per-team recipients

  AI provider             OpenAI-compatible API   OpenAI API directly;
                                                  self-hosted model

  Dashboard delivery      After the WhatsApp MVP  Developed alongside the
                                                  backend
  -----------------------------------------------------------------------

## 17. Recommended Next Steps

Do not ask an AI coding agent to generate the entire application from
this PRD in one step.

Recommended sequence:

1.  Confirm the open product decisions.
2.  Create a Technical Design Document (TDD).
3.  Design and review the database ERD.
4.  Define the API specification.
5.  Break the work into GitHub Issues grouped by milestone.
6.  Implement incrementally, with tests and acceptance criteria for each
    module.

**This PRD is the product-level source of truth.** The TDD should define
how the requirements are implemented technically. Keeping those
documents separate reduces ambiguity and helps prevent coding agents
from inventing business rules or architecture decisions.
