/** Keyless policy and single-case approval decisions read only each actual Agent's recorded context. */
import assert from 'node:assert/strict'
import type { Context } from '@clocky/cordis'
import { CallId, LlmAdapter } from '@clocky/clocky-llm'
import type { GenerateOptions, StreamChunk } from '@clocky/clocky-llm'
import { hireApprovalBody, simulationHireApprovalTargetSchema, simulationWorldTemplateSchema } from '@clocky/clocky-simulation'

export const name = 'world-norm-scripted-model'
export const inject = ['llm']
export const requests: Array<{ entityId: string; purpose: string; tool: string }> = []
export const modelInputs: string[] = []

function record(value: unknown): Record<string, unknown> {
  assert.ok(value !== null && typeof value === 'object' && !Array.isArray(value))
  return value as Record<string, unknown>
}
function objects(value: unknown): Record<string, unknown>[] {
  if (typeof value === 'string') return value.split('\n').flatMap((line) => {
    if (!line.trimStart().startsWith('{') && !line.trimStart().startsWith('[')) return []
    let parsed: unknown
    try { parsed = JSON.parse(line) }
    catch { return [] /* Ordinary prose does not provide an original business reference. */ }
    return objects(parsed)
  })
  if (value === null || typeof value !== 'object') return []
  if (Array.isArray(value)) return value.flatMap(objects)
  const item = value as Record<string, unknown>
  return [item, ...Object.values(item).flatMap(objects)]
}

/** Install external test cognition; the adapter cannot inspect Native, Team, driver or fixture state. */
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
      modelInputs.push(JSON.stringify(options.messages))
      let action: object | undefined
      if (marker.purpose !== 'message') {
        const input = values.findLast(value => value.kind === 'world-context')
        assert.ok(input)
        const authority = record(input.authority)
        if (marker.purpose === 'goal') {
          const wake = values.findLast(value => value.kind === 'world-goal')
          assert.ok(wake && typeof wake.goal === 'string')
          const operation = (name: string) => {
            const value = (input.operations as unknown[]).map(record).find(candidate => record(candidate.pin).operation === name)
            assert.ok(value, `Actual actor lacks ${name}`)
            return value
          }
          const request = (name: string, businessKey: string, payload: unknown) => ({ kind: 'world/request', domain: name === 'generate-and-hire'
            ? 'organization' : 'governance', operation: name, version: '1', businessKey, expectedTime: null, evidence: [], payload })
          if (wake.goal === 'propose-policy') {
            const target = record((operation('propose-norm').targets as unknown[])[0])
            action = request('propose-norm', 'policy-proposal', { committeeId: target.targetEntityId, scopeId: target.scopeEntityId,
              body: '每次招聘必须由政策委员会独立批准，并限于声明的岗位。', target: { kind: 'norm', norm: { id: 'hiring-policy', version: '1' } },
              policyRef: 'clocky.governance/1', rule: { kind: 'unanimity' }, quorum: 2, deadline: '100' })
          } else if (wake.goal === 'vote-policy' || wake.goal === 'vote-hire-approval') {
            const kind = wake.goal === 'vote-policy' ? 'norm' : 'hire-approval'
            const original = (input.governance as unknown[]).map(record).find(value => record(value.target).kind === kind)
            assert.ok(original)
            action = request('vote', `${wake.goal}:${marker.entityId}`, { proposalId: original.proposalId,
              proposalRevision: original.proposalRevision, bodyHash: original.bodyHash, choice: 'yes' })
          } else if (wake.goal === 'enact-policy') {
            const material = record(operation('enact-norm').material)
            const opportunity = record((material.opportunities as unknown[])[0])
            action = request('enact-norm', 'policy-enactment', { norm: opportunity.norm, prior: opportunity.prior,
              proposal: opportunity.proposal, resolution: opportunity.resolution, scope: opportunity.scope, body: opportunity.body,
              effectiveFrom: opportunity.currentTime, effectiveUntil: null, availableAt: opportunity.currentTime,
              audience: { kind: 'public' }, impact: 'future-admissions',
              enforcement: { kind: 'validated', policyRef: 'clocky.organization.hiring-approval/1', params: {
                committeeId: opportunity.committeeId, positionIds: opportunity.positionIds, maxHires: 1 } } })
          } else if (wake.goal === 'request-hire') {
            const target = record((operation('generate-and-hire').targets as unknown[])[0])
            action = request('generate-and-hire', 'committee-approved-hire', { organizationEntityId: target.scopeEntityId,
              positionEntityId: target.targetEntityId, description: 'A colleague is needed; request the actual committee approval.' })
          } else if (wake.goal === 'propose-hire-approval') {
            const material = record(operation('propose-hire-approval').material)
            const opportunity = record((material.opportunities as unknown[])[0])
            const target = simulationHireApprovalTargetSchema.parse(opportunity.target)
            action = request('propose-hire-approval', 'single-hire-approval', { committeeId: opportunity.committeeId,
              scopeId: opportunity.scopeId, body: hireApprovalBody(target), target: { kind: 'hire-approval', approval: target },
              policyRef: 'clocky.governance/1', rule: { kind: 'unanimity' }, quorum: 2, deadline: '100' })
          } else throw new Error(`Unexpected recorded policy goal ${wake.goal}`)
        } else if (marker.purpose === 'resolve') {
          const request = record(input.request)
          let payload: unknown = { kind: 'acknowledge' }
          if (input.enactment !== undefined) payload = input.enactment
          else if (input.application !== undefined) {
            const template = simulationWorldTemplateSchema.parse((input.templates as unknown[])[0])
            payload = { templateId: template.id, templateVersion: template.version,
              persona: { name: template.names[0], skills: template.skills, traits: template.traits, goals: template.goals } }
          }
          action = { kind: 'world/resolve', requestId: request.id, supersedes: request.priorPlan === null
            ? null : record(request.priorPlan).id,
          resolution: { kind: 'apply', payload, rationale: 'Private policy workflow validation.' } }
        } else if (marker.purpose === 'result') action = record(authority.notification)
        else if (marker.purpose === 'first-action') {
          const route = record(input.communication), persona = record(record(input.newcomer).persona), result = record(input.result)
          action = { kind: 'communication/post', recipient: route.recipient, channelId: route.channelId,
            deliverAt: result.time, text: `I am ${String(persona.name)} and ready to work.` }
        } else throw new Error(`Unexpected policy purpose ${marker.purpose}`)
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
  ctx.effect(() => ctx.llm.registerAdapter(['world-norm-scripted'], new Model()))
}
