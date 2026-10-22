/** Keyless independent votes read only each actual Agent's consumed World material and three-tool flow. */
import assert from 'node:assert/strict'
import type { Context } from '@clocky/cordis'
import { CallId, LlmAdapter } from '@clocky/clocky-llm'
import type { GenerateOptions, StreamChunk } from '@clocky/clocky-llm'

export const name = 'world-governance-scripted-model'
export const inject = ['llm']
export const requests: Array<{ entityId: string; purpose: string; tool: string }> = []
export const modelInputs: GenerateOptions[] = []

function objects(value: unknown): Record<string, unknown>[] {
  if (typeof value === 'string') return value.split('\n').flatMap((line) => {
    if (!line.trimStart().startsWith('{') && !line.trimStart().startsWith('[')) return []
    let parsed: unknown
    try { parsed = JSON.parse(line) }
    catch { return [] /* Ordinary prose contains no authoritative structured input. */ }
    return objects(parsed)
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

/** Install external cognition through the Loader without giving the adapter access to Native or Team objects. */
export function apply(ctx: Context): void {
  const calls = new Map<string, number>()
  class Model extends LlmAdapter {
    async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
      modelInputs.push(structuredClone(options))
      const values = objects(options.messages.filter(message => message.role === 'user'
        && !message.content.some(block => block.type === 'tool-result')))
      const marker = values.findLast(value => value.kind === 'world-driver')
      assert.ok(marker && typeof marker.entityId === 'string' && typeof marker.purpose === 'string')
      const key = `${marker.entityId}/${String(marker.contextKey)}`, step = calls.get(key) ?? 0
      calls.set(key, step + 1)
      const tool = ['simulation_observe', 'simulation_stage', 'simulation_submit'][step]
      assert.ok(tool)
      requests.push({ entityId: marker.entityId, purpose: marker.purpose, tool })
      let action: object | undefined
      if (marker.purpose !== 'message') {
        const input = values.findLast(value => value.kind === 'world-context')
        assert.ok(input)
        if (marker.purpose === 'goal') {
          const materials = input.governance
          const proposal: unknown = Array.isArray(materials) ? materials.at(-1) : undefined
          if (proposal === undefined) {
            const available = (input.operations as unknown[]).map(record).find(value => record(value.pin).operation === 'propose-norm')
            assert.ok(available)
            const target = record((available.targets as unknown[])[0])
            action = { kind: 'world/request', domain: 'governance', operation: 'propose-norm', version: '1',
              businessKey: 'committee-hiring-policy', expectedTime: null, evidence: [], payload: {
                committeeId: target.targetEntityId, scopeId: target.scopeEntityId, body: '招聘需要委员会独立批准。',
                target: { kind: 'norm', norm: { id: 'committee-hiring', version: '1' } }, policyRef: 'clocky.governance/1',
                rule: { kind: 'absolute-threshold', yes: 2 }, quorum: 2, deadline: '100' } }
          } else {
            const original = record(proposal)
            assert.equal(original.body, '招聘需要委员会独立批准。')
            action = { kind: 'world/request', domain: 'governance', operation: 'vote', version: '1',
              businessKey: `independent-vote:${marker.entityId}`, expectedTime: null, evidence: [],
              payload: { proposalId: original.proposalId, proposalRevision: original.proposalRevision,
                bodyHash: original.bodyHash, choice: 'yes' } }
          }
        } else if (marker.purpose === 'resolve') {
          const request = record(input.request)
          action = { kind: 'world/resolve', requestId: request.id, supersedes: null,
            resolution: { kind: 'apply', payload: { kind: 'acknowledge' }, rationale: 'Acknowledge the original independent contribution.' } }
        } else if (marker.purpose === 'result') action = record(record(input.authority).notification)
        else throw new Error(`Unexpected governance purpose ${marker.purpose}`)
      }
      const args = JSON.stringify(step === 1 ? { proposals: action === undefined ? [] : [{ after: [], action }] } : {})
      const id = CallId(`${key}:${step}`)
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 0, id, name: tool, argumentsDelta: args }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name: tool, arguments: args } }
      yield { type: 'usage', usage: { inputTokens: 10, outputTokens: 5 } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
    }
  }
  ctx.effect(() => ctx.llm.registerAdapter(['world-governance-scripted'], new Model()))
}
