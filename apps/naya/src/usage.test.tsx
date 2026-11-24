import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { TokenUsage } from './pages/TokenUsage.tsx'
import { formatCost, sourceLabel } from './usage.ts'

describe('token usage view', () => {
  it('labels kinds of work and formats estimated costs', () => {
    expect(sourceLabel('kanban')).toBe('Tugas Kanban')
    expect(sourceLabel('cron')).toBe('Cron job')
    expect(sourceLabel('matrix')).toBe('Matrix')
    expect(formatCost(undefined)).toBe('—')
    expect(formatCost(0.0123)).toBe('$0.0123')
    expect(formatCost(27.584)).toBe('$27.58')
  })

  it('offers the three periods and starts by loading every agent', () => {
    const markup = renderToStaticMarkup(<TokenUsage/>)
    expect(markup).toContain('PEMAKAIAN TOKEN · 7 HARI TERAKHIR')
    for (const label of ['24J', '7H', '30H']) expect(markup).toContain(`>${label}<`)
    expect(markup).toContain('Membaca hermes insights setiap agent')
  })
})
