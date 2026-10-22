// @vitest-environment jsdom
/** Case controls never infer employment or delivery from plan acceptance or completed wakes. */
import { useState } from 'react'
import { Context } from '@clocky/cordis'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { simulationProductWorldCasesPageSchema, simulationProductWorldCaseInspectionSchema } from '@clocky/clocky-simulation-product/schema'
import { SimulationRuntime } from '@clocky/clocky-client-runtime/client'
import { FakeApiClient } from '../../runtime/tests/fake-api.client.ts'
import { WorldCases } from '../src/client/WorldCases.tsx'
import type { Route } from '../src/client/store.ts'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)
const lifecycle = (status: string) => ({ request: { status }, plan: { status: 'none' },
  execution: { callback: { status: 'none' }, business: ['committed', 'rejected', 'cancelled'].includes(status)
    ? { status, resultId: 'result' } : { status: 'none' } }, notification: { request: null } })
const cancellationPreview = { snapshotRevision: 3, previewHash: `sha256:${'c'.repeat(64)}`, impact: { requestStatus: 'open',
  planIds: [], hiringReservationIds: [], personnelReservationIds: [], representativeReservationIds: [], unconfirmedExecutionPlanIds: [] } }
const summary = { apiVersion: 'clocky.world-case/v4', businessSummary: { status: 'unsupported' }, origin: { kind: 'decision' }, domain: 'organization', operation: 'generate-and-hire', version: '1', requestId: 'case', intentId: 'intent', status: 'open', requesterEntityId: 'requester',
  organizationEntityId: 'organization', targetEntityId: 'position', cancel: { allowed: true, reason: 'ready', preview: cancellationPreview }, lifecycle: lifecycle('open') }
const post = { operationId: 'notify', status: 'pending', publication: 'unpublished', delivery: 'not-received', channelId: 'channel' }
function setup(section: 'plans' | 'notification' | 'request' | 'execution', stale = false,
  extra: Partial<Pick<Parameters<typeof WorldCases>[0], 'extensions' | 'readExtensions'>> = {}, requestPost: typeof post | null = post, awaitingEvidence = false, evidence?: unknown, terminal?: 'evidence-deadline' | 'evidence-exhausted', execution?: unknown) {
  const selectedExecution = execution === undefined ? undefined : simulationProductWorldCaseInspectionSchema.parse({ runId: 'run',
    requestId: 'case', section: 'execution', snapshotRevision: 3, readVersion: 'v1', observedAt: 1, status: 'found', value: execution })
  const baseSummary = selectedExecution?.value?.summary ?? (terminal !== undefined ? { ...summary, status: 'rejected', cancel: { allowed: false, reason: 'terminal' } }
    : awaitingEvidence ? { ...summary, status: 'awaiting-evidence', lifecycle: lifecycle('awaiting-evidence') }
      : section === 'notification' ? { ...summary, status: 'committed', cancel: { allowed: false, reason: 'terminal' }, lifecycle: lifecycle('committed') } : summary)
  const selectedSummary = { ...baseSummary, ...'preview' in baseSummary.cancel ? { cancel: { ...baseSummary.cancel,
    preview: { ...cancellationPreview, impact: { ...cancellationPreview.impact, requestStatus: baseSummary.status,
      planIds: section === 'plans' ? ['plan'] : [] } } } } : {}, lifecycle: { ...baseSummary.lifecycle,
    ...terminal !== undefined ? lifecycle('rejected') : {},
    ...section === 'plans' ? { plan: { status: 'accepted', id: 'plan', resolution: awaitingEvidence ? 'awaiting-evidence' : 'apply' } } : {},
    ...section === 'notification' ? { notification: { request: requestPost, result: { resultId: 'result',
      wake: { id: 'wake', status: 'completed', decisionId: 'decision' } } } } : {},
  } }
  const ctx = new Context(), source = new SimulationRuntime(ctx, new FakeApiClient())
  const runId = 'run' as never
  const page = simulationProductWorldCasesPageSchema.parse({ runId, snapshotRevision: 3, readVersion: 'v1', observedAt: 1,
    items: [selectedSummary], total: 2, nextCursor: 'bound-next' })
  const detail = simulationProductWorldCaseInspectionSchema.parse({ runId, requestId: 'case', snapshotRevision: 3,
    readVersion: 'v1', observedAt: 1, section, status: 'found', value: section === 'plans'
      ? { section, summary: selectedSummary, total: 1, items: [{ id: 'plan', operationId: 'resolve', sequence: 2, hash: 'hash', predecessor: null,
        status: 'accepted', resolution: awaitingEvidence ? 'awaiting-evidence' : 'apply',
        rationale: { status: 'withheld' }, persona: { status: awaitingEvidence ? 'not-applicable' : 'withheld' } }] }
      : section === 'execution' ? execution ?? { section, summary: selectedSummary, result: { id: 'result', sequence: 3, time: '100',
        source: terminal === 'evidence-deadline' ? { kind: terminal, challengeId: 'challenge', eventId: 'deadline' }
          : { kind: 'evidence-exhausted', challengeId: 'challenge', decisionId: 'decision' },
        outcome: { kind: 'rejected', reason: 'insufficient-information' }, payload: { status: 'withheld' } } }
        : section === 'notification' ? { section, summary: selectedSummary, request: requestPost, result: { resultId: 'result', wake: {
          id: 'wake', status: 'completed', decisionId: 'decision' } } } : { section, summary: selectedSummary,
          source: { kind: 'decision', operationId: 'request', sequence: 1, payloadHash: 'hash' }, description: { status: 'withheld' },
          ...evidence === undefined ? {} : { evidence } } })
  const data = { ...source.state.getSnapshot(), connected: true, authorizationVersion: 1,
    worldCases: { scope: JSON.stringify(['worldCases', { runId }]), value: page, loading: false, stale },
    worldCase: { scope: JSON.stringify(['worldCase', runId, 'case', section]), value: detail, loading: false, stale } }
  const read = vi.fn(async () => {}), inspect = vi.fn(async () => {}), closeDetail = vi.fn()
  const retain = vi.fn(() => 'original' as never), submit = vi.fn(async () => undefined)
  function Harness() {
    const [view, navigate] = useState<Route>({ runId, module: 'cases', search: '', objectId: 'case', caseSection: section })
    return <WorldCases runId={runId} view={view} navigate={navigate} data={data} connected authorizationVersion={1} pageSize={1}
      read={read} inspect={inspect} closeDetail={closeDetail} commands={{}} retain={retain} submit={submit}
      query={async () => undefined} t={key => en[key]} {...extra} />
  }
  return { view: render(<Harness />), ctx, read, retain, submit }
}

it('shows scenario wake responsibility without inventing a request or result Channel post', async () => {
  const h = setup('notification', false, {}, null)
  try {
    await h.view.findByText(en['cases.scenarioNoRequestPost'])
    expect(h.view.getAllByText(en['cases.scenarioNoResultPost'])).toHaveLength(2)
    expect(h.view.queryByRole('button', { name: 'notify' })).toBeNull()
    expect(h.view.queryByText('channel', { exact: true })).toBeNull()
    expect(h.view.queryByText(en['cases.noPost'])).toBeNull()
  } finally { await h.ctx.fiber.dispose() }
})

it('keeps accepted plans and withheld Persona separate from employment and binds next-page revision', async () => {
  const h = setup('plans')
  try {
    await h.view.findByText(en['cases.planNotice'])
    expect(document.querySelectorAll('[data-disclosure="withheld"]')).toHaveLength(2)
    expect(h.view.queryByText(en['cases.reservation.committed'])).toBeNull()
    expect(h.submit).not.toHaveBeenCalled()
    fireEvent.click(h.view.getByRole('button', { name: en.next }))
    await waitFor(() => { expect(h.read).toHaveBeenLastCalledWith({ runId: 'run', limit: 1,
      status: undefined, expectedRevision: 3, cursor: 'bound-next' }) })
  } finally { await h.ctx.fiber.dispose() }
})

it('shows wake completion with absent publication instead of asserting recipient delivery', async () => {
  const h = setup('notification')
  try {
    expect(h.view.getAllByText(en['cases.noPost'])).toHaveLength(2)
    expect(h.view.getByText(en['cases.publication.unpublished'], { exact: false })).toBeTruthy()
    expect(h.view.queryByText(en['cases.delivery.received'], { exact: false })).toBeNull()
    expect(h.submit).not.toHaveBeenCalled()
  } finally { await h.ctx.fiber.dispose() }
})

it.each(['blocked', 'outcome-unknown', 'settled'] as const)('shows %s callback confirmation without merging business or sending commands', async (status) => {
  const execution = { section: 'execution', summary: { ...summary, operation: 'hire-existing', status: 'committed',
    cancel: { allowed: false, reason: 'terminal' }, lifecycle: { ...lifecycle('committed'),
      plan: { status: 'accepted', id: 'original-plan', resolution: 'apply' },
      execution: { callback: { planId: 'original-plan', mode: 'execute', sequence: 3, updates: 2, time: '100', status,
        reason: status === 'settled' ? null : status === 'blocked' ? 'handoff-required' : 'callback-unconfirmed' },
      business: { status: 'committed', resultId: 'result' } } } }, observation: { planId: 'original-plan', mode: 'execute',
    sequence: 3, updates: 2, time: '100', status,
    reason: status === 'settled' ? null : status === 'blocked' ? 'handoff-required' : 'callback-unconfirmed' },
  result: { id: 'result', sequence: 3, time: '100', source: { kind: 'plan', planId: 'original-plan' },
    outcome: { kind: 'committed' }, payload: { status: 'allowed', value: { entityId: 'candidate', relationId: 'assignment' } } } }
  const h = setup('execution', false, {}, post, false, undefined, undefined, execution)
  try {
    await h.view.findByText(en[`cases.execution.${status}`])
    expect(h.view.getByRole('heading', { name: en['cases.execution.business'] })).toBeTruthy()
    expect(h.view.getAllByText(en['cases.status.committed']).length).toBeGreaterThan(0)
    expect(h.view.queryByText(en['cases.noReservation'])).toBeNull()
    if (status !== 'settled') {
      expect(h.view.getByText(en[status === 'blocked' ? 'status.stop.handoff-required' : 'status.stop.callback-unconfirmed'])).toBeTruthy()
      fireEvent.click(h.view.getByRole('button', { name: en['cases.execution.viewRecovery'] }))
      expect(h.retain).not.toHaveBeenCalled(); expect(h.submit).not.toHaveBeenCalled()
    } else expect(h.view.queryByRole('button', { name: en['cases.execution.viewRecovery'] })).toBeNull()
    fireEvent.click(h.view.getByRole('checkbox', { name: en['world.cases.needsAction'] }))
    expect(h.view.queryByRole('button', { name: 'case' }) !== null).toBe(status !== 'settled')
  } finally { await h.ctx.fiber.dispose() }
})

it('shows personnel and shared representative responsibilities without inventing a hiring reservation', async () => {
  for (const selected of [{ domain: 'organization', operation: 'depart', version: '1',
    duties: [{ kind: 'personnel', id: 'intent', planId: 'original-plan', status: 'blocked', sequence: 2, updatedSequence: 3 }] },
  { domain: 'external', operation: 'interact', version: '2', duties: [
    { kind: 'representative', id: 'shared-older-intent', planId: 'shared-older-plan', status: 'preparing', sequence: 2, updatedSequence: 3 },
    { kind: 'contact', id: 'intent', planId: 'original-plan', status: 'reserved', sequence: 3, updatedSequence: 3 }] }]) {
    const h = setup('execution', false, {}, post, false, undefined, undefined, { section: 'execution',
      summary: { ...summary, domain: selected.domain, operation: selected.operation, version: selected.version },
      responsibilities: selected.duties })
    try {
      await h.view.findByRole('region', { name: en['cases.execution.duties'] })
      expect(h.view.queryByText(en['cases.noReservation'])).toBeNull()
      for (const duty of selected.duties) expect(h.view.getByText(duty.id, { exact: true })).toBeTruthy()
      expect(h.submit).not.toHaveBeenCalled()
    } finally { h.view.unmount(); await h.ctx.fiber.dispose() }
  }
})

it('returns keyboard focus to the original visible row after closing a directly opened case', async () => {
  const h = setup('request')
  try {
    // The shared inspector dock closes from its icon button; focus returns to the row that opened it.
    fireEvent.click(h.view.getByRole('button', { name: en['world.close'] }))
    await waitFor(() => { expect(document.activeElement).toBe(h.view.getByRole('button', { name: 'case' })) })
    expect(h.view.queryByRole('complementary')).toBeNull()
    expect(h.submit).not.toHaveBeenCalled()
  } finally { await h.ctx.fiber.dispose() }
})

it('requires a fresh eligible detail and explicit confirmation before retaining one original cancellation', async () => {
  const h = setup('request')
  try {
    fireEvent.click(h.view.getByRole('button', { name: en['cases.cancel'] }))
    expect(h.retain).not.toHaveBeenCalled()
    fireEvent.click(h.view.getByRole('button', { name: en['cases.cancelConfirm'] }))
    expect(h.retain).toHaveBeenCalledOnce(); expect(h.submit).toHaveBeenCalledOnce()
    expect(h.retain).toHaveBeenCalledWith({ kind: 'cancel-world-case', input: { runId: 'run', requestId: 'case', previewRevision: 3, previewHash: cancellationPreview.previewHash,
      commandId: expect.any(String) as unknown } }, 1)
  } finally { await h.ctx.fiber.dispose() }
  cleanup()
  const blocked = setup('request', true)
  try {
    expect((blocked.view.getByRole('button', { name: en['cases.cancel'] }) as HTMLButtonElement).disabled).toBe(true)
    expect(blocked.retain).not.toHaveBeenCalled()
  } finally { await blocked.ctx.fiber.dispose() }
})

it('reads the World projection once per committed page even though the owner passes a fresh callback', async () => {
  const readExtensions = vi.fn()
  const h = setup('request', false, { extensions: { status: 'unpublished' }, readExtensions: (ids) => { readExtensions(ids) } })
  try {
    fireEvent.click(h.view.getByRole('tab', { name: en['cases.section.plans'] }))
    fireEvent.click(h.view.getByRole('tab', { name: en['cases.section.request'] }))
    await waitFor(() => { expect(readExtensions).toHaveBeenCalledWith(['case']) })
    expect(readExtensions).toHaveBeenCalledOnce()
    expect(h.view.getByRole('tab', { name: en['world.cases.section.evidence'] })).toBeTruthy()
  } finally { await h.ctx.fiber.dispose() }
})


it('renders an awaiting-evidence case and plan without implying a generated Persona or submitting work', async () => {
  const h = setup('plans', false, {}, post, true)
  try {
    await h.view.findByRole('heading', { name: `${en['cases.plan.accepted']} · ${en['cases.resolution.awaiting-evidence']}` })
    expect(h.view.getAllByText(en['cases.status.awaiting-evidence'])).toHaveLength(2)
    expect(document.querySelectorAll('[data-disclosure="withheld"]')).toHaveLength(1)
    fireEvent.click(h.view.getByRole('checkbox', { name: en['world.cases.needsAction'] }))
    expect(h.view.getByRole('button', { name: 'case' })).toBeTruthy()
    expect(h.submit).not.toHaveBeenCalled()
  } finally { await h.ctx.fiber.dispose() }
})


it.each([false, true])('shows original evidence metadata and applies answer disclosure: %s', async (allowed) => {
  const evidence = { inputRevision: 1, latestChallenge: { id: 'challenge', status: 'answered', round: 1,
    fields: [{ code: 'invoice', description: { text: 'Provide original invoice', truncated: false } }], responders: ['requester'],
    deadline: '100', maxAttempts: 2, attemptsUsed: 1 }, latestRevision: { id: 'revision', revision: 1, sequence: 3, actorId: 'requester',
    answers: allowed ? { status: 'allowed', items: [{ field: 'invoice', text: { text: 'Authorized answer only', truncated: false } }] }
      : { status: 'withheld' } } }
  const h = setup('request', false, {}, post, false, evidence)
  try {
    await h.view.findByText(en['cases.evidence.title'])
    expect(h.view.getByText(/Provide original invoice/)).toBeTruthy()
    expect(h.view.getByText(`${en['cases.evidence.deadline']}: 100`)).toBeTruthy()
    expect(h.view.getByText(`${en['cases.evidence.attempts']}: 1 / 2`)).toBeTruthy()
    expect(h.view.queryByText(/Authorized answer only/) !== null).toBe(allowed)
    expect(h.view.queryByRole('textbox')).toBeNull()
    expect(h.submit).not.toHaveBeenCalled()
  } finally { await h.ctx.fiber.dispose() }
})


it.each(['evidence-deadline', 'evidence-exhausted'] as const)('shows the actual %s terminal cause without a fake cancellation', async (kind) => {
  const h = setup('execution', false, {}, post, false, undefined, kind)
  try {
    await h.view.findByText(en[kind === 'evidence-deadline' ? 'cases.evidence.deadlineResult' : 'cases.evidence.exhaustedResult'])
    expect(h.view.queryByText(en['cases.status.cancelled'])).toBeNull()
    expect(h.submit).not.toHaveBeenCalled()
  } finally { await h.ctx.fiber.dispose() }
})

it('leads rows with the business action, keeps the request hash in the inspector, and explains the compact tracks and position', async () => {
  const h = setup('request')
  try {
    const row = h.view.getAllByRole('row')[1]!
    // Without a projector the row says so instead of an anonymous technical operation or "unknown domain".
    expect(row.textContent).toContain(en['world.cases.summary.unsupported'])
    expect(row.textContent).toContain('generate-and-hire v1')
    expect(row.querySelector('code')).toBeNull()
    expect(row.textContent).toContain(`${en['world.cases.technicalStatus']}: ${en['cases.status.open']}`)
    // An all-empty "updated" column is not drawn.
    expect(h.view.queryByRole('columnheader', { name: en['world.cases.time'] })).toBeNull()
    expect(document.querySelector('[data-track-legend]')?.textContent).toContain(en['world.track.state.unknown'])
    expect(document.querySelector('[data-page-position]')).not.toBeNull()
    expect(en['world.cases.position'].replace('{start}', '1').replace('{end}', '1').replace('{total}', '2')).toBe('1–1 of 2')
  } finally { await h.ctx.fiber.dispose() }
})

it('shows a recorded result the judge rejected as judge rejected in the row', async () => {
  const projected = summary as { businessSummary: unknown }
  const original = projected.businessSummary
  projected.businessSummary = { status: 'allowed', value: { version: 1, label: 'Coop requests harbor environment quote',
    submission: 'accepted', execution: 'rejected', businessOutcome: 'not-achieved',
    counts: Object.fromEntries(['businessEntities', 'firms', 'alliances', 'organizations', 'memberships', 'employmentRelationships',
      'founderRepresentedEntities', 'employedPeople', 'technicalRoles', 'independentSessions', 'openOrders', 'openLoans']
      .map(id => [id, { status: 'unknown' }])), sources: [{ kind: 'request', sequence: 1 }], nativeRevision: 3 } }
  const h = setup('request')
  try {
    const row = h.view.getAllByRole('row')[1]!
    expect(row.textContent).toContain('Coop requests harbor environment quote')
    expect(row.querySelector('[data-layer="execution"]')?.getAttribute('data-tone')).toBe('failed')
    expect(row.querySelector('[data-tone="done"]')).toBeNull()
  } finally { projected.businessSummary = original; await h.ctx.fiber.dispose() }
})
