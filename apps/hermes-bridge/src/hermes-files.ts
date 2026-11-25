import { Database } from 'bun:sqlite'
import { closeSync, existsSync, fstatSync, openSync, readdirSync, readFileSync, readSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { KanbanBoard, Task } from './mission-control.js'

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
