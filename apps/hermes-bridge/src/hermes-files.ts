import { Database } from 'bun:sqlite'
import { closeSync, existsSync, fstatSync, openSync, readdirSync, readFileSync, readSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { GatewayState, KanbanBoard, Profile, ScheduledJob, Session, Task } from './mission-control.js'

// Hermes keeps its Kanban, sessions and logs in files under HERMES_HOME. Reading them directly
// takes milliseconds; the same read through the `hermes` CLI starts Python and takes 4-25 s (and
// seconds of CPU) on a small server, which timed out the board and the agents' states. Writes
// still go through the CLI. Every reader here only reads.

export function hermesHome(env: NodeJS.ProcessEnv = process.env): string {
  return env.HERMES_HOME || join(homedir(), '.hermes')
}

/** Where a profile's own files live: `default` is Hermes' home itself. */
export function profileHome(home: string, profile: string): string {
  return profile === 'default' ? home : join(home, 'profiles', profile)
}

export interface KanbanFiles { boards: KanbanBoard[]; tasks: Task[] }

const BOARD_SLUG = /^[a-z0-9][a-z0-9_-]{0,63}$/

function readJson(path: string): Record<string, unknown> {
  try { return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown> } catch { return {} }
}

/** Open tasks (not archived) of one board's kanban.db, tagged with the board. */
function readBoardTasks(path: string, board: string): Task[] {
  const db = new Database(path, { readonly: true })
  try {
    const rows = db.query("select id, title, status, assignee, priority from tasks where status != 'archived' order by created_at").all() as { id: string; title: string; status: string; assignee: string | null; priority: number | null }[]
    return rows.map((row) => ({
      title: row.title,
      status: row.status.toLowerCase(),
      ...(/^[A-Za-z0-9_-]+$/.test(row.id) ? { id: row.id } : {}),
      ...(row.assignee ? { assignee: row.assignee } : {}),
      ...(typeof row.priority === 'number' ? { priority: row.priority } : {}),
      board,
    }))
  } finally {
    db.close()
  }
}

/**
 * Every Kanban board and its open tasks, as `hermes kanban boards list` and `kanban list` give them:
 * `default` is `<home>/kanban.db`, the others `<home>/kanban/boards/<slug>/kanban.db` with a
 * `board.json` (archived ones are left out). The current board is `HERMES_KANBAN_BOARD`, else the
 * slug in `<home>/kanban/current`, else `default`. Undefined without kanban.db (no Kanban here).
 */
export function readKanban(home: string, env: NodeJS.ProcessEnv = process.env): KanbanFiles | undefined {
  const root = join(home, 'kanban', 'boards')
  if (!existsSync(join(home, 'kanban.db'))) return undefined
  const found: { slug: string; name: string; path: string }[] = [{ slug: 'default', name: 'Default', path: join(home, 'kanban.db') }]
  let dirs: string[] = []
  try { dirs = readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort() } catch { dirs = [] }
  for (const slug of dirs) {
    const meta = readJson(join(root, slug, 'board.json'))
    const path = join(root, slug, 'kanban.db')
    if (!BOARD_SLUG.test(slug) || slug === 'default' || meta.archived === true || !existsSync(path)) continue
    found.push({ slug, name: typeof meta.name === 'string' && meta.name ? meta.name : slug, path })
  }
  let current = 'default'
  try { current = readFileSync(join(home, 'kanban', 'current'), 'utf8').trim() } catch { /* no current file: default */ }
  const wanted = (env.HERMES_KANBAN_BOARD ?? '').trim() || current
  current = found.some((board) => board.slug === wanted) ? wanted : 'default'
  const perBoard = found.map((board) => readBoardTasks(board.path, board.slug))
  return {
    boards: found.map((board, index) => ({ slug: board.slug, name: board.name, current: board.slug === current, total: perBoard[index].length })),
    tasks: perBoard.flat(),
  }
}

const LOG_TAIL_BYTES = 128 * 1024
const LOG_TIME = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:[,.](\d{1,3}))?/

/** Lines of a Hermes log written in the last `windowMs` (Hermes stamps them in local time); '' without a log. */
export function recentLogLines(path: string, windowMs: number, now = Date.now()): string {
  let fd: number
  try { fd = openSync(path, 'r') } catch { return '' }
  try {
    const size = fstatSync(fd).size
    const length = Math.min(size, LOG_TAIL_BYTES)
    const buffer = Buffer.alloc(length)
    readSync(fd, buffer, 0, length, size - length)
    const lines = buffer.toString('utf8').split('\n')
    if (length < size) lines.shift() // the first line was cut in half
    const from = now - windowMs
    const index = lines.findIndex((line) => {
      const time = line.match(LOG_TIME)
      return time ? new Date(+time[1], +time[2] - 1, +time[3], +time[4], +time[5], +time[6], +(time[7] ?? 0)).getTime() >= from : false
    })
    return index < 0 ? '' : lines.slice(index).join('\n')
  } finally {
    closeSync(fd)
  }
}

/** When the profile's newest session last moved (ms), from its state.db; undefined without one. */
export function lastSessionActivity(path: string): number | undefined {
  if (!existsSync(path)) return undefined
  const db = new Database(path, { readonly: true })
  try {
    const row = db.query('select max(coalesce(last_activity_at, ended_at, started_at)) as at from sessions').get() as { at: number | null } | null
    return typeof row?.at === 'number' ? row.at * 1000 : undefined
  } finally {
    db.close()
  }
}

// ---------------------------------------------------------------------------
// Profiles, sessions and cron, the way `hermes profile list`, `sessions list` and `cron list`
// read them (hermes_cli/profiles.py, sessions_cmd.py, cron.py of Hermes 0.23).

const PROFILE_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/
/** A folder under profiles/ is a profile only when it carries one of these (hermes_constants). */
const PROFILE_MARKERS = ['config.yaml', '.env', 'SOUL.md', 'profile.yaml', 'auth.json', 'state.db']

/** Bun's built-in YAML parser (Bun 1.2.21+; the installed bun-types do not declare it yet). */
const yaml = (Bun as unknown as { YAML: { parse: (text: string) => unknown } }).YAML

function readYaml(path: string): Record<string, unknown> {
  try {
    const value = yaml.parse(readFileSync(path, 'utf8'))
    return value && typeof value === 'object' ? value as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

/** The pid in a gateway.pid ({"pid": n, …}, or a bare number) when that process is alive. */
function livePid(path: string): number | undefined {
  let pid: number | undefined
  try {
    const raw = readFileSync(path, 'utf8').trim()
    pid = raw.startsWith('{') ? Number((JSON.parse(raw) as { pid?: unknown }).pid) : Number(raw)
  } catch {
    return undefined
  }
  if (!Number.isInteger(pid) || pid <= 0) return undefined
  try {
    process.kill(pid, 0)
    return pid
  } catch (error) {
    // EPERM: the process exists, it is just not ours to signal.
    return (error as NodeJS.ErrnoException).code === 'EPERM' ? pid : undefined
  }
}

function configModel(dir: string): string {
  const model = readYaml(join(dir, 'config.yaml')).model
  if (typeof model === 'string' && model) return model
  if (model && typeof model === 'object') {
    const value = (model as Record<string, unknown>).default ?? (model as Record<string, unknown>).model
    if (typeof value === 'string' && value) return value
  }
  return 'Not configured'
}

/**
 * Every profile with its model, display name and gateway. A profile's gateway runs when its own
 * gateway.pid is alive, or (named profiles) when the default gateway is alive and multiplexes it:
 * it lists the profile in `served_profiles` of its gateway_state.json and has not parked it.
 * Undefined when this is not a Hermes home.
 */
export function readProfiles(home: string): Profile[] | undefined {
  if (!existsSync(join(home, 'config.yaml'))) return undefined
  const hostAlive = livePid(join(home, 'gateway.pid')) !== undefined
  const hostState = readJson(join(home, 'gateway_state.json'))
  const served = Array.isArray(hostState.served_profiles) ? hostState.served_profiles.filter((name): name is string => typeof name === 'string') : []
  const parked = hostState.parked_profiles && typeof hostState.parked_profiles === 'object' ? Object.keys(hostState.parked_profiles) : []
  let named: string[] = []
  try {
    named = readdirSync(join(home, 'profiles'), { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name !== 'default' && PROFILE_ID.test(entry.name))
      .map((entry) => entry.name)
      .filter((name) => PROFILE_MARKERS.some((marker) => existsSync(join(home, 'profiles', name, marker))) && !existsSync(join(home, 'profiles', '.deleted', name)))
      .sort()
  } catch { named = [] }
  return ['default', ...named].map((name): Profile => {
    const dir = profileHome(home, name)
    const own = name === 'default' ? hostAlive : livePid(join(dir, 'gateway.pid')) !== undefined
    const gateway: GatewayState = own || (name !== 'default' && hostAlive && served.includes(name) && !parked.includes(name)) ? 'Running' : 'Stopped'
    const displayName = readYaml(join(dir, 'profile.yaml')).display_name
    return { name, model: configModel(dir), gateway, ...(typeof displayName === 'string' && displayName.trim() ? { displayName: displayName.trim() } : {}) }
  })
}

/** "just now", "5m ago", "3h ago", "yesterday", "3d ago", then the date: Hermes' timefmt.relative_time. */
export function relativeTime(at: number, now = Date.now()): string {
  const seconds = Math.max(0, (now - at) / 1000)
  if (seconds < 60) return 'just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`
  if (seconds < 172_800) return 'yesterday'
  if (seconds < 604_800) return `${Math.floor(seconds / 86_400)}d ago`
  const date = new Date(at)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

/** The newest sessions of a profile's state.db, as `sessions list` shows them (no archived, hidden, child or tool sessions). Titles only: messages are never read. */
export function readSessions(dir: string, limit = 20, now = Date.now()): Session[] | undefined {
  const path = join(dir, 'state.db')
  if (!existsSync(path)) return undefined
  const db = new Database(path, { readonly: true })
  try {
    const rows = db.query("select id, title, display_name, source, coalesce(last_activity_at, ended_at, started_at) as at from sessions where archived = 0 and hidden = 0 and parent_session_id is null and source != 'tool' order by at desc limit ?").all(limit) as { id: string; title: string | null; display_name: string | null; source: string; at: number }[]
    return rows.map((row) => ({
      title: row.title?.trim() || row.display_name?.trim() || 'Sesi tanpa judul',
      preview: '',
      lastActive: relativeTime(row.at * 1000, now),
      id: row.id,
      ...(row.source ? { source: row.source } : {}),
    }))
  } finally {
    db.close()
  }
}

/** `cron list` waits this long past a job's next run before calling it overdue. */
const OVERDUE_GRACE_MS = 15 * 60_000

/** One profile's cron jobs from `cron/jobs.json` (none when it has no file). Error text is never returned. */
export function readCronJobs(dir: string, profile: string, now = Date.now()): ScheduledJob[] {
  const path = join(dir, 'cron', 'jobs.json')
  if (!existsSync(path)) return []
  const data = JSON.parse(readFileSync(path, 'utf8')) as { jobs?: unknown } | unknown[]
  const jobs = Array.isArray(data) ? data : Array.isArray((data as { jobs?: unknown }).jobs) ? (data as { jobs: unknown[] }).jobs : undefined
  if (!jobs) throw new Error('Unrecognized jobs.json.')
  return jobs.flatMap((item): ScheduledJob[] => {
    if (!item || typeof item !== 'object') return []
    const job = item as Record<string, unknown>
    const text = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim() : undefined
    const id = text(job.id)
    const scheduleInfo = job.schedule && typeof job.schedule === 'object' ? job.schedule as Record<string, unknown> : {}
    const schedule = text(job.schedule_display) ?? text(scheduleInfo.display) ?? text(scheduleInfo.value) ?? text(job.schedule)
    if (!id || !schedule) return []
    const state = text(job.state)
    const status = state === 'paused' || state === 'completed' ? state : job.enabled === false ? 'disabled' : 'active'
    const nextRun = text(job.next_run_at)
    const late = nextRun ? now - Date.parse(nextRun) : NaN
    const repeat = job.repeat && typeof job.repeat === 'object' ? job.repeat as Record<string, unknown> : {}
    const lastStatus = text(job.last_status)
    const lastRun = text(job.last_run_at)
    return [{
      name: text(job.name) ?? id,
      schedule,
      id,
      status,
      ...(nextRun ? { nextRun } : {}),
      ...(status === 'active' && late > OVERDUE_GRACE_MS ? { overdue: true } : {}),
      repeat: typeof repeat.times === 'number' ? `${typeof repeat.completed === 'number' ? repeat.completed : 0}/${repeat.times}` : '∞',
      ...(lastStatus && lastRun ? { lastRun, lastRunOk: lastStatus === 'ok' } : {}),
      agent: profile,
    }]
  })
}
