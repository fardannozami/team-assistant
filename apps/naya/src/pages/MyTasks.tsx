import { useEffect, useRef, useState } from 'react'
import { useAgentName } from '../agent-name.ts'
import { formatDateTime, formatRelative } from '../format.ts'
import { usePolling } from '../polling.ts'
import { cardFromHash, cardHash } from '../routes.ts'
import type { InboxEntry, Task } from '../types.ts'
import { EmptyState, PageTitle } from '../ui.tsx'
import { TaskDetailDialog } from './TaskBoard.tsx'

// Tugas Saya: the cards the AI handed over that wait on the signed-in person, overdue first.
// WhatsApp links (`#/my-tasks/<board>/<id>`) open a card straight away.

const asTask = (entry: InboxEntry): Task => ({ id: entry.id, title: entry.title, status: 'review', board: entry.board, ...(entry.assignee ? { assignee: entry.assignee } : {}) })

export function MyTasks() {
  const inbox = usePolling<InboxEntry[]>('/api/inbox', 15_000)
  const agentName = useAgentName()
  const entries = inbox.status === 'ready' ? inbox.data : []
  const [linked, setLinked] = useState(() => cardFromHash(window.location.hash))
  const trigger = useRef<HTMLButtonElement | null>(null)
  useEffect(() => {
    const onHashChange = () => setLinked(cardFromHash(window.location.hash))
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])
  const openCard = (entry: InboxEntry, button: HTMLButtonElement) => {
    trigger.current = button
    window.location.hash = cardHash(entry.board, entry.id)
  }
  const close = () => {
    window.history.replaceState(null, '', '#/my-tasks')
    setLinked(null)
    trigger.current?.focus()
  }
  const open = linked ? entries.find((entry) => entry.id === linked.id && entry.board === linked.board) : undefined
  // A link to a card no longer waiting on me still opens it, with whatever the detail shows.
  const task: Task | undefined = linked ? (open ? asTask(open) : { id: linked.id, title: `#${linked.id}`, status: 'unknown', board: linked.board }) : undefined

  return <>
    <PageTitle eyebrow="KEPUTUSAN ANDA" title="Tugas saya">Kartu yang sudah dikerjakan AI dan menunggu keputusan Anda. Tandai tiap item Selesai, Feedback (dengan catatan), atau Ditolak (dengan alasan); kartu maju setelah semua item diputuskan.</PageTitle>
    {inbox.status === 'failed' && <p className="form-error" role="alert">{inbox.message}</p>}
    {inbox.status === 'ready' && (entries.length === 0
      ? <EmptyState title="Tidak ada yang menunggu Anda">Saat AI menyerahkan hasil kerja, kartunya muncul di sini dan Anda menerima pesan WhatsApp.</EmptyState>
      : <ul className="inbox-list">{entries.map((entry) => <li key={`${entry.board}:${entry.id}`}>
        <button type="button" className={`inbox-row${entry.stale ? ' inbox-stale' : ''}`} onClick={(event) => openCard(entry, event.currentTarget)}>
          <span className="inbox-title"><b>{entry.title}</b><small className="mono">#{entry.id}{entry.board !== 'default' ? ` · ${entry.board}` : ''}{entry.assignee ? ` · AI: ${agentName(entry.assignee)}` : ''}</small></span>
          <span className="inbox-meta">
            {entry.stale && <span className="pill pill-blocked">Lewat 48 jam</span>}
            <span className="chip">{entry.total ? `${entry.pending} dari ${entry.total} item` : 'checklist baru'}</span>
            {entry.waitingSince && <small title={formatDateTime(entry.waitingSince)}>menunggu sejak {formatRelative(entry.waitingSince)}</small>}
          </span>
        </button>
      </li>)}</ul>)}
    {task && <TaskDetailDialog key={`${task.board}-${task.id}`} task={task} onClose={close} onChanged={inbox.refresh} agentName={agentName}/>}
  </>
}
