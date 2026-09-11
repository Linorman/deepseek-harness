import type { Context } from '@clocky/cordis'
import { createUserMessage } from '@clocky/clocky-llm'
import type { SessionEvent } from '@clocky/clocky-session'
import type {} from '@clocky/clocky-agent'
import type {} from '@clocky/clocky-team-run'
import { teamTaskCreateIdempotencyKeySchema } from '@clocky/clocky-team'
import type { TeamId } from '@clocky/clocky-team'
import { coordinatorStarted, releaseCoordinator } from './headless-team-channel-view-llm.ts'

const NAME = 'headless-team-channel-view-driver'

function waitForView(ctx: Context, teamId: TeamId): Promise<void> {
  const settled = Promise.withResolvers<undefined>()
  const timeout = setTimeout(() => {
    void (async () => {
      const state = await ctx.teams.getTeam({ teamId })
      settled.reject(new Error(`no persisted consult channel view for Team '${teamId}': ${JSON.stringify({
        team: state.team,
        tasks: state.tasks.map(task => ({ id: task.id, phase: task.phase, revision: task.revision })),
        participants: state.participants.map(participant => ({ id: participant.id, role: participant.role, phase: participant.phase })),
        activations: state.activations.map(binding => ({
          participantId: binding.activation.participantId,
          status: binding.activation.status,
        })),
        channels: state.channelIds,
        agents: ctx.agents.list().map(agent => ({
          sessionId: agent.session.id,
          status: agent.status,
          events: agent.session.events.map(event => event.type),
        })),
      })}`))
    })().catch((error: unknown) => { settled.reject(error) })
  }, 15_000)
  timeout.unref()
  const dispose = ctx.on('session/event', (_session, event: SessionEvent) => {
    if (event.type !== 'team/channel-view' || event.data.teamId !== teamId) return
    clearTimeout(timeout)
    dispose()
    settled.resolve(undefined)
  })
  return settled.promise
}

async function run(ctx: Context, exit: (code: number) => void): Promise<void> {
  await ctx.get('loader')?.await()
  const teamRuns = ctx.get('teamRuns')
  if (teamRuns === undefined) {
    throw new Error(`${NAME}: assembled TeamRun service is required`)
  }
  const handle = await teamRuns.create({ objective: 'Prove a durable non-direct Team channel view.', cwd: process.cwd() })
  const coordinator = handle.coordinatorLease.localAgent
  if (coordinator === undefined) throw new Error(`${NAME}: TeamRun did not publish its coordinator Agent`)
  coordinator.followup(createUserMessage({
    content: [{ type: 'text', text: 'P0_VIEW_COORDINATOR_WAKE' }],
    source: { kind: 'user' },
  }))
  await coordinatorStarted.promise
  const view = waitForView(ctx, handle.teamId)
  const authority = teamRuns.coordinatorTaskAuthority(coordinator)
  await ctx.agents.withInitiator(coordinator, async () => await teamRuns.startDefaultWorkerTask(authority, {
    idempotencyKey: teamTaskCreateIdempotencyKeySchema.parse('headless-team-channel-view-task'),
    subject: 'Create one durable consult review request.',
    instructions: 'Complete the task so the scheduler opens a consult review channel.',
    readScopes: ['examples/headless-agent'],
    writeScopes: ['examples/headless-agent'],
  }))
  await view
  releaseCoordinator.resolve(undefined)
  await coordinator.whenIdle()
  process.stdout.write('P0_VIEW_CHANNEL_VIEW_PERSISTED\n')
  exit(0)
}

export const name = NAME
export const inject = ['teamRuns', 'agents', 'teams']

export function apply(ctx: Context): void {
  const exit = ctx.get('appExit')
  if (exit === undefined) throw new Error(`${NAME}: assembled appExit service is required`)
  void run(ctx, exit).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    exit(1)
  })
}
