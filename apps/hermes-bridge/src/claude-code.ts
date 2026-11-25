import { open, readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'

// Claude Code as an office agent: is anyone (or an agent via `claude -p`) using it right now?
// Only metadata is read: which session files changed recently, and the `cwd` of the newest one
// for the project name. Transcript contents (code, prompts, secrets) are never returned.

export const CLAUDE_ACTIVE_MS = 3 * 60_000
/** Bytes read from the end of a session file to find the last record's `cwd`. */
const TAIL_BYTES = 64 * 1024
const MAX_FILES = 2_000

export interface ClaudeSessions {
  availability: 'available' | 'unavailable'
  active: boolean
  /** Sessions changed within CLAUDE_ACTIVE_MS. */
  activeSessions: number
  /** Folder name of the newest session's working directory. */
  project?: string
  lastSeen?: string
  fetchedAt: string
}

/** Claude Code keeps sessions in `<config>/projects/<encoded cwd>/<session>.jsonl`. */
export function claudeProjectsDir(env: NodeJS.ProcessEnv = process.env): string {
  return join(env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'projects')
}

/** `cwd` of the last complete record in a JSONL tail, as a folder name. */
export function projectFromTail(tail: string): string | undefined {
  const lines = tail.split('\n').map((line) => line.trim()).filter(Boolean)
  for (let index = lines.length - 1; index >= 0; index--) {
    try {
      const record = JSON.parse(lines[index]) as { cwd?: unknown }
      if (typeof record.cwd === 'string' && record.cwd) return basename(record.cwd).slice(0, 80)
    } catch { /* a partial first line of the tail */ }
  }
  return undefined
}

async function readTail(path: string, size: number): Promise<string> {
  const handle = await open(path, 'r')
  try {
    const length = Math.min(size, TAIL_BYTES)
    const buffer = Buffer.alloc(length)
    await handle.read(buffer, 0, length, size - length)
    return buffer.toString('utf8')
  } finally {
    await handle.close()
  }
}

export async function collectClaudeSessions(dir = claudeProjectsDir(), now = Date.now()): Promise<ClaudeSessions> {
  const fetchedAt = new Date(now).toISOString()
  let projects: string[]
  try {
    projects = await readdir(dir)
  } catch {
    return { availability: 'unavailable', active: false, activeSessions: 0, fetchedAt }
  }
  let newest: { path: string; mtime: number; size: number } | undefined
  let activeSessions = 0
  let seen = 0
  for (const project of projects) {
    let files: string[]
    try {
      files = (await readdir(join(dir, project))).filter((name) => name.endsWith('.jsonl'))
    } catch {
      continue
    }
    for (const file of files) {
      if (++seen > MAX_FILES) break
      const path = join(dir, project, file)
      const info = await stat(path).catch(() => undefined)
      if (!info?.isFile()) continue
      const mtime = info.mtimeMs
      if (now - mtime <= CLAUDE_ACTIVE_MS) activeSessions++
      if (!newest || mtime > newest.mtime) newest = { path, mtime, size: info.size }
    }
  }
  const active = activeSessions > 0
  const project = active && newest ? projectFromTail(await readTail(newest.path, newest.size).catch(() => '')) : undefined
  return {
    availability: 'available',
    active,
    activeSessions,
    ...(project ? { project } : {}),
    ...(newest ? { lastSeen: new Date(newest.mtime).toISOString() } : {}),
    fetchedAt,
  }
}
