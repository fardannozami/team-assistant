import type { Source } from './types.ts'

export type OfficeBadgeTone = 'good' | 'muted' | 'unknown'
export type OfficeState = 'Idle' | 'Working' | 'Reviewing' | 'Collaborating' | 'Offline' | 'Unknown'

/** Indonesian display names; the state values themselves stay as the API sends them. */
const STATE_LABELS: Record<OfficeState, string> = {
  Idle: 'Santai', Working: 'Bekerja', Reviewing: 'Mereview', Collaborating: 'Berdiskusi', Offline: 'Offline', Unknown: 'Tidak diketahui',
}

const GATEWAY_LABELS: Record<string, string> = { Running: 'Berjalan', Stopped: 'Berhenti', Unknown: 'Tidak diketahui' }

/** Display name of an office state (Idle → Santai…). */
export function officeStateLabel(state: OfficeState): string {
  return STATE_LABELS[state] ?? state
}

/** Display name of a Hermes gateway state (Running / Stopped / Unknown). */
export function gatewayLabel(state: string): string {
  return GATEWAY_LABELS[state] ?? state
}

export function officeBadge(source: Source<string> | undefined, kind: 'gateway' | 'version' = 'gateway'): { label: string; tone: OfficeBadgeTone } {
  if (!source || source.availability === 'unavailable') return { label: 'Tidak tersedia', tone: 'muted' }
  if (source.data === 'Unknown' || !source.data) return { label: 'Tidak diketahui', tone: 'unknown' }
  if (kind === 'version') return { label: 'Versi tersedia', tone: 'good' }
  return { label: gatewayLabel(source.data), tone: source.data === 'Running' ? 'good' : 'unknown' }
}

export function officeStateBadge(state: OfficeState): { label: string; tone: OfficeBadgeTone } {
  return { label: officeStateLabel(state), tone: state === 'Offline' ? 'muted' : state === 'Unknown' || state === 'Idle' ? 'unknown' : 'good' }
}
