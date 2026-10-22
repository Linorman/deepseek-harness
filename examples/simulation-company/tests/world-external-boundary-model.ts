/** Finite actual Agent proposals consume recorded views; Native alone validates and publishes each adjudication. */
import assert from 'node:assert/strict'
import type { Context } from '@clocky/cordis'
import { CallId, LlmAdapter } from '@clocky/clocky-llm'
import type { GenerateOptions, StreamChunk } from '@clocky/clocky-llm'
import { simulationExternalMediatedRequestSchema } from '@clocky/clocky-simulation'
import { negativeCases, forbiddenPayload } from './world-external-boundary-cases.ts'
import type { BoundaryCase } from './world-external-boundary-cases.ts'
export const name = 'world-external-boundary-scripted-model'
export const inject = ['llm']
export const boundaryModelRequests: Array<{ entityId: string; purpose: string; tool: string; input: string }> = []
function objects(value: unknown): Record<string, unknown>[] {
  if (typeof value === 'string') return value.split('\n').flatMap((line) => {
    if (!line.trimStart().startsWith('{')) return []
    let decoded: unknown
    try { decoded = JSON.parse(line) }
    catch { return [] /* Ordinary instruction prose is not a Native context. */ }
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
/** The original Native queue validates proposals; this cognition adapter has no Native, storage, network or asset capability. */
export function apply(ctx: Context): void {
  const calls = new Map<string, number>()
  class Model extends LlmAdapter {
    async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
      const primary = objects(options.messages.filter(value => value.role === 'user'
        && !value.content.some(block => block.type === 'tool-result')))
      const marker = primary.findLast(value => value.kind === 'world-driver')
      assert.ok(marker)
      const key = `${String(marker.entityId)}/${String(marker.contextKey)}`, step = calls.get(key) ?? 0
      calls.set(key, step + 1)
      const input = primary.filter(value => value.kind === 'world-context').toSorted((a, b) =>
        Number(record(a.authority).baseRevision) - Number(record(b.authority).baseRevision)).at(-1)
      const purpose = String(marker.purpose), selected = process.env.WORLD_BOUNDARY_CASE as BoundaryCase
      assert.ok(negativeCases.includes(selected))
      const requestMode = purpose === 'goal' ? primary.findLast(value => value.kind === 'world-goal')?.goal
        : purpose === 'resolve' ? simulationExternalMediatedRequestSchema.parse(input?.externalMediated).input.question : undefined
      const probe = requestMode === 'probe'
      const attack = probe && (selected.startsWith('request-') ? purpose === 'goal' : purpose === 'resolve')
      const tool = attack ? ['simulation_observe', 'simulation_stage', 'simulation_submit', 'simulation_submit',
        'simulation_stage', 'simulation_submit'][step] : ['simulation_observe', 'simulation_stage', 'simulation_submit'][step]
      assert.ok(tool)
      boundaryModelRequests.push({ entityId: String(marker.entityId), purpose, tool, input: JSON.stringify(options.messages) })
      if (attack && step >= 3) {
        const rejected = options.messages.flatMap(value => value.content).find(value => value.type === 'tool-result'
          && value.toolCallId === `${key}:2`)
        assert.ok(rejected?.type === 'tool-result' && rejected.isError)
      }
      if (attack && step >= 4) {
        const retried = options.messages.flatMap(value => value.content).find(value => value.type === 'tool-result'
          && value.toolCallId === `${key}:3`)
        assert.ok(retried?.type === 'tool-result' && retried.isError)
      }
      let action: object | undefined
      if (purpose === 'goal') {
        assert.ok(input)
        const operation = record((input.operations as unknown[]).find(value => record(record(value).pin).version === '3'))
        const target = record((operation.targets as unknown[])[0])
        const payload = { scope: target.scopeEntityId, subjectRef: target.targetEntityId, externalKey: 'boundary-vendor',
          sourceKind: 'director-mediated', policyRef: 'clocky.external.adjudication/1', input: { kind: 'adjudicate', question: requestMode },
          responseScope: { allowed: ['failure'], disclosure: { kind: 'requester' } } }
        if (!attack || step < 4) action = { kind: 'world/request', domain: 'external', operation: 'interact', version: '3',
          businessKey: String(requestMode), expectedTime: null, evidence: [],
          payload: attack ? forbiddenPayload(selected, payload) : payload }
      } else if (purpose === 'resolve') {
        assert.ok(input)
        const request = simulationExternalMediatedRequestSchema.parse(input.externalMediated)
        const actual = record(input.request)
        const payload = { kind: 'adjudicate', outcome: { kind: 'failure', subjectRef: request.subjectRef,
          sourceKind: request.sourceKind, policyRef: request.policyRef, attribution: 'scenario-generated', evidence: [],
          disclosure: { kind: 'requester' }, code: 'unavailable', description: 'Bounded simulation result.' } }
        action = { kind: 'world/resolve', requestId: actual.id, supersedes: null, resolution: {
          kind: 'apply', payload: attack && step < 4 ? forbiddenPayload(selected, payload) : payload,
          rationale: 'No outside execution is authorized.' } }
      } else if (purpose === 'result') { assert.ok(input); action = record(record(input.authority).notification) }
      else assert.equal(purpose, 'message')
      const args = JSON.stringify(tool === 'simulation_stage' ? { proposals: action === undefined ? [] : [{ after: [], action }] } : {})
      const id = CallId(`${key}:${step}`)
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 0, id, name: tool, argumentsDelta: args }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name: tool, arguments: args } }
      yield { type: 'usage', usage: { inputTokens: 10, outputTokens: 5 } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
    }
  }
  ctx.effect(() => ctx.llm.registerAdapter(['world-external-boundary-scripted'], new Model()))
}
