import { agentLabel } from './format.ts'
import { usePolling } from './polling.ts'
import type { OfficeSnapshot } from './types.ts'

export type AgentName = (id: string | undefined) => string

/** Agents by their office names (Hermes display names such as "Asisten Umum", "Coder"), as the office shows them. */
export function useAgentName(): AgentName {
  const office = usePolling<OfficeSnapshot>('/api/office', 60_000)
  const names = office.status === 'ready' ? Object.fromEntries(office.data.stations.map((station) => [station.id, station.name])) : {}
  return (id) => agentLabel(id, names)
}
