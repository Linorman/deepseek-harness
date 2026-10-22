/** Real Hub serializers hold every original personnel source until the Native-only callback settles. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { channelIdSchema, channelManifestSchema, channelRecordSchema, simulationPersonnelSettlementCutScopeSchema,
  teamSystemEnvelopePostScopeSchema, teamTaskCreateIdempotencyKeySchema, TeamRuntime } from '@clocky/clocky-team'
import type { Context } from '@clocky/cordis'
import type { SimulationPersonnelSettlementCutScope, TeamChannelAdapter, TeamSystemMaintenanceProof, TeamPersonnelSettlementCutSources,
  ChannelId, TeamSystemMaintenanceScope, TeamSystemEnvelopePostProof, TeamSystemEnvelopePostScope } from '@clocky/clocky-team'
import { recover } from './durable-replay-fixtures.ts'
import { channelAdmissionPrefix } from './durable-channel-fixtures.ts'
import { createdTeam, participant, participantChanged, teamId, teamPhase,
  taskCreatorId, taskCreatorActivationId, taskCreatorSessionId, otherParticipantId } from './fixtures.ts'

const adapter: TeamChannelAdapter = {
  type: 'direct', version: 4,
  validateCreate() {}, initialState() { return null }, validateSend() {}, fold(state) { return state },
  afterAccept() { return [] }, expectedNext() { return { kind: 'none' } }, projectView() { return {} },
  deliveryPlan({ manifest, envelope }) {
    return manifest.participants.filter(value => value.id !== envelope.senderId).map(value => ({
      participantId: value.id, envelopeId: envelope.id, delivery: envelope.delivery,
    }))
  },
}
beforeEach(() => { vi.spyOn(Date, 'now').mockReturnValue(100) })
afterEach(() => { vi.restoreAllMocks() })

const channelIds = [channelIdSchema.parse('cut-channel-z'), channelIdSchema.parse('cut-channel-a')]

/** Source-owned opaque proofs follow the existing maintenance owner protocol; no Actor/Human authority is fabricated. */
function authority(ctx: Context) {
  const proofs = new WeakMap<TeamSystemMaintenanceProof, TeamSystemMaintenanceScope>()
  const dispose = ctx.teams.registerSystemMaintenanceProofSource({ name: 'personnel-cut-source',
    resolveMaintenanceProof: proof => proofs.get(proof) })
  return { dispose, issue(scope: TeamSystemMaintenanceScope) {
    const token: object = {}
    Object.defineProperty(token, 'toJSON', { value: (): never => { throw new TypeError('Personnel cut proof is runtime-only') } })
    const actor = Object.freeze(token) as TeamSystemMaintenanceProof
    proofs.set(actor, structuredClone(scope))
    return { actor, revoke: () => { proofs.delete(actor) } }
  } }
}

async function fixture(backend: 'json' | 'sqlite', unkeyedPending = false) {
  const coordinator = participant({ id: taskCreatorId, role: 'coordinator' }), peer = participant({ id: otherParticipantId, role: 'member' })
  const rows = [createdTeam({ rules: { simulationRunId: 'cut-run', activationLifecycleOwner: 'simulation/cut' } }), teamPhase(), ...[coordinator, peer].flatMap((member, memberIndex) =>
    (['invited', 'provisioning', 'active'] as const).map((phase, index) => participantChanged({
      participant: { ...member, phase }, createdAt: 12 + memberIndex * 3 + index }))),
  { type: 'activation/changed', createdAt: 18, binding: { activation: { id: taskCreatorActivationId,
    teamId, participantId: taskCreatorId, status: 'idle' }, sessionId: taskCreatorSessionId, provider: 'in-process' } },
  ...channelIds.map((channelId, index) => ({ type: 'channel/attached', channelId, createdAt: 19 + index }))]
  const channels = channelIds.map((id, index) => {
    const prefix = channelAdmissionPrefix(channelManifestSchema.parse({ id, teamId,
      adapter: { type: adapter.type, version: adapter.version }, participants: [{ id: taskCreatorId, role: 'coordinator' },
        { id: otherParticipantId, role: 'member' }], limits: {} }), 21, 1000)
    // A durable replay boundary, not a fabricated current post permission: the original unkeyed WAL slot is retained.
    const pending = unkeyedPending && index === 0 ? [channelRecordSchema.parse({ type: 'channel/envelope',
      envelope: { id: 'unkeyed-original', teamId, channelId: id, sequence: prefix.length, senderId: taskCreatorId,
        audience: [otherParticipantId], kind: 'message', payload: { text: 'Retained original message' },
        delivery: 'context', priority: 'normal', createdAt: 30 },
      deliveryIntents: [{ participantId: otherParticipantId, envelopeId: 'unkeyed-original', delivery: 'context' }] })] : []
    return { id, records: [...prefix, ...pending] }
  })
  const ctx = await recover(backend, rows, undefined, teamId, channels)
  ctx.teams.registerAdapter(adapter)
  const state = await ctx.teams.getTeam({ teamId })
  const actual = state.activations.find(value => value.activation.id === taskCreatorActivationId)!
  const lease = ctx.teams.openActivationActorProofIssuer().issue(actual)
  const source = authority(ctx)
  const scope = async (): Promise<SimulationPersonnelSettlementCutScope> => {
    const team = await ctx.teams.getTeam({ teamId })
    return simulationPersonnelSettlementCutScopeSchema.parse({ kind: 'simulation-personnel-cut', teamId,
      runId: 'cut-run', lifecycleOwner: 'simulation/cut', personnelIntentId: 'personnel-intent', expectedTeamCursor: team.team.cursor,
      channels: await Promise.all(channelIds.map(async channelId => ({ channelId,
        cursor: (await ctx.teams.getChannel({ channelId })).cursor }))) })
  }
  // Core owner boundary unit: exact fixture operations use the established Simulation source protocol.
  // This tests Hub locking, not Native ledger operation acceptance (covered by the real Loader integration).
  const operations = new WeakMap<TeamSystemEnvelopePostProof, TeamSystemEnvelopePostScope>()
  ctx.teams.registerSystemEnvelopePostProofSource({ name: 'simulation-team', resolveEnvelopePostProof: proof => operations.get(proof) })
  let operationSequence = 0
  const postRequest = (channelId: typeof channelIds[number], expectedCursor: number) => {
    const operationId = `cut-operation-${++operationSequence}`
    const accepted = teamSystemEnvelopePostScopeSchema.parse({ kind: 'simulation-operation',
      runId: 'cut-run', decisionId: 'cut-decision', operationId, acceptedRevision: 1,
      fingerprint: operationId, lifecycleOwner: 'simulation/cut', teamId,
      senderId: actual.activation.participantId, recipientId: peer.id, publishAllowed: true,
      idempotencyKey: JSON.stringify(['simulation', 'cut-run', operationId]),
      draft: { channelId, audience: [peer.id], kind: 'message', delivery: 'context',
        payload: { text: 'Exact source-owned operation' }, traceId: operationId,
        correlationId: JSON.stringify(['cut-run', 'cut-decision', operationId, 1]) } })
    if (accepted.kind !== 'simulation-operation') throw new Error('Post fixture scope differs')
    const token: object = { toJSON(): never { throw new TypeError('Operation proof is runtime-only') } }
    const actor = Object.freeze(token) as TeamSystemEnvelopePostProof
    operations.set(actor, Object.freeze(accepted))
    return { actor, expectedCursor, idempotencyKey: accepted.idempotencyKey, draft: accepted.draft }
  }
  const post = async (channelId = channelIds[0]!) => {
    const channel = await ctx.teams.getChannel({ channelId })
    return await ctx.teams.postChannelEnvelope(postRequest(channelId, channel.cursor))
  }
  return { ctx, source, scope, post, postRequest, lease }
}

for (const backend of ['json', 'sqlite'] as const) {
  describe(`${backend} personnel settlement cut`, () => {
    it('pins actual unkeyed pending references without changing any source cursor and returns the original result', async () => {
      const f = await fixture(backend, true), selected = await f.scope(), proof = f.source.issue(selected)
      const before = await f.ctx.teams.getTeam({ teamId }), callback = vi.fn(async (sources: TeamPersonnelSettlementCutSources) => {
        expect(sources.team).toEqual(before)
        expect(Object.isFrozen(sources)).toBe(true)
        expect(Object.isFrozen(sources.channels[0]?.pending)).toBe(true)
        const held = sources.channels.find(value => value.channel.manifest.id === channelIds[0])!
        expect(held.pending).toEqual([{ envelopeId: 'unkeyed-original', senderId: taskCreatorId,
          recipientId: otherParticipantId, sequence: 7 }])
        return { originalNativeResult: 'retained' }
      })
      expect(await f.ctx.teams.withPersonnelSettlementCut({ scope: selected, actor: proof.actor }, callback))
        .toEqual({ originalNativeResult: 'retained' })
      expect(callback).toHaveBeenCalledOnce()
      expect(await f.scope()).toEqual(selected)
    })

    it('keeps actual task creation and posts on every attached Channel behind the cut until commit returns', async () => {
      const f = await fixture(backend), selected = await f.scope(), proof = f.source.issue(selected)
      const entered = Promise.withResolvers<undefined>(), release = Promise.withResolvers<undefined>()
      const cut = f.ctx.teams.withPersonnelSettlementCut({ scope: selected, actor: proof.actor }, async () => {
        entered.resolve(undefined); await release.promise; return 'original-native-commit'
      })
      await entered.promise
      let taskDone = false
      const task = f.ctx.teams.createTask({ actor: f.lease.proof, teamId, expectedCursor: selected.expectedTeamCursor,
        createCommand: { idempotencyKey: teamTaskCreateIdempotencyKeySchema.parse('cut-task') },
        subject: 'Concurrent task', description: 'Task mutation waits for the original Native settlement', requiredCapabilities: [],
        priority: 0, readScopes: [], writeScopes: [], workspaceMode: 'shared', reviewPolicy: { kind: 'none' }, budget: {},
        maxAttempts: 1, blockedBy: [] }).then((value) => { taskDone = true; return value })
      const completed = new Set<string>()
      const posts = selected.channels.map(value => f.ctx.teams.postChannelEnvelope(f.postRequest(value.channelId, value.cursor))
        .then((result) => { completed.add(result.channelId); return result }))
      // Observe all queued rejections immediately, and release the Native callback even if an assertion fails.
      const mutations = Promise.all([task, ...posts])
      const observed = mutations.then(value => ({ value }), (error: unknown) => ({ error }))
      await new Promise<undefined>((resolve) => { setImmediate(() => { resolve(undefined) }) })
      try {
        expect(taskDone).toBe(false)
        expect(completed.size).toBe(0)
      } finally { release.resolve(undefined) }
      expect(await cut).toBe('original-native-commit')
      const result = await observed
      if ('error' in result) throw result.error
      expect((await task).phase).toBe('pending')
      expect(await Promise.all(posts)).toHaveLength(2)
      expect((await f.ctx.teams.getTeam({ teamId })).tasks).toHaveLength(1)
    })

    it('rejects different intent, owner, run, incomplete/duplicate Channel sets and stale cursors before callback', async () => {
      const f = await fixture(backend), selected = await f.scope(), callback = vi.fn(async () => 'must-not-commit')
      const original = f.source.issue(selected)
      await expect(f.ctx.teams.withPersonnelSettlementCut({ scope: { ...selected,
        personnelIntentId: 'substituted-intent' as SimulationPersonnelSettlementCutScope['personnelIntentId'] }, actor: original.actor }, callback))
        .rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
      for (const scope of [{ ...selected, lifecycleOwner: 'another-owner' },
        { ...selected, runId: 'another-run' as SimulationPersonnelSettlementCutScope['runId'] },
        { ...selected, channels: selected.channels.slice(1) },
        { ...selected, channels: [...selected.channels, { channelId: channelIdSchema.parse('unknown-channel'), cursor: 0 }] },
        { ...selected, channels: [selected.channels[0]!, selected.channels[0]!] },
        { ...selected, expectedTeamCursor: selected.expectedTeamCursor - 1 },
        { ...selected, channels: selected.channels.map(value => ({ ...value, cursor: value.cursor - 1 })) }]) {
        const issued = f.source.issue(scope)
        await expect(f.ctx.teams.withPersonnelSettlementCut({ scope, actor: issued.actor }, callback)).rejects.toBeDefined()
      }
      expect(callback).not.toHaveBeenCalled()
    })

    it('rejects missing or substituted original WAL slots and rechecks authority after WAL reads', async () => {
      const f = await fixture(backend, true), selected = await f.scope(), proof = f.source.issue(selected)
      // Owning provider fault boundary: interfere only with the loaded original Channel stream, not public authority.
      const internals = f.ctx.teams as unknown as { readonly channels: ReadonlyMap<ChannelId, {
        readonly stream: Awaited<ReturnType<Context['storageLog']['open']>>
      }> }
      const loaded = internals.channels.get(channelIds[0]!)
      if (loaded === undefined) throw new Error('Original fixture Channel was not loaded')
      const stream = loaded.stream, originalRead = stream.read.bind(stream)
      const read = vi.spyOn(stream, 'read'), callback = vi.fn(async () => 'must-not-commit')
      read.mockResolvedValueOnce([])
      await expect(f.ctx.teams.withPersonnelSettlementCut({ scope: selected, actor: proof.actor }, callback))
        .rejects.toMatchObject({ code: 'TEAM_CHANNEL_WAL_MALFORMED' })
      read.mockImplementationOnce(async (after, limit) => {
        const entries = await originalRead(after, limit)
        return entries.map(entry => ({ ...entry, value: { type: 'channel/phase', sequence: entry.sequence,
          phase: 'active', createdAt: 100 } }))
      })
      await expect(f.ctx.teams.withPersonnelSettlementCut({ scope: selected, actor: proof.actor }, callback))
        .rejects.toMatchObject({ code: 'TEAM_CHANNEL_WAL_MALFORMED' })
      read.mockImplementationOnce(async (after, limit) => {
        const entries = await originalRead(after, limit)
        proof.revoke()
        return entries
      })
      await expect(f.ctx.teams.withPersonnelSettlementCut({ scope: selected, actor: proof.actor }, callback))
        .rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
      expect(callback).not.toHaveBeenCalled()
      read.mockRestore()
      expect(await f.scope()).toEqual(selected)
      const live = f.source.issue(selected)
      expect(await f.ctx.teams.withPersonnelSettlementCut({ scope: selected, actor: live.actor }, async () => 'retained')).toBe('retained')
    })

    it('refuses individually revoked or unloaded maintenance authority and permits no compaction-scope substitution', async () => {
      const f = await fixture(backend), selected = await f.scope(), callback = vi.fn(async () => 'must-not-commit')
      const revoked = f.source.issue(selected); revoked.revoke()
      await expect(f.ctx.teams.withPersonnelSettlementCut({ scope: selected, actor: revoked.actor }, callback))
        .rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
      const other = f.source.issue({ kind: 'scheduler-team-journal-compaction', teamId,
        expectedCursor: selected.expectedTeamCursor, throughSequence: 0 })
      await expect(f.ctx.teams.withPersonnelSettlementCut({ scope: selected, actor: other.actor }, callback))
        .rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
      const live = f.source.issue(selected); f.source.dispose()
      await expect(f.ctx.teams.withPersonnelSettlementCut({ scope: selected, actor: live.actor }, callback))
        .rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
      expect(callback).not.toHaveBeenCalled()
    })

    it('revalidates a proof revoked while waiting for source serializers and releases serializers after callback failure', async () => {
      const f = await fixture(backend), selected = await f.scope(), first = f.source.issue(selected), waiting = f.source.issue(selected)
      const entered = Promise.withResolvers<undefined>(), release = Promise.withResolvers<undefined>()
      const held = f.ctx.teams.withPersonnelSettlementCut({ scope: selected, actor: first.actor }, async () => {
        entered.resolve(undefined); await release.promise; throw new Error('Native commit refused')
      })
      const rejected = expect(held).rejects.toThrow('Native commit refused')
      await entered.promise
      const callback = vi.fn(async () => 'must-not-commit')
      const queued = f.ctx.teams.withPersonnelSettlementCut({ scope: selected, actor: waiting.actor }, callback)
      const invalid = expect(queued).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
      waiting.revoke(); release.resolve(undefined)
      await Promise.all([rejected, invalid])
      expect(callback).not.toHaveBeenCalled()
      expect((await f.post()).senderId).toBe(taskCreatorId)
      const next = await f.scope(), current = f.source.issue(next)
      expect(await f.ctx.teams.withPersonnelSettlementCut({ scope: next, actor: current.actor }, async () => 'retry')).toBe('retry')
    })
  })
}

it('keeps the base Runtime unsupported and never invokes a settlement callback', async () => {
  const f = await fixture('json'), scope = await f.scope(), proof = f.source.issue(scope)
  const callback = vi.fn(async () => 'not-supported')
  await expect(TeamRuntime.prototype.withPersonnelSettlementCut.call(TeamRuntime.prototype, { scope, actor: proof.actor }, callback))
    .rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
  expect(callback).not.toHaveBeenCalled()
})
