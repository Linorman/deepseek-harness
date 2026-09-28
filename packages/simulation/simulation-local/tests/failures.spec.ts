import { simulationTemp } from './temp.ts'
import { rm, stat } from 'node:fs/promises'
import { afterEach, expect, it, vi } from 'vitest'
import { SqliteStorageBackend } from '@clocky/clocky-storage-sqlite'
import { simulationRunSelectionSchema } from '@clocky/clocky-simulation'
import { LocalSimulationProvider } from '../src/index.ts'
import type { LogStream, LogStreamDescriptor } from '@clocky/clocky-storage'

vi.mock('node:fs/promises', async (original) => {
  const actual = await original<typeof import('node:fs/promises')>()
  return { ...actual, stat: vi.fn(actual.stat) }
})
afterEach(() => { vi.restoreAllMocks() })
const request = simulationRunSelectionSchema.parse({ provider: 'local', mode: 'create', spec: {
  runId: 'test', tickUnit: 'minute', origin: '0', maxTime: '100', rulesVersion: '1', policyVersion: '1', outboxMaxAttempts: 3, outboxRetryDelayMs: 10, maxDriveSteps: 16, maxMicrostepsPerTime: 32, phaseOrder: ['delivery', 'decision', 'deadline'], decisionTimeoutMs: 60000, maxConflictRetries: 2, maxIngressBytes: 65536, maxEntities: 1000, maxResidentActors: 16, maxTokensPerInterval: 1000000, tokensPerModelRequest: 10000, budgetInterval: '100', maxDecisionsPerInterval: 1000, maxMessagesPerInterval: 1000, maxPendingEvents: 1000, maxPendingInteractions: 1000, maxKnowledgeBytes: 65536, maxKnowledgePerQuery: 32, maxQueuedDecisions: 1000, maxDispatchWaitRounds: 8, maxDecisionsPerWindow: 16, maxOperationsPerDecision: 16, maxResourceQuantity: '1000000000000000000000000', relationRules: [],
} })

it('rejects a missing replay page and releases ownership for a corrected retry', async () => {
  const root = await simulationTemp('missing-replay-page')
  const provider = new LocalSimulationProvider({ name: 'local', root, backend: 'sqlite', replayPageSize: 1 }, () => {})
  try {
    const run = await provider.open(request)
    await run.setPhase('running', run.snapshot().revision)
    const expected = run.snapshot()
    await run.close()
    const prototype = SqliteStorageBackend.prototype as unknown as { openLog(descriptor: LogStreamDescriptor): Promise<LogStream> }
    // oxlint-disable-next-line typescript/unbound-method -- The fault wrapper calls this method with the original backend as its receiver.
    const open = prototype.openLog
    const fault = vi.spyOn(prototype, 'openLog').mockImplementationOnce(async function (this: SqliteStorageBackend, descriptor) {
      const stream = await open.call(this, descriptor)
      const read = stream.read.bind(stream)
      vi.spyOn(stream, 'read').mockImplementationOnce(read).mockResolvedValueOnce([])
      return stream
    })
    await expect(provider.open({ ...request, mode: 'open' })).rejects.toThrow(/suffix is incomplete/)
    fault.mockRestore()
    const reopened = await provider.open({ ...request, mode: 'open' })
    expect(reopened.snapshot()).toEqual(expected)
  } finally { await provider.close(); await rm(root, { recursive: true, force: true }) }
})

it('retains ownership across uncertain medium cleanup and retries it on provider close', async () => {
  const root = await simulationTemp('cleanup')
  const config = { name: 'local', root, backend: 'sqlite' as const, replayPageSize: 1 }
  const provider = new LocalSimulationProvider(config, () => {})
  const competitor = new LocalSimulationProvider(config, () => {})
  try {
    await provider.open(request)
    const close = vi.spyOn(SqliteStorageBackend.prototype, 'close')
    close.mockRejectedValueOnce(new Error('close failed'))
    await expect(provider.close()).rejects.toThrow(/cleanup failed/)
    await expect(competitor.open({ ...request, mode: 'open' })).rejects.toThrow(/coordinator/)
    close.mockRejectedValueOnce(new Error('retry failed'))
    await expect(provider.close()).rejects.toThrow(/cleanup failed/)
    await expect(competitor.open({ ...request, mode: 'open' })).rejects.toThrow(/coordinator/)
    await provider.close()
    await competitor.open({ ...request, mode: 'open' })
  } finally {
    await provider.close()
    await competitor.close()
    await rm(root, { recursive: true, force: true })
  }
})

it('propagates filesystem failures and releases a lock acquired before opening the journal', async () => {
  const root = await simulationTemp('stat')
  const provider = new LocalSimulationProvider({ name: 'local', root, backend: 'sqlite', replayPageSize: 1 }, () => {})
  try {
    vi.mocked(stat).mockRejectedValueOnce(Object.assign(new Error('read denied'), { code: 'EACCES' }))
    await expect(provider.open(request)).rejects.toThrow('read denied')
    await provider.open(request)
  } finally {
    await provider.close()
    await rm(root, { recursive: true, force: true })
  }
})

it('retains failed-open cleanup until a later provider close confirms medium release', async () => {
  const root = await simulationTemp('open-cleanup')
  const config = { name: 'local', root, backend: 'sqlite' as const, replayPageSize: 1 }
  const provider = new LocalSimulationProvider(config, () => {})
  const competitor = new LocalSimulationProvider(config, () => {})
  try {
    vi.spyOn(SqliteStorageBackend.prototype, 'close').mockRejectedValueOnce(new Error('cleanup uncertain'))
    await expect(provider.open({ ...request, mode: 'open' })).rejects.toThrow('cleanup uncertain')
    await expect(competitor.open(request)).rejects.toThrow(/coordinator/)
    await provider.close()
    await competitor.open(request)
  } finally {
    await provider.close(); await competitor.close()
    await rm(root, { recursive: true, force: true })
  }
})
