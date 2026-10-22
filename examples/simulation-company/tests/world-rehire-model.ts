/** External keyless cognition uses only the actual actor's recorded World material and three-tool responses. */
import assert from 'node:assert/strict'
import type { Context } from '@clocky/cordis'
import { CallId, LlmAdapter } from '@clocky/clocky-llm'
import type { GenerateOptions, StreamChunk } from '@clocky/clocky-llm'
import { hireApprovalBody, simulationHireApprovalTargetSchema,
  simulationWorldHireExistingPayloadSchema, simulationWorldDepartPayloadSchema } from '@clocky/clocky-simulation'

export const name = 'world-rehire-scripted-model'
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
            domain: name === 'hire-existing' || name === 'depart' ? 'organization' : 'governance', operation: name, version: '1',
            businessKey, expectedTime: null, evidence: [], payload })
          if (wake.goal === 'depart-retire') {
            const material = record(operation('depart').material)
            assert.equal(material.kind, 'departure-opportunities')
            const opportunity = record((material.opportunities as unknown[])[0])
            const payload = simulationWorldDepartPayloadSchema.parse({ organizationEntityId: opportunity.organizationEntityId,
              personId: opportunity.personId, assignmentId: opportunity.assignmentId, assignmentRevision: opportunity.assignmentRevision,
              requestedEffectiveAt: null, description: 'Retire the original colleague before explicitly rehiring the same person.', retire: true })
            action = request('depart', 'original-person-retire-before-rehire', payload)
          } else if (wake.goal === 'propose-policy') {
            const target = record((operation('propose-norm').targets as unknown[])[0])
            action = request('propose-norm', 'existing-person-policy', { committeeId: target.targetEntityId,
              scopeId: target.scopeEntityId, body: '录用既有人物必须得到委员会对该原人物与岗位的独立批准。',
              target: { kind: 'norm', norm: { id: 'existing-person-policy', version: '1' } },
              policyRef: 'clocky.governance/1', rule: { kind: 'unanimity' }, quorum: 2, deadline: '100' })
          } else if (wake.goal === 'vote-policy' || wake.goal === 'vote-hire-approval') {
            const kind = wake.goal === 'vote-policy' ? 'norm' : 'hire-approval'
            const proposal = (input.governance as unknown[]).map(record).find(value => record(value.target).kind === kind)
            assert.ok(proposal)
            action = request('vote', `${wake.goal}:${marker.entityId}`, { proposalId: proposal.proposalId,
              proposalRevision: proposal.proposalRevision, bodyHash: proposal.bodyHash, choice: 'yes' })
          } else if (wake.goal === 'enact-policy') {
            const material = record(operation('enact-norm').material)
            const opportunity = record((material.opportunities as unknown[])[0])
            action = request('enact-norm', 'existing-person-policy-enactment', { norm: opportunity.norm, prior: opportunity.prior,
              proposal: opportunity.proposal, resolution: opportunity.resolution, scope: opportunity.scope, body: opportunity.body,
              effectiveFrom: opportunity.currentTime, effectiveUntil: null, availableAt: opportunity.currentTime,
              audience: { kind: 'public' }, impact: 'future-admissions', enforcement: {
                kind: 'validated', policyRef: 'clocky.organization.hiring-approval/1', params: {
                  committeeId: opportunity.committeeId, positionIds: opportunity.positionIds, maxHires: 1 } } })
          } else if (wake.goal === 'request-existing-person') {
            const material = record(operation('hire-existing').material)
            assert.equal(material.kind, 'existing-hire-opportunities')
            const opportunity = record((material.opportunities as unknown[])[0])
            action = request('hire-existing', 'original-existing-person-hire', simulationWorldHireExistingPayloadSchema.parse({
              organizationEntityId: opportunity.organizationEntityId, positionEntityId: opportunity.positionEntityId,
              personId: opportunity.personId, description: 'Hire the eligible original colleague without replacing identity or memory.' }))
          } else if (wake.goal === 'propose-hire-approval') {
            const opportunity = record((record(operation('propose-hire-approval').material).opportunities as unknown[])[0])
            const target = simulationHireApprovalTargetSchema.parse(opportunity.target)
            assert.equal(target.selection.kind, 'existing-person')
            action = request('propose-hire-approval', 'original-existing-person-approval', { committeeId: opportunity.committeeId,
              scopeId: opportunity.scopeId, body: hireApprovalBody(target), target: { kind: 'hire-approval', approval: target },
              policyRef: 'clocky.governance/1', rule: { kind: 'unanimity' }, quorum: 2, deadline: '100' })
          } else throw new Error(`Unexpected existing-person goal ${wake.goal}`)
        } else if (marker.purpose === 'resolve') {
          const request = record(input.request)
          const payload = input.personnel !== undefined ? simulationWorldDepartPayloadSchema.parse(input.personnel)
            : input.existingHire === undefined ? input.enactment ?? { kind: 'acknowledge' }
              : simulationWorldHireExistingPayloadSchema.parse(input.existingHire)
          action = { kind: 'world/resolve', requestId: request.id, supersedes: request.priorPlan === null
            ? null : record(request.priorPlan).id, resolution: { kind: 'apply', payload,
            rationale: 'DIRECTOR-PRIVATE-REHIRE-CANARY' } }
        } else if (marker.purpose === 'result') action = record(authority.notification)
        else if (marker.purpose === 'first-action') {
          const route = record(input.communication), result = record(input.result), onboarding = record(input.onboarding)
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
  ctx.effect(() => ctx.llm.registerAdapter(['world-rehire-scripted'], new Model()))
}
