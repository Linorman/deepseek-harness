/** Context replay preserves exact input and unrelated conversation nodes. */
import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { Session, SessionId, snapshotSessionEvent } from '@clocky/clocky-session'
import type { SessionEvent, SimulationContextViewEventData } from '@clocky/clocky-session'
import { createUserMessage, createToolResultMessage, CallId } from '@clocky/clocky-llm'
import { isSimulationContextView, isSimulationContextViewEvent } from '@clocky/clocky-session/surface'

const corpus = JSON.parse(await readFile(new URL('../../../sdk/protocol/tests/fixtures/simulation-context-cases.json', import.meta.url), 'utf8')) as {
  name: string
  valid: boolean
  event: SessionEvent<'simulation/context-view'>
}[]
function data(): SimulationContextViewEventData { return structuredClone(corpus[0]!.event.data) }

describe('Simulation context persistence', () => {
  it.each(corpus)('validates $name consistently at wire and Session append boundaries', ({ event, valid }) => {
    expect(isSimulationContextViewEvent(event)).toBe(valid)
    // Envelope provenance belongs to the complete log; payload admission is checked with a new append envelope.
    if (valid) {
      const session = Session.create(SessionId('context'))
      const view = session.append('simulation/context-view', event.data, { surfaceOp: 'append' })
      expect(snapshotSessionEvent(view)).toEqual(view)
    } else {
      expect(() => snapshotSessionEvent(event)).toThrow()
      if (!isSimulationContextView(event.data)) {
        const session = Session.create(SessionId('invalid-context'))
        expect(() => session.append('simulation/context-view', event.data, { surfaceOp: 'append' })).toThrow()
        expect(() => Session.create(session.id, [{ ...event, seq: 0, time: 1, surfaceOp: 'append' }])).toThrow()
        expect(session.events).toEqual([])
      }
    }
  })

  it('replaces only the selected context while preserving messages and tool results across reopening', () => {
    const session = Session.create(SessionId('replace-context'))
    const first = session.append('simulation/context-view', data(), { surfaceOp: 'append' })
    session.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'Ordinary message' }], source: { kind: 'user' } }), { surfaceOp: 'append' })
    const tool = session.append('tool/result', { turn: 1, step: 1,
      message: createToolResultMessage({ callId: CallId('context-tool'), content: [{ type: 'text', text: 'Retained tool result' }], isError: false }),
    }, { surfaceOp: 'append' })
    const refreshed = data()
    refreshed.content[0] = { kind: 'identity', blocks: [{ type: 'text', text: 'Updated identity' }] }
    const second = session.append('simulation/context-view', refreshed, {
      surfaceOp: { op: 'replace', start: first.seq, end: first.seq }, sourceEventSeqs: [first.seq],
    })
    const third = session.append('simulation/context-view', { ...refreshed, content: [{ kind: 'identity', blocks: [{ type: 'text', text: 'Final identity' }] }] }, {
      surfaceOp: { op: 'replace', start: second.seq, end: second.seq }, sourceEventSeqs: [second.seq],
    })
    expect(session.surface.nodes).toEqual([third.seq, 1, tool.seq])
    const reopened = Session.create(session.id, JSON.parse(JSON.stringify(session.events)) as SessionEvent[])
    expect(reopened.deriveMessages()).toEqual(session.deriveMessages())
    expect(session.deriveMessages().slice(0, 2).map(message => message.content)).toEqual([
      [{ type: 'text', text: 'Final identity' }], [{ type: 'text', text: 'Ordinary message' }],
    ])
    expect(session.deriveMessages()[2]).toEqual(tool.data.message)
    expect(Object.isFrozen(snapshotSessionEvent(third).data.content)).toBe(true)
  })

  it('rejects replacement of unrelated history or another entity', () => {
    const session = Session.create(SessionId('context-target'))
    const first = session.append('simulation/context-view', data(), { surfaceOp: 'append' })
    const ordinary = session.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'Keep' }], source: { kind: 'user' } }), { surfaceOp: 'append' })
    for (const target of [ordinary.seq]) {
      expect(() => session.append('simulation/context-view', data(), {
        surfaceOp: { op: 'replace', start: target, end: target }, sourceEventSeqs: [target],
      })).toThrow(/same run and entity/)
    }
    expect(() => session.append('simulation/context-view', { ...data(), entityId: 'other' as SimulationContextViewEventData['entityId'] }, {
      surfaceOp: { op: 'replace', start: first.seq, end: first.seq }, sourceEventSeqs: [first.seq],
    })).toThrow(/same run and entity/)
    expect(() => session.append('simulation/context-view', data(), {
      surfaceOp: { op: 'replace', start: first.seq, end: ordinary.seq }, sourceEventSeqs: [first.seq, ordinary.seq],
    })).toThrow(/invalid required context/)
    expect(() => session.append('simulation/context-view', { ...data(), runId: 'other' as SimulationContextViewEventData['runId'], sources: [] }, {
      surfaceOp: { op: 'replace', start: first.seq, end: first.seq }, sourceEventSeqs: [first.seq],
    })).toThrow(/same run and entity/)
    expect(session.events).toHaveLength(2)
  })
})
