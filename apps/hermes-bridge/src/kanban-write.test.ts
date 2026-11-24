import { describe, expect, it } from 'bun:test'
import { createInstruction, review, WriteError, type Actor } from './kanban-write.js'
import type { Run, RunOptions } from './mission-control.js'

const actor: Actor = { id: 'u1', name: 'Fardan', role: 'PM' }

function recorder(outputs: string[] = []) {
  const calls: { args: string[]; options?: RunOptions }[] = []
  const run: Run = async (_file, args, options) => {
    calls.push({ args, options })
    return outputs.shift() ?? ''
  }
  return { calls, run }
}

describe('instructions', () => {
  it('parks an unassigned instruction in triage and returns its id', async () => {
    const { calls, run } = recorder([JSON.stringify({ id: 't_1a2b' })])
    await expect(createInstruction({ title: ' Carikan 20 prospek FMCG ', body: 'Jakarta\nIT/Purchasing', board: 'sales' }, actor, run)).resolves.toEqual({ id: 't_1a2b', board: 'sales' })
    expect(calls[0]!.args).toEqual(['kanban', '--board', 'sales', 'create', 'Carikan 20 prospek FMCG', '--body', 'Jakarta\nIT/Purchasing', '--triage', '--created-by', 'Fardan (PM)', '--json'])
    expect(calls[0]!.options).toMatchObject({ timeoutMs: 20_000, logAs: 'hermes kanban --board sales create' })
  })

  it('assigns straight to an agent, or splits a triage task in the background', async () => {
    const direct = recorder([JSON.stringify({ id: 't_1' })])
    await createInstruction({ title: 'Audit website', assignee: 'sales' }, actor, direct.run)
    expect(direct.calls[0]!.args).toEqual(['kanban', 'create', 'Audit website', '--assignee', 'sales', '--created-by', 'Fardan (PM)', '--json'])

    const split = recorder([JSON.stringify({ id: 't_2' })])
    await createInstruction({ title: 'Kampanye FMCG', decompose: true }, actor, split.run)
    expect(split.calls.map((call) => call.args)).toEqual([
      ['kanban', 'create', 'Kampanye FMCG', '--triage', '--created-by', 'Fardan (PM)', '--json'],
      ['kanban', 'decompose', 't_2', '--author', 'Fardan (PM)'],
    ])
  })

  it('validates input before running anything', async () => {
    const { calls, run } = recorder()
    await expect(createInstruction({ title: '   ' }, actor, run)).rejects.toThrow('Judul wajib diisi.')
    await expect(createInstruction({ title: 'x'.repeat(201) }, actor, run)).rejects.toThrow('maksimal 200')
    await expect(createInstruction({ title: 'ok', board: '../x' }, actor, run)).rejects.toThrow('Board tidak dikenal.')
    await expect(createInstruction({ title: 'ok', assignee: '--force' }, actor, run)).rejects.toThrow('Agent tidak dikenal.')
    expect(calls).toEqual([])
  })

  it('keeps text from reading as an option', async () => {
    const { calls, run } = recorder([JSON.stringify({ id: 't_3' })])
    await createInstruction({ title: '--assignee root' }, actor, run)
    expect(calls[0]!.args[2]).toBe('‐‐assignee root')
  })

  it('reports a missing id as a Hermes failure', async () => {
    const { run } = recorder(['not json'])
    await expect(createInstruction({ title: 'ok' }, actor, run)).rejects.toMatchObject({ status: 502 })
  })
})

describe('reviews', () => {
  it('approves, sends back with a note, rejects and comments', async () => {
    const { calls, run } = recorder()
    await review('approve', 't_1', 'review', 'Mantap', undefined, actor, run)
    await review('changes', 't_1', 'review', 'Tombol checkout jadi 2 kata', 'design', actor, run)
    await review('reject', 't_1', 'review', 'Bukan target enterprise', undefined, actor, run)
    await review('reject', 't_2', 'ready', 'Duplikat', undefined, actor, run)
    await review('comment', 't_2', 'running', 'Pakai data Q3', undefined, actor, run)
    expect(calls.map((call) => call.args)).toEqual([
      ['kanban', 'complete', 't_1', '--result', 'Disetujui oleh Fardan (PM): Mantap'],
      ['kanban', '--board', 'design', 'reopen-review', 't_1', '--reason', '[Revisi dari Fardan (PM)] Tombol checkout jadi 2 kata'],
      ['kanban', 'reopen-review', 't_1'],
      ['kanban', 'block', 't_1', '--kind', 'needs_input', '[Ditolak oleh Fardan (PM)] Bukan target enterprise'],
      ['kanban', 'block', 't_2', '--kind', 'needs_input', '[Ditolak oleh Fardan (PM)] Duplikat'],
      ['kanban', 'comment', 't_2', 'Pakai data Q3', '--author', 'Fardan (PM)'],
    ])
    expect(calls.every((call) => !call.options?.logAs?.includes('Fardan'))).toBe(true)
  })

  it('requires a note for changes and rejections, and the right status', async () => {
    const { calls, run } = recorder()
    await expect(review('changes', 't_1', 'review', ' ', undefined, actor, run)).rejects.toThrow('Catatan revisi wajib diisi.')
    await expect(review('reject', 't_1', 'review', undefined, undefined, actor, run)).rejects.toThrow('Alasan penolakan wajib diisi.')
    await expect(review('approve', 't_1', 'running', '', undefined, actor, run)).rejects.toMatchObject({ status: 409 })
    await expect(review('reject', 't_1', 'done', 'x', undefined, actor, run)).rejects.toMatchObject({ status: 409 })
    expect(calls).toEqual([])
  })

  it('passes Hermes\' own refusal on', async () => {
    const run: Run = async () => { throw Object.assign(new Error('exit 1'), { stderr: 'cannot block t_1\n' }) }
    const error = await review('comment', 't_1', 'review', 'x', undefined, actor, run).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(WriteError)
    expect((error as WriteError).message).toBe('Hermes menolak: cannot block t_1')
  })
})
