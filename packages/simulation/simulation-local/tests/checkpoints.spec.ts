import { describe, expect, it, vi } from 'vitest'
import { checkpointState, simulationCheckpointManifestSchema, simulationCheckpointRequestSchema, simulationIngressRequestSchema } from '@clocky/clocky-simulation'
import type { SimulationCheckpointCut, SimulationCheckpointRequest } from '@clocky/clocky-simulation'
import type { LogStream } from '@clocky/clocky-storage'
import { createBusinessHarness } from './business-harness.ts'

const request = (id: string) => simulationCheckpointRequestSchema.parse({ id, implementationVersion: 'fixture-1', maxDrainRounds: 4, maxAttempts: 3 })
function manifest(cut: SimulationCheckpointCut, command: SimulationCheckpointRequest) {
  return simulationCheckpointManifestSchema.parse({ version: 2, id: command.id, implementationVersion: command.implementationVersion,
    rulesVersion: cut.snapshot.spec.rulesVersion, policyVersion: cut.snapshot.spec.policyVersion, rng: { kind: 'none' }, run: cut.reference,
    team: { owner: { kind: 'team', teamId: 'company' }, stream: { name: 'team/company', version: 35 }, cursor: 0,
      firstSequence: 0, retention: 'full', projectionVersion: 35, fingerprint: `sha256:${'0'.repeat(64)}` },
    channels: [], sessions: [], state: checkpointState(cut.snapshot) })
}

describe.each(['json', 'sqlite'] as const)('%s checkpoint publication', (backend) => {
  it.each(['binding', 'reservation', 'publication'] as const)('retains the checkpoint Team before any entity binding through %s', async (action) => {
    const h = await createBusinessHarness(backend)
    try {
      const first = request('canonical-first')
      await h.run.beginCheckpoint(first)
      const cut = await h.run.acquireCheckpointCut(4)
      try { await cut.publish(manifest(cut, first)) }
      finally { cut.release() }
      const before = h.run.snapshot()
      if (action === 'binding') {
        const { simulationChangeSchema, simulationEntityIdSchema, simulationEntityBindingSchema } = await import('@clocky/clocky-simulation')
        const id = simulationEntityIdSchema.parse('new-actor')
        await h.run.change(simulationChangeSchema.parse({ kind: 'entity/create', id, entityKind: 'person', cognition: 'agent', profile: {} }), before.revision)
        await expect(h.run.bindEntity(id, simulationEntityBindingSchema.parse({ teamId: 'foreign', participantId: 'actor', sessionId: 'session' }),
          h.run.snapshot().revision)).rejects.toThrow(/canonical Team/)
        expect(h.run.snapshot().entities[id]?.binding).toBeUndefined()
      } else if (action === 'reservation') {
        await expect(h.run.reserveTeam({ goal: { objective: 'Another Team', budgets: {} }, budgets: {},
          rules: { simulationRunId: before.spec.runId, activationLifecycleOwner: 'simulation/foreign' } }, before.revision))
          .rejects.toThrow(/canonical Team/)
        expect(h.run.snapshot()).toEqual(before)
      } else {
        const second = request('canonical-second')
        await h.run.beginCheckpoint(second)
        const next = await h.run.acquireCheckpointCut(4)
        try {
          const value = manifest(next, second)
          const foreign = simulationCheckpointManifestSchema.parse({ ...value, team: { ...value.team,
            owner: { kind: 'team', teamId: 'foreign' }, stream: { ...value.team.stream, name: 'team/foreign' } } })
          await expect(next.publish(foreign)).rejects.toThrow(/canonical Team/)
          expect(h.run.snapshot().latestCheckpointId).toBe(first.id)
        } finally { next.release() }
      }
    } finally { await h.close() }
  })

  it.each([false, true])('publishes only the confirmed reserved Team before binding entities (confirmed=%s)', async (confirmed) => {
    const h = await createBusinessHarness(backend)
    try {
      await h.run.setPhase('paused', h.run.snapshot().revision)
      const reserved = await h.run.reserveTeam({ goal: { objective: 'Canonical owner', budgets: {} }, budgets: {},
        rules: { simulationRunId: h.selection.spec.runId, activationLifecycleOwner: 'simulation/canonical' } }, h.run.snapshot().revision)
      const teamId = reserved.teamReservation!.teamId
      if (confirmed) await h.run.confirmTeam(teamId, h.run.snapshot().revision)
      const command = request('reserved-cut')
      await h.run.beginCheckpoint(command)
      const cut = await h.run.acquireCheckpointCut(4)
      try {
        const wrong = manifest(cut, command)
        const matching = simulationCheckpointManifestSchema.parse({ ...wrong, team: { ...wrong.team,
          owner: { kind: 'team', teamId }, stream: { ...wrong.team.stream, name: `team/${teamId}` } } })
        if (!confirmed) await expect(cut.publish(matching)).rejects.toThrow(/quiescent run prefix/)
        else {
          await expect(cut.publish(wrong)).rejects.toThrow(/canonical Team/)
          expect((await cut.publish(matching)).status).toBe('completed')
        }
      } finally { cut.release() }
    } finally { await h.close() }
  })

  it('retains a pending request across restart and blocks resume and new external input', async () => {
    const h = await createBusinessHarness(backend)
    try {
      const actor = await h.actor('a')
      const command = request('pending')
      const started = await h.run.beginCheckpoint(command)
      expect(h.run.snapshot().phase).toBe('paused')
      await expect(h.run.setPhase('running', h.run.snapshot().revision)).rejects.toThrow(/checkpoint request must finish/)
      await expect(h.run.ingest(simulationIngressRequestSchema.parse({ id: 'input', entityId: actor.id,
        text: 'After request', source: 'test', availableAt: '0' }))).rejects.toThrow(/blocks new external input/)
      await expect(h.run.beginCheckpoint({ ...command, implementationVersion: 'changed' })).rejects.toThrow(/changed its request/)
      await actor.lease.revoke(); await actor.lease.release(); await h.run.close()
      const restored = await h.provider.open({ ...h.selection, mode: 'open' })
      try {
        expect(await restored.beginCheckpoint(command)).toEqual(started)
        await restored.failCheckpoint(command.id, 'Cancelled by operator')
        await restored.setPhase('running', restored.snapshot().revision)
      } finally { await restored.close() }
    } finally { await h.close() }
  })

  it('rejects a mismatched responsibility list and replays the exact completed manifest', async () => {
    const h = await createBusinessHarness(backend)
    try {
      const command = request('complete')
      await h.run.beginCheckpoint(command)
      const cut = await h.run.acquireCheckpointCut(4)
      const value = manifest(cut, command)
      let result
      try {
        await expect(cut.publish({ ...value, run: { ...value.run, cursor: value.run.cursor + 1 } }))
          .rejects.toThrow(/changed its run cut/)
        const invalid = simulationCheckpointManifestSchema.parse({ ...value, state: { ...value.state, pendingEvents: ['missing-event'] } })
        await expect(cut.publish(invalid)).rejects.toThrow(/run prefix/)
        expect(h.run.snapshot().latestCheckpointId).toBeUndefined()
        result = await cut.publish(value)
        expect(await cut.publish(value)).toEqual(result)
        await expect(cut.publish({ ...value, implementationVersion: 'changed' })).rejects.toThrow(/retry changed its manifest/)
      } finally { cut.release() }
      await expect(cut.publish(value)).rejects.toThrow(/live sealed cut/)
      await h.run.close()
      const restored = await h.provider.open({ ...h.selection, mode: 'open' })
      try {
        expect(restored.snapshot().checkpoints?.[command.id]).toEqual(result)
        expect(restored.snapshot().latestCheckpointId).toBe(command.id)
      } finally { await restored.close() }
    } finally { await h.close() }
  })

  it('keeps the write barrier until an admitted publication finishes after release is requested', async () => {
    const h = await createBusinessHarness(backend)
    try {
      const command = request('release-during-publication')
      await h.run.beginCheckpoint(command)
      const cut = await h.run.acquireCheckpointCut(4)
      const stream = (h.run as unknown as { stream: LogStream }).stream
      const append = stream.append.bind(stream)
      const entered = Promise.withResolvers<undefined>(), release = Promise.withResolvers<undefined>()
      const held = vi.spyOn(stream, 'append').mockImplementationOnce(async (...args) => {
        entered.resolve(undefined)
        await release.promise
        return await append(...args)
      })
      const publication = cut.publish(manifest(cut, command))
      await entered.promise
      cut.release()
      try { await expect(h.run.setPhase('running', h.run.snapshot().revision)).rejects.toThrow(/blocks new writes/) }
      finally { release.resolve(undefined) }
      expect((await publication).status).toBe('completed')
      held.mockRestore()
      await h.run.setPhase('running', h.run.snapshot().revision)
    } finally { await h.close() }
  })

  it('rejects a manifest that labels an executed canonical Session as unmaterialized', async () => {
    const h = await createBusinessHarness(backend)
    try {
      const actor = await h.actor('a')
      await actor.lease.revoke(); await actor.lease.release()
      const command = request('missing-execution-history')
      await h.run.beginCheckpoint(command)
      const cut = await h.run.acquireCheckpointCut(4)
      try {
        const binding = cut.snapshot.entities[actor.id]!.binding!
        const forged = simulationCheckpointManifestSchema.parse({ ...manifest(cut, command),
          sessions: [{ kind: 'unmaterialized', ...binding }] })
        await expect(cut.publish(forged)).rejects.toThrow(/cannot omit an executed Session/)
        expect(h.run.snapshot().latestCheckpointId).toBeUndefined()
      } finally { cut.release() }
    } finally { await h.close() }
  })

  it('refuses a persisted manifest naming another stream before exposing a reopened run', async () => {
    const h = await createBusinessHarness(backend)
    try {
      const command = request('wrong-stream')
      await h.run.beginCheckpoint(command)
      const cut = await h.run.acquireCheckpointCut(4)
      const stream = (h.run as unknown as { stream: LogStream }).stream
      const append = stream.append.bind(stream)
      const { jsonValueSchema } = await import('@clocky/clocky-team')
      const corrupt = vi.spyOn(stream, 'append').mockImplementationOnce((cursor, values, options) =>
        append(cursor, values.map(value => jsonValueSchema.parse(JSON.parse(JSON.stringify(value)
          .replace('"name":"simulation"', '"name":"another-run"')))), options))
      try { await cut.publish(manifest(cut, command)) }
      finally { corrupt.mockRestore(); cut.release() }
      await h.run.close()
      await expect(h.provider.open({ ...h.selection, mode: 'open' })).rejects.toThrow(/names another run journal/)
    } finally { await h.close() }
  })

  it('leaves a failed atomic publication pending and permits the same request to complete after reopen', async () => {
    const h = await createBusinessHarness(backend)
    try {
      const command = request('retry-publication')
      await h.run.beginCheckpoint(command)
      const cut = await h.run.acquireCheckpointCut(4)
      const value = manifest(cut, command)
      const stream = (h.run as unknown as { stream: LogStream }).stream
      const fault = vi.spyOn(stream, 'append').mockRejectedValueOnce(new Error('Publication failed'))
      await expect(cut.publish(value)).rejects.toThrow(/Publication failed/)
      fault.mockRestore(); cut.release()
      expect(h.run.snapshot().checkpoints?.[command.id]?.status).toBe('in-progress')
      expect(h.run.snapshot().latestCheckpointId).toBeUndefined()
      await h.run.close()
      const restored = await h.provider.open({ ...h.selection, mode: 'open' })
      try {
        const retry = await restored.acquireCheckpointCut(4)
        try { expect((await retry.publish(value)).status).toBe('completed') }
        finally { retry.release() }
      } finally { await restored.close() }
    } finally { await h.close() }
  })
})

it.each(['json', 'sqlite'] as const)('%s rejects incomplete or substituted canonical references and retains the prior checkpoint', async (backend) => {
  const h = await createBusinessHarness(backend)
  try {
    const a = await h.actor('a'), z = await h.actor('z')
    for (const actor of [a, z]) { await actor.lease.revoke(); await actor.lease.release() }
    const command = request('owners')
    await h.run.beginCheckpoint(command)
    const cut = await h.run.acquireCheckpointCut(4)
    try {
      const sessions = [a, z].map(actor => ({ kind: 'materialized', ...cut.snapshot.entities[actor.id]!.binding!,
        formatVersion: 0, sequence: -1, revision: 'fixture', fingerprint: `sha256:${'0'.repeat(64)}`, retention: 'full' }))
      const valid = simulationCheckpointManifestSchema.parse({ ...manifest(cut, command), sessions })
      const channel = { ...valid.team, owner: { kind: 'channel', channelId: 'channel' } }
      for (const changed of [
        { ...valid, sessions: [] }, { ...valid, sessions: [sessions[0], sessions[0]] },
        { ...valid, sessions: [{ ...sessions[0], teamId: 'foreign' }, sessions[1]] },
        { ...valid, sessions: [{ ...sessions[0], participantId: 'foreign' }, sessions[1]] },
        { ...valid, channels: [channel, channel] },
      ]) {
        await expect(cut.publish(simulationCheckpointManifestSchema.parse(changed))).rejects.toThrow(/canonical owner references/)
        expect(h.run.snapshot().latestCheckpointId).toBeUndefined()
      }
      expect((await cut.publish(valid)).status).toBe('completed')
    } finally { cut.release() }
    const second = request('second')
    await h.run.beginCheckpoint(second)
    const next = await h.run.acquireCheckpointCut(4)
    try {
      await expect(next.publish(manifest(next, second))).rejects.toThrow(/canonical owner references/)
      expect(h.run.snapshot().latestCheckpointId).toBe(command.id)
    } finally { next.release() }
  } finally { await h.close() }
})

it('rejects overlapping requests and outcomes that have no pending checkpoint', async () => {
  const h = await createBusinessHarness('sqlite')
  try {
    const { foldCheckpoint } = await import('../src/checkpoints.ts')
    const { foldManagement } = await import('../src/management.ts')
    const { simulationPhaseManagementRequestSchema } = await import('@clocky/clocky-simulation')
    const command = request('pending')
    const before = h.run.snapshot()
    expect(() => foldCheckpoint(before, { kind: 'checkpoint/failed', id: command.id, error: 'Unknown' }, before.revision + 1))
      .toThrow(/no pending request/)
    const pending = foldCheckpoint(before, { kind: 'checkpoint/requested', request: command }, before.revision + 1)
    expect(() => foldCheckpoint(pending, { kind: 'checkpoint/requested', request: command }, pending.revision + 1)).toThrow(/already exists/)
    expect(() => foldCheckpoint(pending, { kind: 'checkpoint/requested', request: request('other') }, pending.revision + 1)).toThrow(/another checkpoint/)
    const paused = foldManagement(before, { kind: 'management/started', request: simulationPhaseManagementRequestSchema.parse({ id: 'pause', phase: 'paused' }) }, before.revision + 1)
    expect(() => foldCheckpoint(paused, { kind: 'checkpoint/requested', request: command }, paused.revision + 1)).toThrow(/pending/)
    await h.run.beginCheckpoint(command)
    await expect(h.run.managePhase(simulationPhaseManagementRequestSchema.parse({ id: 'resume', phase: 'running' }))).rejects.toThrow(/another request is pending/)
    const failed = await h.run.failCheckpoint(command.id, 'Operator cancelled')
    expect(await h.run.failCheckpoint(command.id, 'A later attempt')).toEqual(failed)
    const state = h.run.snapshot()
    expect(() => foldCheckpoint(state, { kind: 'checkpoint/failed', id: command.id, error: 'Changed' }, state.revision + 1)).toThrow(/no pending/)
  } finally { await h.close() }
})

it.each(['json', 'sqlite'] as const)('%s retains exact context versions, pending inputs and operations in a complete checkpoint', async (backend) => {
  const h = await createBusinessHarness(backend)
  try {
    const z = await h.actor('z'), a = await h.actor('a')
    const { simulationWakeRequestSchema, simulationDecisionIdSchema, simulationProposalSchema, simTimeSchema } = await import('@clocky/clocky-simulation')
    const { contextRequest } = await import('./context-fixture.ts')
    const wake = simulationWakeRequestSchema.parse({ id: 'finished-wake', entityId: z.id, time: '0', reason: 'Complete this wake' })
    await h.run.scheduleWake(wake, h.run.snapshot().revision)
    await h.run.drive({ until: simTimeSchema.parse('0') })
    const first = simulationDecisionIdSchema.parse('first')
    await z.lease.openDecision(first, h.run.snapshot().revision, wake.id)
    await z.lease.prepareContext(first, { ...contextRequest(), personaVersion: 'persona-z', modelVersion: 'model-z' })
    expect(() => checkpointState(h.run.snapshot())).toThrow(/live writer/)
    await z.lease.submitDecision(first, [])
    const pendingWake = simulationWakeRequestSchema.parse({ id: 'pending-wake', entityId: a.id, time: '0', reason: 'Retain this wake' })
    await h.run.scheduleWake(pendingWake, h.run.snapshot().revision)
    await h.run.drive({ until: simTimeSchema.parse('0') })
    const second = simulationDecisionIdSchema.parse('second')
    await a.lease.openDecision(second, h.run.snapshot().revision)
    await a.lease.prepareContext(second, { ...contextRequest(), personaVersion: 'persona-a', modelVersion: 'model-a' })
    const accepted = await a.lease.submitDecision(second, [simulationProposalSchema.parse({ after: [], action: {
      kind: 'task/create', deliverAt: '5', task: { subject: 'Retain task intent', description: 'Dispatch after recovery', blockedBy: [],
        requiredCapabilities: [], priority: 0, readScopes: [], writeScopes: [], workspaceMode: 'shared', reviewPolicy: { kind: 'none' },
        budget: {}, maxAttempts: 1 },
    } })])
    const ingress = await h.run.ingest(simulationIngressRequestSchema.parse({ id: 'external', entityId: z.id,
      text: 'Future input', source: 'operator', availableAt: '5' }))
    for (const actor of [a, z]) { await actor.lease.revoke(); await actor.lease.release() }
    const command = request('responsibilities')
    await h.run.beginCheckpoint(command)
    const cut = await h.run.acquireCheckpointCut(4)
    let value
    try {
      value = simulationCheckpointManifestSchema.parse({ ...manifest(cut, command), sessions: [a, z].map(actor => ({
        kind: 'materialized', ...cut.snapshot.entities[actor.id]!.binding!, formatVersion: 0, sequence: -1,
        revision: 'fixture', fingerprint: `sha256:${'0'.repeat(64)}`, retention: 'full',
      })) })
      expect(value.state.contextVersions.personas).toEqual(['persona-a', 'persona-z'])
      expect(value.state.contextVersions.models).toEqual(['model-a', 'model-z'])
      expect(value.state.contextVersions.policies).toHaveLength(1)
      expect(value.state.nextIngressSlot).toBe('1')
      expect(value.state.nextDecisionSlot).toBe('2')
      expect(value.state.pendingOperations).toEqual(accepted.operationIds)
      expect(value.state.pendingEvents).toContain(ingress.eventId)
      expect(value.state.pendingEvents).toHaveLength(2)
      expect(value.state.pendingWakes).toEqual([pendingWake.id])
      expect(value.state.writers.map(writer => writer.entityId)).toEqual([a.id, z.id])
      expect((await cut.publish(value)).status).toBe('completed')
    } finally { cut.release() }
    await h.run.close()
    const restored = await h.provider.open({ ...h.selection, mode: 'open' })
    try {
      expect(checkpointState(restored.snapshot())).toEqual(value.state)
      expect(restored.snapshot().operations[accepted.operationIds[0]!]!.result).toBeUndefined()
      expect(restored.snapshot().ingresses?.[ingress.request.id]).toEqual(ingress)
    } finally { await restored.close() }
  } finally { await h.close() }
})
