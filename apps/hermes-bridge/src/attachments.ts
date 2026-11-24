import { open, realpath } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, extname, join, sep } from 'node:path'
import { WriteError } from './kanban-write.js'
import { jsonPayload, systemRun, type Run } from './mission-control.js'

// Files agents attach to Kanban tasks (`kanban_complete` keeps the deliverables of a task's
// scratch workspace this way). Listing goes through the CLI; the file itself is read only when
// its stored path resolves inside Hermes' home, so a crafted row cannot read anything else.

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024

export interface Attachment { id: number; filename: string; size: number; contentType?: string; uploadedBy?: string; createdAt?: string }
interface StoredAttachment extends Attachment { storedPath: string }

const TEXT_TYPES: Record<string, string> = {
  '.txt': 'text/plain', '.md': 'text/markdown', '.csv': 'text/csv', '.json': 'application/json', '.log': 'text/plain',
  '.html': 'text/plain', '.yaml': 'text/plain', '.yml': 'text/plain',
}
const BINARY_TYPES: Record<string, string> = {
  '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
  '.zip': 'application/zip', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
}

/** Served type by extension; HTML and SVG go out as plain text so they never render as pages. */
export function attachmentType(filename: string): string {
  const ext = extname(filename).toLowerCase()
  return TEXT_TYPES[ext] ? `${TEXT_TYPES[ext]}; charset=utf-8` : BINARY_TYPES[ext] ?? 'application/octet-stream'
}

export function parseAttachments(output: string): StoredAttachment[] {
  const rows = jsonPayload(output)
  if (!Array.isArray(rows)) throw new Error('Unrecognized attachments output.')
  return rows.flatMap((row) => {
    const item = (row ?? {}) as Record<string, unknown>
    if (typeof item.id !== 'number' || typeof item.filename !== 'string' || typeof item.stored_path !== 'string') return []
    const filename = basename(item.filename).slice(0, 200)
    return [{
      id: item.id,
      filename,
      size: typeof item.size === 'number' ? item.size : 0,
      contentType: attachmentType(filename),
      ...(typeof item.uploaded_by === 'string' ? { uploadedBy: item.uploaded_by.slice(0, 80) } : {}),
      ...(typeof item.created_at === 'number' ? { createdAt: new Date(item.created_at * 1000).toISOString() } : {}),
      storedPath: item.stored_path,
    }]
  })
}

async function stored(id: string, board: string | undefined, run: Run): Promise<StoredAttachment[]> {
  try {
    return parseAttachments(await run('hermes', ['kanban', ...(board ? ['--board', board] : []), 'attachments', id, '--json']))
  } catch {
    throw new WriteError('Lampiran tidak bisa dibaca dari Hermes.', 502)
  }
}

/** The task's attachments, without where they are stored. */
export async function listAttachments(id: string, board: string | undefined, run: Run = systemRun): Promise<Attachment[]> {
  return (await stored(id, board, run)).map(({ storedPath: _, ...item }) => item)
}

export function hermesHome(env: NodeJS.ProcessEnv = process.env): string {
  return env.HERMES_HOME || join(homedir(), '.hermes')
}

/** One attachment's bytes, when it lives under Hermes' home and is not too large. */
export async function readAttachment(id: string, attachmentId: number, board: string | undefined, options: { run?: Run; home?: string } = {}): Promise<{ attachment: Attachment; data: Uint8Array }> {
  const match = (await stored(id, board, options.run ?? systemRun)).find((item) => item.id === attachmentId)
  if (!match) throw new WriteError('Lampiran tidak ditemukan.', 404)
  const { storedPath, ...attachment } = match
  let path: string
  let root: string
  try {
    ;[path, root] = await Promise.all([realpath(storedPath), realpath(options.home ?? hermesHome())])
  } catch {
    throw new WriteError('File lampiran sudah tidak ada.', 404)
  }
  if (!path.startsWith(root + sep)) throw new WriteError('Lampiran di luar folder Hermes.', 403)
  const file = await open(path, 'r')
  try {
    const { size } = await file.stat()
    if (size > MAX_ATTACHMENT_BYTES) throw new WriteError('Lampiran terlalu besar untuk diunduh lewat Naya (maks 10 MB).', 413)
    return { attachment: { ...attachment, size }, data: new Uint8Array(await file.readFile()) }
  } finally {
    await file.close()
  }
}
