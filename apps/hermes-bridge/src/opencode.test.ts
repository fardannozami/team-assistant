import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { Database } from 'bun:sqlite'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { collectOpenCodeSessions } from './opencode.js'
import { buildOfficeSnapshot, type RuntimeSnapshot } from './mission-control.js'

const NOW = Date.parse('2026-11-24T10:00:00.000Z')
const at = new Date(NOW).toISOString()

describe('opencode sessions', () => {
  let dir: string
  let path: string
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'naya-opencode-'))
    path = join(dir, 'opencode.db')
    const db = new Database(path)
    db.run('create table session_v2 (id text primary key, directory text not null, title text)')
    db.run('create table session_message (id text primary key, session_id text not null, time_updated integer not null, data text not null)')
    const secret = 'sk-ant-api03-prompt-secret'
    db.run('insert into session_v2 values (?, ?, ?)', ['s1', '/home/x/team-assistant', `fix ${secret}`])
    db.run('insert into session_v2 values (?, ?, ?)', ['s2', '/home/x/old-project', 'old'])
    db.run('insert into session_message values (?, ?, ?, ?)', ['m1', 's1', NOW - 30_000, JSON.stringify({ text: secret })])
    db.run('insert into session_message values (?, ?, ?, ?)', ['m2', 's2', NOW - 60 * 60_000, '{}'])
    db.close()
  })
  afterEach(async () => { await rm(dir, { recursive: true, force: true }) })

  it('is active when a session got a message in the last 3 minutes, named after its folder only', () => {
    const sessions = collectOpenCodeSessions(path, NOW)
    expect(sessions).toMatchObject({ availability: 'available', active: true, activeSessions: 1, project: 'team-assistant' })
    expect(JSON.stringify(sessions)).not.toContain('sk-ant')
    expect(JSON.stringify(sessions)).not.toContain('/home/x')
  })

  it('is idle later, and unavailable without a database', () => {
    expect(collectOpenCodeSessions(path, NOW + 10 * 60_000)).toMatchObject({ availability: 'available', active: false, activeSessions: 0 })
    expect(collectOpenCodeSessions(join(dir, 'missing.db'), NOW).availability).toBe('unavailable')
  })

  it('puts OpenCode at a desk while a person uses it', () => {
    const runtime: RuntimeSnapshot = {
      profiles: { availability: 'available', data: [{ name: 'ceo', model: 'gemini', gateway: 'Running' }] },
      openCode: { availability: 'available', data: 'opencode v2.2.5' },
      fetchedAt: at,
    }
    const office = buildOfficeSnapshot(runtime, { tasks: { availability: 'available', data: [] }, fetchedAt: at }, { sessions: { availability: 'available', data: [] }, fetchedAt: at }, {
      now: at,
      agentActivity: { agents: [{ profile: 'ceo', availability: 'available', active: false, mentionsOpenCode: false }], fetchedAt: at },
      openCodeSessions: collectOpenCodeSessions(path, NOW),
    })
    expect(office.stations.find((station) => station.id === 'opencode')).toMatchObject({ state: 'Working', activity: 'Bekerja di team-assistant', room: 'Workspace' })
  })
})
