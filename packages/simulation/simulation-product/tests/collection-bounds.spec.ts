/** Complete wrappers, opaque query binding and exact section budgets remain enforced at every read. */
import { expect, it } from 'vitest'
import { simulationProductBrowseInputSchema, simulationProductObjectInputSchema, simulationProductObjectInspectionSchema,
  simulationProductCollectionPageSchema } from '../src/schema.ts'
import { call, registration } from './fixtures.ts'
import { browseInput, decision, operation, worldFixture } from './collection-fixtures.ts'

it('pages redacted transport attempts and rejects cross-object, section, revision and credential continuations', async () => {
  const h = await worldFixture()
  Object.assign(h.state.decisions, { first: decision('first', '1') })
  Object.assign(h.state.operations, { effect: { ...operation('effect'), outbox: { ready: true, budgetStart: 0, nextAttemptAt: 200,
    attempts: [{ number: 1, startedAt: 1, outcome: 'uncertain', finishedAt: 2, detail: '/private/transport-error' },
      { number: 2, startedAt: 3, outcome: 'in-flight' }] } },
  second: operation('second') })
  const input = { runId: registration().id, collection: 'operations', id: 'effect' as never, section: 'attempts', limit: 1 } as const
  const first = await h.products.inspectObject(input, call())
  expect(first.value).toMatchObject({ attempts: { total: 2, items: [{ number: 1, startedAt: 1, finishedAt: 2, outcome: 'uncertain' }] } })
  if (first.value?.collection !== 'operations' || first.value.section !== 'attempts') throw new Error('Expected attempt section')
  const cursor = first.value.attempts.nextCursor
  const last = await h.products.inspectObject({ ...input, cursor }, call())
  expect(last.value).toMatchObject({ attempts: { items: [{ number: 2, outcome: 'in-flight' }] } })
  expect(JSON.stringify(first)).not.toContain('/private/')
  const current = await h.products.inspectObject({ runId: input.runId, collection: 'operations', id: input.id, section: 'execution' }, call())
  expect(current.value).toMatchObject({ outbox: { ready: true, attemptCount: 2, nextAttemptAt: 200 } })
  for (const changed of [{ ...input, id: 'second' as never }, { ...input, limit: 2 }]) {
    await expect(h.products.inspectObject({ ...changed, cursor }, call())).rejects.toMatchObject({ code: 'SIMULATION_PRODUCT_STALE' })
  }
  await expect(h.products.inspectObject({ ...input, cursor }, { ...call(), credentialGeneration: 2 }))
    .rejects.toMatchObject({ code: 'SIMULATION_PRODUCT_STALE' })
  await expect(h.products.browse({ ...browseInput('operations'), collection: 'operations', cursor, limit: 1 }, call()))
    .rejects.toMatchObject({ code: 'SIMULATION_PRODUCT_STALE' })
  h.state.revision++
  await expect(h.products.inspectObject({ ...input, cursor }, call())).rejects.toMatchObject({ code: 'SIMULATION_PRODUCT_STALE' })
})

it('bounds full collection and detail wrappers, retains every row on continuation, and refuses oversized inputs before IO', async () => {
  const h = await worldFixture({ maxBytes: 1800, maxPageSize: 8 })
  Object.assign(h.state.entities, Object.fromEntries(Array.from({ length: 8 }, (_, index) => [String(index), {
    id: String(index), kind: 'org', cognition: 'none', phase: 'active', revision: 1, profileRevision: 1,
    profile: { name: '中'.repeat(130), secret: '/private/profile' },
  }])))
  let result = await h.products.browse({ ...browseInput('entities'), collection: 'entities', limit: 8 }, call())
  expect(result.items.length).toBeGreaterThan(0)
  expect(result.items.length).toBeLessThan(8)
  expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(1800)
  const ids = result.items.map(row => row.id)
  while (result.nextCursor !== undefined) {
    result = await h.products.browse({ ...browseInput('entities'), collection: 'entities', limit: 8, cursor: result.nextCursor }, call())
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(1800)
    ids.push(...result.items.map(row => row.id))
  }
  expect(ids).toEqual(['0', '1', '2', '3', '4', '5', '6', '7'])
  h.inspect.mockClear()
  await expect(h.products.browse({ ...browseInput('entities'), collection: 'entities', limit: 9 }, call())).rejects.toMatchObject({ code: 'SIMULATION_PRODUCT_INVALID' })
  await expect(h.products.browse({ ...browseInput('entities'), collection: 'entities', cursor: 'x'.repeat(2000) as never }, call()))
    .rejects.toMatchObject({ code: 'SIMULATION_PRODUCT_INVALID' })
  await expect(h.products.inspectObject({ ...browseInput('entities'), collection: 'entities', id: 'x'.repeat(2000) as never, section: 'identity' }, call()))
    .rejects.toMatchObject({ code: 'SIMULATION_PRODUCT_INVALID' })
  expect(h.inspect).not.toHaveBeenCalled()
  await h.fiber.dispose()
  const tiny = await h.mount(Object.assign({}, h.config, { imports: [], maxBytes: 100 }))
  await expect(tiny.products.browse({ ...browseInput('entities'), collection: 'entities' }, call())).rejects.toThrow(/row exceeds/)
  await expect(tiny.products.inspectObject({ ...browseInput('entities'), collection: 'entities', id: '0' as never, section: 'identity' }, call()))
    .rejects.toThrow(/byte allowance/)
  await expect(tiny.products.browse({ ...browseInput('entities'), collection: 'entities', phase: 'terminated' }, call()))
    .rejects.toThrow(/byte allowance/)
})

it('does not order an operation without its retained accepted parent decision', async () => {
  const h = await worldFixture()
  Object.assign(h.state.operations, { orphan: operation('orphan') })
  await expect(h.products.browse({ ...browseInput('operations'), collection: 'operations' }, call())).rejects.toThrow(/parent decision/)
})

it('reads local effects without transport attempts and unfinished inference without inventing completion', async () => {
  const h = await worldFixture()
  Object.assign(h.state.decisions, { low: decision('low', '1'), high: { ...decision('high', '9007199254740993'),
    inference: { startedAt: 10, deadline: 20 }, context: { status: 'prepared', maxBytes: 1000, retainedBytes: 10,
      view: { sources: [], content: [] } } } })
  Object.assign(h.state.operations, { local: { ...operation('local', 'low'), action: { kind: 'resource/revoke-grant', id: 'grant', expectedRevision: 1 },
    status: 'applied', result: { operationId: 'local', status: 'applied', sequence: 1, time: '0', code: 'SIM_APPLIED' } },
  task: { ...operation('task', 'high'), action: { kind: 'task/create' } } })
  expect((await h.products.browse({ ...browseInput('decisions'), collection: 'decisions' }, call())).items.map(row => row.id)).toEqual(['low', 'high'])
  expect((await h.products.browse({ ...browseInput('operations'), collection: 'operations', status: 'applied' }, call())).total).toBe(1)
  const pending = await h.products.browse({ ...browseInput('operations'), collection: 'operations', status: 'pending' }, call())
  expect(pending.items).toMatchObject([{ id: 'task', task: 'pending' }])
  const local = await h.products.inspectObject({ runId: registration().id, collection: 'operations', id: 'local' as never, section: 'execution' }, call())
  expect(local.value).toMatchObject({ result: { status: 'applied', code: { text: 'SIM_APPLIED', truncated: false } } })
  const attempts = await h.products.inspectObject({ runId: registration().id, collection: 'operations', id: 'local' as never, section: 'attempts' }, call())
  expect(attempts.value).toMatchObject({ attempts: { items: [], total: 0 } })
  const inference = await h.products.inspectObject({ runId: registration().id, collection: 'decisions', id: 'high' as never, section: 'execution' }, call())
  expect(inference.value).toMatchObject({ inference: { startedAt: 10, deadline: 20 }, context: { knowledgeCount: 0 } })
  const entities = { a: { id: 'a', kind: 'org', cognition: 'none', phase: 'active', revision: 1, profileRevision: 1, profile: {} },
    z: { id: 'z', kind: 'org', cognition: 'none', phase: 'active', revision: 1, profileRevision: 1, profile: {} } }
  Object.assign(h.state.entities, entities)
  expect((await h.products.browse({ ...browseInput('entities'), collection: 'entities' }, call())).items.map(row => row.id)).toEqual(['a', 'z'])
})

it('rejects invalid wire filters, actor fields, precise-decimal violations and mismatched detail identities', () => {
  for (const input of [{ ...browseInput('entities'), status: 'open' }, { ...browseInput('decisions'), status: 'applied' },
    { ...browseInput('operations'), principalId: 'reader' }, { ...browseInput('checkpoints'), limit: 0 }]) {
    expect(() => simulationProductBrowseInputSchema.parse(input)).toThrow()
  }
  for (const input of [{ ...browseInput('entities'), id: 'actor', section: 'execution' },
    { ...browseInput('decisions'), id: 'first', section: 'execution', cursor: 'unrelated' },
    { ...browseInput('operations'), id: 'effect', section: 'attempts', expectedRevision: -1 },
    { ...browseInput('checkpoints'), id: 'complete', section: 'references', source: 'admin' }]) {
    expect(() => simulationProductObjectInputSchema.parse(input)).toThrow()
  }
  const summary = { id: 'actor', kind: { text: 'org', truncated: false }, cognition: 'none', phase: 'active', writer: 'none' }
  const base = { runId: 'public-run', snapshotRevision: 1, observedAt: 0, status: 'found',
    selection: { collection: 'entities', id: 'actor', section: 'identity' } }
  const value = { collection: 'entities', id: 'actor', section: 'identity', summary, revision: 1, profileRevision: 1 }
  expect(simulationProductObjectInspectionSchema.parse({ ...base, value }).status).toBe('found')
  for (const input of [{ ...base }, { ...base, status: 'missing', value }, { ...base, value: { ...value, id: 'other' } },
    { ...base, value: { ...value, summary: { ...summary, id: 'other' } } },
    { ...base, value: { ...value, profile: { secret: 'private' } } },
    { ...base, value: { ...value, writerEpoch: '01' } }]) {
    expect(() => simulationProductObjectInspectionSchema.parse(input)).toThrow()
  }
  expect(() => simulationProductCollectionPageSchema.parse({ runId: 'public-run', snapshotRevision: 1, observedAt: 0,
    collection: 'entities', items: [summary], total: 0 })).toThrow()
})
