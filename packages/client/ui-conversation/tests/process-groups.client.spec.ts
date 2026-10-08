import { describe, expect, it } from 'vitest'
import { groupFlow, isProcessNode, summarizeGroup } from '../src/client/chat/process-groups.ts'

const tool = (name: string, time: number, settled?: { at: number; error?: boolean }) => ({
  kind: 'tool-call',
  data: { root: settled === undefined
    ? { callId: name, name, argsRaw: '{}', turn: 1, step: 1, time, callView: null, children: [] }
    : { kind: 'tool-result', seq: 1, time: settled.at, callId: name, call: { name, argsRaw: '{}' }, callTime: time, content: [], isError: settled.error === true } },
})
const think = (time: number, status = 'settled') => ({ kind: 'assistant-step', data: { status, turn: 1, step: 1, time, blocks: [{ kind: 'reasoning', text: '…' }] } })
const answer = { kind: 'assistant-step', data: { status: 'settled', turn: 1, step: 2, time: 9, blocks: [{ kind: 'text', text: 'Done' }] } }

describe('process groups', () => {
  it('classifies tool, context, and text-free assistant steps as process', () => {
    expect(isProcessNode(tool('read', 1) as never)).toBe(true)
    expect(isProcessNode({ kind: 'context', data: {} })).toBe(true)
    expect(isProcessNode(think(1) as never)).toBe(true)
    expect(isProcessNode(answer as never)).toBe(false)
    expect(isProcessNode({ kind: 'user', data: {} })).toBe(false)
  })

  it('groups runs of two or more and leaves single process rows alone', () => {
    const order = ['u', 't1', 't2', 'a', 't3', 'b']
    const process = [false, true, true, false, true, false]
    expect(groupFlow(order, process)).toEqual([
      { type: 'node', key: 'u' },
      { type: 'group', key: 'group:t1', keys: ['t1', 't2'] },
      { type: 'node', key: 'a' },
      { type: 'node', key: 't3' },
      { type: 'node', key: 'b' },
    ])
  })

  it('summarizes steps, duration, running, and failure', () => {
    const settled = summarizeGroup([think(1000), tool('read', 2000, { at: 5000 })])
    expect(settled).toMatchObject({ steps: 2, startTime: 1000, endTime: 5000, running: false, failed: false, currentTool: 'read' })
    const live = summarizeGroup([think(1000), tool('bash', 3000)])
    expect(live).toMatchObject({ running: true, currentTool: 'bash' })
    const failed = summarizeGroup([tool('a', 1, { at: 2, error: true }), tool('b', 2, { at: 3 })])
    expect(failed.failed).toBe(true)
  })
})
