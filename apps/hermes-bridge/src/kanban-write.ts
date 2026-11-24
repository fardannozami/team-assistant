import { BOARD_SLUG, PROFILE_NAME, TASK_ID, redactLogLine, systemRun, type Run } from './mission-control.js'

// Adapted from Ruang (MIT, © yugienugraha) for Naya.
// Writes to the Hermes Kanban board on behalf of a signed-in person (daily's API passes the actor;
// it checks roles and keeps the audit log). Hermes Kanban is the source of
// truth; Naya maps the four review states of the Digdaya blueprint onto it:
//   In progress  todo / ready / running (agents claim and work)
//   Review       review (an agent called request-review)
//   Approved     complete --result "Disetujui oleh …"
//   Feedback     reopen-review --reason "…" (back to ready; the worker sees the note as a comment)
//   Rejected     block --kind needs_input "[Ditolak oleh …] …" (a review task is reopened first,
//                since Hermes cannot block a task in review)
//   Retry        unblock (a task held by a worker error or waiting for input goes back to work)
// Every argument is passed to execFile (no shell); ids are validated, free text is bounded.

export const WRITE_TIMEOUT_MS = 20_000
const DECOMPOSE_TIMEOUT_MS = 180_000
export const MAX_TITLE = 200
export const MAX_TEXT = 4_000

export class WriteError extends Error {
  constructor(message: string, readonly status = 400) { super(message) }
}

export interface Actor { name: string; role: string | null; id: string }

const author = (actor: Actor) => `${actor.name}${actor.role ? ` (${actor.role})` : ''}`.slice(0, 120)

function text(value: unknown, label: string, max: number, required: boolean): string | undefined {
  if (value === undefined || value === null || value === '') {
    if (required) throw new WriteError(`${label} wajib diisi.`)
    return undefined
  }
  if (typeof value !== 'string') throw new WriteError(`${label} tidak valid.`)
  // eslint-disable-next-line no-control-regex
  const cleaned = value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim()
  if (required && !cleaned) throw new WriteError(`${label} wajib diisi.`)
  if (cleaned.length > max) throw new WriteError(`${label} maksimal ${max} karakter.`)
  // A leading "-" would read as an option to Hermes' argument parser.
  return cleaned.replace(/^-+/, (dashes) => `‐`.repeat(dashes.length)) || undefined
}

export function taskId(value: unknown): string {
  if (typeof value !== 'string' || !TASK_ID.test(value)) throw new WriteError('Task tidak dikenal.', 404)
  return value
}

export function boardSlug(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string' || !BOARD_SLUG.test(value)) throw new WriteError('Board tidak dikenal.')
  return value
}

const kanban = (board: string | undefined, ...args: string[]) => ['kanban', ...(board ? ['--board', board] : []), ...args]

/** Runs one write; the command log shows the action and task, never the free text. */
async function write(run: Run, board: string | undefined, args: string[], label: string): Promise<string> {
  try {
    return await run('hermes', kanban(board, ...args), { timeoutMs: WRITE_TIMEOUT_MS, logAs: `hermes kanban ${board ? `--board ${board} ` : ''}${label}` })
  } catch (error) {
    const detail = error as { stdout?: string; stderr?: string }
    const reason = (detail.stderr?.trim() || detail.stdout?.trim())?.split('\n').pop()
    throw new WriteError(reason ? `Hermes menolak: ${redactLogLine(reason, 300)}` : 'Hermes tidak bisa menjalankan perintah ini.', 502)
  }
}

/**
 * Added to every instruction from Naya: the humans decide when work is done, so the agent ends
 * with a review request (Naya's "Menunggu review") instead of completing the task itself.
 */
export const REVIEW_NOTE = 'Instruksi dari tim lewat Naya. Hasil wajib direview manusia: setelah selesai dan dicek sendiri, akhiri dengan kanban_request_review (ringkasan + lampirkan file hasil), bukan kanban_complete. Jika dipecah jadi subtugas, tugas induk ini yang meminta review.'

export interface InstructionInput { title: unknown; body?: unknown; board?: unknown; assignee?: unknown; decompose?: unknown }

/**
 * A new instruction for the AI team. Without an assignee it parks in triage, where the lead agent
 * (or `decompose`, which splits it into tasks for the specialist profiles) picks it up.
 */
export async function createInstruction(input: InstructionInput, actor: Actor, run: Run = systemRun): Promise<{ id: string; board?: string }> {
  const title = text(input.title, 'Judul', MAX_TITLE, true)!
  const body = text(input.body, 'Isi instruksi', MAX_TEXT, false)
  const board = boardSlug(input.board)
  let assignee: string | undefined
  if (input.assignee !== undefined && input.assignee !== null && input.assignee !== '') {
    if (typeof input.assignee !== 'string' || !PROFILE_NAME.test(input.assignee)) throw new WriteError('Agent tidak dikenal.')
    assignee = input.assignee
  }
  const output = await write(run, board, [
    'create', title,
    '--body', body ? `${body}\n\n---\n${REVIEW_NOTE}` : REVIEW_NOTE,
    ...(assignee ? ['--assignee', assignee] : ['--triage']),
    '--created-by', author(actor),
    '--json',
  ], 'create')
  let id: unknown
  try {
    id = (JSON.parse(output) as { id?: unknown }).id
  } catch { /* checked below */ }
  if (typeof id !== 'string' || !TASK_ID.test(id)) throw new WriteError('Hermes tidak mengembalikan id task.', 502)
  if (!assignee && input.decompose === true) {
    // Splitting calls an LLM and can take a minute; the page polls the board meanwhile.
    void run('hermes', kanban(board, 'decompose', id, '--author', author(actor)), { timeoutMs: DECOMPOSE_TIMEOUT_MS, logAs: `hermes kanban decompose ${id}` }).catch(() => undefined)
  }
  return { id, ...(board ? { board } : {}) }
}

export type ReviewAction = 'approve' | 'changes' | 'reject' | 'comment' | 'retry'

/** One review action on a task in the given status (from the cached board). */
export async function review(action: ReviewAction, id: string, status: string, note: unknown, board: string | undefined, actor: Actor, run: Run = systemRun): Promise<void> {
  const who = author(actor)
  switch (action) {
    case 'approve': {
      if (status !== 'review') throw new WriteError('Hanya task yang menunggu review yang bisa disetujui.', 409)
      const extra = text(note, 'Catatan', MAX_TEXT, false)
      await write(run, board, ['complete', id, '--result', `Disetujui oleh ${who}${extra ? `: ${extra}` : ''}`], `complete ${id}`)
      return
    }
    case 'changes': {
      if (status !== 'review') throw new WriteError('Revisi hanya untuk task yang menunggu review.', 409)
      const reason = text(note, 'Catatan revisi', MAX_TEXT, true)!
      await write(run, board, ['reopen-review', id, '--reason', `[Revisi dari ${who}] ${reason}`], `reopen-review ${id}`)
      return
    }
    case 'reject': {
      if (['done', 'archived', 'blocked'].includes(status)) throw new WriteError('Task ini sudah selesai atau diblokir.', 409)
      const reason = text(note, 'Alasan penolakan', MAX_TEXT, true)!
      if (status === 'review') await write(run, board, ['reopen-review', id], `reopen-review ${id}`)
      await write(run, board, ['block', id, '--kind', 'needs_input', `[Ditolak oleh ${who}] ${reason}`], `block ${id}`)
      return
    }
    case 'retry': {
      // A blocked task (a worker error, or waiting for input) goes back to work; a note is optional.
      if (status !== 'blocked') throw new WriteError('Hanya tugas yang tertahan yang bisa dicoba lagi.', 409)
      const extra = text(note, 'Catatan', MAX_TEXT, false)
      if (extra) await write(run, board, ['comment', id, `[Dicoba lagi oleh ${who}] ${extra}`, '--author', who], `comment ${id}`)
      await write(run, board, ['unblock', id], `unblock ${id}`)
      return
    }
    case 'comment': {
      const body = text(note, 'Komentar', MAX_TEXT, true)!
      await write(run, board, ['comment', id, body, '--author', who], `comment ${id}`)
      return
    }
  }
}

