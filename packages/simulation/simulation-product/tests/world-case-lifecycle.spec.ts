/** Case lists and details share one Native prefix without promoting private bodies or inferring effect/delivery from request status. */
import { expect, it } from 'vitest'
import { hiringResourceHarness } from '../../simulation-local/tests/hiring-resource-harness.ts'
import Products from '../src/index.ts'
import { registration, call } from './fixtures.ts'

it.each(['json', 'sqlite'] as const)('projects %s two-case request, plan, callback, business and notification facts independently', async (backend) => {
  const h = await hiringResourceHarness(backend, 'hire-existing', { evidenceRoot: '.local/world-completion/u04-tracks', capacity: 3 })
  try {
    const first = await h.plan('first-track'), second = await h.plan('second-track')
    const armed = await h.run.recordWorldExecution({ planId: first.id, phase: 'armed', mode: 'execute', reason: null, expectedSequence: null })
    await h.reserve(first)
    if (first.proposal.resolution.kind !== 'apply') throw new Error('Original plan is not executable')
    await h.run.commitWorldMutation({ planId: first.id, payload: first.proposal.resolution.payload })
    const unknown = await h.run.recordWorldExecution({ planId: first.id, phase: 'outcome-unknown', mode: 'execute',
      reason: 'callback-unconfirmed', expectedSequence: armed.sequence })
    const original = h.run.snapshot(), registered = { ...registration('case-tracks'), spec: h.selection.spec }
    await h.ctx.plugin(Products, { directoryStream: 'case-track-directory', imports: [registered] })
    const page = await h.ctx.simulationProducts.listWorldCases({ runId: registered.id }, call())
    expect(page.snapshotRevision).toBe(original.revision)
    const committed = page.items.find(value => value.requestId === first.requestId)!
    const untouched = page.items.find(value => value.requestId === second.requestId)!
    expect(committed.apiVersion).toBe('clocky.world-case/v4')
    expect(committed.lifecycle).toMatchObject({ request: { status: 'committed' },
      plan: { id: first.id, status: 'accepted', resolution: 'apply' },
      execution: { callback: { status: 'outcome-unknown', sequence: unknown.sequence },
        business: { status: 'committed' } }, notification: { request: { publication: 'published', delivery: 'received' } } })
    expect(committed.lifecycle.notification.result?.post).toBeUndefined()
    expect(untouched.lifecycle).toMatchObject({ request: { status: 'open' },
      plan: { id: second.id, status: 'accepted', resolution: 'apply' },
      execution: { callback: { status: 'none' }, business: { status: 'none' } } })
    for (const item of page.items) {
      for (const section of ['request', 'plans', 'execution', 'notification'] as const) {
        const detail = await h.ctx.simulationProducts.inspectWorldCase({ runId: registered.id, requestId: item.requestId, section }, call())
        expect(detail.snapshotRevision).toBe(original.revision)
        expect(detail.value?.summary.lifecycle).toEqual(item.lifecycle)
        if (detail.value?.section === 'request') expect(detail.value.description.status).toBe('withheld')
        if (detail.value?.section === 'plans') for (const plan of detail.value.items) {
          expect(plan.rationale.status).toBe('withheld'); expect(plan.persona.status).toBe('not-applicable')
        }
        if (detail.value?.section === 'notification') {
          const { section: _section, summary: _summary, ...notification } = detail.value
          expect(notification).toEqual(item.lifecycle.notification)
        }
      }
    }
    expect(h.run.snapshot()).toEqual(original)
    expect(h.requests).toHaveLength(0)
  } finally { await h.close() }
})
