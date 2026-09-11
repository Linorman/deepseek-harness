/** Child owner held at provider disposal until the parent kills its Host process. */
import { Context } from '@clocky/cordis'
import AgentRuntime from '@clocky/clocky-agent-runtime'
import Storage from '@clocky/clocky-storage'
import * as StorageJson from '@clocky/clocky-storage-json'
import * as StorageSqlite from '@clocky/clocky-storage-sqlite'
import * as StorageLog from '@clocky/clocky-storage-log'
import TeamHub from '@clocky/clocky-team-hub'
import * as Controller from '@clocky/clocky-team-activation-controller'
import { SessionId } from '@clocky/clocky-session'
import { activationIdSchema, teamClosureIdempotencyKeySchema, teamTaskCreateIdempotencyKeySchema } from '@clocky/clocky-team'
import type { TeamSystemClosureProof, TeamSystemClosureScope } from '@clocky/clocky-team'
import { join } from 'node:path'
import { createTestRootTeam, inviteBootstrapParticipant, transitionBootstrapParticipant } from '../../../../core/team/tests/bootstrap-topology-authority.ts'
import { assignTestTask } from '../../../team-hub/tests/fixtures.ts'

const [root, backend] = process.argv.slice(2)
if (root === undefined || (backend !== 'json' && backend !== 'sqlite')) throw new Error('expected root and backend')
const ctx = new Context()
await ctx.plugin(Storage)
if (backend === 'json') await ctx.plugin(StorageJson, { root })
else await ctx.plugin(StorageSqlite, { path: join(root, 'team.db') })
await ctx.plugin(StorageLog, { backend, routes: {} })
await ctx.plugin(TeamHub)
await ctx.plugin(AgentRuntime)
ctx.agentRuntimes.registerProvider({
  name: 'kill-window',
  terminationMode: 'cooperative',
  async activate(request) {
    const activation = { id: activationIdSchema.parse(`kill-${request.teamId}`),
      teamId: request.teamId,
      participantId: request.participant.id,
      status: 'running' as const }
    return {
      activation, sessionId: request.sessionId, localAgent: undefined,
      async health() { return activation }, onStatus() { return () => {} }, interrupt() {},
      async dispose() {
        // The durable stopping record precedes this callback. IPC names the exact kill point.
        process.send?.({ teamId: request.teamId, activationId: activation.id })
        await new Promise<void>(() => {})
      },
    }
  },
})
await ctx.plugin(Controller)
const created = await createTestRootTeam(ctx,
  { goal: { objective: 'Retain intent across an abrupt Host exit.',
    budgets: {} },
  rules: {},
  budgets: {} })
const teamId = created.team.id
const participant = await inviteBootstrapParticipant(ctx,
  { teamId,
    expectedCursor: created.team.cursor,
    kind: 'local-agent',
    displayName: 'Coordinator',
    role: 'coordinator',
    capabilities: [] })
for (const phase of ['provisioning', 'active'] as const) {
  await transitionBootstrapParticipant(ctx,
    { teamId,
      participantId: participant.id,
      expectedCursor: (await ctx.teams.getTeam({ teamId })).team.cursor,
      phase })
}
const lease = await ctx.teamActivations.activate({ teamId,
  participantId: participant.id,
  expectedCursor: (await ctx.teams.getTeam({ teamId })).team.cursor,
  provider: 'kill-window',
  sessionId: SessionId(`session-${teamId}`),
  seed: { kind: 'fresh' },
  agent: { options: {} },
  signal: new AbortController().signal })
const actor = ctx.teams.openActivationActorProofIssuer().issue(lease.binding)
const task = await ctx.teams.createTask({ actor: actor.proof, teamId, expectedCursor: (await ctx.teams.getTeam({ teamId })).team.cursor,
  createCommand: { idempotencyKey: teamTaskCreateIdempotencyKeySchema.parse(`task-${teamId}`) },
  subject: 'Owned task',
  description: 'Owner disappears during cleanup.',
  blockedBy: [],
  requiredCapabilities: [],
  priority: 0,
  readScopes: [],
  writeScopes: [],
  workspaceMode: 'shared',
  budget: {},
  reviewPolicy: { kind: 'none' },
  maxAttempts: 2 })
const assigned = await assignTestTask(ctx,
  { teamId,
    taskId: task.id,
    expectedRevision: task.revision,
    participantId: participant.id,
    activationId: lease.binding.activation.id,
    leaseDurationMs: 60_000 })
if (assigned.lease === undefined) throw new Error('missing task lease')
await ctx.teams.startTaskAttempt({ actor: actor.proof,
  taskId: task.id,
  expectedRevision: assigned.revision,
  attemptId: assigned.lease.attemptId })
actor.revoke()
const proof = Object.freeze({}) as TeamSystemClosureProof
const scope: TeamSystemClosureScope = { kind: 'team-run-create-failure', teamId }
ctx.teams.registerSystemClosureProofSource({ name: 'team-run', resolveClosureProof: value => value === proof ? scope : undefined })
await ctx.teams.failTeam({ actor: proof, teamId, expectedCursor: (await ctx.teams.getTeam({ teamId })).team.cursor,
  idempotencyKey: teamClosureIdempotencyKeySchema.parse(`fail-${teamId}`),
  reason: { code: 'MODEL_FAILED',
    message: 'Stop the interrupted owner.' } })
