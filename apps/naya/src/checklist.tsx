import { useEffect, useState, type FormEvent } from 'react'
import { rosterAgent } from '@repo/shared/naya-roster'
import { apiPost, useMe } from './access.ts'
import { agentLabel, formatRelative } from './format.ts'
import { usePeople } from './people.ts'
import { loadSnapshot, type RequestState } from './request-state.ts'
import type { Checklist, ChecklistItem, ChecklistStatus, Member, NayaPool } from './types.ts'

// The human half of a card (blueprint v3). The AI drafts until the card reaches review; then each
// item of its checklist is In Progress, Selesai, Feedback (what to fix) or Ditolak (why). The card
// only moves once nobody is still checking, and the notes go back to the agent. PICs are team
// members; "auto" picks the most available member of the card's pool when the AI hands it over,
// and a reviewed card can continue to design or development.

const CHECKLIST_LABEL: Record<ChecklistStatus, string> = { in_progress: 'In Progress', done: 'Selesai', feedback: 'Feedback', rejected: 'Ditolak' }
const CHECKLIST_PILL: Record<ChecklistStatus, string> = { in_progress: 'review', done: 'done', feedback: 'ai', rejected: 'blocked' }

const POOL_LABEL: Record<NayaPool, string> = { review: 'Sales/PM', design: 'Designer', development: 'Developer' }
const PRESENCE_LABEL: Record<Member['presence'], string> = { standby: 'santai', working: 'sedang bekerja', absent: 'belum standup', resting: 'sudah pulang' }
const PRESENCE_RANK: Record<Member['presence'], number> = { standby: 0, working: 1, absent: 2, resting: 3 }

const OUTCOME_TEXT: Record<string, string> = {
  approve: 'Semua item Selesai. Kartu ditandai selesai.',
  changes: 'Feedback dikirim ke agent. Item kembali ke PIC sebagai versi berikutnya.',
  reject: 'Kartu ditolak. Alasan tercatat sebagai aturan kandidat untuk agent.',
}

/** "auto" in a picker: leave the choice to handover time. */
const AUTO = 'auto'

const memberLabel = (member: Member) => `${member.name} · ${PRESENCE_LABEL[member.presence]}${member.load ? ` · ${member.load} antrean` : ''}`

/**
 * A team member picker, grouped by pool, the most available first. With `autoPool`, the first
 * option is "auto" (the most available member of that pool); otherwise "" is nobody.
 */
export function PicSelect({ value, people: list, onChange, label, disabled, autoPool }: { value: string | null; people: Member[]; onChange: (pic: string | null) => void; label: string; disabled?: boolean; autoPool?: NayaPool | null }) {
  const groups: [string, Member[]][] = [...(['review', 'design', 'development'] as NayaPool[]).map((pool): [string, Member[]] => [POOL_LABEL[pool], list.filter((member) => member.pool === pool)]), ['Lainnya', list.filter((member) => !member.pool)]]
  const sorted = (members: Member[]) => [...members].sort((a, b) => PRESENCE_RANK[a.presence] - PRESENCE_RANK[b.presence] || a.load - b.load || a.name.localeCompare(b.name))
  return <label className="select-label">{label} <select value={value ?? (autoPool ? AUTO : '')} disabled={disabled} onChange={(event) => onChange(event.target.value && event.target.value !== AUTO ? event.target.value : autoPool ? AUTO : null)}>
    {autoPool ? <option value={AUTO}>Otomatis: {POOL_LABEL[autoPool]} yang tersedia (prioritas santai)</option> : <option value="">— belum ada —</option>}
    {groups.filter(([, members]) => members.length).map(([name, members]) => <optgroup key={name} label={name}>{sorted(members).map((member) => <option key={member.id} value={member.id}>{memberLabel(member)}</option>)}</optgroup>)}
  </select></label>
}

type Mode = 'feedback' | 'rejected'

function ChecklistRow({ item, mayDecide, mayAssign, open, people: list, onAssign, onDecide }: {
  item: ChecklistItem
  mayDecide: boolean
  mayAssign: boolean
  open: boolean
  people: Member[]
  onAssign: (pic: string | null) => void
  onDecide: (status: ChecklistStatus, note?: string) => Promise<boolean>
}) {
  const [mode, setMode] = useState<Mode>()
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const pic = list.find((person) => person.id === item.picEmployeeId)
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
      {mayAssign && open ? <PicSelect label="PIC" value={item.picEmployeeId} people={list} onChange={onAssign} disabled={busy}/> : <small>PIC: {pic?.name ?? 'belum ada'}</small>}
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

/** After review: send the card on to design or development (an AI agent drafts the requirement first). */
function ContinueActions({ checklist, onContinue }: { checklist: Checklist; onContinue: (step: Exclude<NayaPool, 'review'>, note: string) => Promise<boolean> }) {
  const [step, setStep] = useState<Exclude<NayaPool, 'review'>>()
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  if (checklist.continuedTo) {
    return <p className="file-notice">Dilanjutkan ke <b>{POOL_LABEL[checklist.continuedStep ?? 'design']}</b> sebagai kartu <span className="mono">#{checklist.continuedTo}</span>. AI menyusun {checklist.continuedStep === 'development' ? 'PRD' : 'design requirement'} dari hasil ini, lalu {POOL_LABEL[checklist.continuedStep ?? 'design'].toLowerCase()} yang paling tersedia menerimanya.</p>
  }
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!step) return
    setBusy(true)
    if (await onContinue(step, note)) { setStep(undefined); setNote('') }
    setBusy(false)
  }
  return <div className="continue-box">
    <p className="eyebrow">LANGKAH BERIKUTNYA</p>
    <p className="small-note">Butuh dikerjakan tim? AI menyusun requirement dari hasil yang sudah Anda setujui, lalu menyerahkannya ke anggota yang tersedia (prioritas yang santai).</p>
    <div className="review-actions">
      <button type="button" className="secondary-button" aria-pressed={step === 'design'} onClick={() => setStep(step === 'design' ? undefined : 'design')}>🎨 Lanjut ke Designer</button>
      <button type="button" className="secondary-button" aria-pressed={step === 'development'} onClick={() => setStep(step === 'development' ? undefined : 'development')}>💻 Lanjut ke Developer</button>
    </div>
    {step && <form className="review-form" onSubmit={submit}>
      <label className="field-label" htmlFor="continue-note">Catatan untuk {POOL_LABEL[step].toLowerCase()} (opsional)</label>
      <textarea id="continue-note" value={note} onChange={(event) => setNote(event.target.value)} maxLength={2000} placeholder={step === 'design' ? 'mis. Fokus versi mobile, ikuti warna brand klien' : 'mis. Pakai stack yang sama dengan proyek X'}/>
      <div className="review-actions"><button type="submit" className="primary-button" disabled={busy}>{busy ? 'Membuat kartu…' : `Buat kartu untuk ${POOL_LABEL[step]}`}</button><button type="button" className="secondary-button" onClick={() => setStep(undefined)}>Batal</button></div>
    </form>}
  </div>
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
  const checklist = state.data
  const { status, pic, pool, items } = checklist
  const open = status === 'review'
  const mayAssign = me.can.review || me.can.instruct
  const done = items.filter((item) => item.status === 'done').length
  const post = async (path: string, body: Record<string, unknown>, success?: string) => {
    setMessage(undefined)
    const result = await apiPost<{ outcome?: string; id?: string }>(`${base}/${path}`, { ...body, ...(board ? { board } : {}) })
    if (!result.ok) { setMessage({ ok: false, text: result.message }); return false }
    const outcome = result.data.outcome
    if (outcome && outcome !== 'wait') { setMessage({ ok: true, text: OUTCOME_TEXT[outcome] }); onDone() }
    if (success) { setMessage({ ok: true, text: success }); onDone() }
    setReload((value) => value + 1)
    return true
  }
  const picName = list.find((person) => person.id === pic)?.name
  return <section className="task-section" aria-label="Checklist manusia">
    <p className="eyebrow">CHECKLIST TIM{items.length ? ` · ${done}/${items.length} SELESAI` : ''}</p>
    {checklist.continuesFrom && <p className="small-note">Lanjutan dari kartu <span className="mono">#{checklist.continuesFrom}</span> yang sudah disetujui Sales/PM.</p>}
    {mayAssign
      ? <PicSelect label="PIC kartu" value={pic} people={list} autoPool={pool} onChange={(next) => void post('pic', { pic: next === AUTO ? null : next })}/>
      : <p className="small-note">PIC kartu: {picName ?? (pool ? `otomatis (${POOL_LABEL[pool]} yang tersedia)` : 'belum ada')}</p>}
    {!pic && pool && <p className="small-note">PIC dipilih otomatis saat AI selesai: {POOL_LABEL[pool]} yang santai lebih dulu, lalu yang sedang bekerja.</p>}
    {!items.length && <p className="small-note">Checklist muncul saat AI menyerahkan hasilnya (kolom Review). PIC kartu menerima pemberitahuan WhatsApp.</p>}
    {items.length > 0 && !open && <p className="small-note">{status === 'done' ? 'Kartu sudah selesai.' : 'AI sedang mengerjakan versi berikutnya; keputusan dibuka lagi saat kartu kembali ke Review.'}</p>}
    {items.length > 0 && <ul className="checklist">{items.map((item) => <ChecklistRow
      key={item.id}
      item={item}
      open={open}
      people={list}
      mayAssign={mayAssign}
      mayDecide={(!!me.user.employeeId && item.picEmployeeId === me.user.employeeId) || me.can.review}
      onAssign={(next) => void post(`checklist/${encodeURIComponent(item.id)}/pic`, { pic: next })}
      onDecide={(next, note) => post(`checklist/${encodeURIComponent(item.id)}`, { status: next, ...(note ? { note } : {}) })}
    />)}</ul>}
    {open && items.length > 0 && <p className="small-note">Kartu baru maju setelah semua item diputuskan: semua Selesai menutup kartu; Feedback dan Ditolak dikirim ke agent beserta catatannya.</p>}
    {status === 'done' && mayAssign && !checklist.continuesFrom && <ContinueActions checklist={checklist} onContinue={(step, note) => post('continue', { step, ...(note.trim() ? { note } : {}) }, `Kartu baru dibuat untuk ${POOL_LABEL[step]}. AI menyusun requirement-nya dulu.`)}/>}
    {message && <p className={message.ok ? 'form-success' : 'form-error'} role={message.ok ? 'status' : 'alert'}>{message.text}</p>}
  </section>
}
