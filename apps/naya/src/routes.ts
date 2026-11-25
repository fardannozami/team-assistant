export const navigation = ['Office', 'My Tasks', 'Task Board', 'Agents', 'Usage', 'Calendar', 'Settings'] as const
export type Page = typeof navigation[number]

/** The page shown when the address names no page (or an unknown one). */
export const HOME: Page = 'Office'

/** Menu names; the page ids (and their #/ addresses) stay as upstream Ruang has them. */
const LABELS: Record<Page, string> = {
  Office: 'Kantor',
  'My Tasks': 'Tugas Saya',
  Agents: 'Agent',
  Usage: 'Pemakaian',
  'Task Board': 'Papan Tugas',
  Calendar: 'Kalender',
  Settings: 'Pengaturan',
}

export function pageLabel(page: Page): string {
  return LABELS[page]
}

export function pageSlug(page: Page): string {
  return page.toLowerCase().replace(/\s+/g, '-')
}

export function pageFromHash(hash: string): Page {
  const slug = hash.replace(/^#\/?/, '').split('/')[0].toLowerCase()
  // The Dashboard's statistics now live in the Office HUD and panel.
  if (slug === 'dashboard') return 'Office'
  return navigation.find((page) => pageSlug(page) === slug) ?? HOME
}

/** A card named in the address, as WhatsApp links give it: `#/my-tasks/<board>/<task id>`. */
export function cardFromHash(hash: string): { board: string; id: string } | null {
  const [, board, id] = hash.replace(/^#\/?/, '').split('/')
  if (!board || !id) return null
  try {
    return { board: decodeURIComponent(board), id: decodeURIComponent(id) }
  } catch {
    return null
  }
}

/** The address of a card in Tugas Saya (what WhatsApp links and "Lanjut" open). */
export function cardHash(board: string, id: string): string {
  return `#/my-tasks/${encodeURIComponent(board)}/${encodeURIComponent(id)}`
}
