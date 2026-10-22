/** Read actual Team task, activation and pending-message owners without scheduling, claiming or acknowledging anything. */
import { z } from 'zod'
import type { Context } from '@clocky/cordis'
import type { SimulationEntityBinding } from '@clocky/clocky-simulation'
import type { PersonnelTeamReadLimits, PersonnelTeamSources, PersonnelChannelSource,
  PersonnelPendingDeliverySource } from './personnel-source-types.ts'

const readLimits = z.strictObject({ maxChannels: z.number().int().min(1).max(4096),
  maxPages: z.number().int().min(1).max(4096), pageSize: z.number().int().min(1).max(1024),
  maxBytes: z.number().int().min(1).max(1024 * 1024) })

/**
 * Observe canonical sources for one bound person; incomplete reads can never authorize a personnel commit.
 * @param ctx - Original trusted Team reader; no model or controller capabilities are invoked.
 * @param binding - Native-retained Team, participant and Session identity.
 * @param limits - Explicit finite observation-work limits, checked before the first owner read.
 * @param admitted - Original connection's read admission, rechecked after each asynchronous owner call.
 * @returns owner-only source material with exact cursors and a truthful coverage marker; private prose is not projected.
 */
export async function collectPersonnelTeamSources(ctx: Context, binding: SimulationEntityBinding,
  limits: PersonnelTeamReadLimits, admitted: () => void): Promise<PersonnelTeamSources> {
  const bounds = readLimits.parse(limits)
  admitted()
  const team = await ctx.teams.getTeam({ teamId: binding.teamId })
  admitted()
  if (team.team.id !== binding.teamId || !team.participants.some(value => value.id === binding.participantId
    && value.teamId === binding.teamId)) throw new Error('Personnel inspection lost its original canonical Team participant')
  const channels: PersonnelChannelSource[] = []
  let pages = 0, referenceBytes = 2, referenceCount = 0
  let incomplete: PersonnelTeamSources['incomplete']
  for (const channelId of [...team.channelIds].sort()) {
    if (channels.length >= bounds.maxChannels) { incomplete = 'channel-limit'; break }
    admitted()
    const channel = await ctx.teams.getChannel({ channelId })
    admitted()
    if (channel.manifest.id !== channelId || channel.manifest.teamId !== binding.teamId)
      throw new Error('Personnel inspection received another canonical Channel')
    const deliveries: PersonnelPendingDeliverySource[] = []
    channels.push({ channel, deliveries })
    if (!channel.manifest.participants.some(value => value.id === binding.participantId)) continue
    for (const recipient of channel.manifest.participants) {
      let afterCursor = -1
      while (afterCursor < channel.cursor) {
        if (pages++ >= bounds.maxPages) { incomplete = 'page-limit'; break }
        const page = await ctx.teams.listChannelPendingDeliveries({ channelId, participantId: recipient.id,
          afterCursor, limit: bounds.pageSize })
        admitted()
        if (page.channel.manifest.id !== channelId || page.channel.manifest.teamId !== binding.teamId
          || page.channel.cursor !== channel.cursor) { incomplete = 'source-moved'; break }
        if (page.nextCursor <= afterCursor || page.nextCursor > channel.cursor)
          throw new Error('Personnel pending-message pagination lost its exact source cursor')
        for (const { envelope } of page.deliveries) {
          if (envelope.channelId !== channelId || envelope.teamId !== binding.teamId || envelope.sequence <= afterCursor
            || envelope.sequence > page.nextCursor) throw new Error('Personnel pending message has another owner or source range')
          if (recipient.id !== binding.participantId && envelope.senderId !== binding.participantId) continue
          const reference: PersonnelPendingDeliverySource = { envelopeId: envelope.id, recipientId: recipient.id,
            senderId: envelope.senderId, sequence: envelope.sequence,
            direction: recipient.id === binding.participantId ? 'incoming' : 'outgoing' }
          const bytes = Buffer.byteLength(JSON.stringify(reference), 'utf8') + (referenceCount > 0 ? 1 : 0)
          if (referenceBytes + bytes > bounds.maxBytes) {
            incomplete = 'byte-limit'
            break
          }
          referenceBytes += bytes
          referenceCount++
          deliveries.push(reference)
        }
        if (incomplete !== undefined) break
        afterCursor = page.nextCursor
      }
      if (incomplete !== undefined) break
    }
    if (incomplete !== undefined) break
  }
  // Revalidate the observed prefixes; movement yields incomplete coverage instead of a fabricated atomic snapshot.
  if (incomplete === undefined) {
    const latest = await ctx.teams.getTeam({ teamId: binding.teamId })
    admitted()
    if (latest.team.cursor !== team.team.cursor) incomplete = 'source-moved'
    for (const { channel } of channels) {
      if (incomplete !== undefined) break
      const latestChannel = await ctx.teams.getChannel({ channelId: channel.manifest.id })
      admitted()
      if (latestChannel.cursor !== channel.cursor) incomplete = 'source-moved'
    }
  }
  return incomplete === undefined ? { team, channels, complete: true } : { team, channels, complete: false, incomplete }
}
