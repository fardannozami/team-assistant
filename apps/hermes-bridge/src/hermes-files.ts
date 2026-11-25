import { Database } from 'bun:sqlite'
import { closeSync, existsSync, fstatSync, openSync, readdirSync, readSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Task } from './mission-control.js'

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

/** Any Kanban database besides the default board's (more boards: the CLI reads those). */
function hasOtherBoards(home: string): boolean {
  const walk = (dir: string, depth: number): boolean => {
    let entries
    try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return false }
    return entries.some((entry) => entry.isFile() ? entry.name.endsWith('.db') : entry.isDirectory() && depth > 0 && entry.name !== 'workspaces' && entry.name !== 'logs' && walk(join(dir, entry.name), depth - 1))
  }
  return walk(join(home, 'kanban'), 2)
}

/** Open tasks (not archived) of the default board in kanban.db; undefined when the CLI should read them. */
export function readKanbanTasks(home: string): Task[] | undefined {
  const path = join(home, 'kanban.db')
  if (!existsSync(path) || hasOtherBoards(home)) return undefined
  const db = new Database(path, { readonly: true })
  try {
    const rows = db.query("select id, title, status, assignee, priority from tasks where status != 'archived' order by created_at").all() as { id: string; title: string; status: string; assignee: string | null; priority: number | null }[]
    return rows.map((row) => ({
      title: row.title,
      status: row.status.toLowerCase(),
      ...(/^[A-Za-z0-9_-]+$/.test(row.id) ? { id: row.id } : {}),
      ...(row.assignee ? { assignee: row.assignee } : {}),
      ...(typeof row.priority === 'number' ? { priority: row.priority } : {}),
    }))
  } finally {
    db.close()
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
