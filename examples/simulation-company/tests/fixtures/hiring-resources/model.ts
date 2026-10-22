/** This adapter has no Native, Team or storage handle; every business reference comes from its actual recorded context. */
import assert from 'node:assert/strict'
import type { Context } from '@clocky/cordis'
import { LlmAdapter, CallId } from '@clocky/clocky-llm'
import type { GenerateOptions, StreamChunk } from '@clocky/clocky-llm'
export const name = 'hiring-resource-model'
export const inject = ['llm']
export const hiringModelRequests: Array<{ actor: string; contextKey: string; purpose: string; tool: string; messages: unknown }> = []
function objects(value: unknown): Record<string, unknown>[] {
  if (typeof value === 'string') return value.split('\n').flatMap((line) => {
    if (!line.trimStart().startsWith('{')) return []
    let decoded: unknown
    try { decoded = JSON.parse(line) } catch { return [] /* Ordinary prose does not supply a business reference. */ }
    return objects(decoded)
  })
  if (value === null || typeof value !== 'object') return []
  if (Array.isArray(value)) return value.flatMap(objects)
  return [value as Record<string, unknown>, ...Object.values(value).flatMap(objects)]
}
function record(value: unknown): Record<string, unknown> {
  assert.ok(value !== null && typeof value === 'object' && !Array.isArray(value)); return value as Record<string, unknown>
}
/** @param ctx - Provider registry; this model cannot obtain business services or execute IO. */
export function apply(ctx: Context): void {
  const counts = new Map<string, number>()
  class Model extends LlmAdapter {
    async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
      const values = objects(options.messages.filter(value => value.role === 'user' &&
        !value.content.some(block => block.type === 'tool-result')))
      const marker = values.findLast(value => value.kind === 'world-driver'); assert.ok(marker)
      const key = `${String(marker.entityId)}/${String(marker.contextKey)}`, step = counts.get(key) ?? 0
      counts.set(key, step + 1)
      const deniedGoal = process.env.WORLD_HIRING_POLICY_BOUNDARY === 'blocked' && marker.purpose === 'goal'
      const tool = (deniedGoal ? ['simulation_observe', 'simulation_stage', 'simulation_submit', 'simulation_stage', 'simulation_submit']
        : ['simulation_observe', 'simulation_stage', 'simulation_submit'])[step]; assert.ok(tool)
      if (deniedGoal && step === 3) {
        const refusal = objects(options.messages).findLast(value => value.type === 'tool-result')
        assert.equal(refusal?.isError, true)
        assert.ok(JSON.stringify(refusal).includes('current authoritative policy'))
      }
      assert.deepEqual(options.tools?.map(value => value.name).sort(), ['simulation_observe', 'simulation_stage', 'simulation_submit'])
      hiringModelRequests.push({ actor: String(marker.entityId), contextKey: String(marker.contextKey),
        purpose: String(marker.purpose), tool, messages: options.messages })
      let action: object | undefined
      if (marker.purpose !== 'message') {
        const input = values.findLast(value => value.kind === 'world-context'); assert.ok(input)
        const authority = record(input.authority)
        if (marker.purpose === 'goal') {
          const operations = (input.operations as unknown[]).map(record)
          const operation = operations.find(value => ['generate-and-hire', 'hire-existing'].includes(String(record(value.pin).operation)))
          assert.ok(operation); const pin = record(operation.pin), material = record(operation.material)
          const fee = record((material.hiringFees as unknown[])[0]); assert.equal(fee.quantity,
            '3'); assert.equal(fee.reservationPeriod, '10')
          const target = record((operation.targets as unknown[])[0])
          const opportunity = pin.operation === 'hire-existing' ? record((material.opportunities as unknown[])[0]) : undefined
          action = { kind: 'world/request', domain: 'organization', operation: pin.operation, version: '1',
            businessKey: 'original-funded-hire',
            expectedTime: null, evidence: [], payload: { organizationEntityId: target.scopeEntityId, positionEntityId: fee.positionEntityId,
              description: 'Hire one colleague at the original recorded charge.',
              ...opportunity === undefined ? {} : { personId: opportunity.personId } } }
        } else if (marker.purpose === 'resolve') {
          const request = record(input.request), fee = record(input.hiringFee); assert.equal(fee.quantity, '3')
          const template = input.existingHire === undefined ? record((input.templates as unknown[])[0]) : undefined
          const payload = template === undefined ? input.existingHire : { templateId: template.id, templateVersion: template.version,
            persona: { name: (template.names as unknown[])[0], skills: [], traits: [], goals: [] } }
          const clarify = process.env.WORLD_HIRING_EVIDENCE === 'true' && request.evidence === null
          action = { kind: 'world/resolve', requestId: request.id,
            supersedes: request.priorPlan === null ? null : record(request.priorPlan).id,
            resolution: clarify ? { kind: 'awaiting-evidence', missingFields: ['requirements'], deadline: '10', maxAttempts: 2,
              rationale: 'PRIVATE-EVIDENCE-DIRECTOR-RATIONALE' }
              : { kind: 'apply', payload, rationale: 'PRIVATE-C40-DIRECTOR-RATIONALE-CANARY' } }
        } else if (marker.purpose === 'evidence') {
          const question = record(input.question)
          assert.equal(process.env.WORLD_HIRING_EVIDENCE, 'true')
          action = { kind: 'world/evidence', requestId: authority.requestId, challengeId: authority.challengeId,
            expectedInputRevision: question.expectedInputRevision, answers: [{ field: 'requirements',
              text: 'The original role requires careful research and collaboration.', references: [] }] }
        } else if (marker.purpose === 'result') action = record(authority.notification)
        else if (marker.purpose === 'first-action') {
          const route = record(input.communication), result = record(input.result)
          action = { kind: 'communication/post', recipient: route.recipient, channelId: route.channelId, deliverAt: result.time,
            text: 'The colleague acknowledges the recorded assignment.' }
        } else throw new Error(`Unsupported original hiring purpose ${String(marker.purpose)}`)
      }
      const args = JSON.stringify(step === 1 ? { proposals: action === undefined ? [] : [{ after: [],
          action }] } : deniedGoal && step === 3 ? { proposals: [] } : {}), id = CallId(`${key}:${step}`)
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 0, id, name: tool, argumentsDelta: args }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name: tool, arguments: args } }
      yield { type: 'usage', usage: { inputTokens: 10, outputTokens: 5 } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
    }
  }
  ctx.effect(() => ctx.llm.registerAdapter(['hiring-resource-scripted'], new Model()))
}
