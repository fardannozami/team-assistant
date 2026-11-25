import { useEffect, useState } from 'react'
import { loadSnapshot } from './request-state.ts'
import type { Member } from './types.ts'

let people: Promise<Member[]> | undefined

/** The team members who can be a PIC (with today's presence), loaded once per page load. */
export function usePeople(): Member[] {
  const [list, setList] = useState<Member[]>([])
  useEffect(() => {
    let active = true
    people ??= loadSnapshot<Member[]>('/api/people').then((state) => (state.status === 'ready' ? state.data : []))
    void people.then((next) => { if (active) setList(next) })
    return () => { active = false }
  }, [])
  return list
}
