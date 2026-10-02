/** Authorized paged collections and exact details never disclose unrelated/private native bodies. */
import { expect, it } from 'vitest'
import { simulationChangeSchema } from '@clocky/clocky-simulation'
import { createBusinessHarness } from '../../simulation-local/tests/business-harness.ts'
import type { SimulationProductObjectInput } from '../src/types.ts'
import { fixture, registration, call } from './fixtures.ts'
import { worldFixture, decision, operation, checkpoints, browseInput } from './collection-fixtures.ts'

it.each(['json', 'sqlite'] as const)('reads real held world entities and expires pages after a native write (%s)', async (backend) => {
  const native = await createBusinessHarness(backend)
  const h = await fixture(backend, { imports: [{ ...registration(), spec: native.selection.spec }] })
  h.unregister()
  h.ctx.simulations.registerProvider(native.provider)
  try {
    for (const id of ['b', 'a']) await native.run.change(simulationChangeSchema.parse({ kind: 'entity/create', id,
      entityKind: 'org', cognition: 'none', profile: { name: id, secret: 'private-profile-body' } }), native.run.snapshot().revision)
    const { products } = await h.mount()
    const before = native.run.snapshot()
    const first = await products.browse({ ...browseInput('entities'), collection: 'entities', limit: 1 }, call())
    expect(first.items.map(row => row.id)).toEqual(['a'])
    expect(first.total).toBe(2)
    const second = await products.browse({ ...browseInput('entities'), collection: 'entities', limit: 1, cursor: first.nextCursor }, call())
    expect(second.items.map(row => row.id)).toEqual(['b'])
    expect(second.snapshotRevision).toBe(first.snapshotRevision)
    expect(native.run.snapshot()).toEqual(before)
    await native.run.change(simulationChangeSchema.parse({ kind: 'entity/create', id: 'c', entityKind: 'org',
      cognition: 'none', profile: {} }), native.run.snapshot().revision)
    await expect(products.browse({ ...browseInput('entities'), collection: 'entities', limit: 1, cursor: first.nextCursor }, call()))
      .rejects.toMatchObject({ code: 'SIMULATION_PRODUCT_STALE' })
    await expect(products.inspectObject({ runId: registration().id, collection: 'entities', id: 'a' as never,
      section: 'identity', expectedRevision: first.snapshotRevision }, call())).rejects.toMatchObject({ code: 'SIMULATION_PRODUCT_STALE' })
  } finally { await native.close() }
})

it('sorts decimal decision slots and effect order exactly, filters each collection and binds continuation', async () => {
  const h = await worldFixture()
  Object.assign(h.state.decisions, { z: decision('z', '9007199254740993'), a: decision('a', '9007199254740992'), b: decision('b', '10', 'other') })
  Object.assign(h.state.operations, { later: operation('later', 'z'), earlier: operation('earlier', 'a'),
    second: operation('second', 'a', 1) })
  const first = await h.products.browse({ ...browseInput('decisions'), collection: 'decisions', limit: 1 }, call())
  expect(first.items.map(row => row.id)).toEqual(['b'])
  const next = await h.products.browse({ ...browseInput('decisions'), collection: 'decisions', limit: 1, cursor: first.nextCursor }, call())
  expect(next.items.map(row => row.id)).toEqual(['a'])
  expect((await h.products.browse({ ...browseInput('decisions'), collection: 'decisions', entityId: 'actor' as never }, call())).total).toBe(2)
  expect((await h.products.browse({ ...browseInput('operations'), collection: 'operations' }, call())).items.map(row => row.id))
    .toEqual(['earlier', 'second', 'later'])
  expect((await h.products.browse({ ...browseInput('operations'), collection: 'operations', decisionId: 'a' as never }, call())).total).toBe(2)
  expect((await h.products.browse({ ...browseInput('operations'), collection: 'operations', entityId: 'other' as never }, call())).total).toBe(0)
  expect((await h.products.browse({ ...browseInput('decisions'), collection: 'decisions', status: 'accepted' }, call())).total).toBe(3)
  expect((await h.products.browse({ ...browseInput('operations'), collection: 'operations', status: 'applied' }, call())).total).toBe(0)
  for (const changed of [{ ...browseInput('decisions'), collection: 'decisions' as const, status: 'open' as const, limit: 1 },
    { ...browseInput('operations'), collection: 'operations' as const, limit: 1 },
    { ...browseInput('decisions'), collection: 'decisions' as const, limit: 2 }]) {
    await expect(h.products.browse({ ...changed, cursor: first.nextCursor }, call())).rejects.toMatchObject({ code: 'SIMULATION_PRODUCT_STALE' })
  }
  h.state.revision++
  await expect(h.products.browse({ ...browseInput('decisions'), collection: 'decisions', limit: 1, cursor: first.nextCursor }, call()))
    .rejects.toMatchObject({ code: 'SIMULATION_PRODUCT_STALE' })
  expect(h.open).not.toHaveBeenCalled()
})

it('separates submission, effect execution, publication, input persistence, receipt and task creation', async () => {
  const h = await worldFixture()
  Object.assign(h.state.decisions, { first: decision('first', '1'), submitted: { ...decision('submitted', '2'), status: 'submitted' } })
  const publication = { runId: h.state.spec.runId, teamId: 'team' as never, recipientId: 'recipient' as never, sequence: 3,
    operationId: 'published' as never, fingerprint: 'secret', channelId: 'channel' as never, envelopeId: 'envelope' as never }
  const published = { ...operation('published'), status: 'applied', outbox: { ready: true, budgetStart: 0, attempts: [], receipt: publication } }
  const persisted = { ...published, id: 'persisted', delivery: { wakeId: 'wake', sessionId: 'session', sequence: 1, time: '0' } }
  const receipted = { ...persisted, id: 'receipted', delivery: { ...persisted.delivery,
    receipt: { type: 'channel/receipt', sequence: 4, createdAt: 1, participantId: 'recipient', envelopeId: 'envelope', cursor: 3 } } }
  const abandoned = { ...published, id: 'abandoned', deliveryFailure: { record: { type: 'channel/delivery-expired', sequence: 4,
    createdAt: 1, participantId: 'recipient', envelopeId: 'envelope', envelopeSequence: 3 }, sequence: 4, time: '0' } }
  const resolved = { ...abandoned, id: 'resolved', deliveryFailure: { ...abandoned.deliveryFailure,
    resolution: { kind: 'retained-input', sequence: 5, time: '0' } } }
  const task = { ...operation('task'), action: { kind: 'task/create', deliverAt: '0', task: { subject: 'private-task-subject',
    description: 'private-task-description', blockedBy: [], requiredCapabilities: [], priority: 0, readScopes: [], writeScopes: [],
    workspaceMode: 'shared', reviewPolicy: { kind: 'none' }, budget: {}, maxAttempts: 1 } }, outbox: { ready: false, attempts: [], budgetStart: 0,
    taskReceipt: { operationId: 'task', fingerprint: 'secret', teamId: 'team', taskId: 'task-id' } } }
  Object.assign(h.state.operations, { pending: operation('pending'), unknown: { ...operation('unknown'), status: 'outcome-unknown' },
    published, persisted, receipted, abandoned, resolved, task })
  const page = await h.products.browse({ ...browseInput('operations'), collection: 'operations' }, call())
  expect(page.collection).toBe('operations')
  if (page.collection !== 'operations') throw new Error('Expected effect collection')
  const byId = Object.fromEntries(page.items.map(row => [row.id, row]))
  expect(byId['pending']).toMatchObject({ publication: 'pending', delivery: 'pending', status: 'pending', task: 'not-applicable' })
  expect(byId['unknown']?.status).toBe('outcome-unknown')
  expect(byId['published']).toMatchObject({ publication: 'published', delivery: 'pending' })
  expect(byId['persisted']?.delivery).toBe('input-persisted')
  expect(byId['receipted']?.delivery).toBe('receipted')
  expect(byId['abandoned']).toMatchObject({ delivery: 'pending', deliveryFailure: 'unresolved' })
  expect(byId['resolved']).toMatchObject({ delivery: 'input-persisted', deliveryFailure: 'retained-input' })
  expect(byId['task']).toMatchObject({ publication: 'not-applicable', delivery: 'not-applicable', task: 'created' })
  const result = await h.products.inspectObject({ runId: registration().id, collection: 'operations', id: 'task' as never, section: 'execution' }, call())
  expect(result.value).toMatchObject({ taskReference: { teamId: 'team', taskId: 'task-id' } })
  expect(JSON.stringify(page)).not.toContain('private-communication-text')
  expect(JSON.stringify(result)).not.toContain('fingerprint')
  expect((await h.products.browse({ ...browseInput('decisions'), collection: 'decisions', status: 'submitted' }, call())).items.map(row => row.id))
    .toEqual(['submitted'])
})

it('projects exact entity and decision metadata while withholding profiles, knowledge and model context', async () => {
  const h = await worldFixture({ maxTextBytes: 7 })
  Object.assign(h.state.entities, { actor: { id: 'actor', kind: 'person', phase: 'active', cognition: 'agent', revision: 2, profileRevision: 1,
    profile: { name: '中文🙂标题', secret: 'private-profile-body' }, binding: { teamId: 'team', participantId: 'actor', sessionId: 'session' },
    participantReservation: { participant: { displayName: '中文🙂名' } }, writer: { phase: 'active', epoch: '9007199254740993' } },
  absentName: { id: 'absentName', kind: 'org', phase: 'inactive', cognition: 'none', revision: 1, profileRevision: 1, profile: {} } })
  expect((await h.products.browse({ ...browseInput('entities'), collection: 'entities', phase: 'active', cognition: 'agent' }, call())).total).toBe(1)
  expect((await h.products.browse({ ...browseInput('entities'), collection: 'entities', phase: 'terminated' }, call())).items).toEqual([])
  const actor = await h.products.inspectObject({ runId: registration().id, collection: 'entities', id: 'actor' as never, section: 'identity' }, call())
  expect(actor.value).toMatchObject({ writerEpoch: '9007199254740993', summary: { name: { text: '中文', truncated: true } },
    binding: { teamId: 'team', participantId: 'actor', sessionId: 'session' } })
  const noBinding = await h.products.inspectObject({ runId: registration().id, collection: 'entities', id: 'absentName' as never, section: 'identity' }, call())
  expect(noBinding.value).toMatchObject({ summary: { writer: 'none' } })
  Object.assign(h.state.decisions, { first: { ...decision('first', '1'), closedAt: 3, cancellation: 'timeout',
    inference: { startedAt: 1, deadline: 2, finishedAt: 3, expiredAt: 2 },
    context: { status: 'prepared', maxBytes: 1000, retainedBytes: 99, knowledge: [{ id: 'private-knowledge' }],
      view: { sources: [{ kind: 'run-event' }], content: [{ kind: 'identity', blocks: [{ type: 'text', text: 'private-context-body' }] }] } } },
  overflow: { ...decision('overflow', '2'), context: { status: 'overflow', requiredBytes: 1001, maxBytes: 1000 } },
  absent: decision('absent', '3') })
  for (const id of ['first', 'overflow', 'absent']) {
    const result = await h.products.inspectObject({ runId: registration().id, collection: 'decisions', id: id as never, section: 'execution' }, call())
    expect(result.status).toBe('found')
    expect(JSON.stringify(result)).not.toContain('private-')
    if (id === 'first') expect(result.value).toMatchObject({ summary: { time: '9007199254740993' },
      inference: { startedAt: 1, deadline: 2, finishedAt: 3, expiredAt: 2 },
      context: { status: 'prepared', knowledgeCount: 1, sourceCount: 1, sectionCount: 1, content: 'withheld' } })
    if (id === 'overflow') expect(result.value).toMatchObject({ context: { status: 'overflow', requiredBytes: 1001 } })
    if (id === 'absent') expect(result.value).toMatchObject({ context: { status: 'absent' } })
  }
  expect(JSON.stringify(actor)).not.toContain('private-profile-body')
})

it('pages checkpoint references independently and does not claim current validation from retained completion', async () => {
  const h = await worldFixture()
  expect((await h.products.browse({ ...browseInput('checkpoints'), collection: 'checkpoints' }, call())).items).toEqual([])
  Object.assign(h.state, { checkpoints: checkpoints(h.state), latestCheckpointId: 'complete' })
  const page = await h.products.browse({ ...browseInput('checkpoints'), collection: 'checkpoints' }, call())
  expect(page.items.map(row => row.id)).toEqual(['complete', 'progress', 'failed'])
  expect((await h.products.browse({ ...browseInput('checkpoints'), collection: 'checkpoints', status: 'failed' }, call())).total).toBe(1)
  const input = { runId: registration().id, collection: 'checkpoints', id: 'complete', section: 'references', limit: 2 } as const
  let result = await h.products.inspectObject(input as SimulationProductObjectInput, call())
  expect(result.value).toMatchObject({ summary: { status: 'completed', latestSuccessful: true, sourceValidation: 'not-performed',
    time: '9007199254740993' } })
  if (result.value?.collection !== 'checkpoints') throw new Error('Expected checkpoint references')
  const refs = [...result.value.references.items]
  while (result.value.references.nextCursor !== undefined) {
    const nextInput = { ...input, cursor: result.value.references.nextCursor } as SimulationProductObjectInput
    result = await h.products.inspectObject(nextInput, call())
    if (result.value?.collection !== 'checkpoints') throw new Error('Expected next checkpoint reference page')
    refs.push(...result.value.references.items)
  }
  expect(refs).toEqual([{ kind: 'run', cursor: 1 }, { kind: 'team', id: 'team', cursor: 4 },
    { kind: 'channel', id: 'channel-a', cursor: 4 }, { kind: 'channel', id: 'channel-z', cursor: 4 },
    { kind: 'session', id: 'session-a', teamId: 'team', participantId: 'actor', materialization: 'materialized', sequence: -1 },
    { kind: 'session', id: 'session-z', teamId: 'team', participantId: 'actor', materialization: 'unmaterialized' }])
  for (const id of ['failed', 'progress']) {
    const result = await h.products.inspectObject({ ...input, id } as SimulationProductObjectInput, call())
    expect(JSON.stringify(result)).not.toContain('/private/')
    expect(result.value).toMatchObject({ references: { items: [], total: 0 } })
  }
  expect(JSON.stringify(refs)).not.toContain('stream')
  expect(JSON.stringify(refs)).not.toContain('fingerprint')
})

it('distinguishes missing history, missing objects and access refusal, rechecking retirement on all read paths', async () => {
  const h = await worldFixture()
  for (const collection of ['entities', 'decisions', 'operations', 'checkpoints'] as const) {
    const section = collection === 'entities' ? 'identity' : collection === 'checkpoints' ? 'references' : 'execution'
    const object = { runId: registration().id, collection, id: 'other-run-object', section } as SimulationProductObjectInput
    expect(await h.products.inspectObject(object, call())).toMatchObject({ status: 'missing' })
    await expect(h.products.inspectObject(object, call(undefined, 'other'))).rejects.toMatchObject({ code: 'SIMULATION_PRODUCT_FORBIDDEN' })
    await expect(h.products.browse(browseInput(collection), call(undefined, 'other'))).rejects.toMatchObject({ code: 'SIMULATION_PRODUCT_FORBIDDEN' })
  }
  for (const failing of [false, true]) {
    for (const method of ['browse', 'inspectObject'] as const) {
      const controller = new AbortController()
      h.inspect.mockImplementationOnce(async () => {
        controller.abort()
        if (failing) throw new Error('private-provider-error')
        return { snapshot: h.state, owner: 'other-owner' }
      })
      const input = method === 'browse' ? browseInput('entities') : { ...browseInput('entities'), id: 'actor', section: 'identity' }
      await expect(h.products[method](input as never, call(controller))).rejects.toMatchObject({ code: 'SIMULATION_PRODUCT_FORBIDDEN' })
    }
  }
  const missing = await fixture()
  const mounted = await missing.mount()
  await expect(mounted.products.browse(browseInput('entities'), call())).rejects.toMatchObject({ code: 'SIMULATION_PRODUCT_UNAVAILABLE' })
  await expect(mounted.products.inspectObject({ ...browseInput('entities'), collection: 'entities', id: 'actor' as never, section: 'identity' }, call()))
    .rejects.toMatchObject({ code: 'SIMULATION_PRODUCT_UNAVAILABLE' })
})
