import { formatDateTime, formatNumber, orderedStatuses, statusTone, taskStatusLabel } from '../format.ts'
import type { DashboardSnapshot } from '../types.ts'
import { EmptyState, LoadingState } from '../ui.tsx'
import { TokenUsage } from './TokenUsage.tsx'
import type { Page } from '../routes.ts'

function availableCount(source: { availability: string; total: number }, unit?: string) {
  return source.availability === 'available' ? `${formatNumber(source.total)}${unit ? ` ${unit}` : ''}` : 'Tidak tersedia'
}

function StatTile({ label, value, detail, onClick }: { label: string; value: string; detail?: string; onClick?: () => void }) {
  return <button type="button" className="stat-tile" onClick={onClick} disabled={!onClick}><span>{label}</span><strong className={value === 'Tidak tersedia' ? 'na' : undefined}>{value}</strong>{detail && <small>{detail}</small>}</button>
}

/** The operations overview (formerly the Dashboard page), shown in the Office panel's Stats tab. */
export function Stats({ dashboard, pending = false, onNavigate }: { dashboard: DashboardSnapshot | null; pending?: boolean; onNavigate?: (page: Page) => void }) {
  if (pending) return <LoadingState message="Membaca kondisi runtime…"/>
  if (!dashboard) return <EmptyState title="Tidak tersedia">API Naya tidak bisa dihubungi. Coba muat ulang sebentar lagi.</EmptyState>
  const { runtime, tasks, calendar, activity, knowledge, channels, office, commands } = dashboard
  const go = (page: Page) => onNavigate ? () => onNavigate(page) : undefined
  const openTasks = Object.entries(tasks.byStatus).filter(([status]) => !['done', 'archived'].includes(status)).reduce((sum, [, count]) => sum + count, 0)
  const statuses = orderedStatuses(Object.keys(tasks.byStatus))
  const hermesMissing = /not installed/i.test(runtime.profiles.error?.message ?? '')

  return <div className="stats-view">
    {hermesMissing && <section className="notice" role="status"><strong>CLI Hermes tidak ditemukan.</strong> Naya membaca semua data lewat perintah <code>hermes</code>. Minta admin memastikan Hermes Agent terpasang dan <code>hermes</code> ada di PATH server Naya.</section>}
    <section className="stat-grid" aria-label="Statistik utama">
      <StatTile label="Gateway berjalan" value={`${office.gatewaysReachable} / ${office.gatewaysDeclared}`} detail="Profil Hermes" onClick={go('Agents')}/>
      <StatTile label="Kru aktif" value={`${office.active} / ${office.declared}`} detail={`${office.idle} santai · ${office.offline} offline · ${office.unknown} tidak diketahui`} />
      <StatTile label="Tugas terbuka" value={tasks.availability === 'available' ? formatNumber(openTasks) : 'Tidak tersedia'} detail={tasks.availability === 'available' ? `${formatNumber(tasks.total)} total · ${tasks.byStatus.running ?? 0} dikerjakan` : undefined} onClick={go('Task Board')}/>
      <StatTile label="Job terjadwal" value={availableCount(calendar)} detail={calendar.availability === 'available' ? `${calendar.active} aktif · ${calendar.paused} dijeda` : undefined} onClick={go('Calendar')}/>
      <StatTile label="Sesi terbaru" value={availableCount(activity)} detail={channels.activeSessions !== undefined ? `${channels.activeSessions} aktif sekarang` : '20 terakhir'}/>
      <StatTile label="Skill aktif" value={availableCount(knowledge)} detail={knowledge.availability === 'available' ? `${Object.keys(knowledge.byCategory).length} kategori` : undefined}/>
      <StatTile label="Kanal" value={availableCount(channels, 'diatur')} detail={channels.availability === 'available' ? `${channels.connected} terhubung` : undefined} />
      <StatTile label="Pembacaan CLI" value={formatNumber(commands.total)} detail={`${commands.failed} gagal · rata-rata ${commands.averageMs} ms`}/>
    </section>

    <TokenUsage/>

    <section className="dash-grid">
      <article className="card">
        <p className="eyebrow">KANBAN PER STATUS</p>
        {tasks.availability === 'unavailable' ? <p className="muted">Tidak tersedia</p> : tasks.total === 0 ? <p className="muted">Belum ada tugas di board.</p> : <>
          <div className="stack-bar" role="img" aria-label={statuses.map((status) => `${taskStatusLabel(status)} ${tasks.byStatus[status]}`).join(', ')}>{statuses.map((status) => <i key={status} className={`tone-${statusTone(status)}`} style={{ flexGrow: tasks.byStatus[status] }} title={`${taskStatusLabel(status)}: ${tasks.byStatus[status]}`}/>)}</div>
          <ul className="legend">{statuses.map((status) => <li key={status}><i className={`tone-${statusTone(status)}`}/>{taskStatusLabel(status)}<b>{tasks.byStatus[status]}</b></li>)}</ul>
          <p className="card-note">{tasks.assigned} dari {tasks.total} tugas sudah punya penanggung jawab.</p>
        </>}
      </article>

      <article className="card">
        <p className="eyebrow">RUNTIME</p>
        <dl className="runtime-list">
          <div><dt>Profil Hermes</dt><dd>{runtime.profiles.availability === 'available' ? runtime.profiles.data.length : 'Tidak tersedia'}</dd></div>
          <div><dt>Gateway berjalan</dt><dd>{runtime.profiles.availability === 'available' ? `${runtime.profiles.data.filter((profile) => profile.gateway === 'Running').length} dari ${runtime.profiles.data.length}` : 'Tidak tersedia'}</dd></div>
          <div><dt>Model terpakai</dt><dd>{runtime.profiles.availability === 'available' ? [...new Set(runtime.profiles.data.map((profile) => profile.model).filter((model) => model !== 'Not configured'))].join(', ') || '—' : 'Tidak tersedia'}</dd></div>
          <div><dt>OpenCode</dt><dd>{runtime.openCode.availability === 'available' ? runtime.openCode.data : 'Tidak terpasang'}</dd></div>
          <div><dt>Claude Code</dt><dd>{runtime.claudeCode?.availability === 'available' ? runtime.claudeCode.data : 'Tidak terpasang'}</dd></div>
        </dl>
      </article>

      <article className="card">
        <p className="eyebrow">BERIKUTNYA</p>
        <dl className="runtime-list">
          <div><dt>Cron berikutnya</dt><dd>{calendar.availability === 'unavailable' ? 'Tidak tersedia' : formatDateTime(calendar.nextRun)}</dd></div>
          <div><dt>Sesi terakhir</dt><dd>{activity.availability === 'unavailable' ? 'Tidak tersedia' : activity.latest ? `${activity.latest.title} · ${activity.latest.lastActive}` : '—'}</dd></div>
          <div><dt>Kategori skill</dt><dd>{knowledge.availability === 'unavailable' ? 'Tidak tersedia' : Object.entries(knowledge.byCategory).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([category, count]) => `${category} (${count})`).join(', ') || '—'}</dd></div>
        </dl>
      </article>
    </section>
    <p className="card-note">Dibaca langsung dari Hermes, OpenCode, dan Claude Code, di-cache server selama 10 detik, dan diperbarui otomatis.</p>
  </div>
}
