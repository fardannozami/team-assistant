import { Database } from 'bun:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { lastSessionActivity, readKanban, recentLogLines } from './hermes-files.js'
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
})
