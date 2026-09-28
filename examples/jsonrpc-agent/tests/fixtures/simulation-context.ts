import { CompactionId, recordCompactionRequest } from '@clocky/clocky-compaction'
import { freezeMessage, MessageId } from '@clocky/clocky-llm'
/** Materialize a deterministic view through the runnable SDK composition. */
import { readFileSync } from 'node:fs'
import type { Context } from '@clocky/cordis'
import { isSimulationContextView } from '@clocky/clocky-session/surface'

export const name = 'simulation-context-snapshot'
export const inject = ['sessions']

/**
 * Record and flush supplementary context before the fixture model request.
 * @param ctx - Loader-owned plugin lifetime.
 */
export function apply(ctx: Context): void {
  ctx.on('agent/pre-step', async ({ agent }, next) => {
    const decision = await next()
    if (decision.kind === 'reject') return decision
    const probe = freezeMessage({ id: MessageId('sdk-wake-probe'), role: 'user',
      content: [{ type: 'text', text: 'Wake checkpoint probe.' }], source: { kind: 'plugin', plugin: 'simulation-context-snapshot' } })
    if (!agent.session.events.some(event => event.type === 'agent/inbox/spliced' && event.data.inserted.some(message => message.id === probe.id))) {
      agent.send(probe, 'next-step', false)
      await ctx.sessions.flush(agent.session)
      if (!agent.wakePending(probe.id)) throw new Error('Snapshot queued wake was not accepted')
      agent.inbox.remove(probe.id)
    }
    if (!agent.session.events.some(event => event.type === 'compaction/request')) {
      const turn = agent.session.events.findLast(event => event.type === 'turn/start')
      if (turn?.type !== 'turn/start') throw new Error('Snapshot has no active turn')
      const compactionId = CompactionId('sdk-compaction-probe')
      agent.session.append('compaction/start', { compactionId, turn: turn.data.turn })
      recordCompactionRequest(agent.session, { sessionId: agent.session.id, purpose: 'compaction',
        provider: 'test-provider', model: 'test-model', messages: [freezeMessage({
          id: MessageId('sdk-auxiliary-source'), role: 'user', source: { kind: 'user' },
          content: [{ type: 'text', text: 'Auxiliary source outside the conversation surface.' }],
        })] })
      agent.session.append('compaction/end', { compactionId, turn: turn.data.turn, error: 'Cancelled before dispatch' })
    }
    const data: unknown = JSON.parse(readFileSync(new URL('./simulation-context-data.json', import.meta.url), 'utf8'))
    if (!isSimulationContextView(data)) throw new Error('Invalid snapshot context')
    const previous = agent.session.events.findLast(event => event.type === 'simulation/context-view')
    agent.session.append('simulation/context-view', data, previous === undefined ? { surfaceOp: 'append' } : {
      surfaceOp: { op: 'replace', start: previous.seq, end: previous.seq }, sourceEventSeqs: [previous.seq],
    })
    if (!await ctx.sessions.flush(agent.session)) throw new Error('Snapshot context has no durable Session owner')
    return decision
  })
}
