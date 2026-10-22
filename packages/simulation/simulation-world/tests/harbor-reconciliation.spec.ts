/** Reconciliation can publish original evidence but cannot issue an uncertain external command again. */
import { mkdtemp, readFile, rm, unlink } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { expect, it, vi } from 'vitest'
import type { SimulationSnapshot, SimulationWorldPlan } from '@clocky/clocky-simulation'
import { SimulationStopBoundaryError } from '@clocky/clocky-simulation'
import type { WorldExecutionBinding } from '../src/providers.ts'
import { HarborCase, harborHash } from '../src/harbor-case.ts'
import { HarborExecution } from '../src/harbor-execution.ts'
import { HARBOR_PIN } from '../src/harbor-protocol.ts'

async function fixture() {
  const root = await mkdtemp(resolve('.tmp/harbor-reconcile-')), source = resolve('test-cases/harbor-society-365')
  const lifetime = new AbortController().signal, runId = 'original-reconciliation'
  const judge = new HarborCase(source, root, runId, lifetime)
  const initial = await judge.overview()
  const state = { spec: { runId }, entities: { 'harbor-environment': { profile: { harbor: {
    ...initial, overview: {}, prompt: 'Task', rules: 'Rules', guide: 'Guide',
  } } } }, world: { requests: { original: { id: 'original', intentId: 'original-intent', requesterEntityId: 'coordinator',
    source: { kind: 'decision', binding: { teamId: 'real-team', sessionId: 'real-session' } },
    proposal: { payload: { scopeEntityId: 'harbor', targetEntityId: 'harbor-environment', command: { kind: 'advance', day: 1 } } } } },
  executions: { originalPlan: { pin: HARBOR_PIN, planId: 'originalPlan', phase: 'outcome-unknown' } }, results: {} } } as unknown as SimulationSnapshot
  const run = { snapshot: () => state, controlObservation: () => ({ phase: 'running' }),
    commitWorldMutation: vi.fn<(input: { planId: SimulationWorldPlan['id']; payload: unknown }) => Promise<void>>()
      .mockResolvedValue(undefined), checkStopBoundary: vi.fn() }
  const plan = { id: 'originalPlan', requestId: 'original',
    proposal: { resolution: { kind: 'apply', payload: { forwardOriginal: true } } } } as unknown as SimulationWorldPlan
  const handler = () => new HarborExecution({ run, lifetime } as unknown as WorldExecutionBinding, source, root)
  const journal = () => readFile(join(judge.directory, 'output', 'journal.jsonl'), 'utf8')
  return { root, judge, run, plan, handler, journal }
}

it('publishes an existing receipt after Native publication failed without redispatching or requiring new execution authority', async () => {
  const h = await fixture()
  try {
    h.run.commitWorldMutation.mockRejectedValueOnce(new Error('Native append interrupted'))
    await expect(h.handler().execute(h.plan)).rejects.toThrow('Native append interrupted')
    const before = await h.journal()
    h.run.checkStopBoundary.mockImplementation(() => { throw new Error('New execution authority is closed') })
    h.run.checkStopBoundary.mockClear()
    await h.handler().reconcile(h.plan)
    expect(h.run.checkStopBoundary).not.toHaveBeenCalled()
    expect(h.run.commitWorldMutation.mock.lastCall?.[0].planId).toBe(h.plan.id)
    expect(h.run.commitWorldMutation.mock.lastCall?.[0].payload).toMatchObject({ day: 1, ok: true })
    expect(await h.journal()).toBe(before)
  } finally { await rm(h.root, { recursive: true, force: true }) }
})

it.each([false, true])('retains unknown responsibility with no receipt (judge already executed: %s)', async (executed) => {
  const h = await fixture()
  try {
    if (executed) {
      await h.handler().execute(h.plan)
      await unlink(join(h.judge.directory, '.bridge', `${harborHash('original-intent')}.result.json`))
    }
    h.run.commitWorldMutation.mockClear()
    const before = await h.journal(), handler = h.handler()
    await expect(handler.reconcile(h.plan)).rejects.toThrow(/outcome remains unknown/)
    expect(handler.retainsResponsibility(h.plan)).toBe(true)
    expect(h.run.commitWorldMutation).not.toHaveBeenCalled()
    expect(await h.journal()).toBe(before)
  } finally { await rm(h.root, { recursive: true, force: true }) }
})

it('rechecks the live stop guard before dispatch and never advances the judge after refusal', async () => {
  const h = await fixture()
  try {
    const before = await h.journal()
    h.run.checkStopBoundary.mockImplementation(() => { throw new SimulationStopBoundaryError('Stop target changed while preparing IO') })
    expect(await h.handler().execute(h.plan)).toBe('paused')
    expect(h.run.commitWorldMutation).not.toHaveBeenCalled()
    expect(await h.journal()).toBe(before)
    await expect(h.handler().reconcile(h.plan)).rejects.toThrow(/outcome remains unknown/)
    expect(await h.journal()).toBe(before)
  } finally { await rm(h.root, { recursive: true, force: true }) }
})
