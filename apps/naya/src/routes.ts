export const navigation = ['Office', 'Task Board', 'Agents', 'Usage', 'Calendar', 'Settings'] as const
export type Page = typeof navigation[number]

/** The page shown when the address names no page (or an unknown one). */
export const HOME: Page = 'Office'

/** Menu names; the page ids (and their #/ addresses) stay as upstream Ruang has them. */
const LABELS: Record<Page, string> = {
  Office: 'Kantor',
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
