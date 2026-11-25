import { useEffect, useRef, useState, type FormEvent } from 'react'
import { apiFetch } from '../api.ts'
import { useAgentName, type AgentName } from '../agent-name.ts'
import { apiPost, useMe } from '../access.ts'
import { agentLabel, formatDateTime, formatRelative } from '../format.ts'
import { usePolling } from '../polling.ts'
import { loadSnapshot, type RequestState } from '../request-state.ts'
import type { CardSummary, Task, TaskBoardSnapshot, TaskDetailSnapshot } from '../types.ts'
import { ChecklistPanel, PicSelect } from '../checklist.tsx'
import { usePeople } from '../people.ts'
import { PILLS, pillOf, STAGES, stageOf, type Pill } from '../pipeline.ts'
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
  ...(Object.keys(PILLS) as Pill[]).map((pill) => ({ id: pill, label: PILLS[pill].label, statuses: PILLS[pill].statuses })),
]

/** Where the task is in the flow, as in the card detail of the design. */
function StageSteps({ status }: { status: string }) {
  const current = stageOf(status)
  return <ol className="pipe-steps" aria-label="Alur tugas">{STAGES.map((stage, index) => <li key={stage.id} className={index < current || status === 'done' ? 'past' : index === current ? `now pill-${pillOf(status)}` : ''} aria-current={index === current ? 'step' : undefined}><span className="mono">{index + 1}</span>{stage.label}</li>)}</ol>
}

// Approving and feedback happen per item in the checklist; rejecting stops the whole card.
type ReviewMode = 'reject'
const REVIEW: Record<ReviewMode, { label: string; field: string; required: boolean; submit: string; done: string }> = {
  reject: { label: '✕ Tolak seluruh kartu', field: 'Alasan penolakan (wajib)', required: true, submit: 'Tolak', done: 'Ditolak. Alasan Anda tercatat untuk agent.' },
}

/** Why a blocked task is blocked: a person rejected it, or a worker error / missing input holds it. */
type BlockedBy = 'rejected' | 'held'

/** From the task's comments: Naya's rejections are recorded as "BLOCKED: [Ditolak oleh …]". */
function blockedBy(comments: { body: string }[]): BlockedBy {
  const last = [...comments].reverse().find((comment) => comment.body.startsWith('BLOCKED:'))
  return last?.body.includes('[Ditolak oleh') ? 'rejected' : 'held'
}

/** Reject the whole card (with the required note), retry a blocked task and comment, as the signed-in person. */
function ReviewPanel({ task, status, blocked, onDone }: { task: Task; status: string; blocked?: BlockedBy; onDone: () => void }) {
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
  const canRetry = me.can.review && status === 'blocked'
  const retry = () => void send('retry', {}, 'Tugas dikembalikan ke antrean. Agent akan mengerjakannya lagi.')
  const modes = Object.keys(REVIEW) as ReviewMode[]
  return <section className="task-section" aria-label="Tindakan">
    <p className="eyebrow">KEPUTUSAN ANDA</p>
    {status === 'blocked' && <p className="file-notice">{blocked === 'rejected'
      ? 'Ditolak oleh anggota tim (alasannya di komentar). "Coba lagi" mengembalikan tugas ke agent untuk dikerjakan ulang.'
      : 'Tertahan: agent gagal (lihat Kegagalan terakhir, mis. API key model ditolak) atau menunggu masukan. Perbaiki penyebabnya, lalu "Coba lagi".'}</p>}
    {canRetry && <div className="review-actions"><button type="button" className="primary-button" disabled={busy} onClick={retry}>↻ Coba lagi</button></div>}
    {canReview && <div className="review-actions">{modes.map((item) => <button type="button" key={item} className="secondary-button bad" aria-pressed={mode === item} disabled={busy} onClick={() => { setMode(mode === item ? undefined : item); setMessage(undefined) }}>{REVIEW[item].label}</button>)}</div>}
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
  const me = useMe()
  const people = usePeople()
  const [pic, setPic] = useState<string | null>(me?.user.id ?? null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!title.trim()) { setError('Judul wajib diisi.'); return }
    setBusy(true)
    const result = await apiPost<{ id: string }>('/api/tasks', { title, body, decompose, ...(pic ? { pic } : {}), ...(board ? { board } : {}) })
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
      <PicSelect label="PIC (yang memutuskan hasilnya)" value={pic} people={people} onChange={setPic}/>
      <label className="check-label"><input type="checkbox" checked={decompose} onChange={(event) => setDecompose(event.target.checked)}/> Pecah otomatis menjadi tugas untuk agent spesialis</label>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="review-actions"><button type="submit" className="primary-button" disabled={busy}>{busy ? 'Mengirim…' : 'Kirim ke Naya'}</button><button type="button" className="secondary-button" onClick={onClose}>Batal</button></div>
      <p className="small-note">Tugas masuk ke kolom Triase. Setelah AI selesai, PIC menerima WhatsApp dan memutuskan tiap item checklist di Tugas Saya.</p>
    </form>
  </Dialog>
}

interface Attachment { id: number; filename: string; size: number; contentType?: string; uploadedBy?: string; createdAt?: string }

const isText = (file: Attachment) => /^(text\/|application\/json)/.test(file.contentType ?? '')
const fileSize = (bytes: number) => bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`

/** Files the agent attached to the task (its deliverables): read text here, download anything. */
function TaskAttachments({ task, version }: { task: Task; version: number }) {
  const [files, setFiles] = useState<Attachment[] | null>(null)
  const [open, setOpen] = useState<{ id: number; text: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const base = `/api/tasks/${encodeURIComponent(task.id ?? '')}/attachments`
  const board = task.board ? `?board=${encodeURIComponent(task.board)}` : ''
  useEffect(() => {
    if (!task.id) return
    let active = true
    void apiFetch(`${base}${board}`).then(async (response) => {
      const data = await response.json().catch(() => undefined) as { attachments?: Attachment[] } | undefined
      if (active) setFiles(response.ok ? data?.attachments ?? [] : [])
    }).catch(() => { if (active) setFiles([]) })
    return () => { active = false }
  }, [base, board, task.id, version])
  if (!files?.length) return null

  async function fetchFile(file: Attachment): Promise<Blob | null> {
    setError(null)
    const response = await apiFetch(`${base}/${file.id}${board}`).catch(() => null)
    if (!response?.ok) {
      const data = await response?.json().catch(() => undefined) as { error?: string } | undefined
      setError(data?.error ?? 'Lampiran tidak bisa dibuka.')
      return null
    }
    return response.blob()
  }
  async function view(file: Attachment) {
    if (open?.id === file.id) return setOpen(null)
    const blob = await fetchFile(file)
    if (blob) setOpen({ id: file.id, text: await blob.text() })
  }
  async function download(file: Attachment) {
    const blob = await fetchFile(file)
    if (!blob) return
    const url = URL.createObjectURL(blob)
    const link = Object.assign(document.createElement('a'), { href: url, download: file.filename })
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1_000)
  }

  return <section className="task-section">
    <p className="eyebrow">LAMPIRAN ({files.length})</p>
    <ul className="task-attachments">{files.map((file) => <li key={file.id}>
      <div className="task-attachment-row">
        <span><b>{file.filename}</b><small>{fileSize(file.size)}{file.createdAt ? ` · ${formatDateTime(file.createdAt)}` : ''}</small></span>
        <span className="task-attachment-actions">
          {isText(file) && <button type="button" className="chip chip-button" aria-expanded={open?.id === file.id} onClick={() => void view(file)}>{open?.id === file.id ? 'Tutup' : 'Lihat'}</button>}
          <button type="button" className="chip chip-button" onClick={() => void download(file)}>Unduh</button>
        </span>
      </div>
      {open?.id === file.id && <pre className="task-text task-attachment-text">{open.text}</pre>}
    </li>)}</ul>
    {error && <p className="text-bad small-note" role="alert">{error}</p>}
  </section>
}

/** Hermes notes rejections as "BLOCKED: [Ditolak oleh …] reason"; people only need the words. */
const commentText = (body: string) => body.replace(/^BLOCKED:\s*/, '')

/** Who asked for it and when it moved, as one sentence instead of a grid of timestamps. */
function TaskStory({ createdAt, createdBy, startedAt, completedAt }: { createdAt?: string; createdBy?: string; startedAt?: string; completedAt?: string }) {
  const parts = [
    createdAt && <span key="created" title={formatDateTime(createdAt)}>Diminta {createdBy ? <>oleh <b>{createdBy}</b> </> : ''}{formatRelative(createdAt)}</span>,
    startedAt && <span key="started" title={formatDateTime(startedAt)}>mulai dikerjakan {formatRelative(startedAt)}</span>,
    completedAt && <span key="done" title={formatDateTime(completedAt)}>selesai {formatRelative(completedAt)}</span>,
  ].filter(Boolean)
  return parts.length ? <p className="task-story">{parts.flatMap((part, index) => index ? [' · ', part] : [part])}</p> : null
}

export function TaskDetailDialog({ task, onClose, onOpenTask, onChanged, titleOf, agentName = agentLabel }: { task: Task; onClose: () => void; onOpenTask?: (id: string) => void; onChanged?: () => void; titleOf?: (id: string) => string | undefined; agentName?: AgentName }) {
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
  const assignee = detail?.assignee ?? task.assignee
  const priority = detail?.priority ?? task.priority
  const blocked = detail ? blockedBy(detail.comments) : undefined
  const related = (label: string, ids: string[]) => ids.length > 0 && <section className="task-section"><p className="eyebrow">{label}</p><ul className="task-related">{ids.map((id) => <li key={id}><button type="button" className="link-button" onClick={() => onOpenTask?.(id)}>{titleOf?.(id) ?? id}</button></li>)}</ul></section>
  return <Dialog labelledBy="task-detail-title" onClose={onClose} closeLabel={`Tutup detail ${task.title}`} className="task-detail">
    <p className="eyebrow">TUGAS{task.board ? ` · ${task.board.toUpperCase()}` : ''}</p>
    <h2 id="task-detail-title">{detail?.title ?? task.title}</h2>
    <div className="task-meta"><span className={`pill pill-${pillOf(status)}`}>{status === 'blocked' && detail ? (blocked === 'rejected' ? '✕ Ditolak' : '✕ Tertahan') : PILLS[pillOf(status)].label}</span><span className={`chip ${assignee ? '' : 'chip-muted'}`}>{assignee ? `PIC: ${agentName(assignee)}` : 'Belum ditugaskan'}</span>{priority ? <span className="chip chip-priority">Prioritas {priority}</span> : null}</div>
    {detail && <TaskStory {...detail}/>}
    <StageSteps status={status}/>
    {state.status === 'pending' && task.id && <p className="muted">Memuat detail tugas…</p>}
    {failed && <p className="file-notice">{task.id ? 'Detail lengkap belum bisa dimuat. Menampilkan ringkasan dari papan.' : 'Hanya ringkasan dari papan yang tersedia untuk tugas ini.'}</p>}
    {detail && <>
      {status === 'blocked' && detail.lastError && <section className="task-section"><p className="eyebrow">KENAPA TERTAHAN</p><p className="task-prose task-prose-bad">{detail.lastError}</p></section>}
      <section className="task-section"><p className="eyebrow">INSTRUKSI</p>{detail.body ? <p className="task-prose">{detail.body}</p> : <p className="muted">Tidak ada instruksi tambahan selain judul.</p>}</section>
      {detail.result && <section className="task-section"><p className="eyebrow">HASIL KERJA</p><p className="task-prose">{detail.result}</p></section>}
      <TaskAttachments task={task} version={version}/>
      {related('BAGIAN DARI', detail.parents)}
      {related('TUGAS TURUNAN', detail.children)}
      {task.id && <ChecklistPanel taskId={task.id} board={task.board} version={version} onDone={() => { setVersion((value) => value + 1); onChanged?.() }}/>}
      {detail.comments.length > 0 && <section className="task-section"><p className="eyebrow">DISKUSI</p><ul className="task-timeline">{detail.comments.map((comment, index) => <li key={index}><b>{agentName(comment.author)}</b><small title={formatDateTime(comment.createdAt)}>{formatRelative(comment.createdAt)}</small><p>{commentText(comment.body)}</p></li>)}</ul></section>}
    </>}
    <ReviewPanel task={task} status={status} blocked={blocked} onDone={() => { setVersion((value) => value + 1); onChanged?.() }}/>
  </Dialog>
}

/** The four flow columns of cards (Masuk → Dikerjakan AI → Review → Selesai). */
export function PipelineColumns({ tasks, multiBoard, onOpen, agentName = agentLabel, cards = [] }: { tasks: Task[]; multiBoard: boolean; onOpen: (task: Task, trigger: HTMLButtonElement) => void; agentName?: AgentName; cards?: CardSummary[] }) {
  return <div className="pipeline-scroll"><section className="pipeline" aria-label="Alur tugas">{STAGES.map((stage, index) => {
    const items = tasks.filter((task) => stageOf(task.status) === index).sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))
    return <section key={stage.id} className="pipe-col" aria-label={`Kolom ${index + 1} ${stage.label}`}>
      <header className="pipe-col-head"><h2>{index + 1} · {stage.label}</h2><span className="mono">{items.length}</span></header>
      <div className="pipe-col-body">{items.length === 0 ? <p className="column-empty">—</p> : items.map((task) => {
        const pill = pillOf(task.status)
        const card = cards.find((item) => item.taskId === task.id && item.board === (task.board ?? 'default'))
        return <button type="button" className={`pipe-card card-${pill}`} key={`${task.board ?? ''}-${task.status}-${task.id ?? task.title}`} onClick={(event) => onOpen(task, event.currentTarget)} aria-label={`${task.title}. ${statusLabel(task.status)}. Buka detail tugas.`}>
          <span className="pipe-card-head"><span className={`pill pill-${pill}`}>{PILLS[pill].label}</span>{task.id && <span className="mono">#{task.id}</span>}</span>
          <strong>{task.title}</strong>
          <span className={`pipe-bar pill-${pill}`}><span style={{ width: `${((stageOf(task.status) + 1) / STAGES.length) * 100}%` }}/></span>
          <span className="pipe-card-foot"><span>AI: {task.assignee ? agentName(task.assignee) : 'belum ditugaskan'}{card?.picName ? ` · PIC: ${card.picName}` : ''}{card?.total ? ` · ✓ ${card.done}/${card.total}` : ''}</span><span className="mono">{multiBoard && task.board ? `${task.board} · ` : ''}{task.priority ? `P${task.priority}` : ''}</span></span>
        </button>
      })}</div>
    </section>
  })}</section></div>
}

export function TaskBoard() {
  const snapshot = usePolling<TaskBoardSnapshot>('/api/tasks', 10_000)
  const cards = usePolling<CardSummary[]>('/api/cards', 15_000)
  const [query, setQuery] = useState('')
  const [assignee, setAssignee] = useState('all')
  const [board, setBoard] = useState('all')
  const [openTask, setOpenTask] = useState<Task | undefined>()
  const [filter, setFilter] = useState('all')
  const [instructing, setInstructing] = useState(false)
  const me = useMe()
  const agentName = useAgentName()
  const trigger = useRef<HTMLButtonElement | null>(null)
  const closeTask = () => { setOpenTask(undefined); trigger.current?.focus() }
  const data = snapshot.status === 'ready' ? snapshot.data : undefined
  const tasks = data?.tasks
  const all = tasks?.data ?? []
  const assignees = [...new Set(all.map((task) => task.assignee ?? UNASSIGNED))].sort()
  const boards = data?.boards ?? []
  const multiBoard = boards.length > 1
  const needle = query.trim().toLowerCase()
  const statuses = FILTERS.find((item) => item.id === filter)?.statuses
  const visible = all.filter((task) => (!statuses || statuses.includes(task.status)) && (assignee === 'all' || (task.assignee ?? UNASSIGNED) === assignee) && (board === 'all' || task.board === board) && (!needle || `${task.title} ${task.id ?? ''} ${task.assignee ?? ''} ${task.assignee ? agentName(task.assignee) : ''}`.toLowerCase().includes(needle)))
  return <><PageTitle eyebrow="HERMES KANBAN" title="Papan tugas">Semua tugas tim AI dari Kanban Hermes, diperbarui tiap 10 detik. AI menyusun draf; PIC manusia memutuskan tiap item checklist (Selesai, Feedback, atau Ditolak) sebelum kartu maju.</PageTitle>
    {me?.can.instruct && <div className="toolbar"><button type="button" className="primary-button" onClick={() => setInstructing(true)}>＋ Instruksi ke Naya</button></div>}
    {instructing && <InstructionDialog boards={boards} onClose={() => setInstructing(false)} onCreated={snapshot.refresh}/>}
    <SourceStatus source={tasks} fetchedAt={data?.fetchedAt} request={snapshot}/><Unavailable source={tasks} request={snapshot}/>
    {data?.failedBoards && <p className="file-notice">Board {data.failedBoards.join(', ')} tidak bisa dibaca; menampilkan board lain.</p>}
    {tasks?.availability === 'available' && (all.length === 0 ? <EmptyState title="Belum ada tugas">{multiBoard ? `Tidak ada tugas terbuka di ${boards.length} board Kanban.` : 'Kanban Hermes masih kosong.'} {me?.can.instruct ? 'Mulai dengan tombol "Instruksi ke Naya".' : 'Tugas baru dibuat oleh Owner, Admin, atau PM.'}</EmptyState> : <>
      <div className="pipe-filters" role="group" aria-label="Saring status">{FILTERS.map((item) => <button type="button" key={item.id} className={`pipe-filter${item.statuses ? ` pill-${item.id}` : ''}`} aria-pressed={filter === item.id} onClick={() => setFilter(item.id)}>{item.label} <b className="mono">{item.statuses ? all.filter((task) => item.statuses!.includes(task.status)).length : all.length}</b></button>)}</div>
      <div className="toolbar"><SearchInput value={query} onChange={setQuery} label="Cari tugas"/><label className="select-label">PIC <select value={assignee} onChange={(event) => setAssignee(event.target.value)}><option value="all">Semua ({all.length})</option>{assignees.map((name) => <option key={name} value={name}>{name === UNASSIGNED ? name : agentName(name)}</option>)}</select></label>{multiBoard && <label className="select-label">Board <select value={board} onChange={(event) => setBoard(event.target.value)}><option value="all">Semua board</option>{boards.map((item) => <option key={item.slug} value={item.slug}>{item.name}{item.current ? ' (aktif)' : ''}</option>)}</select></label>}<span className="toolbar-count">{visible.length} tampil</span></div>
      <PipelineColumns tasks={visible} multiBoard={multiBoard} agentName={agentName} cards={cards.status === 'ready' ? cards.data : []} onOpen={(task, trigger_) => { trigger.current = trigger_; setOpenTask(task) }}/>
      <section className="pipe-legend" aria-label="Legenda"><span className="eyebrow">LEGENDA</span>{(Object.keys(PILLS) as Pill[]).map((pill) => <span key={pill}><span className={`pill pill-${pill}`}>{PILLS[pill].label}</span> {PILLS[pill].legend}</span>)}</section>
    </>)}
    {openTask && <TaskDetailDialog key={`${openTask.board ?? ''}-${openTask.id ?? openTask.title}`} task={openTask} onClose={closeTask} onChanged={() => { snapshot.refresh(); cards.refresh() }} agentName={agentName} titleOf={(id) => all.find((task) => task.id === id && task.board === openTask.board)?.title} onOpenTask={(id) => setOpenTask(all.find((task) => task.id === id && task.board === openTask.board) ?? { id, title: id, status: 'unknown', ...(openTask.board ? { board: openTask.board } : {}) })}/>}
  </>
}
