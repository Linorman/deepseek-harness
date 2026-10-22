/** External keyless cognition uses only the actual actor's recorded World material and three-tool responses. */
import assert from 'node:assert/strict'
import type { Context } from '@clocky/cordis'
import { CallId, LlmAdapter } from '@clocky/clocky-llm'
import type { GenerateOptions, StreamChunk } from '@clocky/clocky-llm'
import { simulationWorldHireExistingPayloadSchema } from '@clocky/clocky-simulation'

export const name = 'world-hiring-market-scripted-model'
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
    catch { return [] /* Unstructured model prose supplies no authoritative business reference. */ }
    return objects(parsed)
  })
  if (value === null || typeof value !== 'object') return []
  if (Array.isArray(value)) return value.flatMap(objects)
  const item = value as Record<string, unknown>
  return [item, ...Object.values(item).flatMap(objects)]
}

/** Register a provider whose inputs come from real Agent Sessions, with no Native, Team or driver access. */
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
        const authority = record(input.authority)
        if (marker.purpose === 'goal') {
          const wake = values.findLast(value => value.kind === 'world-goal')
          assert.ok(wake && typeof wake.goal === 'string')
          const operation = (name: string) => {
            const value = (input.operations as unknown[]).map(record).find(item => record(item.pin).operation === name)
            assert.ok(value, `Actual actor lacks ${name}`)
            return value
          }
          const request = (name: string, businessKey: string, payload: unknown) => ({ kind: 'world/request',
            domain: 'organization', operation: name, version: '1',
            businessKey, expectedTime: null, evidence: [], payload })
          const market = record(operation('hiring-market').material)
          const target = record((operation('hiring-market').targets as unknown[])[0])
          const scope = { organizationEntityId: target.scopeEntityId, positionEntityId: target.targetEntityId }
          let command: object
          if (wake.goal === 'vacancy') command = { kind: 'vacancy', id: 'vacancy', validUntil: '90', capacity: 1,
            requirements: ['research'], reservationPolicy: process.env.WORLD_MARKET_POLICY ?? 'on-acceptance', ...scope }
          else if (wake.goal === 'application') command = { kind: 'application', id: 'application', vacancyId: 'vacancy', ...scope }
          else if (wake.goal === 'hire') {
            const generated = (input.operations as unknown[]).map(record).some(item => record(item.pin).operation === 'generate-and-hire')
            if (generated) {
              const target = record((operation('generate-and-hire').targets as unknown[])[0])
              action = request('generate-and-hire', 'hire-original', { organizationEntityId: target.scopeEntityId,
                positionEntityId: target.targetEntityId, description: 'Prepare the reviewed independent candidate before any offer acceptance.' })
            } else {
              const opportunity = record((record(operation('hire-existing').material).opportunities as unknown[])[0])
              action = request('hire-existing', 'hire-original', { organizationEntityId: opportunity.organizationEntityId,
                positionEntityId: opportunity.positionEntityId, personId: opportunity.personId, description: 'Hire only after the original candidate accepts.' })
            }
            command = {}
          } else if (wake.goal === 'offer') {
            const plan = record((market.hiringPlans as unknown[])[0])
            command = { kind: 'offer', id: 'offer', expectedRevision: 0, vacancyId: 'vacancy', applicationId: 'application',
              planId: plan.planId, candidateId: plan.personId, validUntil: process.env.WORLD_MARKET_POLICY === 'on-proposal' ? '8' : '80', terms: 'One assignment; no recurring salary.', ...scope }
          } else {
            const offer = record((market.offers as unknown[])[0])
            assert.ok(['delivered', 'accepted', 'declined', 'withdrawn'].includes(wake.goal))
            command = { kind: 'offer-response', id: offer.id, revision: offer.revision, bodyHash: offer.bodyHash, decision: wake.goal, ...scope }
          }
          if (action === undefined) action = request('hiring-market', wake.goal, command)
        } else if (marker.purpose === 'resolve') {
          const request = record(input.request)
          const selected = Array.isArray(input.acceptedDrafts) ? record(input.acceptedDrafts[0]) : undefined
          const payload = input.marketCommand ?? (selected === undefined
            ? simulationWorldHireExistingPayloadSchema.parse(input.existingHire)
            : { ...record(selected.body), personaDraft: { id: selected.id, revision: selected.revision, bodyHash: selected.bodyHash } })
          action = { kind: 'world/resolve', requestId: request.id, supersedes: request.priorPlan === null
            ? null : record(request.priorPlan).id, resolution: { kind: 'apply', payload,
            rationale: 'DIRECTOR-PRIVATE-MARKET-CANARY' } }
        } else if (marker.purpose === 'result') action = record(authority.notification)
        else if (marker.purpose === 'first-action') {
          const route = record(input.communication), result = record(input.result), onboarding = record(input.onboarding ?? input.newcomer)
          assert.equal(onboarding.entityId, marker.entityId)
          action = { kind: 'communication/post', recipient: route.recipient, channelId: route.channelId,
            deliverAt: result.time, text: 'The original colleague accepts the newly recorded assignment.' }
        } else throw new Error(`Unexpected existing-person purpose ${marker.purpose}`)
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
  ctx.effect(() => ctx.llm.registerAdapter(['world-hiring-market-scripted'], new Model()))
}
