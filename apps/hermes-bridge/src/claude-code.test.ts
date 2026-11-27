import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { collectClaudeSessions, projectFromTail } from './claude-code.js'
import { buildOfficeSnapshot, collectSnapshot, parseClaudeVersion, parseProfiles, parseRecentActivity, type AgentActivitySnapshot, type RuntimeSnapshot } from './mission-control.js'

const NOW = Date.parse('2026-11-24T07:00:00.000Z')
const at = new Date(NOW).toISOString()

describe('claude code detection', () => {
  let dir: string
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'naya-claude-')) })
  afterEach(async () => { await rm(dir, { recursive: true, force: true }) })

  async function session(project: string, name: string, minutesAgo: number, lines: object[]) {
    await mkdir(join(dir, project), { recursive: true })
    const path = join(dir, project, `${name}.jsonl`)
    await writeFile(path, lines.map((line) => JSON.stringify(line)).join('\n') + '\n')
    const time = new Date(NOW - minutesAgo * 60_000)
    await utimes(path, time, time)
  }

  it('reads the version', () => {
    expect(parseClaudeVersion('2.1.303 (Claude Code)\n')).toBe('Claude Code 2.1.303')
    expect(parseClaudeVersion('nonsense')).toBe('Unknown')
  })

  it('is active when a session changed in the last 3 minutes, named after its working folder only', async () => {
    const secret = 'sk-ant-api03-super-secret-key-in-a-prompt'
    await session('-home-x-old', 'a', 30, [{ cwd: '/home/x/old', message: 'old work' }])
    await session('-home-x-team-assistant', 'b', 1, [{ type: 'user', cwd: '/home/x/team-assistant', message: { content: `use ${secret}` } }])
    const sessions = await collectClaudeSessions(dir, NOW)
    expect(sessions).toMatchObject({ availability: 'available', active: true, activeSessions: 1, project: 'team-assistant' })
    expect(JSON.stringify(sessions)).not.toContain(secret)
    expect(JSON.stringify(sessions)).not.toContain('/home/x')
  })

  it('is idle without recent sessions, and unavailable without a sessions folder', async () => {
    await session('-p', 'a', 10, [{ cwd: '/p' }])
    expect(await collectClaudeSessions(dir, NOW)).toMatchObject({ availability: 'available', active: false, activeSessions: 0 })
    expect((await collectClaudeSessions(join(dir, 'missing'), NOW)).availability).toBe('unavailable')
  })

  it('takes the cwd from the last complete record of the tail', () => {
    expect(projectFromTail('{"partial": "line wi\n{"cwd":"/a/one"}\n{"cwd":"/b/two"}\n')).toBe('two')
    expect(projectFromTail('not json')).toBeUndefined()
  })

  it('notices agents driving Claude Code in their logs', () => {
    const log = '2026-11-24 07:00:00,000 INFO tools.terminal: running `claude -p "fix the tests"` in /work\n'
    expect(parseRecentActivity(log).mentionsClaudeCode).toBe(true)
    expect(parseRecentActivity('2026-11-24 07:00:00,000 INFO tools.terminal: talked to Claude about it\n').mentionsClaudeCode).toBeUndefined()
  })
})

describe('claude code in the office', () => {
  const runtime: RuntimeSnapshot = {
    profiles: { availability: 'available', data: [{ name: 'ceo', model: 'gemini', gateway: 'Running' }] },
    openCode: { availability: 'unavailable', data: 'Unknown' },
    claudeCode: { availability: 'available', data: 'Claude Code 2.1.303' },
    fetchedAt: at,
  }
  const board = { tasks: { availability: 'available' as const, data: [] }, fetchedAt: at }
  const activity = { sessions: { availability: 'available' as const, data: [] }, fetchedAt: at }
  const quiet: AgentActivitySnapshot = { agents: [{ profile: 'ceo', availability: 'available', active: false, mentionsOpenCode: false }], fetchedAt: at }
  const station = (options: Parameters<typeof buildOfficeSnapshot>[3]) => buildOfficeSnapshot(runtime, board, activity, { now: at, ...options }).stations.find((item) => item.id === 'claude-code')

  it('gets a desk when installed and works while a session is active', () => {
    expect(station({ agentActivity: quiet, claudeSessions: { availability: 'available', active: true, activeSessions: 2, project: 'team-assistant', fetchedAt: at } })).toMatchObject({
      name: 'Coder', role: 'Claude Code', state: 'Working', activity: 'Bekerja di team-assistant (2 sesi)',
    })
  })

  it('works when an agent drives it, and rests otherwise', () => {
    const driving: AgentActivitySnapshot = { agents: [{ profile: 'ceo', availability: 'available', active: true, kind: 'tools', mentionsOpenCode: false, mentionsClaudeCode: true }], fetchedAt: at }
    const idleSessions = { availability: 'available' as const, active: false, activeSessions: 0, fetchedAt: at }
    expect(station({ agentActivity: driving, claudeSessions: idleSessions })).toMatchObject({ state: 'Working', activity: 'Ngoding atas perintah ceo' })
    expect(station({ agentActivity: quiet, claudeSessions: idleSessions })).toMatchObject({ state: 'Idle', room: 'Lounge' })
  })

  it('gets a desk on a server from the mounted sessions folder alone', () => {
    const server = { ...runtime, claudeCode: { availability: 'unavailable' as const, data: 'Unknown' } }
    const idle = { availability: 'available' as const, active: false, activeSessions: 0, fetchedAt: at }
    expect(buildOfficeSnapshot(server, board, activity, { now: at, claudeSessions: idle }).stations.find((item) => item.id === 'claude-code')).toMatchObject({ role: 'Claude Code', state: 'Idle' })
  })

  it('has no desk when Claude Code is not installed', async () => {
    const snapshot = await collectSnapshot(async (file) => {
      if (file === 'claude' || file === 'opencode') throw new Error('not found')
      return ' Profile   Model   Gateway\n ceo   gemini   running\n'
    })
    expect(snapshot.claudeCode?.availability).toBe('unavailable')
    expect(buildOfficeSnapshot(snapshot, board, activity, { now: at }).stations.some((item) => item.id === 'claude-code')).toBe(false)
  })
})

describe('renamed default profile', () => {
  it('keeps the id for commands and shows the display name in the office', () => {
    const listing = ' Profile          Model                        Gateway      Alias        Distribution\n ───────────────    ─────────    ───────    ─────    ─────\n  Asisten Umum (default) gemini-flash-lite-latest     running      —            —\n ◆ceo             gemini-flash-lite-latest     running      ceo          —\n'
    const profiles = parseProfiles(listing)
    expect(profiles).toEqual([
      { name: 'default', model: 'gemini-flash-lite-latest', gateway: 'Running', displayName: 'Asisten Umum' },
      { name: 'ceo', model: 'gemini-flash-lite-latest', gateway: 'Running' },
    ])
    const runtime: RuntimeSnapshot = { profiles: { availability: 'available', data: profiles }, openCode: { availability: 'unavailable', data: 'Unknown' }, fetchedAt: at }
    const stations = buildOfficeSnapshot(runtime, { tasks: { availability: 'available', data: [] }, fetchedAt: at }, { sessions: { availability: 'available', data: [] }, fetchedAt: at }, { now: at }).stations
    expect(stations.map((station) => [station.id, station.name])).toEqual([['default', 'Asisten Umum'], ['ceo', 'ceo']])
  })
})
