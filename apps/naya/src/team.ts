import { officeStateBadge, type OfficeBadgeTone } from './office-state.ts'
import type { OfficeStation, TeamMember } from './types.ts'

// People on the team share the office with the agents. Each one's avatar follows today's
// standup (GET /api/team): at a desk working on today's plan, santai around the office when
// the plan is only exploration or standby, and resting upstairs after checkout. Anyone without
// a standup yet today is not in the office.

/** Employees as office stations, seated after the agents (desks are hot desks, one per station). */
export function teamStations(members: TeamMember[], agents: OfficeStation[]): OfficeStation[] {
  let seat = agents.reduce((max, station) => Math.max(max, station.seat), 0)
  return members.filter((member) => member.presence !== 'absent').map((member): OfficeStation => {
    const doing = member.tasks.filter((task) => task.status === 'doing')
    const working = member.presence === 'working'
    seat += 1
    return {
      id: `employee:${member.id}`,
      name: member.name,
      role: member.team ? `Tim ${member.team}` : 'Anggota tim',
      room: working ? 'Workspace' : 'Lounge',
      roomPosition: working ? 'desk' : 'lounge',
      state: working ? 'Working' : 'Idle',
      currentTask: doing.map((task) => task.title).join(' · ') || '—',
      recentActivity: member.presence === 'resting' ? 'Sudah checkout' : 'Sudah standup',
      activity: working ? doing[0]?.title ?? '' : '',
      seat,
      provenance: 'Standup hari ini (daily)',
      freshness: `Standup ${member.date}`,
      employee: { presence: member.presence, team: member.team, tasks: member.tasks },
    }
  })
}

export const isResting = (station: OfficeStation) => station.employee?.presence === 'resting'

/** The state badge, with employees' own words: santai on standby, istirahat after checkout. */
export function stationBadge(station: OfficeStation): { label: string; tone: OfficeBadgeTone } {
  if (station.employee?.presence === 'resting') return { label: 'Istirahat', tone: 'muted' }
  if (station.employee?.presence === 'standby') return { label: 'Standby', tone: 'unknown' }
  return officeStateBadge(station.state)
}
