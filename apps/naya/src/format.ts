const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 })
const whole = new Intl.NumberFormat('en')

export function formatCompact(value: number): string { return compact.format(value) }
export function formatNumber(value: number): string { return whole.format(value) }

export function formatTime(iso: string | undefined): string {
  if (!iso) return '—'
  const time = Date.parse(iso)
  return Number.isFinite(time) ? new Date(time).toLocaleTimeString() : iso
}

export function formatDateTime(value: string | undefined): string {
  if (!value) return '—'
  const time = Date.parse(value)
  return Number.isFinite(time) ? new Date(time).toLocaleString() : value
}

const relative = new Intl.RelativeTimeFormat('id', { numeric: 'auto' })
const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [['day', 86_400], ['hour', 3_600], ['minute', 60]]

/** "3 jam lalu", "kemarin", "baru saja"; older than a week falls back to the date. */
export function formatRelative(value: string | undefined, now = Date.now()): string {
  if (!value) return '—'
  const time = Date.parse(value)
  if (!Number.isFinite(time)) return value
  const seconds = Math.round((time - now) / 1000)
  if (Math.abs(seconds) < 60) return 'baru saja'
  if (Math.abs(seconds) >= 7 * 86_400) return new Date(time).toLocaleDateString('id', { day: 'numeric', month: 'short', year: 'numeric' })
  const [unit, size] = UNITS.find(([, size]) => Math.abs(seconds) >= size)!
  return relative.format(Math.round(seconds / size), unit)
}

/** Hermes Kanban board order (plugins/kanban dashboard), followed by less common states. */
export const TASK_STATUS_ORDER = ['triage', 'todo', 'scheduled', 'ready', 'running', 'blocked', 'review', 'done', 'archived']
export const CORE_TASK_STATUSES = ['todo', 'ready', 'running', 'review', 'done']

export function orderedStatuses(statuses: Iterable<string>, includeCore = false): string[] {
  const set = new Set([...statuses].map((status) => status.toLowerCase()))
  if (includeCore) CORE_TASK_STATUSES.forEach((status) => set.add(status))
  const known = TASK_STATUS_ORDER.filter((status) => set.has(status))
  const extra = [...set].filter((status) => !TASK_STATUS_ORDER.includes(status)).sort()
  return [...known, ...extra]
}

export function statusTone(status: string): 'good' | 'unknown' | 'muted' | 'bad' | 'info' {
  switch (status.toLowerCase()) {
    case 'running': case 'active': case 'ok': return 'good'
    case 'review': case 'ready': case 'scheduled': return 'info'
    case 'blocked': case 'failed': case 'error': return 'bad'
    case 'done': case 'archived': case 'completed': case 'disabled': return 'muted'
    default: return 'unknown'
  }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/** Display name for an agent: its Hermes profile name as-is. */
export function agentLabel(profile: string | undefined): string {
  return profile ?? 'Hermes'
}

/** Hermes task statuses as the Task Board names them (the status values stay as Hermes sends them). */
const TASK_STATUS_LABELS: Record<string, string> = {
  triage: 'Triase', todo: 'Antri', scheduled: 'Terjadwal', ready: 'Siap', running: 'Dikerjakan',
  blocked: 'Ditolak / tertahan', review: 'Menunggu review', done: 'Selesai', archived: 'Diarsipkan',
}

export function taskStatusLabel(status: string): string {
  return TASK_STATUS_LABELS[status.toLowerCase()] ?? status
}
