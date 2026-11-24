import { describe, expect, it } from 'bun:test'
import { createBridge } from './app.js'
import type { Run, TaskBoardSnapshot } from './mission-control.js'

const TOKEN = 'bridge-token-for-tests'
const board: TaskBoardSnapshot = {
  tasks: { availability: 'available', data: [
    { id: 't_review', title: 'Draft proposal', status: 'review', assignee: 'sales' },
    { id: 't_run', title: 'Riset FMCG', status: 'running', assignee: 'sales' },
    { id: 't_design', title: 'Moodboard', status: 'review', assignee: 'design', board: 'design' },
  ] },
  fetchedAt: new Date().toISOString(),
}
const actor = { id: 'u1', name: 'Fardan', role: 'PM' }

function bridge() {
  const calls: string[][] = []
  const run: Run = async (_file, args) => { calls.push(args); return args.includes('create') ? JSON.stringify({ id: 't_new' }) : '' }
  const app = createBridge({ token: TOKEN, run, board: async () => board })
  const post = (path: string, body: unknown, token = TOKEN) =>
    app.request(path, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) })
  return { app, calls, post }
}

describe('hermes-bridge', () => {
  it('needs the token for everything but the health check', async () => {
    const { app, post, calls } = bridge()
    expect((await app.request('/health')).status).toBe(200)
    expect((await app.request('/tasks')).status).toBe(401)
    expect((await post('/tasks', { title: 'x', actor }, 'wrong-token-of-same-size!')).status).toBe(401)
    expect(calls).toEqual([])
    expect(() => createBridge({ token: 'short' })).toThrow()
  })

  it('creates instructions and reviews tasks for the given person', async () => {
    const { post, calls } = bridge()
    const created = await post('/tasks', { title: 'Carikan 20 prospek FMCG', decompose: false, actor })
    expect(await created.json()).toEqual({ id: 't_new' })
    expect((await post('/tasks/t_review/approve', { note: 'Oke', actor })).status).toBe(200)
    const changed = await post('/tasks/t_design/changes', { note: 'Kontras kurang', board: 'design', actor })
    expect(await changed.json()).toEqual({ ok: true, assignee: 'design', status: 'review' })
    expect(calls).toEqual([
      ['kanban', 'create', 'Carikan 20 prospek FMCG', '--triage', '--created-by', 'Fardan (PM)', '--json'],
      ['kanban', 'complete', 't_review', '--result', 'Disetujui oleh Fardan (PM): Oke'],
      ['kanban', '--board', 'design', 'reopen-review', 't_design', '--reason', '[Revisi dari Fardan (PM)] Kontras kurang'],
    ])
  })

  it('refuses unknown tasks, wrong states, missing notes and missing actors', async () => {
    const { post, calls } = bridge()
    expect((await post('/tasks/t_missing/approve', { actor })).status).toBe(404)
    expect((await post('/tasks/t_design/approve', { actor })).status).toBe(404) // other board
    expect((await post('/tasks/t_run/approve', { actor })).status).toBe(409)
    const noReason = await post('/tasks/t_review/reject', { note: ' ', actor })
    expect(noReason.status).toBe(400)
    expect(await noReason.json()).toEqual({ error: 'Alasan penolakan wajib diisi.' })
    expect((await post('/tasks', { title: 'x' })).status).toBe(400)
    expect(calls).toEqual([])
  })

  it('declares presence only for valid profile names', async () => {
    const { post } = bridge()
    expect((await post('/presence', { agent: 'sales' })).status).toBe(200)
    expect((await post('/presence', { agent: '../etc' })).status).toBe(400)
  })
})
