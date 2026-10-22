/** Capability-free model uses only the actual recorded ledger view and the three production tools. */
import assert from 'node:assert/strict'
import type { Context } from '@clocky/cordis'
import { CallId, LlmAdapter } from '@clocky/clocky-llm'
import type { GenerateOptions, StreamChunk } from '@clocky/clocky-llm'
export const name = 'resource-reservation-model'
export const inject = ['llm']
export const resourceModelRequests: Array<{ purpose: string; tool: string; messages: unknown }> = []
function objects(value: unknown): Record<string, unknown>[] {
  if (typeof value === 'string') return value.split('\n').flatMap((line) => {
    if (!line.trimStart().startsWith('{')) return []
    let decoded: unknown
    try { decoded = JSON.parse(line) }
    catch { return [] /* Ordinary instruction text has no ledger authority. */ }
    return objects(decoded)
  })
  if (value === null || typeof value !== 'object') return []
  if (Array.isArray(value)) return value.flatMap(objects)
  const item = value as Record<string, unknown>
  return [item, ...Object.values(item).flatMap(objects)]
}
/** @param ctx - Loader services; this adapter has no Native, Actor or storage handle. */
export function apply(ctx: Context): void {
  const counts = new Map<string, number>()
  class Model extends LlmAdapter {
    async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
      const primary = objects(options.messages.filter(value => value.role === 'user' && !value.content.some(block => block.type === 'tool-result')))
      const input = primary.findLast(value => value.kind === 'resource-reservation-probe'); assert.ok(input)
      const purpose = String(input.purpose), step = counts.get(purpose) ?? 0
      counts.set(purpose, step + 1)
      const tool = ['simulation_observe', 'simulation_stage', 'simulation_submit'][step]; assert.ok(tool)
      assert.deepEqual(options.tools?.map(value => value.name).sort(), ['simulation_observe', 'simulation_stage', 'simulation_submit'])
      const resources = input.resources as Array<{ id: string; revision: number }>
      assert.ok(Array.isArray(resources))
      const transaction = (quantity: string) => ({ commitmentId: null,
        reads: resources.map(({ id, revision }) => ({ resourceId: id, revision })), transfers: [{ from: 'cash', to: 'payee', quantity }] })
      let action: object
      if (purpose === 'reserve') action = { kind: 'resource/reserve', id: 'original-hold', expiresAt: '2', grants: [], transaction: transaction('6') }
      else if (purpose === 'overbook') action = { kind: 'resource/reserve', id: 'new-id-overbook', expiresAt: '2', grants: [], transaction: transaction('5') }
      else if (purpose === 'spend-held') action = { kind: 'resource/transfer', grants: [], transaction: transaction('5') }
      else if (purpose === 'commit-after-expiry') action = { kind: 'resource/commit-reservation', id: 'original-hold', expectedRevision: 2 }
      else if (purpose === 'reserve-payment') action = { kind: 'resource/reserve', id: 'payment-hold', expiresAt: '4', grants: [], transaction: transaction('3') }
      else if (purpose === 'commit-payment') action = { kind: 'resource/commit-reservation', id: 'payment-hold', expectedRevision: 1 }
      else if (purpose === 'reserve-cancel') action = { kind: 'resource/reserve', id: 'cancel-hold', expiresAt: '3', grants: [], transaction: transaction('4') }
      else if (purpose === 'cancel') action = { kind: 'resource/cancel-reservation', id: 'cancel-hold', expectedRevision: 1 }
      else { assert.equal(purpose, 'history-limit'); action = { kind: 'resource/reserve', id: 'quota-bypass', expiresAt: '5', grants: [], transaction: transaction('1') } }
      resourceModelRequests.push({ purpose, tool, messages: options.messages })
      const args = JSON.stringify(step === 1 ? { proposals: [{ after: [], action }] } : {}), id = CallId(`${purpose}:${step}`)
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 0, id, name: tool, argumentsDelta: args }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name: tool, arguments: args } }
      yield { type: 'usage', usage: { inputTokens: 10, outputTokens: 5 } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
    }
  }
  ctx.effect(() => ctx.llm.registerAdapter(['resource-reservation-scripted'], new Model()))
}
