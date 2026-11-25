import { useEffect, useState } from 'react'
import { loadSnapshot } from './request-state.ts'
import type { Person } from './types.ts'

let people: Promise<Person[]> | undefined

/** Everyone on the team who can be a PIC, loaded once per page load. */
export function usePeople(): Person[] {
  const [list, setList] = useState<Person[]>([])
  useEffect(() => {
    let active = true
    people ??= loadSnapshot<Person[]>('/api/people').then((state) => (state.status === 'ready' ? state.data : []))
    void people.then((next) => { if (active) setList(next) })
    return () => { active = false }
  }, [])
  return list
}
