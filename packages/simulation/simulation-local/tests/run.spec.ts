import { simulationTemp } from './temp.ts'
import { simulationEventSlotSchema } from '@clocky/clocky-simulation'
import { simulationDecisionSlotSchema } from '@clocky/clocky-simulation'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { simulationRunSelectionSchema, parseSimTime, simTimeSchema } from '@clocky/clocky-simulation'
import { LocalSimulationProvider } from '../src/index.ts'
import { foldEntry, foldEntries, SIMULATION_JOURNAL_VERSION } from '../src/journal.ts'
import { LocalSimulationRun } from '../src/run.ts'
import type { LogStream } from '@clocky/clocky-storage'

const roots: string[] = []
const providers: LocalSimulationProvider[] = []
afterEach(async () => {
  await Promise.all(providers.splice(0).map(provider => provider.close()))
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})
const spec = simulationRunSelectionSchema.parse({ provider: 'local', mode: 'create', spec: {
  runId: 'supply', tickUnit: 'minute', origin: '0', maxTime: '100000000000000000000',
  rulesVersion: '1', policyVersion: '1', outboxMaxAttempts: 3, outboxRetryDelayMs: 10, maxDriveSteps: 16, maxMicrostepsPerTime: 32, phaseOrder: ['delivery', 'decision', 'deadline'], decisionTimeoutMs: 60000, maxConflictRetries: 2, maxIngressBytes: 65536, maxEntities: 1000, maxResidentActors: 16, maxTokensPerInterval: 1000000, tokensPerModelRequest: 10000, budgetInterval: '100', maxDecisionsPerInterval: 1000, maxMessagesPerInterval: 1000, maxPendingEvents: 1000, maxPendingInteractions: 1000, maxKnowledgeBytes: 65536, maxKnowledgePerQuery: 32, maxQueuedDecisions: 1000, maxDispatchWaitRounds: 8, maxDecisionsPerWindow: 16, maxOperationsPerDecision: 16, maxResourceQuantity: '1000000000000000000000000', relationRules: [],
} }).spec
function selection(mode: 'create' | 'open' = 'create') {
  return simulationRunSelectionSchema.parse({ provider: 'local', mode, spec })
}
async function setup(backend: 'json' | 'sqlite', root?: string) {
  const directory = root ?? await simulationTemp('run')
  if (root === undefined) roots.push(directory)
  const committed = vi.fn()
  const provider = new LocalSimulationProvider({ name: 'local', root: directory, backend, replayPageSize: 1 }, committed)
  providers.push(provider)
  return { provider, committed, directory }
}

describe.each(['json', 'sqlite'] as const)('%s durable run', (backend) => {
  it('reopens exactly the committed projection and rejects duplicate owners', async () => {
    const { provider, directory, committed } = await setup(backend)
    const run = await provider.open(selection())
    expect(run.snapshot()).toEqual({ spec, revision: 0, phase: 'paused', entities: {}, relations: {}, time: simTimeSchema.parse('0'), nextDecisionSlot: simulationDecisionSlotSchema.parse('0'), decisions: {}, operations: {}, resources: {}, grants: {}, interactions: {}, commitments: {}, nextEventSlot: simulationEventSlotSchema.parse('0'), scheduledEvents: {}, wakes: {} })
    await expect(provider.open(selection('open'))).rejects.toThrow(/coordinator/)
    const second = await setup(backend, directory)
    await expect(second.provider.open(selection('open'))).rejects.toThrow(/coordinator/)
    const accepted = run.setPhase('running', 0)
    const stale = run.setPhase('paused', 0)
    await expect(accepted).resolves.toMatchObject({ revision: 1, phase: 'running' })
    await expect(stale).rejects.toThrow(/revision conflict/)
    await expect(run.setPhase('running', 1)).resolves.toMatchObject({ revision: 1 })
    const expected = run.snapshot()
    Reflect.set(expected.spec, 'tickUnit', 'mutated')
    expect(run.snapshot().spec.tickUnit).toBe('minute')
    const pending = run.setPhase('paused', 1)
    const closing = run.close()
    await expect(run.setPhase('running', 2)).rejects.toThrow(/closed/)
    await pending
    await closing
    await run.close()
    const reopened = await second.provider.open(selection('open'))
    expect(reopened.snapshot()).toEqual({ spec, revision: 2, phase: 'paused', entities: {}, relations: {}, time: simTimeSchema.parse('0'), nextDecisionSlot: simulationDecisionSlotSchema.parse('0'), decisions: {}, operations: {}, resources: {}, grants: {}, interactions: {}, commitments: {}, nextEventSlot: simulationEventSlotSchema.parse('0'), scheduledEvents: {}, wakes: {} })
    expect(committed.mock.calls.map((call): unknown => call[1])).toEqual([0, 1, 2])
  })

  it('rejects missing, duplicate, changed configuration and changed backend', async () => {
    const { provider, directory } = await setup(backend)
    await expect(provider.open(selection('open'))).rejects.toThrow(/does not exist/)
    const run = await provider.open(selection())
    await run.close()
    await expect(provider.open(selection())).rejects.toThrow(/already exists/)
    const changed = selection('open')
    Reflect.set(changed.spec, 'policyVersion', '2')
    await expect(provider.open(changed)).rejects.toThrow(/configuration/)
    const other = await setup(backend === 'json' ? 'sqlite' : 'json', directory)
    await expect(other.provider.open(selection('open'))).rejects.toThrow(/backend/)
    await expect(provider.open({ ...selection('open'), provider: 'other' })).rejects.toThrow(/selection mismatch/)
    await provider.close()
    await expect(provider.open(selection('open'))).rejects.toThrow(/closed/)
  })

  it('drains an open admitted before provider disposal', async () => {
    const { provider, directory } = await setup(backend)
    const opening = provider.open(selection())
    await provider.close()
    const run = await opening
    await expect(run.setPhase('running', 0)).rejects.toThrow(/closed/)
    const second = await setup(backend, directory)
    const recovered = await second.provider.open(selection('open'))
    expect(recovered.snapshot().revision).toBe(0)
  })
})

it.each(['00', '01', '-1', '1.0', '1e2', '', ' 1', '1\n', 1, null])('rejects noncanonical time %j', (value) => {
  expect(() => parseSimTime(value, simTimeSchema.parse('100'))).toThrow()
})
it('preserves large integer time precision and enforces the configured range', () => {
  expect(parseSimTime('9007199254740993', simTimeSchema.parse('9007199254740993'))).toBe('9007199254740993')
  expect(() => parseSimTime('10', simTimeSchema.parse('9'))).toThrow(/maximum/)
})
it('rejects missing prefix, wrong record kind, unknown fields and repeated phase on replay', () => {
  const parsed = selection().spec
  const created = { kind: 'run/created', spec, backend: 'json' }
  expect(() => foldEntry(undefined, { sequence: 1, value: created }, parsed, 'json')).toThrow(/prefix/)
  expect(() => foldEntry(undefined, { sequence: 0, value: created }, parsed, 'sqlite')).toThrow(/configuration/)
  expect(() => foldEntry(undefined, { sequence: 0, value: { ...created, extra: 1 } }, parsed, 'json')).toThrow()
  const state = foldEntry(undefined, { sequence: 0, value: created }, parsed, 'json')
  expect(() => foldEntry(state, { sequence: 1, value: created }, parsed, 'json')).toThrow()
  for (const fields of [{ runId: 'other', expectedRevision: 0 }, { runId: spec.runId, expectedRevision: 99 }]) {
    expect(() => foldEntry(state, { sequence: 1, value: { kind: 'run/phase', ...fields, phase: 'running' } }, parsed, 'json')).toThrow(/causal revision/)
  }
  expect(() => foldEntry(state, { sequence: 1, value: { kind: 'run/phase', runId: spec.runId, expectedRevision: 0, phase: 'paused' } }, parsed, 'json')).toThrow(/repeats/)
})
it('keeps failed writes invisible and permits cleanup retry without reopening admission', async () => {
  const state = { spec: selection().spec, revision: 0, phase: 'paused' as const, entities: {}, relations: {}, time: simTimeSchema.parse('0'), nextDecisionSlot: simulationDecisionSlotSchema.parse('0'), decisions: {}, operations: {}, resources: {}, grants: {}, interactions: {}, commitments: {}, nextEventSlot: simulationEventSlotSchema.parse('0'), scheduledEvents: {}, wakes: {} }
  const append = vi.fn().mockRejectedValueOnce(new Error('disk')).mockResolvedValue({ tailSequence: 1 })
  const release = vi.fn().mockRejectedValueOnce(new Error('close')).mockResolvedValue(undefined)
  const committed = vi.fn()
  // Only storage durability is fault-injected; the run serializer and fold are real.
  const run = new LocalSimulationRun({ append } as unknown as LogStream, state, 'json', release, committed)
  await expect(run.setPhase('running', 0)).rejects.toThrow('disk')
  expect(run.snapshot()).toEqual(state)
  expect(committed).not.toHaveBeenCalled()
  await run.setPhase('running', 0)
  await expect(run.close()).rejects.toThrow('close')
  await run.close()
  expect(release).toHaveBeenCalledTimes(2)
})

it.each(['json', 'sqlite'] as const)('rejects %s malformed and unsupported durable history', async (backend) => {
  const { createHash } = await import('node:crypto')
  const { JsonStorageBackend } = await import('@clocky/clocky-storage-json')
  const { SqliteStorageBackend } = await import('@clocky/clocky-storage-sqlite')
  const { provider, directory } = await setup(backend)
  const run = await provider.open(selection())
  await run.close()
  const runRoot = join(directory, createHash('sha256').update(spec.runId).digest('hex'))
  const medium = backend === 'json'
    ? new JsonStorageBackend(join(runRoot, 'journal'))
    : new SqliteStorageBackend({ path: join(runRoot, 'journal.sqlite') })
  const stream = await medium.log.open({ name: 'simulation', version: SIMULATION_JOURNAL_VERSION })
  await stream.append(0, [{ kind: 'run/phase', runId: spec.runId, expectedRevision: 0, phase: 'invalid' }])
  await medium.close()
  await expect(provider.open(selection('open'))).rejects.toThrow()
  for (const version of [0, 1, 2, 3, 4, 11, 12, 13, 14, 15, 16, 17, 34, 35, 99]) {
    const missing = selection('open')
    Reflect.set(missing.spec, 'runId', `new-format-${version}`)
    const badRoot = join(directory, createHash('sha256').update(`new-format-${version}`).digest('hex'))
    const wrong = backend === 'json'
      ? new JsonStorageBackend(join(badRoot, 'journal'))
      : new SqliteStorageBackend({ path: join(badRoot, 'journal.sqlite') })
    const unknown = await wrong.log.open({ name: 'simulation', version })
    await unknown.append(-1, [{ kind: 'run/created', spec: missing.spec, backend }])
    await wrong.close()
    await expect(provider.open(missing)).rejects.toThrow(/version/)
  }
})

it.each(['json', 'sqlite'] as const)('refuses %s history after destructive prefix compaction', async (backend) => {
  const { createHash } = await import('node:crypto')
  const { JsonStorageBackend } = await import('@clocky/clocky-storage-json')
  const { SqliteStorageBackend } = await import('@clocky/clocky-storage-sqlite')
  const { provider, directory } = await setup(backend)
  const run = await provider.open(selection())
  await run.setPhase('running', 0)
  await run.setPhase('paused', 1)
  await run.close()
  const runRoot = join(directory, createHash('sha256').update(spec.runId).digest('hex'))
  const medium = backend === 'json' ? new JsonStorageBackend(join(runRoot, 'journal'))
    : new SqliteStorageBackend({ path: join(runRoot, 'journal.sqlite') })
  const stream = await medium.log.open({ name: 'simulation', version: SIMULATION_JOURNAL_VERSION })
  await stream.writeCheckpoint({ sequence: 2, value: {} })
  await stream.compact({ throughSequence: 0, expectedCheckpointSequence: 2 })
  await medium.close()
  await expect(provider.inspect({ provider: 'local', spec })).rejects.toThrow(/complete retained history/)
  await expect(provider.open(selection('open'))).rejects.toThrow(/prefix/)
})

it('does not publish a phase when the actual SQLite tail has advanced', async () => {
  const { createHash } = await import('node:crypto')
  const { SqliteStorageBackend } = await import('@clocky/clocky-storage-sqlite')
  const { provider, directory, committed } = await setup('sqlite')
  const run = await provider.open(selection())
  const runRoot = join(directory, createHash('sha256').update(spec.runId).digest('hex'))
  // A direct Storage writer bypasses coordinator ownership to inject an observed-tail conflict.
  const competing = new SqliteStorageBackend({ path: join(runRoot, 'journal.sqlite') })
  try {
    const stream = await competing.log.open({ name: 'simulation', version: SIMULATION_JOURNAL_VERSION })
    await stream.append(0, [{ kind: 'run/phase', runId: spec.runId, expectedRevision: 0, phase: 'running' }])
    await expect(run.setPhase('running', 0)).rejects.toThrow(/sequence|tail/i)
    expect(run.snapshot().revision).toBe(0)
    expect(committed).toHaveBeenCalledTimes(1)
  } finally {
    await competing.close()
  }
  const firstClose = provider.close()
  expect(provider.close()).toBe(firstClose)
  await firstClose
})

it('folds entity batches identically without mutating earlier projections on success or refusal', () => {
  const parsed = selection().spec
  const initial = foldEntry(undefined, { sequence: 0, value: { kind: 'run/created', spec: parsed, backend: 'json' } }, parsed, 'json')
  const commands = [
    { kind: 'entity/create', id: 'one', entityKind: 'person', cognition: 'none', profile: { value: 0 } },
    { kind: 'entity/profile', id: 'one', entityRevision: 1, profile: { value: 1 } },
    { kind: 'entity/profile', id: 'one', entityRevision: 2, profile: { value: 2 } },
  ]
  const entries = commands.map((command, index) => ({ sequence: index + 1,
    value: { kind: 'run/change', runId: parsed.runId, expectedRevision: index, command } }))
  const before = structuredClone(initial)
  const expected = entries.reduce((state, entry) => foldEntry(state, entry, parsed, 'json'), initial)
  const actual = foldEntries(initial, entries, parsed, 'json')
  expect(actual).toEqual(expected)
  expect(initial).toEqual(before)
  expect(foldEntries(initial, [], parsed, 'json')).toBe(initial)
  const retained = structuredClone(actual)
  const more = { sequence: 4, value: { kind: 'run/change', runId: parsed.runId, expectedRevision: 3,
    command: { kind: 'entity/profile', id: 'one', entityRevision: 3, profile: { value: 3 } } } }
  const invalid = { sequence: 5, value: { ...more.value, expectedRevision: 4 } }
  expect(() => foldEntries(actual, [more, invalid], parsed, 'json')).toThrow(/entity revision conflict/)
  expect(actual).toEqual(retained)
  const phase = { sequence: 5, value: { kind: 'run/phase', runId: parsed.runId, expectedRevision: 4, phase: 'running' } }
  const last = { sequence: 6, value: { ...more.value, expectedRevision: 5,
    command: { ...more.value.command, entityRevision: 4, profile: { value: 4 } } } }
  expect(foldEntries(actual, [more, phase, last], parsed, 'json'))
    .toEqual([more, phase, last].reduce((state, entry) => foldEntry(state, entry, parsed, 'json'), actual))
  expect(actual).toEqual(retained)
  expect(() => foldEntries(initial, [{ ...entries[0]!, sequence: 2 }], parsed, 'json')).toThrow(/noncontiguous/)
  expect(() => foldEntries(initial, [{ ...entries[0]!, value: { ...entries[0]!.value, extra: true } }], parsed, 'json')).toThrow()
})
