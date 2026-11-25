import { Database } from 'bun:sqlite'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import type { ClaudeSessions } from './claude-code.js'

// OpenCode used by a person (not only driven by a Hermes agent): its sessions live in a SQLite
// database. Only metadata is read: when each session's latest message was written, and the
// session's working folder for the project name. Messages and titles are never read.

export const OPENCODE_ACTIVE_MS = 3 * 60_000

/** Same shape as Claude Code's: active sessions, the newest one's folder, when it last moved. */
export type OpenCodeSessions = ClaudeSessions

/** `$OPENCODE_DATA_DIR` or `~/.local/share/opencode`, where OpenCode keeps `opencode.db`. */
export function openCodeDatabase(env: NodeJS.ProcessEnv = process.env): string {
  return join(env.OPENCODE_DATA_DIR || join(env.XDG_DATA_HOME || join(homedir(), '.local', 'share'), 'opencode'), 'opencode.db')
}

export function collectOpenCodeSessions(path = openCodeDatabase(), now = Date.now()): OpenCodeSessions {
  const fetchedAt = new Date(now).toISOString()
  let db: Database | undefined
  try {
    db = new Database(path, { readonly: true })
    const recent = db.query('select session_id as id, max(time_updated) as at from session_message group by session_id order by at desc limit 20').all() as { id: string; at: number }[]
    const active = recent.filter((row) => now - row.at <= OPENCODE_ACTIVE_MS)
    const newest = recent[0]
    const folder = active.length ? (db.query('select directory from session_v2 where id = ?').get(active[0].id) as { directory?: string } | null)?.directory : undefined
    return {
      availability: 'available',
      active: active.length > 0,
      activeSessions: active.length,
      ...(folder ? { project: basename(folder).slice(0, 80) } : {}),
      ...(newest ? { lastSeen: new Date(newest.at).toISOString() } : {}),
      fetchedAt,
    }
  } catch {
    // No database (OpenCode never used here), or a schema this version does not know.
    return { availability: 'unavailable', active: false, activeSessions: 0, fetchedAt }
  } finally {
    db?.close()
  }
}
