import { describe, expect, it } from 'vitest'
import { pillOf, STAGES, stageOf } from './pipeline.ts'

describe('task pipeline', () => {
  it('flows from in, through the agent and a person\'s review, to done', () => {
    expect(STAGES.map((stage) => stage.label)).toEqual(['Masuk', 'Dikerjakan AI', 'Review', 'Selesai'])
    expect(['triage', 'ready', 'running', 'review', 'done'].map(stageOf)).toEqual([0, 0, 1, 2, 3])
  })

  it('keeps a blocked task where it stopped and unknown statuses in Masuk', () => {
    expect(stageOf('blocked')).toBe(1)
    expect(pillOf('blocked')).toBe('blocked')
    expect(stageOf('something-new')).toBe(0)
    expect(pillOf('something-new')).toBe('queue')
  })

  it('marks who has the task now', () => {
    expect(pillOf('running')).toBe('ai')
    expect(pillOf('review')).toBe('review')
    expect(pillOf('done')).toBe('done')
  })
})
