import { useMe, type Permissions } from '../access.ts'
import { DAILY_URL } from '../api.ts'
import { PageTitle } from '../ui.tsx'

const ACTIONS: [Exclude<keyof Permissions, 'chat' | 'manageAgents' | 'see'>, string][] = [
  ['instruct', 'Memberi instruksi baru ke tim AI'],
  ['review', 'Menyetujui, meminta revisi, atau menolak hasil kerja'],
  ['comment', 'Berkomentar di tugas'],
]

const VIEWS: [keyof Permissions['see'], string][] = [
  ['allTasks', 'Melihat semua kartu di Papan Tugas (tanpa ini: hanya kartu yang ditugaskan kepada Anda)'],
  ['agents', 'Membuka halaman Agent'],
  ['calendar', 'Membuka Kalender'],
  ['usage', 'Membuka Pemakaian (token dan biaya AI)'],
]

export function Settings() {
  const me = useMe()
  if (!me) return null
  return <><PageTitle eyebrow="NAYA" title="Pengaturan">Akun Anda dan agent tim AI.</PageTitle>
    <section className="card settings-card" aria-labelledby="account-title">
      <div className="settings-head"><div><p className="eyebrow">AKUN</p><h2 id="account-title">{me.user.name}</h2></div><span className="badge good">{me.user.role ?? 'Tanpa peran'}</span></div>
      <p className="muted">{me.user.email}. Naya memakai akun daily; peran diatur di daily (Pengaturan › Pengguna).</p>
      <ul className="small-note">
        {ACTIONS.map(([key, label]) => <li key={key}>{me.can[key] ? '✓' : '✕'} {label}</li>)}
        {VIEWS.map(([key, label]) => <li key={key}>{me.can.see[key] ? '✓' : '✕'} {label}</li>)}
        <li>{me.can.chat.length ? `✓ Chat dengan agent: ${me.can.chat.join(', ')}` : '✕ Belum ada agent yang bisa Anda ajak chat'}</li>
      </ul>
    </section>
    <section className="card settings-card" aria-labelledby="agents-title">
      <div className="settings-head"><div><p className="eyebrow">TIM AI</p><h2 id="agents-title">Agent terdaftar</h2></div></div>
      {me.agents.length === 0 ? <p className="muted">Belum ada agent yang didaftarkan.</p> : <ul className="small-note">
        {me.agents.map((agent) => <li key={agent.profile}><b>{agent.displayName}</b> ({agent.profile}){agent.isLead ? ' · lead' : ''}{agent.hasKey ? '' : ' · API key belum diisi'} · chat: {agent.chatRoles.join(', ') || '—'}</li>)}
      </ul>}
      {me.can.manageAgents && <p className="small-note">Agent, API key Hermes, dan token MCP diatur di <a href={`${DAILY_URL}/?page=ai`} target="_blank" rel="noopener">daily › Pengaturan › AI</a>.</p>}
    </section>
  </>
}
