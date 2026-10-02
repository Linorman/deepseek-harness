/** Source reads reuse current Team human authority, including canonical-parent read-only access. */
import type { Context } from '@clocky/cordis'
import type { AuthenticatedProductCall } from '@clocky/clocky-product-principal'
import type { TeamEnvelope } from '@clocky/clocky-team'
import { jsonObjectSchema } from '@clocky/clocky-team'
import type {} from '@clocky/clocky-team-human-actor'
import type { SimulationProductEnvelopeSource, SimulationProductSourceInspection } from './sources-types.ts'
import { textParts } from './context-details.ts'

/** A bounded native lookup never returns unrelated channel records to its product consumer. */
export type EnvelopeSourceRead = { status: 'found'; envelope: TeamEnvelope }
  | { status: 'searching'; afterCursor: number } | { status: 'missing' | 'withheld' | 'unavailable' }
/**
 * Read at most one channel page under current Team permission, independent of Simulation source grants.
 * @param ctx - Optional Team and human-proof providers; discovery never mounts them.
 * @param source - Exact reference selected from the frozen context.
 * @param call - Current product principal and credential lifetime.
 * @param position - Bounded lookup cursor or exact envelope position supplied by the product owner.
 * @param check - Recheck Simulation policy and service lifetime after awaited work.
 * @returns exact matching envelope, safe absence/refusal, or an explicit bounded lookup continuation.
 */
export async function readEnvelopeSource(ctx: Context, source: SimulationProductEnvelopeSource, call: AuthenticatedProductCall,
  position: { afterCursor: number; limit: number; envelopeSequence?: number | undefined }, check: () => void): Promise<EnvelopeSourceRead> {
  const teams = ctx.get('teams'), humans = ctx.get('teamHumanActors')
  if (teams === undefined || humans === undefined) return { status: 'unavailable' }
  const references = { teamId: source.teamId, participantIds: [] }
  try {
    return await humans.withProof(call, { teamId: source.teamId, operation: 'identity-resolve-read', fence: { kind: 'read' },
      payload: jsonObjectSchema.parse(references) }, async (actor) => {
      await teams.resolveIdentities({ ...references, actor }); check()
      try {
        const owner = await teams.getChannelOwner({ channelId: source.channelId }); check()
        if (owner.teamId !== source.teamId) return { status: 'withheld' }
        const page = await teams.readChannelPage({ channelId: source.channelId,
          afterCursor: position.envelopeSequence === undefined ? position.afterCursor : position.envelopeSequence - 1,
          limit: position.envelopeSequence === undefined ? position.limit : 1 })
        check()
        if (page.channel.manifest.teamId !== source.teamId || page.channel.manifest.id !== source.channelId) return { status: 'withheld' }
        const found = page.records.find(row => row.type === 'channel/envelope' && row.envelope.id === source.envelopeId)
        if (found?.type === 'channel/envelope') {
          const envelope = found.envelope
          if (envelope.teamId !== source.teamId || envelope.channelId !== source.channelId
            || position.envelopeSequence !== undefined && envelope.sequence !== position.envelopeSequence) return { status: 'withheld' }
          return { status: 'found', envelope }
        }
        if (position.envelopeSequence === undefined && page.nextCursor !== undefined) {
          if (page.nextCursor <= position.afterCursor) return { status: 'unavailable' }
          return { status: 'searching', afterCursor: page.nextCursor }
        }
        return { status: 'missing' }
      } finally { await teams.resolveIdentities({ ...references, actor }); check() }
    })
  } catch (cause: unknown) {
    check()
    const code = typeof cause === 'object' && cause !== null && 'code' in cause ? cause.code : undefined
    if (typeof code === 'string' && ['TEAM_HUMAN_ACTOR_FORBIDDEN', 'TEAM_HUMAN_ACTOR_NOT_FOUND', 'TEAM_HUMAN_ACTOR_AMBIGUOUS',
      'TEAM_ACTOR_PROOF_INVALID', 'TEAM_GRANT_DENIED', 'TEAM_CHANNEL_NOT_FOUND', 'TEAM_NOT_FOUND'].includes(code)) return { status: 'withheld' }
    return { status: 'unavailable' }
  }
}

/**
 * Extract only inert text from the authorized original Envelope.
 * @param envelope - Validated immutable native message.
 * @param maxPartBytes - Deployment Unicode-safe text allowance.
 * @returns ordered text fragments or an explicit unsupported marker, never arbitrary protocol payloads.
 */
export function* envelopeSourceParts(envelope: TeamEnvelope, maxPartBytes: number): Generator<SimulationProductSourceInspection['items'][number]> {
  const content = envelope.payload['content']
  if (!Array.isArray(content)) { yield { block: 0, body: { status: 'unsupported' } }; return }
  const blocks: readonly unknown[] = content
  for (const [index, block] of blocks.entries()) {
    if (typeof block !== 'object' || block === null || Array.isArray(block) || !('type' in block) || block.type !== 'text'
      || !('text' in block) || typeof block.text !== 'string') {
      yield { block: index, body: { status: 'unsupported' } }; continue
    }
    let parts = 0, part = 0
    for (const _text of textParts(block.text, maxPartBytes)) parts++
    for (const text of textParts(block.text, maxPartBytes)) {
      yield { block: index, body: { status: 'text', text, part: part++, parts } }
    }
  }
}
