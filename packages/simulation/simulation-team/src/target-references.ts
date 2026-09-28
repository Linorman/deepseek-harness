/** Verify accepted target references against retained Team and channel records at an owner cut. @module */
import { isDeepStrictEqual } from 'node:util'
import type { Context } from '@clocky/cordis'
import type { ChannelId, TeamPersistenceReference, TeamTaskSnapshot } from '@clocky/clocky-team'
import type { SimulationSnapshot } from '@clocky/clocky-simulation'

/**
 * Check that acknowledged publications and task creations exist within the captured owner states with their original attribution.
 * @param ctx - Authoritative Team reader; no models or target effects are invoked.
 * @param state - Frozen run projection whose publications require retained evidence.
 * @param references - Captured Team/channel owner positions; Team references are ignored.
 * @param tasks - Task projection at the captured Team position; mutable execution state does not change creation attribution.
 * @param check - Collector or recovery admission and cancellation check.
 * @returns completion after all settled cross-owner targets have been verified.
 */
export async function validateAcceptedTargets(ctx: Context, state: SimulationSnapshot,
  references: readonly TeamPersistenceReference[], tasks: readonly TeamTaskSnapshot[], check: () => void): Promise<void> {
  const cursors = new Map<ChannelId, number>()
  for (const reference of references) {
    if (reference.owner.kind === 'channel') cursors.set(reference.owner.channelId, reference.cursor)
  }
  for (const operation of Object.values(state.operations)) {
    if (operation.status !== 'applied') continue
    if (operation.action.kind === 'task/create') {
      check()
      const receipt = operation.outbox?.taskReceipt
      if (receipt === undefined) throw new Error('Applied Simulation task has no creation receipt')
      const task = tasks.find(value => value.id === receipt.taskId && value.teamId === receipt.teamId)
      if (task === undefined) throw new Error('Simulation task receipt has no retained target')
      const creator = task.createCommand.creator
      if (!('kind' in creator) || creator.teamId !== receipt.teamId || creator.runId !== state.spec.runId
        || creator.operationId !== operation.id || creator.participantId !== state.entities[operation.entityId]?.binding?.participantId
        || task.createCommand.idempotencyKey !== JSON.stringify(['simulation-task', state.spec.runId, operation.id])) {
        throw new Error('Simulation task receipt differs from its retained creation')
      }
      continue
    }
    if (operation.action.kind !== 'communication/post') continue
    check()
    const receipt = operation.outbox?.receipt
    if (receipt === undefined) throw new Error('Applied Simulation publication has no target receipt')
    const cursor = cursors.get(receipt.channelId)
    if (cursor === undefined || receipt.sequence > cursor) throw new Error('Simulation publication is outside its retained channel prefix')
    const page = await ctx.teams.readChannelPage({ channelId: receipt.channelId, afterCursor: receipt.sequence - 1, limit: 1 })
    check()
    const record = page.records[0]
    if (record?.type !== 'channel/envelope' || record.envelope.sequence !== receipt.sequence) {
      throw new Error('Simulation publication has no retained Envelope at its recorded position')
    }
    const envelope = record.envelope
    if (envelope.id !== receipt.envelopeId || envelope.teamId !== receipt.teamId
      || envelope.channelId !== receipt.channelId || envelope.senderId !== state.entities[operation.entityId]?.binding?.participantId
      || envelope.kind !== 'message' || envelope.delivery !== 'context'
      || !isDeepStrictEqual(envelope.audience, [receipt.recipientId])
      || !isDeepStrictEqual(envelope.payload, { content: [{ type: 'text', text: operation.action.text }] })) {
      throw new Error('Simulation publication reference differs from its retained Envelope')
    }
  }
}
