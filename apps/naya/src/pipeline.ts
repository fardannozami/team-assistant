// Task Board flow (after the FM27 Pipeline design): which stage a Hermes status sits in, and
// the status pill a card shows.

/**
 * The flow of a task, left to right: in, worked on by an agent, reviewed by a person, done. Each
 * stage groups Hermes statuses; a blocked task stays in the stage it was stopped in (Dikerjakan).
 */
export const STAGES: { id: string; label: string; statuses: string[] }[] = [
  { id: 'in', label: 'Masuk', statuses: ['triage', 'todo', 'scheduled', 'ready'] },
  { id: 'work', label: 'Dikerjakan AI', statuses: ['running', 'blocked'] },
  { id: 'review', label: 'Review', statuses: ['review'] },
  { id: 'done', label: 'Selesai', statuses: ['done', 'archived'] },
]
/** Index of the task's stage; statuses Naya does not know wait in Masuk. */
export function stageOf(status: string): number {
  return Math.max(0, STAGES.findIndex((stage) => stage.statuses.includes(status)))
}

/** The card's status pill: who has the task now and whether it needs a person. */
export type Pill = 'queue' | 'ai' | 'review' | 'blocked' | 'done'
export const PILLS: Record<Pill, { label: string; legend: string; statuses: string[] }> = {
  queue: { label: '◌ Antre', legend: 'menunggu diambil agent', statuses: ['triage', 'todo', 'scheduled', 'ready'] },
  ai: { label: '● AI mengerjakan', legend: 'sedang dikerjakan agent', statuses: ['running'] },
  review: { label: '↻ Perlu review', legend: 'menunggu keputusan Anda', statuses: ['review'] },
  blocked: { label: '✕ Ditolak / tertahan', legend: 'wajib alasan, lalu Coba lagi', statuses: ['blocked'] },
  done: { label: '✓ Selesai', legend: 'disetujui manusia', statuses: ['done', 'archived'] },
}
export const pillOf = (status: string): Pill => (Object.keys(PILLS) as Pill[]).find((pill) => PILLS[pill].statuses.includes(status)) ?? 'queue'
