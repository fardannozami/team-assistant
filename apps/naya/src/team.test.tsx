import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { OfficeDetail } from './pages/Office.tsx'
import { idlePlan, createLayout } from './office3d-layout.ts'
import { stationBadge, teamStations } from './team.ts'
import type { OfficeStation, TeamMember } from './types.ts'

const agent: OfficeStation = {
  id: 'naya', name: 'naya', role: 'Hermes profile', room: 'Workspace', roomPosition: 'desk', state: 'Working',
  currentTask: '', recentActivity: '', activity: '', seat: 2, provenance: '', freshness: '',
}
const member = (id: string, presence: TeamMember['presence'], tasks: TeamMember['tasks'] = []): TeamMember =>
  ({ id, name: `Orang ${id}`, team: 'Dev', shift: 'day', date: '2026-11-25', presence, tasks })

describe('team avatars', () => {
  const stations = teamStations([
    member('a', 'working', [{ title: 'Fix login', status: 'doing' }, { title: 'Invoice export', status: 'doing' }]),
    member('b', 'standby', [{ title: 'Eksplorasi Three.js', status: 'doing' }]),
    member('c', 'resting', [{ title: 'Fix login', status: 'done' }]),
    member('d', 'absent'),
  ], [agent])

  it('puts people who standup in the office after the agents, and leaves out who has not', () => {
    expect(stations.map((station) => [station.id, station.seat])).toEqual([['employee:a', 3], ['employee:b', 4], ['employee:c', 5]])
  })

  it('works at a desk on today\'s plan, santai on standby, and rests after checkout', () => {
    const [working, standby, resting] = stations
    expect(working).toMatchObject({ room: 'Workspace', state: 'Working', activity: 'Fix login', currentTask: 'Fix login · Invoice export' })
    expect(standby).toMatchObject({ room: 'Lounge', state: 'Idle' })
    expect(resting).toMatchObject({ room: 'Lounge', state: 'Idle' })
    expect(stationBadge(standby).label).toBe('Standby')
    expect(stationBadge(resting).label).toBe('Istirahat')
    // Resting people go to bed upstairs; standby ones wander.
    const plan = idlePlan([standby.seat, resting.seat], 0, createLayout(5), [resting.seat])
    expect(plan.get(resting.seat)?.stop.key).toBe('tidur')
    expect(plan.get(standby.seat)?.stop.key).not.toBe('tidur')
  })

  it('shows today\'s work as a kanban in the detail, without agent tabs', () => {
    const markup = renderToStaticMarkup(<OfficeDetail station={stations[0]} onClose={vi.fn()}/>)
    expect(markup).toContain('ANGGOTA TIM')
    expect(markup).toContain('Dikerjakan')
    expect(markup).toContain('Fix login')
    expect(markup).not.toContain('role="tablist"')
  })
})
