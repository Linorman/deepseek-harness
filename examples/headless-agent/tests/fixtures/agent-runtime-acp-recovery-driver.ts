/** Exercise the Loader-owned ACP provider and process fencer with a durable proxy Session. */
import assert from 'node:assert/strict'
import type { Context } from '@clocky/cordis'
import type {} from '@clocky/clocky-agent-runtime'
import type {} from '@clocky/clocky-session-persistence'
import { SessionId } from '@clocky/clocky-session'
import { participantSnapshotSchema, teamIdSchema } from '@clocky/clocky-team'

async function run(ctx: Context) {
  await ctx.get('loader')?.await()
  const teamId = teamIdSchema.parse('acp-recovery-team')
  const participant = participantSnapshotSchema.parse({ id: 'acp-recovery-worker', teamId,
    displayName: 'ACP recovery worker', role: 'worker', kind: 'remote-agent', phase: 'active', capabilities: [] })
  const request = { provider: 'snapshot-acp', teamId, participant, sessionId: SessionId('acp-recovery-session'),
    agent: { cwd: process.cwd(), options: {} }, signal: new AbortController().signal }
  const initial = await ctx.agentRuntimes.activate({ ...request, seed: { kind: 'fresh' } })
  assert.equal(initial.activation.status, 'idle')
  const recovery = initial.recovery
  assert(recovery?.kind === 'acp-local-cold-replace')
  const fencer = ctx.agentRuntimes.getFencer(request.provider)
  assert(fencer !== undefined)
  await fencer.fence({ activation: initial.activation, sessionId: initial.sessionId, provider: request.provider, recovery })
  await initial.dispose()
  assert.equal((await initial.health()).status, 'offline')
  const replacement = await ctx.agentRuntimes.activate({ ...request, seed: { kind: 'resume' } })
  try {
    assert.equal(replacement.sessionId, initial.sessionId)
    assert.notEqual(replacement.activation.id, initial.activation.id)
    assert.notDeepEqual(replacement.recovery?.process, recovery.process)
    const persisted = await ctx.sessionPersistence.inspect(request.sessionId)
    assert.equal(persisted.meta.teamId, teamId)
    assert.equal(persisted.meta.participantId, participant.id)
  } finally { await replacement.dispose() }
  assert.equal((await replacement.health()).status, 'offline')
  return { initial: 'idle', fenced: 'offline', sameSession: true, newGeneration: true, durableSessionIdentity: true, final: 'offline' }
}

export const name = 'agent-runtime-acp-recovery-driver'
export const inject = ['agentRuntimes', 'sessions', 'sessionPersistence']
/** Run one keyless provider lifecycle through the assembled app. @param ctx - Loader-owned runtime services. */
export function apply(ctx: Context): void {
  const exit = ctx.get('appExit')
  assert(exit !== undefined)
  void run(ctx).then((output) => { process.stdout.write(`${JSON.stringify(output)}\n`); exit(0) }, (error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`)
    exit(1)
  })
}
