/** Keyless cognition derives all personnel identities and effects from the actual Session's recorded material. */
import assert from 'node:assert/strict'
import type { Context } from '@clocky/cordis'
import { CallId, LlmAdapter } from '@clocky/clocky-llm'
import type { GenerateOptions, StreamChunk } from '@clocky/clocky-llm'
import { simulationWorldTransferPayloadSchema } from '@clocky/clocky-simulation'

export const name = 'world-personnel-scripted-model'
export const inject = ['llm']
export const requests: Array<{ entityId: string; purpose: string; tool: string }> = []
export const modelInputs: Array<{ entityId: string; purpose: string; input: string }> = []
function record(value: unknown): Record<string, unknown> {
  assert.ok(value !== null && typeof value === 'object' && !Array.isArray(value))
  return value as Record<string, unknown>
}
function objects(value: unknown): Record<string, unknown>[] {
  if (typeof value === 'string') return value.split('\n').flatMap((line) => {
    if (!line.trimStart().startsWith('{') && !line.trimStart().startsWith('[')) return []
    let parsed: unknown
    try { parsed = JSON.parse(line) }
    catch { return [] /* Unstructured prose provides no authoritative person, assignment or permission references. */ }
    return objects(parsed)
  })
  if (value === null || typeof value !== 'object') return []
  if (Array.isArray(value)) return value.flatMap(objects)
  const item = record(value)
  return [item, ...Object.values(item).flatMap(objects)]
}

/** Install an external model adapter with no Native snapshot, Team ledger, driver or test identity access. */
export function apply(ctx: Context): void {
  const calls = new Map<string, number>()
  class Model extends LlmAdapter {
    async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
      const values = objects(options.messages.filter(message => message.role === 'user'
        && !message.content.some(block => block.type === 'tool-result')))
      const marker = values.findLast(value => value.kind === 'world-driver')
      assert.ok(marker && typeof marker.entityId === 'string' && typeof marker.purpose === 'string')
      const key = `${marker.entityId}/${String(marker.contextKey)}`, step = calls.get(key) ?? 0
      calls.set(key, step + 1)
      const tool = ['simulation_observe', 'simulation_stage', 'simulation_submit'][step]
      assert.ok(tool)
      requests.push({ entityId: marker.entityId, purpose: marker.purpose, tool })
      modelInputs.push({ entityId: marker.entityId, purpose: marker.purpose, input: JSON.stringify(options.messages) })
      let action: object | undefined
      if (marker.purpose !== 'message') {
        const input = values.findLast(value => value.kind === 'world-context')
        assert.ok(input)
        if (marker.purpose === 'goal') {
          const wake = values.findLast(value => value.kind === 'world-goal')
          assert.ok(wake && typeof wake.goal === 'string')
          const operations = (input.operations as unknown[]).map(record)
          if (wake.goal === 'transfer-original-person') {
            const installed = operations.find(value => record(value.pin).operation === 'transfer')
            assert.ok(installed)
            const material = record(installed.material)
            assert.equal(material.kind, 'transfer-opportunities')
            const opportunity = record((material.opportunities as unknown[])[0])
            const payload = simulationWorldTransferPayloadSchema.parse({ organizationEntityId: opportunity.organizationEntityId,
              personId: opportunity.personId, assignmentId: opportunity.assignmentId, assignmentRevision: opportunity.assignmentRevision,
              targetPositionId: opportunity.targetPositionId, requestedEffectiveAt: null,
              description: 'Transfer the original colleague at the next proven safe boundary, preserving identity and memory.' })
            action = { kind: 'world/request', domain: 'organization', operation: 'transfer', version: '1',
              businessKey: 'original-person-transfer', expectedTime: payload.requestedEffectiveAt, evidence: [], payload }
          } else if (wake.goal === 'inspect-new-role') {
            const hiring = operations.find(value => record(value.pin).operation === 'generate-and-hire')
            assert.ok(hiring, 'The actual new-role context must contain its scenario-declared hiring permission')
            assert.ok(Array.isArray(hiring.targets) && hiring.targets.length > 0)
          } else throw new Error(`Unexpected personnel goal ${wake.goal}`)
        } else if (marker.purpose === 'resolve') {
          const request = record(input.request), payload = simulationWorldTransferPayloadSchema.parse(input.personnel)
          action = { kind: 'world/resolve', requestId: request.id,
            supersedes: request.priorPlan === null ? null : record(request.priorPlan).id,
            resolution: { kind: 'apply', payload, rationale: 'DIRECTOR-PRIVATE-PERSONNEL-CANARY' } }
        } else if (marker.purpose === 'result') action = record(record(input.authority).notification)
        else if (marker.purpose === 'first-action') {
          const route = record(input.communication), result = record(input.result), personnel = record(input.personnel)
          assert.equal(personnel.entityId, marker.entityId)
          action = { kind: 'communication/post', recipient: route.recipient, channelId: route.channelId, deliverAt: result.time,
            text: 'The original colleague acknowledges the recorded new assignment and its declared responsibilities.' }
        } else throw new Error(`Unexpected personnel purpose ${marker.purpose}`)
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
  ctx.effect(() => ctx.llm.registerAdapter(['world-personnel-scripted'], new Model()))
}
