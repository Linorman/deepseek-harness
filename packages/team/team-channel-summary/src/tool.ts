/** Explicit summary tool scoped to the current default Team coordinator. @module @clocky/clocky-team-channel-summary/tool */
import type { Context } from '@clocky/cordis'
import type { Agent } from '@clocky/clocky-agent'
import { HarnessError } from '@clocky/clocky-llm'
import { channelIdSchema, channelSummaryIdempotencyKeySchema, teamIdSchema } from '@clocky/clocky-team'
import { defineTool } from '@clocky/clocky-tools'
import type {} from '@clocky/clocky-team-run'
import type {} from './index.ts'

/** Cordis plugin identity. */
export const name = 'tool-team-channel-summary'
/** The default coordinator owner and real tool/summary services must be available. */
export const inject = ['teamRuns', 'teamChannelSummaries', 'teams', 'agents', 'tools']

/** Install one bounded generic summary tool in its exact coordinator context. */
function install(ctx: Context, agent: Agent): () => void {
  return agent.ctx.tools.register(defineTool({
    name: 'team_channel_summarize',
    description: 'Create an explicit channel-wide extractive summary of a committed message range. '
      + 'The channel must use an allowed summary view policy. All selected messages must be visible to every channel member; private subset ranges are rejected. '
      + 'Use the same idempotency key and range to retry. This does not send a message or call another model.',
    parameters: {
      channel_id: { type: 'string', required: true, description: 'Selected channel id.' },
      expected_cursor: { type: 'integer', required: true, description: 'Current channel WAL cursor.' },
      from_sequence: { type: 'integer', required: true, description: 'First included WAL sequence.' },
      to_sequence: { type: 'integer', required: true, description: 'Last included WAL sequence.' },
      idempotency_key: { type: 'string', required: true, description: 'Stable retry identity for this exact range.' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: {
        summary_id: { type: 'string', required: true }, sequence: { type: 'integer', required: true },
        from_sequence: { type: 'integer', required: true }, to_sequence: { type: 'integer', required: true },
        text: { type: 'string', required: true },
      } },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    presentCall: args => ({ card: 'generic', kind: 'other', title: 'Summarize channel',
      rawInput: `${args.channel_id}: ${String(args.from_sequence)}–${String(args.to_sequence)}` }),
    async execute(args, exec) {
      if (exec.agent !== agent || ctx.agents.get(agent.id) !== agent || agent.status !== 'running'
        || ctx.agents.currentInitiator() !== agent || ctx.teamRuns.tryCoordinatorGoalAuthority(agent) === undefined) {
        throw new HarnessError('Channel summary requires the current coordinator inside its active driver', 'TEAM_SUMMARY_COORDINATOR_REQUIRED')
      }
      const teamId = agent.session.header.teamId
      if (teamId === undefined) throw new HarnessError('Coordinator Session has no Team', 'TEAM_SUMMARY_COORDINATOR_REQUIRED')
      const state = await ctx.teams.getTeam({ teamId: teamIdSchema.parse(teamId) })
      const binding = state.activations.find(value => value.sessionId === agent.session.id
        && value.activation.participantId === agent.session.header.participantId
        && (value.activation.status === 'idle' || value.activation.status === 'running'))
      if (binding === undefined) throw new HarnessError('Coordinator has no current activation binding', 'TEAM_SUMMARY_COORDINATOR_REQUIRED')
      const actor = ctx.teams.openActivationActorProofIssuer().issue(binding)
      try {
        const summary = await ctx.teamChannelSummaries.summarize({ requester: actor.proof,
          channelId: channelIdSchema.parse(args.channel_id), expectedCursor: args.expected_cursor,
          coveredSequenceRange: { from: args.from_sequence, to: args.to_sequence },
          idempotencyKey: channelSummaryIdempotencyKeySchema.parse(args.idempotency_key) })
        return { summary_id: summary.idempotencyKey, sequence: summary.sequence,
          from_sequence: summary.coveredSequenceRange.from, to_sequence: summary.coveredSequenceRange.to, text: summary.text }
      } finally { actor.revoke() }
    },
  }))
}

/** Register and remove the tool with its real default coordinator. @param ctx - Team-enabled tool context. */
export function apply(ctx: Context): void {
  const installed = new Map<Agent, () => void>()
  const reconcile = (agent: Agent): void => {
    if (ctx.teamRuns.tryCoordinatorGoalAuthority(agent) === undefined) {
      installed.get(agent)?.()
      installed.delete(agent)
    } else if (!installed.has(agent)) installed.set(agent, install(ctx, agent))
  }
  for (const agent of ctx.agents.list()) reconcile(agent)
  ctx.on('agent/created', ({ agent }) => { reconcile(agent) })
  ctx.on('team/changed', () => { for (const agent of ctx.agents.list()) reconcile(agent) })
  ctx.on('agent/disposed', ({ agent }) => { installed.get(agent)?.(); installed.delete(agent) })
  ctx.effect(() => () => { for (const dispose of installed.values()) dispose(); installed.clear() }, 'teamSummary.scopedTool()')
}
