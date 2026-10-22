/** Actual Agent proposals read only recorded context views; deterministic environment outcomes are never supplied by this model. */
import assert from 'node:assert/strict'
import type { Context } from '@clocky/cordis'
import { CallId, LlmAdapter } from '@clocky/clocky-llm'
import type { GenerateOptions, StreamChunk } from '@clocky/clocky-llm'
export const name = 'world-external-fault-scripted-model'
export const inject = ['llm']
export const requests: string[] = []
function objects(value: unknown): Record<string, unknown>[] {
  if (typeof value === 'string') return value.split('\n').flatMap((line) => {
    if (!line.trimStart().startsWith('{')) return []
    let decoded: unknown
    try { decoded = JSON.parse(line) }
    catch { return [] /* Prose is not an authoritative context source. */ }
    return objects(decoded)
  })
  if (value === null || typeof value !== 'object') return []
  if (Array.isArray(value)) return value.flatMap(objects)
  const item = value as Record<string, unknown>
  return [item, ...Object.values(item).flatMap(objects)]
}
function record(value: unknown): Record<string, unknown> {
  assert.ok(value !== null && typeof value === 'object' && !Array.isArray(value))
  return value as Record<string, unknown>
}
/** Loader-installed external cognition has no access to Native or Team service objects. */
export function apply(ctx: Context): void {
  const calls = new Map<string, number>()
  class Model extends LlmAdapter {
    async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
      const values = objects(options.messages.filter(value => value.role === 'user'
        && !value.content.some(block => block.type === 'tool-result')))
      const marker = values.findLast(value => value.kind === 'world-driver'), input = values.findLast(value => value.kind === 'world-context')
      assert.ok(marker)
      const key = `${String(marker.entityId)}/${String(marker.contextKey)}`, step = calls.get(key) ?? 0
      calls.set(key, step + 1)
      const tool = ['simulation_observe', 'simulation_stage', 'simulation_submit'][step]
      assert.ok(tool)
      requests.push(`${String(marker.purpose)}/${tool}`)
      let action: object | undefined
      if (marker.purpose === 'goal') {
        assert.ok(input)
        const available = record((input.operations as unknown[]).find(value => record(record(value).pin).domain === 'external'))
        const target = record((available.targets as unknown[])[0]), goal = values.findLast(value => value.kind === 'world-goal')?.goal
        assert.equal(typeof goal, 'string')
        const [businessKey, externalKey, unit] = String(goal).split('/')
        assert.ok(businessKey && externalKey && unit)
        action = { kind: 'world/request', domain: 'external', operation: 'interact', version: '1', businessKey,
          expectedTime: null, evidence: [], payload: { scope: target.scopeEntityId, subjectRef: target.targetEntityId,
            externalKey, sourceKind: 'simulated-rule', policyRef: 'clocky.external.availability/1', input: { kind: 'availability', unit } } }
      } else if (marker.purpose === 'resolve') {
        assert.ok(input)
        const request = record(input.request)
        action = { kind: 'world/resolve', requestId: request.id, supersedes: null,
          resolution: { kind: 'apply', payload: { kind: 'evaluate-rule' }, rationale: 'PRIVATE-DIRECTOR-RATIONALE-NOT-AN-EXTERNAL-OBSERVATION' } }
      } else if (marker.purpose === 'result') { assert.ok(input); action = record(record(input.authority).notification) }
      else assert.equal(marker.purpose, 'message')
      const args = JSON.stringify(step === 1 ? { proposals: action === undefined ? [] : [{ after: [], action }] } : {})
      const id = CallId(`${key}:${step}`)
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 0, id, name: tool, argumentsDelta: args }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name: tool, arguments: args } }
      yield { type: 'usage', usage: { inputTokens: 10, outputTokens: 5 } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
    }
  }
  ctx.effect(() => ctx.llm.registerAdapter(['world-external-fault-scripted'], new Model()))
}
