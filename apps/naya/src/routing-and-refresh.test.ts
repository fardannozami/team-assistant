import { describe, expect, it } from 'vitest'
import { orderedStatuses } from './format.ts'
import { mergeRefresh } from './request-state.ts'
import { canOpen, cardFromHash, navigation, pageFromHash, pageSlug } from './routes.ts'

describe('hash routing', () => {
  it('round-trips every page and falls back to the Office home', () => {
    for (const page of navigation) expect(pageFromHash(`#/${pageSlug(page)}`)).toBe(page)
    expect(pageFromHash('#/task-board')).toBe('Task Board')
    expect(pageFromHash('#dashboard')).toBe('Office')
    expect(pageFromHash('')).toBe('Office')
    expect(pageFromHash('#/nope')).toBe('Office')
    expect(navigation).toEqual(['Office', 'My Tasks', 'Task Board', 'Agents', 'Usage', 'Calendar', 'Settings'])
    // Sign-in data in the address is not a page.
    expect(pageFromHash('#token=abc')).toBe('Office')
  })

  it('opens the card a WhatsApp link names', () => {
    expect(pageFromHash('#/my-tasks/default/t_9')).toBe('My Tasks')
    expect(cardFromHash('#/my-tasks/default/t_9')).toEqual({ board: 'default', id: 't_9' })
    expect(cardFromHash('#/my-tasks')).toBeNull()
  })
})

describe('pages by role', () => {
  it('hides Agent, Kalender and Pemakaian from those who may not see them', () => {
    const employee = { agents: false, calendar: false, usage: false }
    expect(navigation.filter((page) => canOpen(page, employee))).toEqual(['Office', 'My Tasks', 'Task Board', 'Settings'])
    expect(navigation.filter((page) => canOpen(page, { agents: true, calendar: true, usage: true }))).toEqual(navigation)
    expect(canOpen('Usage', undefined)).toBe(false)
  })
})

describe('background refresh', () => {
  it('keeps the last good data (marked stale) when a refresh fails', () => {
    expect(mergeRefresh({ status: 'ready', data: 1 }, { status: 'failed' })).toEqual({ status: 'ready', data: 1, stale: true })
    expect(mergeRefresh<number>({ status: 'pending' }, { status: 'failed' })).toEqual({ status: 'failed' })
    expect(mergeRefresh({ status: 'ready', data: 1, stale: true }, { status: 'ready', data: 2 })).toEqual({ status: 'ready', data: 2 })
  })
})

describe('kanban column order', () => {
  it('follows the Hermes board order and appends unknown statuses', () => {
    expect(orderedStatuses(['done', 'custom', 'running', 'triage'])).toEqual(['triage', 'running', 'done', 'custom'])
    expect(orderedStatuses(['blocked'], true)).toEqual(['todo', 'ready', 'running', 'blocked', 'review', 'done'])
  })
})
