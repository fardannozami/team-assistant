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
| Instruction to the AI CEO | *Instruksi ke Naya* creates a task in **triage**; the decomposer splits it into tasks for the specialist profiles (`kanban.auto_decompose`, default on) |
| In progress | todo / ready / running: agents claim and work |
| Waiting for review | **review**: the agent called `request-review` |
| Selesai (approved) | *Setujui*: `complete --result "Disetujui oleh …"` |
| Feedback / revisi | *Minta revisi*: `reopen-review --reason "…"`. The note becomes a comment the agent sees when it reworks |
| Ditolak | *Tolak*: `block --kind needs_input "[Ditolak oleh …] …"` |

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

## Claude Code in the office

When `claude --version` works where the bridge runs, Claude Code gets its own desk.
- **Working:** while one of its sessions changed in the last 3 minutes. The desk shows the project folder name.
- **Working "atas perintah <profile>":** when a Hermes agent's log shows it running `claude -p`.
- **Data read:** only session-file times and the newest session's working-folder name. Transcripts are never read.
- **Where it appears:** in development (Hermes on your machine) it shows up right away. In production, the Hermes image does not include Claude Code yet, so there is no desk.

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
   OPS_SERVICES=api,web,worker,agents,naya
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
