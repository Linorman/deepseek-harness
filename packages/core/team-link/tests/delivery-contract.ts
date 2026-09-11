/** Shared delivery conformance for local and remote activation-bound Team Links. */

import { describe, expect, it, vi } from 'vitest'
import type { ActivationBindingSnapshot, EnvelopeId, TeamEnvelope } from '@clocky/clocky-team'
import type { TeamLink } from '../src/index.ts'

/** Real-transport fixture for one unreceipted recipient delivery. */
export interface TeamLinkDeliveryContractHarness {
  /** Durable activation identity that every connected Link must preserve. */
  readonly binding: ActivationBindingSnapshot
  /** Append one recipient-visible pending Envelope before connecting. */
  post(): Promise<TeamEnvelope>
  /** Open the first Link for the exact binding. */
  connect(): Promise<TeamLink>
  /** Open a replacement Link after the first one closes. */
  reconnect(): Promise<TeamLink>
  /** Read all current pending Envelope ids for the bound recipient. */
  pendingEnvelopeIds(): Promise<readonly EnvelopeId[]>
}

/** Run the delivery behavior that every TeamLink transport must share. */
export function runTeamLinkDeliveryContract(
  label: string,
  create: () => Promise<TeamLinkDeliveryContractHarness>,
): void {
  describe(`TeamLink delivery contract: ${label}`, () => {
    it('replays an unreceipted Envelope, claims it with its binding, and retires it on acknowledgement', async () => {
      const harness = await create()
      const envelope = await harness.post()
      let first: TeamLink | undefined
      let replay: TeamLink | undefined
      let stopFirst = () => {}
      let stopReplay = () => {}
      try {
        first = await harness.connect()
        const firstNotifications: TeamEnvelope[] = []
        stopFirst = first.onNotify(async (notification) => { firstNotifications.push(notification) })
        await vi.waitFor(() => { expect(firstNotifications.map(item => item.id)).toEqual([envelope.id]) })
        expect(await harness.pendingEnvelopeIds()).toEqual([envelope.id])

        stopFirst()
        await first.close()
        first = undefined

        replay = await harness.reconnect()
        const replayedNotifications: TeamEnvelope[] = []
        stopReplay = replay.onNotify(async (notification) => { replayedNotifications.push(notification) })
        await vi.waitFor(() => { expect(replayedNotifications.map(item => item.id)).toEqual([envelope.id]) })

        const claim = await replay.claim(envelope.channelId, envelope.id)
        if (claim === undefined) throw new Error('unreceipted Envelope was not claimable after replay')
        expect(claim).toMatchObject({
          binding: harness.binding,
          envelopeId: envelope.id,
          delivery: envelope.delivery,
        })
        expect(await harness.pendingEnvelopeIds()).toEqual([envelope.id])

        const receipt = await replay.acknowledge(envelope.channelId, envelope.id, claim.channel.cursor)
        expect(receipt).toMatchObject({
          participantId: harness.binding.activation.participantId,
          envelopeId: envelope.id,
        })
        expect(await harness.pendingEnvelopeIds()).toEqual([])
        await expect(replay.claim(envelope.channelId, envelope.id)).resolves.toBeUndefined()
      } finally {
        stopReplay()
        stopFirst()
        await replay?.close()
        await first?.close()
      }
    })
  })
}
