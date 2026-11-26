import { Component, lazy, Suspense, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react'
import { agentLook } from '../agents.ts'
import { usePolling } from '../polling.ts'
import { formatCompact, formatDateTime, formatNumber } from '../format.ts'
import { canOpen, pageLabel, type Page } from '../routes.ts'
import type { ActivitySnapshot, ChannelSnapshot, DashboardSnapshot, OfficeRoom, OfficeSnapshot, OfficeStation, TeamSnapshot, TeamTask, UsageSnapshot } from '../types.ts'
import { stationBadge, teamStations } from '../team.ts'
import { LoadingState, SourceStatus } from '../ui.tsx'
import { CalendarOverlayView } from './Calendar.tsx'
import { Stats } from './Stats.tsx'
import { TaskBoard } from './TaskBoard.tsx'
import { formatCost } from '../usage.ts'
import { TokenUsage } from './TokenUsage.tsx'
import { AgentChat } from './Chat.tsx'
import { useMe } from '../access.ts'

// The 3D view (three.js) is only downloaded when someone switches to it.
const Office3D = lazy(() => import('./Office3D.tsx'))
type OfficeView = '2d' | '3d'

function webglAvailable(): boolean {
  try {
    const canvas = document.createElement('canvas')
    return Boolean(canvas.getContext('webgl2') ?? canvas.getContext('webgl'))
  } catch {
    return false
  }
}

/** 3D unless the viewer chose 2D before (or the browser has no WebGL, handled by the caller). */
function storedView(): OfficeView {
  try { return window.localStorage.getItem('mc.officeView') === '2d' ? '2d' : '3d' } catch { return '3d' }
}

type PanelTab = 'Crew' | 'Stats' | 'Activity'
const PANEL_TABS: PanelTab[] = ['Crew', 'Stats', 'Activity']
/** Tab names shown to people; the ids above stay as stored in localStorage. */
const PANEL_LABEL: Record<PanelTab, string> = { Crew: 'Kru', Stats: 'Statistik', Activity: 'Aktivitas' }

function storedPanel(): PanelTab | undefined {
  try {
    const value = window.localStorage.getItem('mc.officePanel')
    return PANEL_TABS.find((tab) => tab === value)
  } catch { return undefined }
}

class SceneBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() { return this.state.failed ? this.props.fallback : this.props.children }
}

const ROOMS: OfficeRoom[] = ['Workspace', 'Lounge']
/** Room names shown to people; the room values stay as the API sends them. */
const ROOM_LABEL: Record<OfficeRoom, string> = { Workspace: 'Ruang kerja', Lounge: 'Lounge' }
const roomLabel = (room: OfficeRoom) => ROOM_LABEL[room] ?? room

/** A pixel character dressed in the colours derived from the agent id. */
export function PixelCharacter({ agent }: { agent: string }) {
  const look = agentLook(agent)
  const style = { '--hair': look.hair, '--skin': look.skin, '--shirt': look.shirt, '--pants': look.pants } as CSSProperties
  return <span className="pixel-character" style={style} aria-hidden="true"><span className="character-hair"/><span className="character-head"><i/><b/></span><span className="character-torso"/><span className="character-arm left"/><span className="character-arm right"/><span className="character-leg left"/><span className="character-leg right"/></span>
}

function officeStateLabel(station: OfficeStation): string {
  return stationBadge(station).label
}

const KANBAN: { status: TeamTask['status']; label: string }[] = [
  { status: 'doing', label: 'Dikerjakan' },
  { status: 'done', label: 'Selesai' },
  { status: 'blocked', label: 'Kendala' },
]

/** Today's work of a person on the team, from their standup (plan) and checkout (done, blockers). */
export function TeamKanban({ tasks }: { tasks: TeamTask[] }) {
  return <div className="team-kanban">{KANBAN.map((column) => {
    const cards = tasks.filter((task) => task.status === column.status)
    return <section key={column.status} className={`team-kanban-column ${column.status}`} aria-label={`${column.label} (${cards.length})`}>
      <h3>{column.label} <span className="room-count">{cards.length}</span></h3>
      {cards.length === 0 ? <p className="muted">—</p> : cards.map((task, index) => <article key={index} className="team-kanban-card">{task.title}</article>)}
    </section>
  })}</div>
}

const PRESENCE_NOTE = { absent: '', working: 'Sedang mengerjakan rencana hari ini.', standby: 'Hari ini eksplorasi / standby, jadi santai di sekitar kantor.', resting: 'Sudah checkout, sedang istirahat.' } as const

/** This agent's tokens over the last 7 days and its rank in the crew (Hermes profiles only). */
function AgentTokens({ agent }: { agent: string }) {
  const usage = usePolling<UsageSnapshot>('/api/usage?days=7', 0)
  if (usage.status !== 'ready' || !Array.isArray(usage.data.agents)) return <div><dt>Token (7 hari)</dt><dd>{usage.status === 'pending' ? 'Memuat…' : 'Tidak tersedia'}</dd></div>
  const ranked = usage.data.agents.filter((item) => item.usage)
  const index = ranked.findIndex((item) => item.agent === agent)
  const mine = ranked[index]?.usage
  return <div><dt>Token (7 hari)</dt><dd>{mine ? `${formatNumber(mine.totalTokens)} · #${index + 1} dari ${ranked.length}${mine.costUsd !== undefined ? ` · perk. ${formatCost(mine.costUsd)}` : ''}${mine.topSession ? ` · sesi terbesar ${formatCompact(mine.topSession.tokens)}` : ''}` : 'Tidak tersedia'}</dd></div>
}

type DetailTab = 'Overview' | 'Chat'
const DETAIL_LABEL: Record<DetailTab, string> = { Overview: 'Ringkasan', Chat: 'Chat' }

/** The lead agent ("naya") when the person may chat with it, else the first agent they may. */
function leadAgent(chat: readonly string[]): string | undefined {
  return chat.includes('naya') ? 'naya' : chat[0]
}

export function OfficeDetail({ station, onClose }: { station: OfficeStation; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null)
  const dialogRef = useRef<HTMLElement>(null)
  const [tab, setTab] = useState<DetailTab>('Overview')
  const me = useMe()
  const canChat = Boolean(me?.can.chat.includes(station.id))
  const tabs: DetailTab[] = ['Overview', ...(canChat ? ['Chat' as const] : [])]
  useEffect(() => { closeRef.current?.focus() }, [])
  const badge = stationBadge(station)
  const employee = station.employee
  const profile = employee ? undefined : station.id
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') { event.stopPropagation(); onClose(); return }
    if (event.key !== 'Tab') return
    const focusable = dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')
    if (!focusable?.length) { event.preventDefault(); return }
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (event.shiftKey ? document.activeElement === first : document.activeElement === last) {
      event.preventDefault()
      const target = event.shiftKey ? last : first
      target.focus()
    }
  }
  return <div className="office-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <section className={`office-detail${tab === 'Overview' && !employee ? '' : ' wide'}`} ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="office-detail-title" onKeyDown={onKeyDown}>
      <button className="office-close" ref={closeRef} onClick={onClose} aria-label={`Tutup detail ${station.name}`}>Tutup</button>
      <div className="detail-head"><div className="detail-avatar"><PixelCharacter agent={station.id}/></div><div><p className="eyebrow">{employee ? 'ANGGOTA TIM' : 'DETAIL AGENT'}</p><h2 id="office-detail-title">{station.name}</h2><span className={`badge ${badge.tone}`}>{officeStateLabel(station)}</span>{station.privacy === 'locked' && <span className="badge muted">🔒 Terkunci</span>}</div></div>
      {profile && <div className="detail-tabs" role="tablist" aria-label={`Detail ${station.name}`}>{tabs.map((item) => <button type="button" role="tab" key={item} aria-selected={tab === item} className={tab === item ? 'active' : ''} onClick={() => setTab(item)}>{DETAIL_LABEL[item]}</button>)}</div>}
      <div role="tabpanel" aria-label={DETAIL_LABEL[tab]} className="detail-body">
        {employee && <>
          <p className="detail-activity">{PRESENCE_NOTE[employee.presence]}</p>
          {/* A colleague's plan only for those who see every task; the API leaves it out for the rest. */}
          {!me || me.can.see.allTasks || station.id === `employee:${me.user.employeeId}` ? <TeamKanban tasks={employee.tasks}/> : null}
          <dl className="office-detail-grid"><div><dt>Tim</dt><dd>{employee.team ?? '—'}</dd></div><div><dt>Sumber data</dt><dd>{station.provenance}</dd></div><div><dt>Kebaruan data</dt><dd>{station.freshness}</dd></div></dl>
        </>}
        {!employee && tab === 'Overview' && <>
          {station.activity && <p className="detail-activity">{station.activity}</p>}
          <dl className="office-detail-grid"><div><dt>Jenis agent</dt><dd>{station.role}</dd></div>{station.role !== 'OpenCode' && station.role !== 'Claude Code' && me?.can.see.usage && <AgentTokens agent={station.id}/>}<div><dt>Ruangan</dt><dd>{roomLabel(station.room)} / {station.roomPosition}</dd></div><div><dt>Tugas saat ini</dt><dd>{station.currentTask}</dd></div><div><dt>Aktivitas terakhir</dt><dd>{station.recentActivity}</dd></div><div><dt>Sumber data</dt><dd>{station.provenance}</dd></div><div><dt>Kebaruan data</dt><dd>{station.freshness}</dd></div></dl></>}
        {tab === 'Chat' && canChat && <AgentChat agent={station.id}/>}
      </div>
    </section>
  </div>
}

type OverlayKind = 'tasks' | 'calendar' | 'usage' | 'chat'
const OVERLAYS: Record<OverlayKind, { title: string; page?: Page }> = { tasks: { title: 'Papan tugas', page: 'Task Board' }, calendar: { title: 'Kalender', page: 'Calendar' }, usage: { title: 'Pemakaian token', page: 'Usage' }, chat: { title: 'Tanya Naya' } }

/** Task Board, the cron calendar or token usage shown over the office, without leaving it. */
function OfficeOverlay({ kind, onClose, onNavigate }: { kind: OverlayKind; onClose: () => void; onNavigate?: (page: Page) => void }) {
  const closeRef = useRef<HTMLButtonElement>(null)
  useEffect(() => { closeRef.current?.focus() }, [kind])
  const { title, page } = OVERLAYS[kind]
  return <section className={`office-overlay overlay-${kind}`} role="dialog" aria-modal="false" aria-labelledby="office-overlay-title" onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); onClose() } }}>
    <header className="office-overlay-head">
      <h2 id="office-overlay-title">{title}</h2>
      {onNavigate && page && <button type="button" className="refresh-button" onClick={() => onNavigate(page)}>Buka halaman penuh ↗</button>}
      <button type="button" ref={closeRef} className="icon-button" onClick={onClose} aria-label={`Tutup ${title}`}>✕</button>
    </header>
    <div className="office-overlay-body">{kind === 'tasks' ? <TaskBoard/> : kind === 'calendar' ? <CalendarOverlayView/> : kind === 'chat' ? <ChatOverlay/> : <TokenUsage/>}</div>
  </section>
}

/** "Tanya Naya": the command center chat with the lead agent. */
function ChatOverlay() {
  const me = useMe()
  const lead = leadAgent(me?.can.chat ?? [])
  if (!lead) return <p className="muted">Belum ada agent yang bisa Anda ajak chat. Admin perlu menambahkan agent ke agents.json di server Naya, dan peran Anda perlu diizinkan di policy.json.</p>
  return <AgentChat agent={lead} intro={`Selamat datang. Ada arahan apa untuk ${lead === 'naya' ? 'Naya' : lead} hari ini? Contoh: "Carikan 20 prospek FMCG Jakarta dan buatkan tugasnya untuk PM".`}/>
}

interface HudItem { label: string; value: string; tone?: 'warn' | 'bad'; page?: Page; title?: string }

/** The few numbers worth seeing at a glance, over the office like a game HUD. */
function hudItems(office: OfficeSnapshot | undefined, dashboard: DashboardSnapshot | null | undefined, team: TeamSnapshot | undefined): HudItem[] {
  const summary = office?.summary ?? dashboard?.office
  const items: HudItem[] = []
  if (team && team.members.length > 0) {
    const count = (presence: string) => team.members.filter((member) => member.presence === presence).length
    items.push({ label: 'Tim hadir', value: `${team.members.length - count('absent')}/${team.members.length}`, title: `${count('working')} bekerja · ${count('standby')} standby · ${count('resting')} istirahat · ${count('absent')} belum standup` })
  }
  if (summary) {
    items.push({ label: 'Kru aktif', value: `${summary.active}/${summary.declared}`, title: `${summary.idle} santai · ${summary.offline} offline · ${summary.unknown} tidak diketahui` })
    items.push({ label: 'Gateway', value: `${summary.gatewaysReachable}/${summary.gatewaysDeclared}`, title: 'Profil yang gateway Hermes-nya berjalan (agent khusus CLI tidak butuh gateway)', page: 'Agents' })
  }
  if (!dashboard) return items
  const { tasks, calendar, commands } = dashboard
  if (tasks.availability === 'available') {
    const open = Object.entries(tasks.byStatus).filter(([status]) => !['done', 'archived'].includes(status)).reduce((sum, [, count]) => sum + count, 0)
    items.push({ label: 'Tugas', value: `${tasks.byStatus.running ?? 0} dikerjakan · ${open} terbuka`, page: 'Task Board' })
  } else items.push({ label: 'Tugas', value: 'Tidak tersedia', tone: 'warn', page: 'Task Board' })
  if (calendar.availability === 'available') items.push({ label: 'Cron berikutnya', value: calendar.nextRun ? formatDateTime(calendar.nextRun) : '—', page: 'Calendar' })
  if (commands.failed > 0) items.push({ label: 'Error CLI', value: String(commands.failed), tone: 'bad', title: 'Pembacaan CLI Hermes yang gagal' })
  return items
}

export function Office({ dashboard, dashboardPending = false, onNavigate }: { dashboard?: DashboardSnapshot | null; dashboardPending?: boolean; onNavigate?: (page: Page) => void } = {}) {
  const snapshot = usePolling<OfficeSnapshot>('/api/office', 10_000)
  const activitySnapshot = usePolling<ActivitySnapshot>('/api/activity', 15_000)
  const channelsSnapshot = usePolling<ChannelSnapshot>('/api/channels', 30_000)
  const teamSnapshot = usePolling<TeamSnapshot>('/api/team', 30_000)
  const team = teamSnapshot.status === 'ready' ? teamSnapshot.data : undefined
  const office = snapshot.status === 'ready' ? snapshot.data : undefined
  const activity = activitySnapshot.status === 'ready' ? activitySnapshot.data : undefined
  const channels = channelsSnapshot.status === 'ready' ? channelsSnapshot.data : undefined
  const [selectedId, setSelectedId] = useState<OfficeStation['id'] | undefined>()
  const selectedTrigger = useRef<HTMLElement | null>(null)
  const [chosenRoom, setChosenRoom] = useState<OfficeRoom | undefined>()
  const [view, setView] = useState<OfficeView>(() => typeof window === 'undefined' ? '2d' : storedView())
  const [webgl] = useState(() => typeof document === 'undefined' || webglAvailable())
  const [panel, setPanel] = useState<PanelTab | undefined>(() => typeof window === 'undefined' ? undefined : storedPanel())
  const [overlay, setOverlay] = useState<OverlayKind | undefined>()
  const me = useMe()
  // Kalender and Token only for those who may see those pages; the tasks overlay shows one's own cards.
  const overlays = (['chat', 'tasks', 'calendar', 'usage'] as const).filter((item) => item === 'calendar' ? me?.can.see.calendar : item === 'usage' ? me?.can.see.usage : true)
  const choosePanel = (next: PanelTab | undefined) => {
    setPanel(next)
    try { window.localStorage.setItem('mc.officePanel', next ?? 'closed') } catch { /* storage may be blocked */ }
  }
  const chooseView = (next: OfficeView) => {
    setView(next)
    try { window.localStorage.setItem('mc.officeView', next) } catch { /* storage may be blocked */ }
  }
  const show3d = view === '3d' && webgl
  const select3d = (station: OfficeStation, trigger: HTMLElement | null) => { selectedTrigger.current = trigger; setSelectedId(station.id) }
  // The agents, then the people who are in today (their avatars follow their standup).
  const agents = office?.stations ?? []
  const crew = [...agents, ...teamStations(team?.members ?? [], agents)]
  const counts = Object.fromEntries(ROOMS.map((item) => [item, crew.filter((station) => station.room === item).length])) as Record<OfficeRoom, number>
  // Until the viewer picks a room, open wherever the crew currently is.
  const room: OfficeRoom = chosenRoom ?? (counts.Workspace === 0 && counts.Lounge > 0 ? 'Lounge' : 'Workspace')
  const stations = crew.filter((station) => station.room === room)
  const selected = crew.find((station) => station.id === selectedId)
  const sessions = activity?.sessions
  const channelSource = channels?.channels
  const closeDetail = () => {
    setSelectedId(undefined)
    selectedTrigger.current?.focus()
  }
  if (snapshot.status === 'pending') return <LoadingState message="Membaca kondisi kantor…"/>
  const hud = hudItems(office, dashboard, team)
  // Hot desking: one unlabeled desk per agent and per person in today.
  const deskCount = crew.length
  const stationButton2d = (station: OfficeStation) => { const badge = stationBadge(station); const busy = ['Working', 'Reviewing', 'Collaborating'].includes(station.state); return <button className={`pixel-station ${station.roomPosition} state-${station.state.toLowerCase()}`} key={station.id} onClick={(event) => { selectedTrigger.current = event.currentTarget; setSelectedId(station.id) }} aria-label={`${station.name}. ${officeStateLabel(station)}${station.activity ? `: ${station.activity}` : ''}. Buka detail.`} title={station.activity || officeStateLabel(station)}>{busy && station.activity && <span className="speech" aria-hidden="true">{station.activity}</span>}<span className="pixel-station-name">{station.privacy === 'locked' ? '🔒 ' : ''}{station.name}</span><span className={`badge ${badge.tone}`}>{officeStateLabel(station)}</span>{station.state === 'Unknown' && <span className="neutral-label">STATUS BELUM JELAS</span>}<PixelCharacter agent={station.id}/></button> }
  const stationButton = (station: OfficeStation) => { const badge = stationBadge(station); return <button type="button" className="crew-row" key={station.id} onClick={(event) => { selectedTrigger.current = event.currentTarget; setSelectedId(station.id) }} aria-label={`Detail ${station.name}: ${officeStateLabel(station)}`}><PixelCharacter agent={station.id}/><span><strong>{station.name}</strong><small>{station.activity || station.role}</small></span><span className={`badge ${badge.tone}`}>{badge.label}</span></button> }
  return <section className={`office-stage view-${show3d ? '3d' : '2d'}`} aria-label="Kantor visual">
    <div className="office-hud" role="list" aria-label="Statistik utama">{hud.map((item) => { const body = <><span>{item.label}</span><b>{item.value}</b></>; return <div role="listitem" key={item.label}>{item.page && onNavigate && canOpen(item.page, me?.can.see) ? <button type="button" className={`hud-chip${item.tone ? ` ${item.tone}` : ''}`} title={item.title ?? `Buka ${pageLabel(item.page)}`} onClick={() => onNavigate(item.page!)}>{body}</button> : <span className={`hud-chip${item.tone ? ` ${item.tone}` : ''}`} title={item.title}>{body}</span>}</div> })}</div>
    <div className="office-stage-tools">
      <div className="view-toggle" role="group" aria-label="Tampilan kantor">{(['2d', '3d'] as const).map((item) => <button type="button" key={item} className={view === item ? 'active' : ''} aria-pressed={view === item} onClick={() => chooseView(item)} disabled={item === '3d' && !webgl} title={item === '3d' && !webgl ? 'WebGL tidak tersedia di browser ini' : undefined}>{item.toUpperCase()}</button>)}</div>
      {overlays.map((item) => <button type="button" key={item} className={`panel-toggle${overlay === item ? ' active' : ''}`} aria-pressed={overlay === item} onClick={() => setOverlay(overlay === item ? undefined : item)}>{item === 'chat' ? '✦ Tanya Naya' : item === 'tasks' ? '▦ Tugas' : item === 'calendar' ? '◷ Kalender' : '◔ Token'}</button>)}
      <button type="button" className={`panel-toggle${panel ? ' active' : ''}`} aria-expanded={Boolean(panel)} aria-controls="office-panel" onClick={() => choosePanel(panel ? undefined : 'Crew')}>◧ Panel</button>
    </div>
    <div className="office-canvas">
      {show3d ? <SceneBoundary fallback={<section className="empty-state"><h2>Tampilan 3D tidak tersedia</h2><p>Kantor 3D tidak bisa dijalankan di perangkat ini. Beralih ke 2D.</p></section>}><Suspense fallback={<LoadingState message="Memuat kantor 3D…"/>}><Office3D stations={crew} onSelect={select3d}/></Suspense></SceneBoundary> : <>{view === '3d' && !webgl && <p className="muted office-note">3D butuh WebGL, yang tidak didukung browser ini. Menampilkan 2D.</p>}<div className="room-tabs" role="tablist" aria-label="Ruangan kantor">{ROOMS.map((item) => <button role="tab" aria-selected={room === item} className={room === item ? 'active' : ''} onClick={() => setChosenRoom(item)} key={item}>{roomLabel(item)} <span className="room-count">{counts[item]}</span></button>)}</div>
        <div className="room-scroll"><section className={`pixel-room flow ${room.toLowerCase()}`} aria-label={roomLabel(room)}><div className="room-label"><span>{roomLabel(room)}</span><small>{room === 'Workspace' ? `${deskCount} HOT DESK + RUANG RAPAT` : 'AREA ISTIRAHAT'}</small></div>
          {room === 'Workspace' ? <>
            <div className="flow-desks">{Array.from({ length: deskCount }, (_, index) => {
              const atDesk = stations.find((station) => station.seat === index + 1 && station.roomPosition !== 'meeting-area')
              return <div className="flow-desk-cell" key={index}>{atDesk && stationButton2d(atDesk)}<div className={`ws-desk${atDesk && atDesk.state !== 'Offline' ? ' occupied' : ''}`} aria-hidden="true"><i/></div></div>
            })}</div>
            <div className="flow-meeting"><div className="meeting-table" aria-hidden="true"><span>RAPAT</span></div><div className="flow-crew">{stations.filter((station) => station.roomPosition === 'meeting-area').map(stationButton2d)}</div></div>
          </> : <>
            <div className="flow-lounge-props" aria-hidden="true"><div className="pixel-tv"/><div className="lounge-chair"/><div className="lounge-sofa"/><div className="coffee-table"/><div className="lounge-chair"/><div className="pixel-plant"/></div>
            <div className="flow-crew">{stations.map(stationButton2d)}</div>
          </>}
          {room === 'Lounge' && stations.length === 0 && <p className="room-empty">Tidak ada agent yang sedang santai</p>}
          {room === 'Workspace' && stations.length === 0 && office && <p className="room-empty">Meja kosong · kru sedang di lounge</p>}
        </section></div></>}
      {snapshot.status === 'failed' && <section className="empty-state office-failed"><h2>Tidak tersedia</h2><p>Data kantor tidak bisa dihubungi.</p></section>}
    </div>
    {show3d && <small className="office-3d-hint">Seret untuk memutar · seret klik kanan, dua jari, atau Geser untuk menggeser · scroll untuk zoom · klik agent untuk detail</small>}
    {panel && <aside id="office-panel" className="office-panel" aria-label="Panel kantor" onKeyDown={(event) => { if (event.key === 'Escape' && !selected) { event.stopPropagation(); choosePanel(undefined) } }}>
      <div className="office-panel-head"><div className="panel-tabs" role="tablist" aria-label="Panel">{PANEL_TABS.map((tab) => <button type="button" role="tab" key={tab} aria-selected={panel === tab} className={panel === tab ? 'active' : ''} onClick={() => choosePanel(tab)}>{PANEL_LABEL[tab]}</button>)}</div><button type="button" className="icon-button" onClick={() => choosePanel(undefined)} aria-label="Tutup panel">✕</button></div>
      <div className="office-panel-body" role="tabpanel" aria-label={PANEL_LABEL[panel]}>
        {panel === 'Crew' && <>
          <SourceStatus source={office ? { availability: 'available', data: null } : undefined} fetchedAt={office?.fetchedAt} request={snapshot}/>
          <section className="office-summary"><p className="eyebrow">RINGKASAN KRU</p><strong>{office?.summary.active ?? 0} sedang bekerja</strong><span>{office?.summary.idle ?? 0} santai</span><span>{office?.summary.unknown ?? 0} tidak diketahui / {office?.summary.offline ?? 0} offline</span><hr/><span>Gateway berjalan: {office ? `${office.summary.gatewaysReachable} dari ${office.summary.gatewaysDeclared}` : 'Tidak tersedia'}</span></section>
          <div className="crew-list">{crew.map(stationButton)}</div>
          <small className="muted">Hanya pekerjaan yang jelas sumbernya yang ditampilkan. Pilih agent untuk melihat sumber dan kebaruan datanya.</small>
        </>}
        {panel === 'Stats' && <Stats dashboard={dashboard ?? null} pending={dashboardPending} onNavigate={onNavigate}/>}
        {panel === 'Activity' && <>
          <section className="office-feed"><p className="eyebrow">AKTIVITAS LANGSUNG</p><h2>Sesi terbaru</h2>{sessions?.availability === 'unavailable' ? <p>Tidak tersedia</p> : !sessions ? <p>Memuat sesi…</p> : sessions.data.length === 0 ? <p>Belum ada data sesi.</p> : sessions.data.slice(0, 5).map((session) => <article key={session.id ?? session.title}><strong>{session.title}</strong><span>{session.lastActive}</span></article>)}<small>Sesi yang tidak terkait agent tidak mengubah status kru.</small></section>
          <section className="office-feed"><p className="eyebrow">KANAL</p><h2>Platform pesan</h2>{channelSource?.availability === 'unavailable' ? <p>Tidak tersedia</p> : !channelSource ? <p>Memuat status…</p> : channelSource.data.length === 0 ? <p>Belum ada kanal yang diatur.</p> : channelSource.data.map((channel) => <article key={channel.name}><strong>{channel.name}</strong><span>{channel.status}</span></article>)}{channels?.activeSessions !== undefined && <small>{channels.activeSessions} sesi aktif</small>}</section>
        </>}
      </div>
    </aside>}
    {overlay && <OfficeOverlay kind={overlay} onClose={() => setOverlay(undefined)} onNavigate={onNavigate}/>}
    {selected && <OfficeDetail station={selected} onClose={closeDetail}/>}
  </section>
}
