import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@clocky/cordis'
import Storage from '@clocky/clocky-storage'
import * as StorageJson from '@clocky/clocky-storage-json'
import * as StorageLog from '@clocky/clocky-storage-log'
import type {
  ChannelRecord,
  ChannelSummarizeRequest,
  TeamChannelAdapter,
  TeamSystemChannelSummaryProof,
  TeamSystemChannelSummaryScope,
  TeamViewPolicy,
} from '@clocky/clocky-team'
import { fingerprintChannelSummarySources } from '@clocky/clocky-team'
import TeamHub from '../src/index.ts'
import { createTestRootTeam, inviteBootstrapParticipant, transitionBootstrapParticipant } from '../../../core/team/tests/bootstrap-topology-authority.ts'
import { acknowledgeTestChannelActivations, openTestChannel } from '../../../core/team/tests/channel-lifecycle-authority.ts'
import { postActor } from './fixtures.ts'

const roots: string[] = []

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

const directAdapter: TeamChannelAdapter = {
  type: 'direct',
  version: 1,
  validateCreate() {},
  initialState() { return {} },
  validateSend() {},
  fold(state) { return state },
  afterAccept() { return [] },
  expectedNext() { return { kind: 'none' } },
  deliveryPlan() { return [] },
  projectView() { return {} },
}

const summaryPolicy: TeamViewPolicy = {
  type: 'summary-test',
  version: 1,
  project() { return {} },
}

/** Compose the local Hub over one isolated JSON Team journal backend. */
async function setup(): Promise<{ readonly ctx: Context; dispose(): Promise<void> }> {
  const root = await freshRoot()
  const ctx = new Context()
  try {
    await ctx.plugin(Storage)
    await ctx.plugin(StorageJson, { root })
    await ctx.plugin(StorageLog, { backend: 'json', routes: {} })
    await ctx.plugin(TeamHub)
    ctx.teams.registerAdapter(directAdapter)
    ctx.teams.registerViewPolicy(summaryPolicy)
  } catch (error: unknown) {
    await ctx.fiber.dispose()
    throw error
  }
  return { ctx, async dispose() { await ctx.fiber.dispose() } }
}

/** Allocate one repository-local root for an isolated durable Team journal. */
async function freshRoot(): Promise<string> {
  const parent = join(process.cwd(), '.tmp')
  await mkdir(parent, { recursive: true })
  const root = await mkdtemp(join(parent, 'team-hub-summary-authority-'))
  roots.push(root)
  return root
}

/** Create one non-serializable channel-summary token retained only by a registered source. */
function channelSummaryProof(): TeamSystemChannelSummaryProof {
  const proof: object = {}
  Object.defineProperty(proof, 'toJSON', {
    enumerable: true,
    value: (): never => { throw new TypeError('test channel-summary proofs are runtime-only') },
  })
  return Object.freeze(proof) as TeamSystemChannelSummaryProof
}

/** Register test-local summary scopes with independently revocable opaque proofs. */
function channelSummaryAuthority(ctx: Context, name = 'team-channel-summary'): {
  issue(scope: TeamSystemChannelSummaryScope): { readonly proof: TeamSystemChannelSummaryProof; revoke(): void }
} {
  const proofs = new Map<TeamSystemChannelSummaryProof, TeamSystemChannelSummaryScope>()
  ctx.teams.registerSystemChannelSummaryProofSource({
    name,
    resolveChannelSummaryProof: proof => proofs.get(proof),
  })
  return Object.freeze({
    issue(scope) {
      const proof = channelSummaryProof()
      proofs.set(proof, structuredClone(scope))
      return Object.freeze({ proof, revoke: (): void => { proofs.delete(proof) } })
    },
  })
}

/** Create one active channel with an accepted source Envelope and summary input. */
async function summaryInput(ctx: Context): Promise<Omit<ChannelSummarizeRequest, 'actor'>> {
  const team = await createTestRootTeam(ctx, { goal: { objective: 'Summarize one channel.', budgets: {} }, rules: {}, budgets: {} })
  const invited = await inviteBootstrapParticipant(ctx, {
    teamId: team.team.id,
    expectedCursor: team.team.cursor,
    kind: 'local-agent', displayName: 'Summarizer', role: 'coordinator', capabilities: [],
  })
  let state = await ctx.teams.getTeam({ teamId: team.team.id })
  await transitionBootstrapParticipant(ctx, {
    teamId: team.team.id, participantId: invited.id, expectedCursor: state.team.cursor, phase: 'provisioning',
  })
  state = await ctx.teams.getTeam({ teamId: team.team.id })
  await transitionBootstrapParticipant(ctx, {
    teamId: team.team.id, participantId: invited.id, expectedCursor: state.team.cursor, phase: 'active',
  })
  state = await ctx.teams.getTeam({ teamId: team.team.id })
  const opened = await openTestChannel(ctx, {
    teamId: team.team.id,
    expectedCursor: state.team.cursor,
    adapter: { type: 'direct', version: 1 },
    viewPolicy: { type: summaryPolicy.type, version: summaryPolicy.version },
    participants: [{ id: invited.id, role: 'participant' }],
    limits: {},
  })
  const actor = await postActor(ctx, team.team.id, invited.id)
  const channel = await acknowledgeTestChannelActivations(ctx, opened.manifest.id)
  const envelope = await ctx.teams.postChannelEnvelope({
    actor,
    expectedCursor: channel.cursor,
    draft: {
      channelId: channel.manifest.id,
      audience: [], kind: 'message', payload: { text: 'Source summary input.' }, delivery: 'context',
    },
  })
  return {
    channelId: channel.manifest.id,
    expectedCursor: envelope.sequence,
    coveredSequenceRange: { from: envelope.sequence, to: envelope.sequence },
    requester: actor,
    sourceFingerprint: fingerprintChannelSummarySources([envelope]),
    sourceEnvelopeIds: [envelope.id],
    text: 'One summarized source.',
    policy: { type: summaryPolicy.type, version: summaryPolicy.version },
    idempotencyKey: 'summary-authority-test' as never,
  }
}

/** Bind one complete summary input to one source-owned scope. */
function summaryScope(input: Omit<ChannelSummarizeRequest, 'actor'>): TeamSystemChannelSummaryScope {
  const { requester: _requester, ...payload } = input
  return { kind: 'channel-summary', ...payload }
}

describe('channel summary authority', () => {
  it('fails closed for raw, foreign, and mismatched source proofs before a summary append', async () => {
    const harness = await setup()
    try {
      const input = await summaryInput(harness.ctx)
      const authority = channelSummaryAuthority(harness.ctx)
      await expect(harness.ctx.teams.summarizeChannel(input as never)).rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })

      const foreignAuthority = channelSummaryAuthority(harness.ctx, 'foreign-channel-summary')
      const foreign = foreignAuthority.issue(summaryScope(input))
      try {
        await expect(harness.ctx.teams.summarizeChannel({ actor: foreign.proof, ...input }))
          .rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
      } finally {
        foreign.revoke()
      }

      const mismatch = authority.issue(summaryScope(input))
      try {
        await expect(harness.ctx.teams.summarizeChannel({ actor: mismatch.proof, ...input, text: 'Substituted text.' }))
          .rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
      } finally {
        mismatch.revoke()
      }
      await expect(harness.ctx.teams.readChannel({ channelId: input.channelId, afterCursor: -1 }))
        .resolves.not.toMatchObject({ records: [expect.objectContaining({ type: 'channel/summary' })] })
    } finally {
      await harness.dispose()
    }
  })

  it('re-resolves the source proof after its asynchronous source read before summary append', async () => {
    const harness = await setup()
    try {
      const input = await summaryInput(harness.ctx)
      const authority = channelSummaryAuthority(harness.ctx)
      const issued = authority.issue(summaryScope(input))
      const hub = harness.ctx.teams as unknown as {
        readChannelRecordRange(channel: unknown, from: number, count: number): Promise<readonly ChannelRecord[]>
      }
      const readRange = hub.readChannelRecordRange.bind(hub)
      vi.spyOn(hub, 'readChannelRecordRange').mockImplementation(async (channel, from, count) => {
        const records = await readRange(channel, from, count)
        issued.revoke()
        return records
      })
      expect(() => JSON.stringify(issued.proof)).toThrow(/runtime-only/u)
      expect(() => structuredClone(issued.proof)).toThrow()
      await expect(harness.ctx.teams.summarizeChannel({ actor: issued.proof, ...input }))
        .rejects.toMatchObject({ code: 'TEAM_ACTOR_PROOF_INVALID' })
      const read = await harness.ctx.teams.readChannel({ channelId: input.channelId, afterCursor: -1 })
      expect(read.records.some(record => record.type === 'channel/summary')).toBe(false)
    } finally {
      await harness.dispose()
    }
  })
})
