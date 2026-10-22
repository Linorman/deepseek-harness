/** Only explicit recorded cutoff probes replace model chunks; all external decisions delegate to the unchanged adapter. */
import assert from 'node:assert/strict'
import type { Context } from '@clocky/cordis'
import { CallId } from '@clocky/clocky-llm'
import type { StreamChunk } from '@clocky/clocky-llm'
import { simulationProposalSchema } from '@clocky/clocky-simulation'

export const name = 'world-calendar-cutoff-model'
export const inject = ['llm']
export const calendarProbeRequests: Array<{ entityId: string; contextKey: string; tool: string; input: string }> = []
function objects(value: unknown): Record<string, unknown>[] {
  if (typeof value === 'string') return value.split('\n').flatMap((line) => {
    if (!line.trimStart().startsWith('{')) return []
    let decoded: unknown
    try { decoded = JSON.parse(line) }
    catch { return [] /* Ordinary instruction prose has no JSON probe. */ }
    return objects(decoded)
  })
  if (value === null || typeof value !== 'object') return []
  if (Array.isArray(value)) return value.flatMap(objects)
  const item = value as Record<string, unknown>
  return [item, ...Object.values(item).flatMap(objects)]
}
/** Register probes whose proposals come exclusively from the actual recorded user input. */
export function apply(ctx: Context): void {
  const calls = new Map<string, number>()
  ctx.on('llm/stream', async function* (options, next): AsyncIterable<StreamChunk> {
    const primary = objects(options.messages.filter(item => item.role === 'user'
      && !item.content.some(block => block.type === 'tool-result')))
    const marker = primary.findLast(item => item.kind === 'world-driver')
    if (!marker || typeof marker.contextKey !== 'string' || !marker.contextKey.startsWith('time-cutoff:')) {
      yield* next(); return
    }
    const probe = primary.findLast(item => item.kind === 'time-cutoff-probe')
    assert.ok(probe && Array.isArray(probe.proposals)); assert.equal(marker.purpose, 'message')
    const key = `${String(marker.entityId)}/${marker.contextKey}`, step = calls.get(key) ?? 0
    calls.set(key, step + 1)
    const tool = ['simulation_observe', 'simulation_stage', 'simulation_submit'][step]
    assert.ok(tool, 'Each explicit cutoff probe has only three actual tool calls')
    assert.deepEqual(options.tools?.map(item => item.name).sort(), ['simulation_observe', 'simulation_stage', 'simulation_submit'])
    if (step > 0) assert.ok(objects(options.messages).some(item => item.status === 'observed' && typeof item.time === 'string'))
    calendarProbeRequests.push({ entityId: String(marker.entityId), contextKey: marker.contextKey,
      tool, input: JSON.stringify(options.messages) })
    const args = JSON.stringify(step === 1 ? { proposals: probe.proposals.map(value => simulationProposalSchema.parse(value)) } : {})
    const id = CallId(`${key}:${step}`)
    yield { type: 'block-start', index: 0, blockType: 'tool-call' }
    yield { type: 'tool-call-delta', index: 0, id, name: tool, argumentsDelta: args }
    yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name: tool, arguments: args } }
    yield { type: 'usage', usage: { inputTokens: 10, outputTokens: 5 } }
    yield { type: 'finish', reason: { kind: 'tool-calls' } }
  })
}
