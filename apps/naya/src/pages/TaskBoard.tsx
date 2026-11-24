import { useEffect, useRef, useState, type FormEvent } from 'react'
import { apiPost, useMe } from '../access.ts'
import { formatDateTime, orderedStatuses, statusTone } from '../format.ts'
import { usePolling } from '../polling.ts'
import { loadSnapshot, type RequestState } from '../request-state.ts'
import type { Task, TaskBoardSnapshot, TaskDetailSnapshot } from '../types.ts'
import { Dialog, EmptyState, PageTitle, SearchInput, SourceStatus, Unavailable } from '../ui.tsx'

const UNASSIGNED = '(belum ditugaskan)'

/** Hermes statuses in the words of the Digdaya blueprint. */
const STATUS_LABEL: Record<string, string> = {
  triage: 'Triase', todo: 'Antri', scheduled: 'Terjadwal', ready: 'Siap', running: 'Dikerjakan',
  blocked: 'Ditolak / tertahan', review: 'Menunggu review', done: 'Selesai', archived: 'Diarsipkan',
}
const statusLabel = (status: string) => STATUS_LABEL[status] ?? status

const FILTERS: { id: string; label: string; statuses?: string[] }[] = [
  { id: 'all', label: 'Semua' },
  { id: 'progress', label: 'In progress', statuses: ['triage', 'todo', 'scheduled', 'ready', 'running'] },
  { id: 'review', label: 'Menunggu review', statuses: ['review'] },
  { id: 'blocked', label: 'Ditolak / tertahan', statuses: ['blocked'] },
  { id: 'done', label: 'Selesai', statuses: ['done'] },
]

type ReviewMode = 'approve' | 'changes' | 'reject'
const REVIEW: Record<ReviewMode, { label: string; field: string; required: boolean; submit: string; done: string }> = {
  approve: { label: '✓ Setujui', field: 'Catatan (opsional)', required: false, submit: 'Setujui & selesai', done: 'Disetujui. Task ditandai selesai.' },
  changes: { label: '↻ Minta revisi', field: 'Apa yang perlu diperbaiki? (wajib)', required: true, submit: 'Kirim revisi', done: 'Revisi dikirim. Agent mengerjakan ulang dengan catatan Anda.' },
  reject: { label: '✕ Tolak', field: 'Alasan penolakan (wajib)', required: true, submit: 'Tolak', done: 'Ditolak. Alasan Anda tercatat untuk agent.' },
}

/** Approve, request changes, reject (with the required note) and comment, as the signed-in person. */
function ReviewPanel({ task, status, onDone }: { task: Task; status: string; onDone: () => void }) {
  const me = useMe()
  const [mode, setMode] = useState<ReviewMode | undefined>()
  const [note, setNote] = useState('')
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string }>()
  if (!task.id || !me) return null
  const boardBody = task.board ? { board: task.board } : {}
  const send = async (path: string, body: Record<string, unknown>, done: string) => {
    setBusy(true)
    setMessage(undefined)
    const result = await apiPost(`/api/tasks/${encodeURIComponent(task.id!)}/${path}`, { ...body, ...boardBody })
    setBusy(false)
    if (!result.ok) { setMessage({ ok: false, text: result.message }); return false }
    setMessage({ ok: true, text: done })
    onDone()
    return true
  }
  const submitReview = async (event: FormEvent) => {
    event.preventDefault()
    if (!mode) return
    if (REVIEW[mode].required && !note.trim()) { setMessage({ ok: false, text: 'Catatan wajib diisi.' }); return }
    if (await send(mode, { note }, REVIEW[mode].done)) { setMode(undefined); setNote('') }
  }
  const submitComment = async (event: FormEvent) => {
    event.preventDefault()
    if (!comment.trim()) return
    if (await send('comment', { note: comment }, 'Komentar terkirim.')) setComment('')
  }
  const canReview = me.can.review && !['done', 'archived', 'blocked'].includes(status)
  const modes = (Object.keys(REVIEW) as ReviewMode[]).filter((item) => item === 'reject' || status === 'review')
  return <section className="task-section" aria-label="Tindakan">
    <p className="eyebrow">TINDAKAN</p>
    {canReview && <div className="review-actions">{modes.map((item) => <button type="button" key={item} className={item === 'approve' ? 'primary-button' : `secondary-button${item === 'reject' ? ' bad' : ''}`} aria-pressed={mode === item} disabled={busy} onClick={() => { setMode(mode === item ? undefined : item); setMessage(undefined) }}>{REVIEW[item].label}</button>)}</div>}
    {mode && <form className="review-form" onSubmit={submitReview}>
      <label className="field-label" htmlFor="review-note">{REVIEW[mode].field}</label>
      <textarea id="review-note" value={note} onChange={(event) => setNote(event.target.value)} maxLength={4000} required={REVIEW[mode].required} autoFocus/>
      <div className="review-actions"><button type="submit" className="primary-button" disabled={busy}>{busy ? 'Mengirim…' : REVIEW[mode].submit}</button><button type="button" className="secondary-button" onClick={() => setMode(undefined)}>Batal</button></div>
    </form>}
    {me.can.comment && <form className="review-form" onSubmit={submitComment}>
      <label className="field-label" htmlFor="task-comment">Komentar untuk agent dan tim</label>
      <textarea id="task-comment" value={comment} onChange={(event) => setComment(event.target.value)} maxLength={4000} placeholder="mis. Fokus ke distributor di Jabodetabek"/>
      <div><button type="submit" className="secondary-button" disabled={busy || !comment.trim()}>Kirim komentar</button></div>
    </form>}
    {message && <p className={message.ok ? 'form-success' : 'form-error'} role={message.ok ? 'status' : 'alert'}>{message.text}</p>}
  </section>
}

/** "Instruksi ke Naya": a new task for the AI team, parked in triage for the lead agent. */
function InstructionDialog({ boards, onClose, onCreated }: { boards: { slug: string; name: string; current: boolean }[]; onClose: () => void; onCreated: () => void }) {
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [board, setBoard] = useState(boards.find((item) => item.current)?.slug ?? '')
  const [decompose, setDecompose] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!title.trim()) { setError('Judul wajib diisi.'); return }
    setBusy(true)
    const result = await apiPost<{ id: string }>('/api/tasks', { title, body, decompose, ...(board ? { board } : {}) })
    setBusy(false)
    if (!result.ok) { setError(result.message); return }
    onCreated()
    onClose()
  }
  return <Dialog labelledBy="instruction-title" onClose={onClose} closeLabel="Tutup instruksi" className="task-detail">
    <p className="eyebrow">INSTRUKSI KE NAYA</p>
    <h2 id="instruction-title">Apa yang perlu dikerjakan tim AI?</h2>
    <form className="instruction-form" onSubmit={submit}>
      <label className="field-label" htmlFor="instruction-name">Judul</label>
      <input id="instruction-name" className="text-input" type="text" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={200} placeholder="mis. Carikan 20 prospek FMCG Jakarta" required autoFocus/>
      <label className="field-label" htmlFor="instruction-body">Detail (opsional)</label>
      <textarea id="instruction-body" value={body} onChange={(event) => setBody(event.target.value)} maxLength={4000} placeholder="Target, kriteria, format hasil, tenggat…"/>
      {boards.length > 1 && <label className="select-label">Board <select value={board} onChange={(event) => setBoard(event.target.value)}>{boards.map((item) => <option key={item.slug} value={item.slug}>{item.name}</option>)}</select></label>}
      <label className="check-label"><input type="checkbox" checked={decompose} onChange={(event) => setDecompose(event.target.checked)}/> Pecah otomatis menjadi tugas untuk agent spesialis</label>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="review-actions"><button type="submit" className="primary-button" disabled={busy}>{busy ? 'Mengirim…' : 'Kirim ke Naya'}</button><button type="button" className="secondary-button" onClick={onClose}>Batal</button></div>
      <p className="small-note">Tugas masuk ke kolom Triase. Hasil kerja agent kembali ke kolom Menunggu review untuk Anda setujui.</p>
    </form>
  </Dialog>
}

function Field({ label, value }: { label: string; value?: string | number }) {
  return value === undefined || value === '' ? null : <div><dt>{label}</dt><dd>{value}</dd></div>
}

export function TaskDetailDialog({ task, onClose, onOpenTask, onChanged }: { task: Task; onClose: () => void; onOpenTask?: (id: string) => void; onChanged?: () => void }) {
  const [state, setState] = useState<RequestState<TaskDetailSnapshot>>({ status: 'pending' })
  const [version, setVersion] = useState(0)
  useEffect(() => {
    if (!task.id) return
    let active = true
    setState({ status: 'pending' })
    void loadSnapshot<TaskDetailSnapshot>(`/api/tasks/${encodeURIComponent(task.id)}${task.board ? `?board=${encodeURIComponent(task.board)}` : ''}`).then((next) => { if (active) setState(next) })
    return () => { active = false }
  }, [task.id, task.board, version])
  const detail = state.status === 'ready' && state.data.task.availability === 'available' ? state.data.task.data : null
  const failed = !task.id || state.status === 'failed' || (state.status === 'ready' && !detail)
  const status = detail?.status ?? task.status
  const links = (label: string, ids: string[]) => ids.length > 0 && <div><dt>{label}</dt><dd className="task-links">{ids.map((id) => <button type="button" key={id} className="chip chip-button" onClick={() => onOpenTask?.(id)}>{id}</button>)}</dd></div>
  return <Dialog labelledBy="task-detail-title" onClose={onClose} closeLabel={`Tutup detail ${task.title}`} className="task-detail">
    <p className="eyebrow">TUGAS KANBAN{task.board ? ` · BOARD ${task.board.toUpperCase()}` : ''}{task.id ? ` · ${task.id}` : ''}</p>
    <h2 id="task-detail-title">{detail?.title ?? task.title}</h2>
    <div className="task-meta"><span className={`badge ${statusTone(status)}`}>{statusLabel(status)}</span><span className={`chip ${task.assignee ? '' : 'chip-muted'}`}>{detail?.assignee ?? task.assignee ?? 'belum ditugaskan'}</span>{(detail?.priority ?? task.priority) ? <span className="chip chip-priority">P{detail?.priority ?? task.priority}</span> : null}</div>
    {state.status === 'pending' && task.id && <p className="muted">Memuat detail tugas…</p>}
    {failed && <p className="file-notice">{task.id ? 'Detail lengkap belum bisa dibaca (hermes kanban show gagal). Menampilkan ringkasan dari papan.' : 'Tugas ini tidak punya id, jadi hanya ringkasan papan yang tersedia.'}</p>}
    <ReviewPanel task={task} status={status} onDone={() => { setVersion((value) => value + 1); onChanged?.() }}/>
    {detail && <>
      <dl className="office-detail-grid task-grid">
        <Field label="Dibuat" value={detail.createdAt ? `${formatDateTime(detail.createdAt)}${detail.createdBy ? ` oleh ${detail.createdBy}` : ''}` : undefined}/>
        <Field label="Mulai" value={detail.startedAt && formatDateTime(detail.startedAt)}/>
        <Field label="Selesai" value={detail.completedAt && formatDateTime(detail.completedAt)}/>
        <Field label="Workspace" value={detail.workspace}/>
        <Field label="Branch" value={detail.branch}/>
        <Field label="Model" value={detail.model}/>
        <Field label="Tenant" value={detail.tenant}/>
        <Field label="Skills" value={detail.skills.join(', ')}/>
        {links('Bergantung pada', detail.parents)}
        {links('Menahan', detail.children)}
      </dl>
      {detail.lastError && <section className="task-section"><p className="eyebrow">KEGAGALAN TERAKHIR</p><pre className="task-text text-bad">{detail.lastError}</pre></section>}
      <section className="task-section"><p className="eyebrow">DESKRIPSI</p>{detail.body ? <pre className="task-text">{detail.body}</pre> : <p className="muted">Tanpa deskripsi.</p>}</section>
      {detail.result && <section className="task-section"><p className="eyebrow">HASIL / RINGKASAN TERAKHIR</p><pre className="task-text">{detail.result}</pre></section>}
      {detail.runs.length > 0 && <section className="task-section"><p className="eyebrow">PERCOBAAN ({detail.runs.length})</p><table className="log-table"><thead><tr><th>Run</th><th>Profil</th><th>Status</th><th>Mulai</th><th>Selesai</th></tr></thead><tbody>{detail.runs.map((run) => <tr key={run.id}><td>#{run.id}</td><td>{run.profile ?? '—'}</td><td><span className={`badge ${statusTone(run.outcome ?? run.status ?? '')}`}>{run.outcome ?? run.status ?? '—'}</span>{run.error && <div className="text-bad small-note">{run.error}</div>}{run.summary && <div className="small-note">{run.summary}</div>}</td><td>{formatDateTime(run.startedAt)}</td><td>{formatDateTime(run.endedAt)}</td></tr>)}</tbody></table></section>}
      {detail.comments.length > 0 && <section className="task-section"><p className="eyebrow">KOMENTAR ({detail.comments.length})</p><ul className="task-timeline">{detail.comments.map((comment, index) => <li key={index}><b>{comment.author}</b><small>{formatDateTime(comment.createdAt)}</small><p>{comment.body}</p></li>)}</ul></section>}
      {detail.events.length > 0 && <section className="task-section"><p className="eyebrow">AKTIVITAS ({detail.events.length})</p><ul className="task-timeline">{[...detail.events].reverse().map((event, index) => <li key={index}><b>{event.kind}</b><small>{formatDateTime(event.createdAt)}{event.runId ? ` · run #${event.runId}` : ''}</small>{event.detail && <code>{event.detail}</code>}</li>)}</ul></section>}
    </>}
  </Dialog>
}

export function TaskBoard() {
  const snapshot = usePolling<TaskBoardSnapshot>('/api/tasks', 10_000)
  const [query, setQuery] = useState('')
  const [assignee, setAssignee] = useState('all')
  const [board, setBoard] = useState('all')
  const [openTask, setOpenTask] = useState<Task | undefined>()
  const [filter, setFilter] = useState('all')
  const [instructing, setInstructing] = useState(false)
  const me = useMe()
  const trigger = useRef<HTMLButtonElement | null>(null)
  const boardRef = useRef<HTMLElement | null>(null)
  /** Scrolls the board sideways by about one column, or to a column. */
  const scrollBoard = (direction: number) => boardRef.current?.scrollBy({ left: direction * 250, behavior: 'smooth' })
  const showColumn = (status: string) => boardRef.current?.querySelector<HTMLElement>(`[data-status="${CSS.escape(status)}"]`)?.scrollIntoView({ behavior: 'smooth', inline: 'start', block: 'nearest' })
  const closeTask = () => { setOpenTask(undefined); trigger.current?.focus() }
  const data = snapshot.status === 'ready' ? snapshot.data : undefined
  const tasks = data?.tasks
  const all = tasks?.data ?? []
  const assignees = [...new Set(all.map((task) => task.assignee ?? UNASSIGNED))].sort()
  const boards = data?.boards ?? []
  const multiBoard = boards.length > 1
  const needle = query.trim().toLowerCase()
  const statuses = FILTERS.find((item) => item.id === filter)?.statuses
  const visible = all.filter((task) => (!statuses || statuses.includes(task.status)) && (assignee === 'all' || (task.assignee ?? UNASSIGNED) === assignee) && (board === 'all' || task.board === board) && (!needle || `${task.title} ${task.id ?? ''} ${task.assignee ?? ''}`.toLowerCase().includes(needle)))
  const columns = orderedStatuses(all.map((task) => task.status), true)
  return <><PageTitle eyebrow="HERMES KANBAN" title="Papan tugas">Semua tugas tim AI dari Kanban Hermes, diperbarui tiap 10 detik. Buka kartu untuk menyetujui, meminta revisi, atau menolak hasil kerja agent.</PageTitle>
    {me?.can.instruct && <div className="toolbar"><button type="button" className="primary-button" onClick={() => setInstructing(true)}>＋ Instruksi ke Naya</button></div>}
    {instructing && <InstructionDialog boards={boards} onClose={() => setInstructing(false)} onCreated={snapshot.refresh}/>}
    <SourceStatus source={tasks} fetchedAt={data?.fetchedAt} request={snapshot}/><Unavailable source={tasks} request={snapshot}/>
    {data?.failedBoards && <p className="file-notice">Board {data.failedBoards.join(', ')} tidak bisa dibaca; menampilkan board lain.</p>}
    {tasks?.availability === 'available' && (all.length === 0 ? <EmptyState title="Belum ada tugas">{multiBoard ? `Tidak ada tugas terbuka di ${boards.length} board Kanban.` : 'Kanban Hermes masih kosong.'} {me?.can.instruct ? 'Mulai dengan tombol "Instruksi ke Naya".' : 'Tugas baru dibuat oleh Owner, Admin, atau PM.'}</EmptyState> : <>
      <div className="quick-filters" role="group" aria-label="Saring status">{FILTERS.map((item) => <button type="button" key={item.id} className="chip chip-button" aria-pressed={filter === item.id} onClick={() => setFilter(item.id)}>{item.label} <b>{item.statuses ? all.filter((task) => item.statuses!.includes(task.status)).length : all.length}</b></button>)}</div>
      <div className="toolbar"><SearchInput value={query} onChange={setQuery} label="Cari tugas"/><label className="select-label">Agent <select value={assignee} onChange={(event) => setAssignee(event.target.value)}><option value="all">Semua ({all.length})</option>{assignees.map((name) => <option key={name} value={name}>{name}</option>)}</select></label>{multiBoard && <label className="select-label">Board <select value={board} onChange={(event) => setBoard(event.target.value)}><option value="all">Semua board</option>{boards.map((item) => <option key={item.slug} value={item.slug}>{item.name}{item.current ? ' (aktif)' : ''}</option>)}</select></label>}<span className="toolbar-count">{visible.length} tampil</span></div>
      <nav className="board-nav" aria-label="Kolom Kanban">
        <button type="button" className="refresh-button" onClick={() => scrollBoard(-1)} aria-label="Geser papan ke kiri">‹</button>
        <div className="board-nav-chips">{columns.map((status) => <button type="button" key={status} className={`chip chip-button tone-border-${statusTone(status)}`} onClick={() => showColumn(status)}>{statusLabel(status)} <b>{visible.filter((task) => task.status === status).length}</b></button>)}</div>
        <button type="button" className="refresh-button" onClick={() => scrollBoard(1)} aria-label="Geser papan ke kanan">›</button>
      </nav>
      <section className="board" aria-label="Papan Kanban" ref={boardRef}>{columns.map((status) => {
        const items = visible.filter((task) => task.status === status).sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))
        return <article key={status} data-status={status} className={`column tone-border-${statusTone(status)}`} aria-label={`Kolom ${statusLabel(status)}`}><header className="column-head"><p className="eyebrow">{statusLabel(status)}</p><span className="column-count">{items.length}</span></header>
          {items.length === 0 ? <p className="column-empty">—</p> : items.map((task) => <button type="button" className="task task-card" key={`${task.board ?? ''}-${task.status}-${task.id ?? task.title}`} onClick={(event) => { trigger.current = event.currentTarget; setOpenTask(task) }} aria-label={`${task.title}. ${statusLabel(task.status)}. Buka detail tugas.`}><strong>{task.title}</strong><div className="task-meta">{task.id && <small>{task.id}</small>}{multiBoard && task.board && <span className="chip chip-muted">{task.board}</span>}<span className={`chip ${task.assignee ? '' : 'chip-muted'}`}>{task.assignee ?? 'belum ditugaskan'}</span>{task.priority ? <span className="chip chip-priority">P{task.priority}</span> : null}</div></button>)}
        </article>
      })}</section>
    </>)}
    {openTask && <TaskDetailDialog key={`${openTask.board ?? ''}-${openTask.id ?? openTask.title}`} task={openTask} onClose={closeTask} onChanged={snapshot.refresh} onOpenTask={(id) => setOpenTask(all.find((task) => task.id === id && task.board === openTask.board) ?? { id, title: id, status: 'unknown', ...(openTask.board ? { board: openTask.board } : {}) })}/>}
  </>
}
