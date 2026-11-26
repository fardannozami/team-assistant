# Naya: the AI team (naya.digdaya.co)

Naya is the office of Digdaya's AI team. It is a second web app on the same API, database and login
as the dashboard (daily.digdaya.co). The team gives instructions there, reviews the agents' work and
chats with them. The agents are **Hermes Agent** profiles, running in the `hermes` container.

```
naya.digdaya.co (apps/naya)  ─┐
daily.digdaya.co (apps/web)  ─┴─▶ api (apps/api) ─┬─▶ hermes:8700  hermes-bridge (Kanban, status, usage)
                                                 ├─▶ hermes:8642  Hermes API server (chat)
                                                 └─▶ docker-socket-proxy (ops: status, logs, restart)
hermes (agents) ──MCP, Bearer ta_agent_… ──▶ api /mcp (daily data; ops tools for the ops agent)
```

## How the pieces map to the blueprint

The Hermes Kanban is the source of truth:

| Blueprint | Hermes |
|---|---|
| Instruction to the AI CEO | *Instruksi ke Naya* creates a task in **triage**. `claude-worker` is the only splitter: it works the task at once or splits it into 2–5 subtasks. Hermes' own decomposer is off (`kanban.auto_decompose: false`) and is never called |
| In progress | todo / ready / running: agents claim and work |
| Waiting for review | **review**: the agent called `request-review` |
| Selesai (approved) | Every checklist item *Selesai*: `complete --result "Disetujui oleh …"` |
| Feedback / revisi | Checklist items with *Feedback* (and none *Ditolak*): `reopen-review --reason "…"` listing each item's note. The agent sees it as a comment when it reworks |
| Ditolak | A checklist item *Ditolak*, or *Tolak seluruh kartu*: `block --kind needs_input "[Ditolak oleh …] …"` |

### The agent roster

`packages/shared/src/naya-roster.json` lists the blueprint's agents: code, input, output, the human role that reviews them, and the instructions each one works by. When `claude-worker` splits a card, it acts as Naya Core and assigns each subtask, and the final assembly, to an agent from this roster. The agent's code becomes the Hermes assignee, and its contract becomes the system prompt. Subtasks name the earlier subtasks whose results they need. Those that need none run at the same time, up to `CLAUDE_WORKER_PARALLEL` (default 3), and the card itself runs last.

Agents that need tools the worker does not have yet (web research for 1A/1B/4A/4B, GitHub for 3C/3D) are marked `available: false` and are never picked. The Agent page lists the roster. Labels such as "2B · Transcript-to-PRD & Backlog" appear on the board and in the checklist, together with the reviewer role from the blueprint.

### The human half: PIC and checklist

Hermes keeps the AI side of a card; daily's Postgres keeps the people (`naya_cards`, `naya_checklist_items`, `naya_learned_rules`, in `apps/api/src/modules/naya/checklist.ts`):

- **PIC.** Each card has a person in charge: a team member (an employee in daily), chosen in *Instruksi ke Naya* and changeable in the card detail. The default is *Otomatis*. When the AI hands the card over, it goes to the most available Sales/PM member: someone santai (standby by today's standup) first, then someone working, then someone who has not sent a standup yet, never someone who has checked out. Ties go to whoever has fewer checklist items waiting. A member's pool comes from their position (`employees.lead`: `pm_sales`; `designer`/`design`; `developer`/`development`), or else from their team's name (`nayaPoolOf` in `packages/shared`). A member decides in Naya themselves when their daily account is linked to their employee record; anyone who may review can also decide for them.
- **Handover.** When a card reaches **review**, it gets a checklist: one item per subtask result, plus the card's own result, each owned by the card's PIC. Every 10 minutes the worker calls `POST /naya/notify`, which sends the PIC a WhatsApp message with a link straight to the card (`<NAYA_WEB_URL>/#/my-tasks/<board>/<id>`). The phone comes from the person's employee record (`employees.user_id`).
- **Decisions.** The PIC (or anyone who may review) marks each item *Selesai*, *Feedback* (note required) or *Ditolak* (reason required). The card waits while any item is still *In Progress*. When the last item is decided, the card moves in Hermes in the same transaction: if Hermes refuses, the decision is not saved.
- **Next version.** Items that were not *Selesai* go back to *In Progress* as the next version (v2, v3, …) and are handed over again when the agent returns the card to review. Their notes are kept as candidate `naya_learned_rules` for the agent; activating them is still manual.
- **Follow-up email.** When the natural next step is an email to a client or prospect, the AI writes it in full. It appears in the card's discussion as a *Template email*, with buttons that copy the subject and the body to send from the PM's own account. Naya never sends it.
- **On to design or development.** A card whose checklist is all *Selesai* can continue with *Lanjut ke Designer* or *Lanjut ke Developer*. This creates a new card that waits on the approved one, so the agent reads its full result. Agent 3A writes the design requirement, or 2B writes the PRD. The new card's PIC is picked automatically from the designer or developer pool when the agent is done. A card continues only once.
- **Tugas Saya.** It lists the cards waiting on you, and cards waiting more than 48 hours come first. Those cards also get a WhatsApp reminder at most once a day.

Humans decide when work is done:

- Every instruction from Naya ends with a note telling the agent to finish with `request-review`, not `complete` (`REVIEW_NOTE` in `apps/hermes-bridge/src/kanban-write.ts`). The profiles' `SOUL.md` says the same, for tasks the agents create themselves.
- `kanban.review_dispatch: false` in every profile's config. Otherwise Hermes hands review tasks to a reviewer agent, which approves them before anyone in Naya sees them.

Files an agent attaches to a task (`kanban_complete` keeps the deliverables of its scratch workspace this way, because the workspace is deleted afterwards) show under *Lampiran* in the task detail. Text files open in place, and anything can be downloaded, up to 10 MB. The bridge serves a file only when its stored path resolves inside `HERMES_HOME`.

Every action is checked against the person's daily role and written to `audit_logs`:

| Action | Roles |
|---|---|
| instruct | Owner, Admin, PM |
| review | Owner, Admin, Manager, PM |
| comment | everyone |
| chat | per agent |

What each role sees follows the blueprint's access matrix (`NAYA_VIEWS` in `packages/shared`). The menu hides a page, and the API refuses its data too:

| Page | Owner, Admin, Manager, PM | Employee |
|---|---|---|
| Kantor, Tugas Saya, Pengaturan | ✓ | ✓ |
| Papan Tugas | every card | only the cards they are the PIC of (of the card or of an item), and those cards' subtasks |
| Agent, Kalender, Pemakaian | ✓ | — (`/runtime`, `/calendar`, `/usage` answer 403) |

A card someone may not see answers 404 in its detail, attachments, checklist and comments, so its existence is not given away. In the PIC picker, employees get only names: who is santai and how much waits on whom is for those who assign work. In the office, employees see every colleague's avatar and presence, but only their own plan: `/team` sends a colleague's tasks empty, and the detail panel leaves the kanban out.

## OpenCode in the office

OpenCode gets a desk when `opencode --version` works where the bridge runs, or when its session database (`opencode.db`) is readable there. It is **Working** while one of its sessions got a message in the last 3 minutes; only times and the newest session's folder name are read.
- **Local development:** the bridge runs on your machine, so it finds your own OpenCode.
- **Production:** OpenCode runs on the host, outside the `hermes` container. Set `OPENCODE_HOST_DATA` in `.env` to its data folder on the host (`~/.local/share/opencode` of the user who runs it, e.g. `/root/.local/share/opencode`). Then run `docker compose -f docker-compose.prod.yml up -d hermes`. The folder is mounted read-only. The container's user (uid 10000) must be able to read it: the folder itself needs `r-x` for others, and `opencode.db*` need `r--`.

## Claude Code in the office

When `claude --version` works where the bridge runs, Claude Code gets its own desk.
- **Working:** while one of its sessions changed in the last 3 minutes. The desk shows the project folder name.
- **Working "atas perintah <profile>":** when a Hermes agent's log shows it running `claude -p`.
- **Data read:** only session-file times and the newest session's working-folder name. Transcripts are never read.
- **Where it appears:** in development (Hermes on your machine) it shows up right away. In production, the Hermes image does not include Claude Code yet, so there is no desk.

## The team in the office

People on the team (daily's standup targets) get an avatar next to the agents, with an ID lanyard. It follows their standup for today (their shift's date), from `GET /naya/team`:
- **No standup yet:** not in the office. The HUD's *Tim hadir* counts them as *belum standup*.
- **Standup sent:** at a desk, working. The speech bubble shows the first item of the plan.
- **Plan is only exploration or standby** (e.g. "Standby", "Eksplorasi Three.js", "Belum ada task"): *Standby*, santai around the office like an idle agent. One real task in the plan is enough to sit at a desk.
- **Checked out** (or the checkout was missed): *Istirahat*, in bed upstairs.

Clicking the avatar shows today's work as a small kanban: *Dikerjakan* (each line of the plan), *Selesai* (each line of the checkout's done answer; a plan item it mentions moves here) and *Kendala* (the blockers). Everyone who can open Naya sees it; phone numbers are not sent.

## Isolation

- The `hermes` container is only on the Docker network `agents`.
  - It cannot reach Postgres, Redis, the Docker socket, WhatsApp sessions or daily's `.env`.
  - It does have the internet (web research, browser).
- The agents read daily over MCP, with a token per agent: Pengaturan › AI › *Token MCP agent*.
  - `mcp:read`: projects, team, standups, reports, idle members and leads. No fees, no phone numbers.
  - `ops:read` and `ops:restart` (Owner only, for the `ops` agent): status and redacted logs of `OPS_SERVICES`, and restarting one of them. Every restart is audited and sent to Owners and Admins on WhatsApp.
- The Docker proxy (`docker-socket-proxy`) allows only container reads and restarts, and only the `api` container can reach it (network `ops`).

## First deploy

1. **`.env` on the VPS:**
   ```bash
   NAYA_WEB_URL=https://naya.digdaya.co
   BRIDGE_TOKEN=<openssl rand -hex 32>
   OPS_SERVICES=api,web,worker,naya
   OPS_COMPOSE_PROJECT=<the compose project name, usually the folder name: team-assistant>
   NAYA_PORT=3001
   # HERMES_UID/HERMES_GID: only if you mount hermes-data from a host folder
   ```
   GitHub repository variables:
   - `VITE_DAILY_URL=https://daily.digdaya.co` (Naya links back to it)
   - `VITE_API_URL` (already set, shared by both apps)

2. **Caddy:**
   ```caddy
   naya.digdaya.co {
     encode zstd gzip
     reverse_proxy 127.0.0.1:3001
   }
   ```
   The API's own block needs no change. Chat streams (SSE) pass through Caddy as they are.

3. **Deploy** (push to `main`): the workflow builds `naya` and `hermes`, and pulls `docker-socket-proxy`.

4. **Set up Hermes once**. Everything lands in the `hermes-data` volume:
   ```bash
   compose="docker compose -f docker-compose.prod.yml"
   $compose exec hermes hermes setup            # model + key (paid Gemini API key recommended)
   $compose exec hermes hermes profile create naya    --description "Lead: plans work, splits instructions, checks results"
   $compose exec hermes hermes profile create sales   --description "Leads, prospect research, outreach drafts"
   $compose exec hermes hermes profile create design  --description "UI/UX trends, briefs, moodboards"
   $compose exec hermes hermes profile create content --description "Blog SEO, case studies, social posts, video scripts"
   $compose exec hermes hermes profile create ops     --description "Watches the app's services; restarts when stuck"
   $compose exec hermes hermes config set kanban.orchestrator_profile naya
   $compose exec hermes hermes config set kanban.review_dispatch false   # and with -p <profile> for each profile
   ```
   - Web search: run `hermes tools` in the container and choose Tavily, Firecrawl or Exa with a key. The keyless tier works, but with limits.
   - The `ops` profile gets no web tools.

5. **API server per profile** (chat from Naya). In each profile's `.env` inside the volume (`/opt/data/.env` for `default`, `/opt/data/profiles/<name>/.env` for the others):
   ```bash
   API_SERVER_ENABLED=true
   API_SERVER_KEY=<openssl rand -hex 24>
   ```
   One listener serves every profile, at `/p/<profile>/v1` (multiplexing is on by default). Then run `$compose restart hermes`.

6. **Register the agents in daily** (Pengaturan › AI › *Agent Naya*):
   - Profile name, display name, its `API_SERVER_KEY`, and which roles may chat.
   - Mark `naya` as **lead**; it answers *Tanya Naya*.

7. **MCP for the agents.** Create a token per profile in daily (`mcp:read`; for `ops` also `ops:read`/`ops:restart`), then in the profile's `config.yaml`:
   ```yaml
   mcp_servers:
     daily:
       url: https://<api-host>/mcp
       headers:
         Authorization: "Bearer ta_agent_…"
   ```
   The agents reach the API by its public URL. `http://api:4000/mcp` also works from the container, because `api` is on the `agents` network.

8. **Backups.** Back up the `hermes-data` volume nightly. The simplest way is a Hermes cron job on the `ops` profile that commits `/opt/data` (without `.env` files and `*.db`) to a private git repo. Alternatively, snapshot the volume from the host.

## Signing in

- **daily → Naya:** **Naya ↗** in the dashboard header opens Naya already signed in. It uses a one-time link that is valid for a minute.
- **Directly:** *Masuk dengan Google* on naya.digdaya.co uses the same Google login as daily.
- **Phone:** send `NAYA` to the WhatsApp bot to get a one-time link, valid for 10 minutes.
- **From a handover:** every card link in a WhatsApp handover or reminder signs its PIC in and opens that card (`#login=<code>&next=/my-tasks/<board>/<id>`). The link is made for that person, can be used once, and lasts 12 hours. After that, `NAYA` gets a fresh one.
- **Team members need no invite.** Their WhatsApp number already identifies them. The first time a member gets a link (a handover or `NAYA`), Naya makes them a daily account with the Employee role and links it to their employee record (`employees.user_id`). It has a placeholder email `wa.<number>.<workspace>@naya.invalid` (`apps/api/src/modules/naya/accounts.ts`). An admin can raise the role or deactivate it in Settings › Users, or still invite the member's Google email.
- **Signing out:** *Keluar* signs this browser out.
  - The session is daily's JWT, which lasts 7 days.
  - Deactivating someone in daily blocks them right away.

## Local development

**With Hermes installed on your machine** (the usual case): `bun run dev` starts everything.
- `api`, `web` (:3000), `worker` and `agents` as before.
- `naya` (:3001).
- `hermes-bridge` (127.0.0.1:8700). It reads your own `hermes` CLI and `~/.hermes`.

No Docker is needed for Hermes. `.env`:
```bash
NAYA_WEB_URL=http://localhost:3001
HERMES_BRIDGE_URL=http://localhost:8700
HERMES_API_URL=http://localhost:8642      # chat: your Hermes API server
BRIDGE_TOKEN=<any 16+ characters>
DOCKER_PROXY_URL=http://localhost:2375     # only for the ops tools (see below)
```

Chat: in `~/.hermes/.env` set the following, then restart the gateway (`hermes gateway restart`):
```bash
API_SERVER_ENABLED=true
API_SERVER_KEY=<a key>
```
Then register the profile (e.g. `default`) in daily › Pengaturan › AI › *Agent Naya* with that key, and allow your role to chat.

Ops tools: these are optional in development. Run the Docker proxy alone:
```bash
docker compose --profile agents up docker-socket-proxy
```

**Hermes in Docker instead:**
```bash
docker compose --profile agents up hermes docker-socket-proxy
```
- Its ports 8700 and 8642 clash with a host Hermes, so stop one of them first.
- Set it up as in steps 4–7 above, with `docker compose exec hermes …`.

Tests:
- `bun test` in `apps/api` and in `apps/hermes-bridge` (the Hermes CLI is faked).
- `vitest` in `apps/naya`.
- CI does not run Hermes.

## Upgrading Hermes

Bump the tag and digest in `docker/hermes.Dockerfile` together. Use the `stable` tag's version from
Docker Hub (`nousresearch/hermes-agent`), then deploy. The data in `hermes-data` is kept.
