/** Durable summary cursors and retained task-owner references across fresh Hub recovery. @module */

import { describe, expect, it } from 'vitest'
import { channelIdSchema, channelRecordSchema, channelManifestSchema, teamEnvelopeSchema, fingerprintChannelSummarySources, fingerprintChannelManifest, teamTaskSnapshotSchema } from '@clocky/clocky-team'
import type { TeamViewPolicy } from '@clocky/clocky-team'
import { channelProjectionData, channelProjectionFromData, foldChannelRecord } from '../src/fold.ts'
import { channelProjectionDataSchema } from '../src/schema.ts'
import { retainedFinalAdapter } from './durable-final-fixtures.ts'
import { channelAdmissionPrefix } from './durable-channel-fixtures.ts'
import { checkpointFor, recover } from './durable-replay-fixtures.ts'
import { createdTeam, participant, participantChanged, task, taskChanged, taskCreatorActivationId,
  taskCreatorId, taskCreatorSessionId, teamId, teamPhase } from './fixtures.ts'

function roster() {
  const creator = participant({ id: taskCreatorId, role: 'coordinator' })
  const owner = participant({ id: 'proposed-owner', role: 'worker' })
  const records = [createdTeam(), teamPhase(),
    participantChanged({ participant: creator, createdAt: 12 }),
    participantChanged({ participant: { ...creator, phase: 'provisioning' }, createdAt: 13 }),
    participantChanged({ participant: { ...creator, phase: 'active' }, createdAt: 14 }),
    { type: 'activation/changed', createdAt: 15, binding: {
      activation: { id: taskCreatorActivationId, teamId, participantId: taskCreatorId, status: 'idle' },
      sessionId: taskCreatorSessionId, provider: 'in-process' } },
    participantChanged({ participant: owner, createdAt: 16 }),
    participantChanged({ participant: { ...owner, phase: 'provisioning' }, createdAt: 17 }),
    participantChanged({ participant: { ...owner, phase: 'active' }, createdAt: 18 })]
  return { records, owner }
}

function ownerProposal() {
  const f = roster()
  const created = task()
  const proposed = task({ ...created, revision: 2, proposedOwnerId: f.owner.id })
  const prefix = [...f.records, taskChanged({ task: created, createdAt: 19 })]
  const record = { type: 'task/changed', task: proposed, createdAt: 20 }
  const records = [...prefix, record,
    participantChanged({ participant: { ...f.owner, phase: 'left' }, createdAt: 21 })]
  return { prefix, record, proposed, records, checkpoint: checkpointFor(records) }
}

const summaryPolicy: TeamViewPolicy = { type: 'durable-summary-range', version: 1, project() { return {} } }

function summarizedChannel() {
  const f = roster()
  const channelId = channelIdSchema.parse('summary-range-channel')
  const policy = { type: summaryPolicy.type, version: summaryPolicy.version }
  const manifest = channelManifestSchema.parse({ id: channelId, teamId,
    adapter: { type: retainedFinalAdapter.type, version: retainedFinalAdapter.version }, viewPolicy: policy,
    participants: [{ id: taskCreatorId, role: 'coordinator' }, { id: f.owner.id, role: 'worker' }], limits: { turns: 2 } })
  const prefix = channelAdmissionPrefix(manifest, 19, 30)
  const envelope = teamEnvelopeSchema.parse({ id: 'summary-source', teamId, channelId, sequence: prefix.length,
    senderId: taskCreatorId, audience: [f.owner.id], kind: 'message', payload: { text: 'Review this source.' },
    delivery: 'context', priority: 'normal', createdAt: 21 })
  const summary = { type: 'channel/summary', sequence: envelope.sequence + 1, createdAt: 22,
    coveredSequenceRange: { from: envelope.sequence, to: envelope.sequence }, sourceEnvelopeIds: [envelope.id],
    sourceFingerprint: fingerprintChannelSummarySources([envelope]), text: 'The worker should review the retained source.',
    policy, idempotencyKey: 'summary-range' }
  const records = [...prefix,
    { type: 'channel/envelope', envelope, deliveryIntents: [{ participantId: f.owner.id, envelopeId: envelope.id, delivery: 'context' }] }, summary]
  let projection
  for (const [cursor, record] of records.entries()) {
    projection = foldChannelRecord(projection, channelRecordSchema.parse(record), cursor, channelId, retainedFinalAdapter)
  }
  if (projection === undefined) throw new Error('summary checkpoint requires its source WAL')
  const journal = [...f.records, { type: 'channel/attached', channelId, createdAt: 19 }]
  return { channelId, journal, records, summary, checkpoint: channelProjectionData(projection) }
}

for (const backend of ['json', 'sqlite'] as const) {
  describe(`durable reference boundaries (${backend})`, () => {
    it('retains a valid owner proposal after the named participant leaves', async () => {
      const f = ownerProposal()
      const ctx = await recover(backend, f.records, { ...f.checkpoint, rules: { ...f.checkpoint.rules, retainedOwner: true } })
      const state = await ctx.teams.getTeam({ teamId })
      expect(state.tasks).toEqual([f.proposed])
      expect(state.participants.find(member => member.id === f.proposed.proposedOwnerId)?.phase).toBe('left')
      expect(state.rules).toHaveProperty('retainedOwner', true)
    })

    it('rejects a journal proposal naming a participant absent from its Team', async () => {
      const f = ownerProposal()
      const damaged = { ...f.proposed, proposedOwnerId: 'absent-owner' }
      expect(teamTaskSnapshotSchema.safeParse(JSON.parse(JSON.stringify(damaged))).success).toBe(true)
      const ctx = await recover(backend, [...f.prefix, { ...f.record, task: damaged }])
      await expect(ctx.teams.getTeam({ teamId })).rejects.toThrow(`task '${f.proposed.id}' proposes an unknown owner 'absent-owner'`)
    })

    it('restores the journal owner when a checkpoint proposal names an absent participant', async () => {
      const f = ownerProposal()
      const damaged = { ...f.proposed, proposedOwnerId: 'absent-owner' }
      const ctx = await recover(backend, f.records, { ...f.checkpoint, tasks: [damaged] })
      expect((await ctx.teams.getTeam({ teamId })).tasks).toEqual([f.proposed])
    })

    it.each([false, true])('validates a summary cursor against its checkpoint with damage=%s', async (damaged) => {
      const f = summarizedChannel()
      const manifest = { ...f.checkpoint.manifest, limits: { turns: 9 } }
      const checkpoint = { ...f.checkpoint, manifest,
        invitations: f.checkpoint.invitations.map(invitation => ({ ...invitation, manifestFingerprint: fingerprintChannelManifest(manifest) })),
        summaries: [{ ...f.summary, sequence: damaged ? f.checkpoint.cursor + 1 : f.summary.sequence }] }
      const parsed = channelProjectionDataSchema.parse(JSON.parse(JSON.stringify(checkpoint)))
      if (damaged) {
        expect(() => channelProjectionFromData(parsed)).toThrow("channel checkpoint summary 'summary-range' has an invalid source range")
      }
      const ctx = await recover(backend, f.journal, undefined, teamId,
        [{ id: f.channelId, records: f.records, checkpoint }])
      ctx.teams.registerAdapter(retainedFinalAdapter)
      ctx.teams.registerViewPolicy(summaryPolicy)
      // The manifest limit makes checkpoint acceptance observable independently of the retained WAL.
      expect(await ctx.teams.getChannel({ channelId: f.channelId })).toMatchObject({
        phase: 'active', cursor: f.records.length - 1, manifest: { limits: { turns: damaged ? 2 : 9 } },
      })
    })
  })
}
