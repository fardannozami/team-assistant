import { timingSafeEqual } from 'node:crypto'
import { Hono } from 'hono'
import { listAttachments, readAttachment } from './attachments.js'
import { createInstruction, review, taskId, boardSlug, WriteError, type Actor, type ReviewAction } from './kanban-write.js'
import {
  declareState,
  getActivity,
  getCalendar,
  getChannels,
  getDashboard,
  getOffice,
  getSnapshot,
  getTaskBoard,
  getTaskDetail,
  getUsage,
  invalidateTasks,
  PROFILE_NAME,
  systemRun,
  type Run,
} from './mission-control.js'

// hermes-bridge: runs inside the Hermes container and turns the `hermes` CLI (Kanban, status,
// usage, cron) into a small HTTP API for daily's API, which checks roles and keeps the audit log.
// Hermes' own API server covers chat but not the Kanban; its dashboard REST has no auth.
// Every request needs `Authorization: Bearer <BRIDGE_TOKEN>`.

export interface BridgeOptions {
  token: string
  run?: Run
  /** The board writes check against (tests pass a fixed one). */
  board?: typeof getTaskBoard
  /** Where attachments may be read from (tests pass a temporary folder). */
  hermesHome?: string
}

/** `?fresh=1` (a manual refresh) skips the 10 s cache for anything older than 2 s. */
const FRESH_WINDOW_MS = 8_000
const MAX_PRESENCE_MS = 10 * 60_000

function bearerMatches(header: string | undefined, token: string): boolean {
  const given = Buffer.from((header ?? '').replace(/^Bearer\s+/i, ''))
  const expected = Buffer.from(token)
  return given.length === expected.length && timingSafeEqual(given, expected)
}

function actorOf(value: unknown): Actor {
  const actor = (value ?? {}) as Partial<Actor>
  if (typeof actor.id !== 'string' || typeof actor.name !== 'string' || !actor.name.trim()) throw new WriteError('actor wajib ada.')
  return { id: actor.id, name: actor.name.trim().slice(0, 80), role: typeof actor.role === 'string' ? actor.role : null }
}

export function createBridge(options: BridgeOptions): Hono {
  if (options.token.length < 16) throw new Error('BRIDGE_TOKEN must be at least 16 characters')
  const run = options.run ?? systemRun
  const board = options.board ?? getTaskBoard
  const app = new Hono()

  app.get('/health', (c) => c.json({ ok: true }))
  app.use('*', async (c, next) => {
    if (c.req.path === '/health') return next()
    if (!bearerMatches(c.req.header('authorization'), options.token)) return c.json({ error: 'Unauthorized' }, 401)
    return next()
  })
  app.onError((error, c) => {
    if (error instanceof WriteError) return c.json({ error: error.message }, error.status as 400)
    console.error('hermes-bridge request failed:', error instanceof Error ? error.message : error)
    return c.json({ error: 'Internal error' }, 500)
  })

  const now = (fresh: string | undefined) => Date.now() + (fresh === '1' ? FRESH_WINDOW_MS : 0)
  const body = async (c: { req: { json: () => Promise<unknown> } }) => {
    const value = await c.req.json().catch(() => ({}))
    return (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
  }

  // ---- Reads
  app.get('/runtime', async (c) => c.json(await getSnapshot(now(c.req.query('fresh')))))
  app.get('/tasks', async (c) => c.json(await board(now(c.req.query('fresh')))))
  app.get('/tasks/:id', async (c) => {
    const detail = await getTaskDetail(c.req.param('id'), Date.now(), c.req.query('board') || undefined)
    return detail ? c.json(detail) : c.json({ error: 'Task tidak dikenal.' }, 404)
  })
  // Files an agent attached to a task, such as a research result kept from its workspace.
  const knownTask = async (id: string, slug: string | undefined) => {
    const snapshot = await board(Date.now())
    if (snapshot.tasks.availability === 'available' && !snapshot.tasks.data.some((item) => item.id === id && item.board === slug)) throw new WriteError('Task tidak dikenal.', 404)
  }
  app.get('/tasks/:id/attachments', async (c) => {
    const id = taskId(c.req.param('id'))
    const slug = boardSlug(c.req.query('board'))
    await knownTask(id, slug)
    return c.json({ attachments: await listAttachments(id, slug, run) })
  })
  app.get('/tasks/:id/attachments/:attachment', async (c) => {
    const id = taskId(c.req.param('id'))
    const slug = boardSlug(c.req.query('board'))
    const attachmentId = Number(c.req.param('attachment'))
    if (!Number.isSafeInteger(attachmentId) || attachmentId < 1) throw new WriteError('Lampiran tidak dikenal.')
    await knownTask(id, slug)
    const { attachment, data } = await readAttachment(id, attachmentId, slug, { run, home: options.hermesHome })
    return c.body(data as unknown as ArrayBuffer, 200, {
      'content-type': attachment.contentType ?? 'application/octet-stream',
      'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(attachment.filename)}`,
      'x-content-type-options': 'nosniff',
    })
  })
  app.get('/office', async (c) => c.json(await getOffice(now(c.req.query('fresh')))))
  app.get('/usage', async (c) => c.json(await getUsage(Number(c.req.query('days')) || 7, now(c.req.query('fresh')))))
  app.get('/calendar', async (c) => c.json(await getCalendar(now(c.req.query('fresh')))))
  app.get('/dashboard', async (c) => c.json(await getDashboard(now(c.req.query('fresh')))))
  app.get('/activity', async (c) => c.json(await getActivity(now(c.req.query('fresh')))))
  app.get('/channels', async (c) => c.json(await getChannels(now(c.req.query('fresh')))))

  // ---- Writes (daily's API has already checked the person's role)
  app.post('/tasks', async (c) => {
    const input = await body(c)
    try {
      return c.json(await createInstruction({ title: input.title, body: input.body, board: input.board, assignee: input.assignee, parent: input.parent, idempotencyKey: input.idempotencyKey }, actorOf(input.actor), run))
    } finally {
      invalidateTasks()
    }
  })
  for (const action of ['approve', 'changes', 'reject', 'comment', 'retry'] as ReviewAction[]) {
    app.post(`/tasks/:id/${action}`, async (c) => {
      const input = await body(c)
      const id = taskId(c.req.param('id'))
      const slug = boardSlug(input.board)
      const actor = actorOf(input.actor)
      // Only tasks on the board snapshot can be changed, in a state that allows it.
      const task = (await board(Date.now() + FRESH_WINDOW_MS)).tasks.data.find((item) => item.id === id && item.board === slug)
      if (!task) throw new WriteError('Task tidak dikenal.', 404)
      try {
        await review(action, id, task.status, input.note, slug, actor, run)
      } finally {
        invalidateTasks()
      }
      return c.json({ ok: true, assignee: task.assignee ?? null, status: task.status })
    })
  }

  /** An agent is talking to someone in Naya right now: it walks to the meeting room. */
  app.post('/presence', async (c) => {
    const input = await body(c)
    const agent = input.agent
    if (typeof agent !== 'string' || !PROFILE_NAME.test(agent)) throw new WriteError('Agent tidak dikenal.')
    const forMs = Math.min(Math.max(Number(input.forMs) || 90_000, 5_000), MAX_PRESENCE_MS)
    declareState(agent, 'Collaborating', forMs)
    return c.json({ ok: true })
  })

  app.notFound((c) => c.json({ error: 'Not found' }, 404))
  return app
}
