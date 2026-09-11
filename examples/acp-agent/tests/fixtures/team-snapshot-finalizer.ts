/** Test-only final Envelope synthesis for legacy ACP replay scripts. */

import type { Context } from '@clocky/cordis'
import type { Agent } from '@clocky/clocky-agent'
import {
  TeamError,
  channelIdSchema,
  participantIdSchema,
  teamIdSchema,
} from '@clocky/clocky-team'
import type { TeamActorProof } from '@clocky/clocky-team'
import {
  DIRECT_CHANNEL_ADAPTER_V3,
  DIRECT_CHANNEL_FINAL_ENVELOPE_KIND,
} from '@clocky/clocky-team-channel-direct'

export const name = 'team-snapshot-finalizer'
export const inject = ['teams']

interface TeamInput {
  readonly teamId: ReturnType<typeof teamIdSchema.parse>
  readonly participantId: ReturnType<typeof participantIdSchema.parse>
  readonly channelId: ReturnType<typeof channelIdSchema.parse>
  readonly humanId: ReturnType<typeof participantIdSchema.parse>
  readonly sessionId: Agent['session']['id']
}

/** Synthesize a direct final only for a Team coordinator turn without a real `team_final` result. */
export function apply(ctx: Context): void {
  ctx.on('agent/turn-stopping', async ({ agent, turn }) => {
    if (hasTeamFinal(agent, turn)) return
    const input = currentTeamInput(agent)
    const text = terminalText(agent, turn)
    if (input === undefined || text === undefined) return
    await synthesizeFinal(ctx, input, text)
  })
}

/** Append the test-only final after any concurrent direct-delivery receipt settles. */
async function synthesizeFinal(ctx: Context, input: TeamInput, text: string): Promise<void> {
  while (true) {
    const channel = await ctx.teams.getChannel({ channelId: input.channelId })
    if (channel.phase !== 'active'
      || channel.manifest.teamId !== input.teamId
      || channel.manifest.adapter.type !== DIRECT_CHANNEL_ADAPTER_V3.type
      || channel.manifest.adapter.version !== DIRECT_CHANNEL_ADAPTER_V3.version
      || await hasFinal(ctx, channel.manifest.id, input.participantId, input.humanId)) return
    try {
      await ctx.teams.postChannelEnvelope({
        actor: await activeActor(ctx, input),
        expectedCursor: channel.cursor,
        draft: {
          channelId: input.channelId,
          audience: [input.humanId],
          kind: DIRECT_CHANNEL_FINAL_ENVELOPE_KIND,
          payload: { text },
          delivery: 'turn',
        },
      })
      return
    } catch (error: unknown) {
      if (!(error instanceof TeamError) || error.code !== 'TEAM_CHANNEL_CURSOR_CONFLICT') throw error
    }
  }
}

/** Resolve the exact direct-v3 human input that woke the coordinator. */
function currentTeamInput(agent: Agent): TeamInput | undefined {
  const teamId = teamIdSchema.safeParse(agent.session.header.teamId)
  const participantId = participantIdSchema.safeParse(agent.session.header.participantId)
  if (!teamId.success || !participantId.success) return undefined
  for (const event of [...agent.session.events].reverse()) {
    if (event.type !== 'user/message' || event.data.source.kind !== 'team-envelope') continue
    const source = event.data.source
    const sourceTeamId = teamIdSchema.safeParse(source.teamId)
    const channelId = channelIdSchema.safeParse(source.channelId)
    const humanId = participantIdSchema.safeParse(source.senderId)
    if (!sourceTeamId.success || !channelId.success || !humanId.success || sourceTeamId.data !== teamId.data) continue
    return {
      teamId: teamId.data,
      participantId: participantId.data,
      channelId: channelId.data,
      humanId: humanId.data,
      sessionId: agent.session.id,
    }
  }
  return undefined
}

/** Issue an opaque actor proof for the exact coordinator Session that is synthesizing its test final. */
async function activeActor(ctx: Context, input: TeamInput): Promise<TeamActorProof> {
  const state = await ctx.teams.getTeam({ teamId: input.teamId })
  const binding = state.activations.find(candidate => candidate.activation.participantId === input.participantId
    && candidate.sessionId === input.sessionId)
  if (binding === undefined) {
    throw new TeamError('snapshot finalizer requires the coordinator activation binding', 'TEAM_ACTOR_PROOF_INVALID')
  }
  return ctx.teams.openActivationActorProofIssuer().issue(binding).proof
}

/** Return the last text committed by one closing coordinator turn. */
function terminalText(agent: Agent, turn: number): string | undefined {
  const event = [...agent.session.events].reverse().find(candidate =>
    candidate.type === 'assistant/message' && candidate.data.turn === turn)
  if (event?.type !== 'assistant/message') return undefined
  const text = event.data.message.content
    .filter((block): block is Extract<typeof block, { readonly type: 'text' }> => block.type === 'text')
    .map(block => block.text)
    .join('')
  return text.length === 0 ? undefined : text
}

/** Return whether the closing turn already used the real scoped final tool. */
function hasTeamFinal(agent: Agent, turn: number): boolean {
  return agent.session.events.some(event => event.type === 'tool/call'
    && event.data.turn === turn && event.data.name === 'team_final')
}

/** Check whether this direct channel already retains the coordinator's human-addressed final. */
async function hasFinal(
  ctx: Context,
  channelId: ReturnType<typeof channelIdSchema.parse>,
  coordinatorId: ReturnType<typeof participantIdSchema.parse>,
  humanId: ReturnType<typeof participantIdSchema.parse>,
): Promise<boolean> {
  const records = await ctx.teams.readChannel({ channelId, afterCursor: -1 })
  return records.records.some(record => record.type === 'channel/envelope'
    && record.envelope.kind === DIRECT_CHANNEL_FINAL_ENVELOPE_KIND
    && record.envelope.senderId === coordinatorId
    && record.envelope.audience?.length === 1
    && record.envelope.audience[0] === humanId)
}
