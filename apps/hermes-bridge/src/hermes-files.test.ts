import { Database } from 'bun:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { lastSessionActivity, readCronJobs, readKanban, readProfiles, readSessions, recentLogLines, relativeTime } from './hermes-files.js'
import { collectAgentActivityFromFiles, collectTaskBoardFast } from './mission-control.js'

// Hermes' own files, read without starting the CLI.
const NOW = new Date(2026, 10, 25, 10, 10, 0).getTime()
const stamp = (msAgo: number) => {
  const at = new Date(NOW - msAgo)
  const pad = (value: number, size = 2) => String(value).padStart(size, '0')
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())},${pad(at.getMilliseconds(), 3)}`
}

describe('hermes files', () => {
  let home: string
  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'naya-hermes-'))
    const kanban = new Database(join(home, 'kanban.db'))
    kanban.run('create table tasks (id text primary key, title text not null, body text, assignee text, status text not null, priority integer default 0, created_at integer not null)')
    kanban.run("insert into tasks (id, title, assignee, status, priority, created_at) values ('t_1', 'Riset prospek', 'pm', 'running', 2, 1), ('t_2', 'Draft email', null, 'TODO', 0, 2), ('t_3', 'Lama', 'ceo', 'archived', 0, 3)")
    kanban.close()
    await mkdir(join(home, 'profiles', 'pm', 'logs'), { recursive: true })
    await writeFile(join(home, 'profiles', 'pm', 'logs', 'agent.log'), [
      `${stamp(10 * 60_000)} INFO run_agent: an old turn`,
      `${stamp(30_000)} INFO tools.registry: calling web_search`,
      'a continuation line',
    ].join('\n'))
    const state = new Database(join(home, 'profiles', 'pm', 'state.db'))
    state.run('create table sessions (id text primary key, started_at real not null, ended_at real, last_activity_at real)')
    state.run('insert into sessions values (?, ?, null, ?)', ['s1', (NOW - 60 * 60_000) / 1000, (NOW - 20 * 60_000) / 1000])
    state.close()
  })
  afterEach(async () => { await rm(home, { recursive: true, force: true }) })

  it('reads the open tasks of kanban.db, without archived ones', async () => {
    expect(readKanban(home, {})).toEqual({
      boards: [{ slug: 'default', name: 'Default', current: true, total: 2 }],
      tasks: [
        { id: 't_1', title: 'Riset prospek', status: 'running', assignee: 'pm', priority: 2, board: 'default' },
        { id: 't_2', title: 'Draft email', status: 'todo', priority: 0, board: 'default' },
      ],
    })
    const board = await collectTaskBoardFast(home, async () => { throw new Error('the CLI is not needed') })
    expect(board.tasks).toMatchObject({ availability: 'available', data: [{ id: 't_1', board: 'default' }, { id: 't_2', board: 'default' }] })
  })

  it('reads every board, skips archived ones, and follows the current board', async () => {
    const board = async (slug: string, meta: Record<string, unknown>, title?: string) => {
      await mkdir(join(home, 'kanban', 'boards', slug), { recursive: true })
      await writeFile(join(home, 'kanban', 'boards', slug, 'board.json'), JSON.stringify({ slug, ...meta }))
      const db = new Database(join(home, 'kanban', 'boards', slug, 'kanban.db'))
      db.run('create table tasks (id text primary key, title text not null, assignee text, status text not null, priority integer, created_at integer not null)')
      if (title) db.run("insert into tasks values ('t_9', ?, 'sales', 'review', null, 1)", [title])
      db.close()
    }
    await board('sales', { name: 'Sales' }, 'Proposal klien')
    await board('old', { name: 'Old', archived: true }, 'Tidak terbaca')
    await writeFile(join(home, 'kanban', 'current'), 'sales\n')
    const kanban = readKanban(home, {})!
    expect(kanban.boards).toEqual([{ slug: 'default', name: 'Default', current: false, total: 2 }, { slug: 'sales', name: 'Sales', current: true, total: 1 }])
    expect(kanban.tasks.at(-1)).toEqual({ id: 't_9', title: 'Proposal klien', status: 'review', assignee: 'sales', board: 'sales' })
    expect(readKanban(home, { HERMES_KANBAN_BOARD: 'missing' })!.boards.find((item) => item.current)?.slug).toBe('default')
    expect(readKanban(join(home, 'missing'), {})).toBeUndefined()
  })

  it('keeps only the log lines of the last minutes', () => {
    const recent = recentLogLines(join(home, 'profiles', 'pm', 'logs', 'agent.log'), 3 * 60_000, NOW)
    expect(recent).toContain('calling web_search')
    expect(recent).not.toContain('an old turn')
    expect(recentLogLines(join(home, 'nothing.log'), 3 * 60_000, NOW)).toBe('')
  })

  it('reads when the newest session last moved', () => {
    expect(lastSessionActivity(join(home, 'profiles', 'pm', 'state.db'))).toBe(NOW - 20 * 60_000)
    expect(lastSessionActivity(join(home, 'state.db'))).toBeUndefined()
  })

  it('tells which agents are active from their files alone', () => {
    const snapshot = collectAgentActivityFromFiles(['pm', 'ceo'], home, NOW)
    expect(snapshot.agents).toEqual([
      expect.objectContaining({ profile: 'pm', availability: 'available', active: true, kind: 'tools' }),
      expect.objectContaining({ profile: 'ceo', availability: 'available', active: false }),
    ])
  })

  it('lists profiles with model, display name and gateway, without the CLI', async () => {
    await writeFile(join(home, 'config.yaml'), 'model:\n  default: "stepfun/step-3.7-flash:free"\n  provider: nous\n')
    await writeFile(join(home, 'profile.yaml'), 'display_name: Asisten Umum\n')
    await writeFile(join(home, 'gateway.pid'), JSON.stringify({ pid: process.pid, kind: 'hermes-gateway' }))
    await writeFile(join(home, 'gateway_state.json'), JSON.stringify({ gateway_state: 'running', served_profiles: ['default', 'pm'], parked_profiles: {} }))
    await writeFile(join(home, 'profiles', 'pm', 'config.yaml'), 'model: gemini-2.5-flash-lite\n')
    await mkdir(join(home, 'profiles', 'ceo'), { recursive: true })
    await writeFile(join(home, 'profiles', 'ceo', 'config.yaml'), 'model:\n  default: gemini-2.5-flash-lite\n')
    await mkdir(join(home, 'profiles', 'logs-only'), { recursive: true })
    await mkdir(join(home, 'profiles', 'gone'), { recursive: true })
    await writeFile(join(home, 'profiles', 'gone', 'config.yaml'), 'model: x\n')
    await mkdir(join(home, 'profiles', '.deleted', 'gone'), { recursive: true })
    expect(readProfiles(home)).toEqual([
      { name: 'default', model: 'stepfun/step-3.7-flash:free', gateway: 'Running', displayName: 'Asisten Umum' },
      // Not served by the default gateway, and no gateway of its own.
      { name: 'ceo', model: 'gemini-2.5-flash-lite', gateway: 'Stopped' },
      { name: 'pm', model: 'gemini-2.5-flash-lite', gateway: 'Running' },
    ])
    // The default gateway is gone: nothing it served runs.
    await writeFile(join(home, 'gateway.pid'), JSON.stringify({ pid: 2 ** 30 }))
    expect(readProfiles(home)!.map((profile) => profile.gateway)).toEqual(['Stopped', 'Stopped', 'Stopped'])
    expect(readProfiles(join(home, 'missing'))).toBeUndefined()
  })

  it('lists sessions newest first, without tool, child, hidden or archived ones', () => {
    const state = new Database(join(home, 'profiles', 'pm', 'state.db'))
    state.run('alter table sessions add column title text')
    state.run('alter table sessions add column display_name text')
    state.run("alter table sessions add column source text not null default 'cli'")
    state.run('alter table sessions add column parent_session_id text')
    state.run('alter table sessions add column archived integer not null default 0')
    state.run('alter table sessions add column hidden integer not null default 0')
    const at = (msAgo: number) => (NOW - msAgo) / 1000
    state.run("insert into sessions (id, started_at, last_activity_at, title, source) values ('s2', ?, ?, 'Riset prospek', 'api_server')", [at(5 * 60_000), at(2 * 60_000)])
    state.run("insert into sessions (id, started_at, last_activity_at, source) values ('s3', ?, ?, 'tool')", [at(60_000), at(60_000)])
    state.run("insert into sessions (id, started_at, last_activity_at, parent_session_id) values ('s4', ?, ?, 's2')", [at(60_000), at(60_000)])
    state.run("insert into sessions (id, started_at, last_activity_at, hidden) values ('s5', ?, ?, 1)", [at(60_000), at(60_000)])
    state.close()
    expect(readSessions(join(home, 'profiles', 'pm'), 20, NOW)).toEqual([
      { title: 'Riset prospek', preview: '', lastActive: '2m ago', id: 's2', source: 'api_server' },
      { title: 'Sesi tanpa judul', preview: '', lastActive: '20m ago', id: 's1', source: 'cli' },
    ])
    expect(readSessions(join(home, 'profiles', 'ceo'))).toBeUndefined()
  })

  it('words times like Hermes', () => {
    expect([30_000, 5 * 60_000, 3 * 3_600_000, 30 * 3_600_000, 3 * 86_400_000].map((ago) => relativeTime(NOW - ago, NOW))).toEqual(['just now', '5m ago', '3h ago', 'yesterday', '3d ago'])
    expect(relativeTime(new Date(2026, 9, 1).getTime(), NOW)).toBe('2026-10-01')
  })

  it('reads cron jobs from jobs.json, without their error text', async () => {
    await mkdir(join(home, 'profiles', 'pm', 'cron'), { recursive: true })
    await writeFile(join(home, 'profiles', 'pm', 'cron', 'jobs.json'), JSON.stringify({ jobs: [
      { id: 'a1', name: 'Laporan pagi', schedule: { kind: 'cron', display: '0 8 * * *' }, schedule_display: '0 8 * * *', enabled: true, state: 'scheduled', repeat: { times: null, completed: 3 }, next_run_at: new Date(NOW - 60 * 60_000).toISOString(), last_run_at: '2026-11-24T08:00:00+07:00', last_status: 'error', last_error: 'sk-secret leaked' },
      { id: 'b2', schedule: { kind: 'interval', display: 'every 1m' }, enabled: false, state: 'paused', repeat: { times: 5, completed: 2 }, next_run_at: new Date(NOW - 60 * 60_000).toISOString() },
    ] }))
    const jobs = readCronJobs(join(home, 'profiles', 'pm'), 'pm', NOW)
    expect(jobs).toEqual([
      { name: 'Laporan pagi', schedule: '0 8 * * *', id: 'a1', status: 'active', nextRun: new Date(NOW - 60 * 60_000).toISOString(), overdue: true, repeat: '∞', lastRun: '2026-11-24T08:00:00+07:00', lastRunOk: false, agent: 'pm' },
      { name: 'b2', schedule: 'every 1m', id: 'b2', status: 'paused', nextRun: new Date(NOW - 60 * 60_000).toISOString(), repeat: '2/5', agent: 'pm' },
    ])
    expect(JSON.stringify(jobs)).not.toContain('sk-secret')
    expect(readCronJobs(join(home, 'profiles', 'ceo'), 'ceo')).toEqual([])
  })
})
