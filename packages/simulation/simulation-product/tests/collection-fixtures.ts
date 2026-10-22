/** Valid native observations with private decoys exercise administrative projection independently of execution. */
import { afterEach } from 'vitest'
import { createBusinessHarness } from '../../simulation-local/tests/business-harness.ts'
import { simulationCheckpointManifestSchema } from '@clocky/clocky-simulation'
import type { SimulationSnapshot, SimulationDecision, SimulationOperation, SimulationCheckpointOperation } from '@clocky/clocky-simulation'
import { fixture, registration } from './fixtures.ts'

const cleanup: (() => Promise<void>)[] = []
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close() })

export async function worldFixture(options: Parameters<typeof fixture>[1] = {}) {
  const native = await createBusinessHarness('json')
  cleanup.push(native.close)
  const state = { ...native.run.snapshot() }
  const h = await fixture('json', options)
  h.inspect.mockImplementation(async () => ({ snapshot: structuredClone(state), owner: 'other-owner' }))
  const mounted = await h.mount()
  return { ...h, ...mounted, state, native }
}

export function decision(id: string, slot: string, entityId = 'actor'): SimulationDecision {
  return { id: id as never, entityId: entityId as never, epoch: '1' as never, slot: slot as never, snapshotRevision: 0,
    entityRevision: 1, time: '9007199254740993' as never, status: 'accepted', operationIds: [] }
}

export function operation(id: string, decisionId = 'first', index = 0): SimulationOperation {
  return { id: id as never, decisionId: decisionId as never, index, entityId: 'actor' as never,
    action: { kind: 'communication/post', recipient: 'recipient' as never, channelId: 'channel' as never,
      text: 'private-communication-text', deliverAt: '9007199254740993' as never },
    dependencies: [], fingerprint: 'private-fingerprint', status: 'pending' }
}

export function checkpoints(state: SimulationSnapshot): Record<string, SimulationCheckpointOperation> {
  const fingerprint = 'sha256:' + 'a'.repeat(64)
  const owner = { stream: { name: '/private/source', version: 38 }, cursor: 4, firstSequence: 0, retention: 'full', projectionVersion: 38, fingerprint }
  const manifest = simulationCheckpointManifestSchema.parse({ version: 8, id: 'complete', implementationVersion: '1',
    rulesVersion: '1', policyVersion: '1', rng: { kind: 'none' },
    run: { runId: state.spec.runId, backend: 'json', stream: { name: '/private/run', version: 36 }, cursor: 1, firstSequence: 0, retention: 'full',
      fingerprint },
    team: { ...owner, owner: { kind: 'team', teamId: 'team' } },
    channels: [{ ...owner, owner: { kind: 'channel', channelId: 'channel-z' } }, { ...owner, owner: { kind: 'channel', channelId: 'channel-a' } }],
    sessions: [{ kind: 'unmaterialized', sessionId: 'session-z', teamId: 'team', participantId: 'actor' },
      { kind: 'materialized', sessionId: 'session-a', teamId: 'team', participantId: 'actor', formatVersion: 0, sequence: -1,
        revision: 'private-revision', fingerprint, retention: 'full' }],
    state: { world: null, time: '9007199254740993', nextEventSlot: '0', nextDecisionSlot: '0', nextIngressSlot: '0', activeWindowId: null,
      contextVersions: { personas: [], models: [], policies: [] },
      pendingEvents: [], pendingOperations: [], pendingWakes: [], writers: [] },
  })
  const request = { id: 'complete' as never, implementationVersion: '1', maxDrainRounds: 1, maxAttempts: 1 }
  return { complete: { request, startedSequence: 2, status: 'completed', finishedSequence: 3, publishedAt: 100, manifest },
    progress: { request: { ...request, id: 'progress' as never }, startedSequence: 4, status: 'in-progress' },
    failed: { request: { ...request, id: 'failed' as never }, startedSequence: 5, status: 'failed', finishedSequence: 6, error: '/private/checkpoint-error' } }
}

export function browseInput(collection: 'entities' | 'decisions' | 'operations' | 'checkpoints') {
  return { runId: registration().id, collection }
}
