/** Durable idempotent target fixture; it does not claim to implement Team Hub authorization. */
import { join } from 'node:path'
import { JsonStorageBackend } from '@clocky/clocky-storage-json'
import { envelopeIdSchema } from '@clocky/clocky-team'
import { simulationPostReceiptSchema } from '@clocky/clocky-simulation'
import type { SimulationTeamTransport, SimulationPostOutcome } from '@clocky/clocky-simulation'

/** Open a serialized receipt store shared across killed and restarted fixture processes. */
export async function openOutboxTarget(root: string) {
  const backend = new JsonStorageBackend(join(root, 'outbox-target'))
  const log = await backend.log.open({ name: 'receipts', version: 0 })
  let pending: Promise<unknown> = Promise.resolve()
  const transport: SimulationTeamTransport = {
    post: (message) => {
      const operation = pending.then(async (): Promise<SimulationPostOutcome> => {
        const receipts = (await log.read(-1, 100)).map(entry => simulationPostReceiptSchema.parse(entry.value))
        const existing = receipts.find(receipt => receipt.operationId === message.operationId)
        if (existing !== undefined) {
          if (existing.fingerprint !== message.fingerprint || existing.channelId !== message.channelId) throw new Error('Target payload conflict')
          return { status: 'applied', receipt: existing }
        }
        if (!message.publishAllowed) return { status: 'blocked-authority', code: 'DENIED' }
        const receipt = { runId: message.runId, teamId: message.sender.teamId, recipientId: message.recipient.participantId,
          sequence: log.tailSequence + 2, operationId: message.operationId, fingerprint: message.fingerprint, channelId: message.channelId,
          envelopeId: envelopeIdSchema.parse(`fixture-envelope-${log.tailSequence + 1}`) }
        await log.append(log.tailSequence, [receipt])
        return { status: 'applied', receipt }
      })
      pending = operation.then(() => undefined, () => undefined)
      return operation
    },
  }
  return { transport, count: async () => (await log.read(-1, 100)).length,
    close: async () => { await pending; await backend.close() } }
}
