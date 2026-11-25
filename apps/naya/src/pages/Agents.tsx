import { NAYA_ROSTER } from '@repo/shared/naya-roster'
import { agentLabel } from '../format.ts'
import { officeStateLabel } from '../office-state.ts'
import type { OfficeSnapshot, RuntimeSnapshot } from '../types.ts'
import { usePolling } from '../polling.ts'
import { EmptyState, LoadingState, PageTitle, RuntimeBadge } from '../ui.tsx'
import { PixelCharacter } from './Office.tsx'

/** Every Hermes profile on this machine is an agent, plus OpenCode when it is installed. */
/** Naya's roster (blueprint v3): which agent claude-worker routes each part of a card to, and who reviews it. */
function RosterTable() {
  return <section className="task-section" aria-label="Roster agent Naya">
    <p className="eyebrow">ROSTER AGENT NAYA · {NAYA_ROSTER.filter((agent) => agent.available).length} AKTIF DARI {NAYA_ROSTER.length}</p>
    <p className="muted small-note">Saat memecah instruksi, Naya Core memilih agent untuk tiap bagian. Kontrak agent (input, output) menjadi instruksi kerjanya, dan hasilnya direview oleh peran di kolom PIC.</p>
    <div className="md-table"><table className="roster-table">
      <thead><tr><th>Kode</th><th>Agent</th><th>Input → output</th><th>PIC</th><th>Status</th></tr></thead>
      <tbody>{NAYA_ROSTER.map((agent) => <tr key={agent.code} className={agent.available ? '' : 'roster-off'}>
        <td className="mono">{agent.label}</td>
        <td><b>{agent.name}</b><br/><small className="muted">{agent.pillar}</small></td>
        <td>{agent.input} → {agent.output}</td>
        <td>{agent.pic}</td>
        <td>{agent.available ? <span className="pill pill-done">Aktif</span> : <span title={agent.reason}><span className="pill pill-queue">Belum</span><br/><small className="muted">{agent.reason}</small></span>}</td>
      </tr>)}</tbody>
    </table></div>
  </section>
}

export function Agents({ runtime, pending = false }: { runtime: RuntimeSnapshot | null; pending?: boolean }) {
  const office = usePolling<OfficeSnapshot>('/api/office', 15_000)
  if (pending) return <><PageTitle eyebrow="TIM" title="Agent"/><LoadingState message="Membaca detail runtime…"/></>
  if (!runtime || runtime.profiles.availability === 'unavailable') return <><PageTitle eyebrow="TIM" title="Agent"/><EmptyState title="Tidak tersedia">Daftar profil Hermes tidak bisa dibaca. Apakah <code>hermes</code> ada di PATH server?</EmptyState><RosterTable/></>
  const states = new Map(office.status === 'ready' ? office.data.stations.map((station) => [station.id, station]) : [])
  const openCode = runtime.openCode.availability === 'available' ? runtime.openCode.data : undefined
  const claudeCode = runtime.claudeCode?.availability === 'available' ? runtime.claudeCode.data : undefined
  const cards = [
    ...runtime.profiles.data.map((profile) => ({ id: profile.name, kind: 'Profil Hermes', model: profile.model, gateway: profile.gateway })),
    ...(openCode ? [{ id: 'opencode', kind: 'OpenCode (tool CLI)', model: openCode, gateway: undefined }] : []),
    ...(claudeCode ? [{ id: 'claude-code', kind: 'Claude Code (tool CLI)', model: claudeCode, gateway: undefined }] : []),
  ]
  return <><PageTitle eyebrow="TIM" title="Agent">Setiap profil Hermes di mesin ini (dari <code>hermes profile list</code>) adalah agent{[openCode && 'OpenCode', claudeCode && 'Claude Code'].filter(Boolean).length ? `, ditambah ${[openCode && 'OpenCode', claudeCode && 'Claude Code'].filter(Boolean).join(' dan ')}` : ''}. Tidak ada yang diatur manual: profil baru otomatis muncul di sini dan di kantor.</PageTitle>
    <section className="agent-grid">{cards.map((card) => {
      const station = states.get(card.id)
      return <article className="agent-card" key={card.id}>
        <span className="folder-glyph" aria-hidden="true"><PixelCharacter agent={card.id}/></span>
        <div className="agent-card-body">
          <h2>{station?.privacy === 'locked' ? '🔒 ' : ''}{agentLabel(card.id, station && { [card.id]: station.name })}</h2>
          <p className="muted">{card.kind}</p>
          <dl>
            <div><dt>Model</dt><dd>{card.model}</dd></div>
            <div><dt>Gateway</dt><dd>{card.gateway ? <RuntimeBadge source={{ availability: 'available', data: card.gateway }}/> : <span className="muted">Tidak ada (tool CLI)</span>}</dd></div>
            <div><dt>Di kantor</dt><dd>{station ? `${officeStateLabel(station.state)}${station.activity ? ` · ${station.activity}` : ''}` : '—'}</dd></div>
          </dl>
        </div>
      </article>
    })}</section>
    <RosterTable/>
  </>
}
