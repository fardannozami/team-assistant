import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createBridge } from './app.js'
import { attachmentType, parseAttachments } from './attachments.js'
import type { Run, TaskBoardSnapshot } from './mission-control.js'

const TOKEN = 'bridge-token-for-tests'
const board: TaskBoardSnapshot = {
  tasks: { availability: 'available', data: [{ id: 't_3a25786b', title: 'Riset FMCG', status: 'done', assignee: 'ceo' }] },
  fetchedAt: new Date().toISOString(),
}

describe('task attachments', () => {
  let home: string
  let outside: string
  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'naya-hermes-'))
    outside = await mkdtemp(join(tmpdir(), 'naya-outside-'))
    await mkdir(join(home, 'kanban', 'attachments', 't_3a25786b'), { recursive: true })
    await writeFile(join(home, 'kanban', 'attachments', 't_3a25786b', 'daftar_fmcg_jakarta.txt'), '1. Indofood\n')
    await writeFile(join(outside, 'secret.env'), 'GOOGLE_API_KEY=x')
  })
  afterEach(async () => { await rm(home, { recursive: true, force: true }); await rm(outside, { recursive: true, force: true }) })

  function bridge() {
    const calls: string[][] = []
    const rows = [
      { id: 1, filename: 'daftar_fmcg_jakarta.txt', content_type: null, size: 12, uploaded_by: 'kanban_complete', stored_path: join(home, 'kanban', 'attachments', 't_3a25786b', 'daftar_fmcg_jakarta.txt'), created_at: 1795518240 },
      { id: 2, filename: 'secret.env', content_type: null, size: 16, uploaded_by: 'x', stored_path: join(outside, 'secret.env'), created_at: 1795518240 },
    ]
    const run: Run = async (_file, args) => { calls.push(args); return JSON.stringify(rows) }
    const app = createBridge({ token: TOKEN, run, board: async () => board, hermesHome: home })
    const get = (path: string) => app.request(path, { headers: { authorization: `Bearer ${TOKEN}` } })
    return { calls, get }
  }

  it('lists attachments without where they are stored', async () => {
    const { get, calls } = bridge()
    const body = await (await get('/tasks/t_3a25786b/attachments')).json() as { attachments: Record<string, unknown>[] }
    expect(body.attachments[0]).toEqual({ id: 1, filename: 'daftar_fmcg_jakarta.txt', size: 12, contentType: 'text/plain; charset=utf-8', uploadedBy: 'kanban_complete', createdAt: new Date(1795518240 * 1000).toISOString() })
    expect(JSON.stringify(body)).not.toContain(home)
    expect(calls).toEqual([['kanban', 'attachments', 't_3a25786b', '--json']])
  })

  it('serves a file inside Hermes home and refuses anything outside it', async () => {
    const { get } = bridge()
    const file = await get('/tasks/t_3a25786b/attachments/1')
    expect(file.status).toBe(200)
    expect(await file.text()).toBe('1. Indofood\n')
    expect(file.headers.get('content-disposition')).toContain('daftar_fmcg_jakarta.txt')
    expect((await get('/tasks/t_3a25786b/attachments/2')).status).toBe(403)
    expect((await get('/tasks/t_3a25786b/attachments/9')).status).toBe(404)
    expect((await get('/tasks/t_3a25786b/attachments/abc')).status).toBe(400)
    expect((await get('/tasks/t_other/attachments/1')).status).toBe(404)
  })

  it('keeps only the file name and never renders HTML', () => {
    expect(parseAttachments(JSON.stringify([{ id: 1, filename: '../../x.txt', stored_path: '/a' }]))[0]!.filename).toBe('x.txt')
    expect(attachmentType('page.html')).toBe('text/plain; charset=utf-8')
    expect(attachmentType('logo.svg')).toBe('application/octet-stream')
    expect(attachmentType('leads.csv')).toBe('text/csv; charset=utf-8')
  })
})
