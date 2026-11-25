import { useEffect, useState, type FormEvent } from 'react'
import { apiPost, useMe } from './access.ts'
import { formatRelative } from './format.ts'
import { rosterAgent } from '@repo/shared/naya-roster'
import { agentLabel } from './format.ts'
import { usePeople } from './people.ts'
import { loadSnapshot, type RequestState } from './request-state.ts'
import type { Checklist, ChecklistItem, ChecklistStatus, Person } from './types.ts'

// The human half of a card (blueprint v3). The AI drafts until the card reaches review; then each
// item of its checklist is In Progress, Selesai, Feedback (what to fix) or Ditolak (why). The card
// only moves once nobody is still checking, and the notes go back to the agent.

const CHECKLIST_LABEL: Record<ChecklistStatus, string> = { in_progress: 'In Progress', done: 'Selesai', feedback: 'Feedback', rejected: 'Ditolak' }
const CHECKLIST_PILL: Record<ChecklistStatus, string> = { in_progress: 'review', done: 'done', feedback: 'ai', rejected: 'blocked' }

const OUTCOME_TEXT: Record<string, string> = {
  approve: 'Semua item Selesai. Kartu ditandai selesai.',
  changes: 'Feedback dikirim ke agent. Item kembali ke PIC sebagai versi berikutnya.',
  reject: 'Kartu ditolak. Alasan tercatat sebagai aturan kandidat untuk agent.',
}

/** A person picker; "" is nobody (everyone who may review sees the item). */
export function PicSelect({ value, people: list, onChange, label, disabled }: { value: string | null; people: Person[]; onChange: (pic: string | null) => void; label: string; disabled?: boolean }) {
  return <label className="select-label">{label} <select value={value ?? ''} disabled={disabled} onChange={(event) => onChange(event.target.value || null)}>
    <option value="">— belum ada —</option>
    {list.map((person) => <option key={person.id} value={person.id}>{person.name}{person.role ? ` (${person.role})` : ''}</option>)}
  </select></label>
}

type Mode = 'feedback' | 'rejected'

function ChecklistRow({ item, mayDecide, mayAssign, open, people: list, onAssign, onDecide }: {
  item: ChecklistItem
  mayDecide: boolean
  mayAssign: boolean
  open: boolean
  people: Person[]
  onAssign: (pic: string | null) => void
  onDecide: (status: ChecklistStatus, note?: string) => Promise<boolean>
}) {
  const [mode, setMode] = useState<Mode>()
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const pic = list.find((person) => person.id === item.picUserId)
  // The blueprint names who reviews each agent's work; shown as a hint next to the PIC.
  const reviewer = rosterAgent(item.agent)?.pic
  const decide = async (status: ChecklistStatus, text?: string) => {
    setBusy(true)
    const ok = await onDecide(status, text)
    setBusy(false)
    if (ok) { setMode(undefined); setNote('') }
  }
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (mode && note.trim()) void decide(mode, note)
  }
  return <li className="checklist-item">
    <div className="checklist-head">
      <span className={`pill pill-${CHECKLIST_PILL[item.status]}`}>{CHECKLIST_LABEL[item.status]}</span>
      <b>{item.title}</b>
      <span className="mono">v{item.version}</span>
    </div>
    <div className="checklist-meta">
      {mayAssign && open ? <PicSelect label="PIC" value={item.picUserId} people={list} onChange={onAssign} disabled={busy}/> : <small>PIC: {pic?.name ?? 'belum ada'}</small>}
      {item.agent && <small>dikerjakan {agentLabel(item.agent)}{reviewer && reviewer !== 'PIC kartu' ? ` · review oleh ${reviewer}` : ''}</small>}
      {item.handedAt && item.status === 'in_progress' && <small>diserahkan {formatRelative(item.handedAt)}</small>}
    </div>
    {item.note && <p className={`small-note${item.status === 'in_progress' ? '' : ' checklist-note'}`}>{item.status === 'in_progress' ? `Catatan versi sebelumnya: ${item.note}` : item.note}</p>}
    {open && mayDecide && <div className="review-actions">
      {item.status === 'in_progress'
        ? <>
          <button type="button" className="primary-button" disabled={busy} onClick={() => void decide('done')}>✓ Selesai</button>
          <button type="button" className="secondary-button warn" aria-pressed={mode === 'feedback'} disabled={busy} onClick={() => setMode(mode === 'feedback' ? undefined : 'feedback')}>↻ Feedback</button>
          <button type="button" className="secondary-button bad" aria-pressed={mode === 'rejected'} disabled={busy} onClick={() => setMode(mode === 'rejected' ? undefined : 'rejected')}>✕ Tolak</button>
        </>
        : <button type="button" className="secondary-button" disabled={busy} onClick={() => void decide('in_progress')}>Batalkan keputusan</button>}
    </div>}
    {mode && <form className="review-form" onSubmit={submit}>
      <label className="field-label" htmlFor={`note-${item.id}`}>{mode === 'feedback' ? 'Apa yang perlu diperbaiki? (wajib)' : 'Alasan penolakan (wajib)'}</label>
      <textarea id={`note-${item.id}`} value={note} onChange={(event) => setNote(event.target.value)} maxLength={4000} required autoFocus/>
      <div className="review-actions"><button type="submit" className="primary-button" disabled={busy || !note.trim()}>{busy ? 'Menyimpan…' : 'Simpan'}</button><button type="button" className="secondary-button" onClick={() => setMode(undefined)}>Batal</button></div>
    </form>}
  </li>
}

/** The card's PIC and checklist, with a decision per item for its PIC (or anyone who may review). */
export function ChecklistPanel({ taskId, board, version, onDone }: { taskId: string; board?: string; version: number; onDone: () => void }) {
  const me = useMe()
  const list = usePeople()
  const [state, setState] = useState<RequestState<Checklist>>({ status: 'pending' })
  const [reload, setReload] = useState(0)
  const [message, setMessage] = useState<{ ok: boolean; text: string }>()
  const query = board ? `?board=${encodeURIComponent(board)}` : ''
  const base = `/api/tasks/${encodeURIComponent(taskId)}`
  useEffect(() => {
    let active = true
    void loadSnapshot<Checklist>(`${base}/checklist${query}`).then((next) => { if (active) setState(next) })
    return () => { active = false }
  }, [base, query, version, reload])
  if (!me) return null
  if (state.status === 'failed') return <section className="task-section"><p className="eyebrow">CHECKLIST</p><p className="text-bad small-note">{state.message}</p></section>
  if (state.status !== 'ready') return null
  const { status, pic, items } = state.data
  const open = status === 'review'
  const mayAssign = me.can.review || me.can.instruct
  const done = items.filter((item) => item.status === 'done').length
  const post = async (path: string, body: Record<string, unknown>) => {
    setMessage(undefined)
    const result = await apiPost<{ outcome?: string }>(`${base}/${path}`, { ...body, ...(board ? { board } : {}) })
    if (!result.ok) { setMessage({ ok: false, text: result.message }); return false }
    const outcome = result.data.outcome
    if (outcome && outcome !== 'wait') { setMessage({ ok: true, text: OUTCOME_TEXT[outcome] }); onDone() }
    setReload((value) => value + 1)
    return true
  }
  return <section className="task-section" aria-label="Checklist manusia">
    <p className="eyebrow">CHECKLIST TIM{items.length ? ` · ${done}/${items.length} SELESAI` : ''}</p>
    {mayAssign
      ? <PicSelect label="PIC kartu" value={pic} people={list} onChange={(next) => void post('pic', { pic: next })}/>
      : <p className="small-note">PIC kartu: {list.find((person) => person.id === pic)?.name ?? 'belum ada'}</p>}
    {!items.length && <p className="small-note">Checklist muncul saat AI menyerahkan hasilnya (kolom Review). PIC kartu menerima pemberitahuan WhatsApp.</p>}
    {items.length > 0 && !open && <p className="small-note">{status === 'done' ? 'Kartu sudah selesai.' : 'AI sedang mengerjakan versi berikutnya; keputusan dibuka lagi saat kartu kembali ke Review.'}</p>}
    {items.length > 0 && <ul className="checklist">{items.map((item) => <ChecklistRow
      key={item.id}
      item={item}
      open={open}
      people={list}
      mayAssign={mayAssign}
      mayDecide={item.picUserId === me.user.id || me.can.review}
      onAssign={(next) => void post(`checklist/${encodeURIComponent(item.id)}/pic`, { pic: next })}
      onDecide={(next, note) => post(`checklist/${encodeURIComponent(item.id)}`, { status: next, ...(note ? { note } : {}) })}
    />)}</ul>}
    {open && items.length > 0 && <p className="small-note">Kartu baru maju setelah semua item diputuskan: semua Selesai menutup kartu; Feedback dan Ditolak dikirim ke agent beserta catatannya.</p>}
    {message && <p className={message.ok ? 'form-success' : 'form-error'} role={message.ok ? 'status' : 'alert'}>{message.text}</p>}
  </section>
}
