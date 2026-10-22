/** Representative cognition reads only actual Agent input, including canonical received Channel messages. */
import assert from 'node:assert/strict'
import type { Context } from '@clocky/cordis'
import { CallId, LlmAdapter } from '@clocky/clocky-llm'
import type { GenerateOptions, StreamChunk } from '@clocky/clocky-llm'
import { simulationWorldTemplateSchema } from '@clocky/clocky-simulation'

export const name = 'world-external-mediated-actor-scripted-model'
export const inject = ['llm']
export const requests: Array<{ entityId: string; purpose: string; tool: string; input: string }> = []
function objects(value: unknown): Record<string, unknown>[] {
  if (typeof value === 'string') return value.split('\n').flatMap((line) => {
    if (!line.trimStart().startsWith('{') && !line.trimStart().startsWith('[')) return []
    let decoded: unknown
    try { decoded = JSON.parse(line) }
    catch { return [] /* Ordinary prose carries no structured context authority. */ }
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

/** Loader-installed deterministic provider has no Native or Team capability references. */
export function apply(ctx: Context): void {
  const calls = new Map<string, number>()
  class Model extends LlmAdapter {
    async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
      const current = options.messages.filter(value => value.role === 'user'
        && !value.content.some(block => block.type === 'tool-result'))
      const values = objects(current), marker = values.findLast(value => value.kind === 'world-driver')
      assert.ok(marker)
      const key = `${String(marker.entityId)}/${String(marker.contextKey)}`, step = calls.get(key) ?? 0
      calls.set(key, step + 1)
      const tool = ['simulation_observe', 'simulation_stage', 'simulation_submit'][step]
      assert.ok(tool)
      requests.push({ entityId: String(marker.entityId), purpose: String(marker.purpose), tool, input: JSON.stringify(options.messages) })
      const input = values.findLast(value => value.kind === 'world-context')
      const externalAllowed = (value: Record<string, unknown>) => record(record(value.externalMediated).responseScope)
      let action: object | undefined
      if (marker.purpose === 'contract-propose' || marker.purpose === 'contract-accept') {
        const contract = values.findLast(value => value.kind === 'supplier-contract')
        assert.ok(contract)
        action = marker.purpose === 'contract-propose'
          ? { kind: 'interaction/request', id: contract.id, assignee: contract.custodian, description: contract.description,
            replyBy: null, completeBy: null, fulfillment: contract.fulfillment }
          : { kind: 'interaction/accept', id: contract.id, expectedRevision: contract.revision }
      } else if (marker.purpose === 'goal') {
        assert.ok(input)
        const available = record((input.operations as unknown[]).find((value) => {
          const pin = record(record(value).pin)
          return pin.domain === 'external'
            && pin.version === (String(values.findLast(value => value.kind === 'world-goal')?.goal).startsWith('reuse/') ? '2' : '3')
        }))
        const target = record((available.targets as unknown[])[0])
        const goal = String(values.findLast(value => value.kind === 'world-goal')?.goal)
        const [businessKey, externalKey, unit] = goal.split('/')
        assert.ok(businessKey && externalKey && unit)
        action = businessKey !== 'reuse' ? { kind: 'world/request', domain: 'external', operation: 'interact', version: '3', businessKey,
          expectedTime: null, evidence: [], payload: { scope: target.scopeEntityId, subjectRef: target.targetEntityId,
            externalKey, sourceKind: 'director-mediated', policyRef: 'clocky.external.adjudication/1',
            input: { kind: 'adjudicate', question: 'Prepare an independent simulated supplier representative.', contactUnit: unit },
            responseScope: { allowed: [businessKey === 'commitment' ? 'environmental-fact' : 'representative-preparation-plan'],
              disclosure: { kind: 'requester' } } } }
          : { kind: 'world/request', domain: 'external', operation: 'interact', version: '2', businessKey,
            expectedTime: null, evidence: [], payload: { scope: target.scopeEntityId, subjectRef: target.targetEntityId,
              externalKey, sourceKind: 'simulated-actor', policyRef: 'clocky.external.representative/1',
              input: { kind: 'contact', unit } } }
      } else if (marker.purpose === 'resolve') {
        assert.ok(input)
        if (record(input.operation).version === '3') {
          if ((record(externalAllowed(input)).allowed as unknown[]).includes('environmental-fact')) {
            const contract = record((input.commitments as unknown[])[0])
            const external = record(input.externalMediated)
            action = { kind: 'world/resolve', requestId: record(input.request).id, supersedes: null,
              resolution: { kind: 'apply', payload: { kind: 'adjudicate', outcome: { kind: 'environmental-fact',
                subjectRef: external.subjectRef, sourceKind: 'director-mediated', policyRef: 'clocky.external.adjudication/1',
                attribution: 'scenario-generated', evidence: [], disclosure: { kind: 'requester' }, factKey: 'original-custody',
                claim: { kind: 'commitment-as-of', commitmentId: contract.id, phase: contract.phase },
                effectiveFrom: objects(options.messages).findLast(value => value.status === 'observed')?.time ?? '0',
                effectiveUntil: null } },
              rationale: 'Observe the actual original nonempty custody obligation.' } }
          } else {
            const template = simulationWorldTemplateSchema.parse((input.templates as unknown[])[0])
            const selected = template.names.at(-1)
            assert.ok(selected)
            const external = record(input.externalMediated)
            action = { kind: 'world/resolve', requestId: record(input.request).id, supersedes: null,
              resolution: { kind: 'apply', payload: { kind: 'adjudicate', outcome: { kind: 'representative-preparation-plan',
                subjectRef: external.subjectRef, sourceKind: 'director-mediated', policyRef: 'clocky.external.adjudication/1',
                attribution: 'scenario-generated', evidence: [], disclosure: { kind: 'requester' },
                preparation: { templateId: template.id, templateVersion: template.version,
                  persona: { name: selected, skills: template.skills, traits: template.traits, goals: template.goals } },
                contactUnit: record(external.input).contactUnit } }, rationale: 'PRIVATE-DIRECTOR-REPRESENTATIVE-RATIONALE' } }
          }
        } else {
          const representative = record(input.representative)
          assert.equal(representative.status, 'committed')
          action = { kind: 'world/resolve', requestId: record(input.request).id, supersedes: null,
            resolution: { kind: 'apply', payload: { kind: 'reuse', identityId: representative.identityId, generation: 1 },
              rationale: 'Reuse this actual original mediated representative.' } }
        }
      } else if (marker.purpose === 'result') {
        assert.ok(input)
        action = record(record(input.authority).notification)
      } else if (marker.purpose === 'first-action') {
        assert.ok(input)
        const actual = record(record(record(record(input.result).payload).outcome).actual)
        const communication = record(input.communication)
        assert.equal(actual.entityId, communication.recipient)
        assert.equal(actual.channelId, communication.channelId)
        assert.equal(actual.requesterEntityId, marker.entityId)
        action = { kind: 'communication/post', recipient: communication.recipient, channelId: communication.channelId,
          deliverAt: record(input.result).time, text: JSON.stringify({ kind: 'mediated-contact', sourceKind: 'director-mediated',
            representativeEntityId: actual.entityId, requesterEntityId: actual.requesterEntityId, unit: actual.contactUnit }) }
      } else {
        assert.equal(marker.purpose, 'message')
        if (step === 1) {
          // A durable Team source identifies the received query. Neither arbitrary context prose nor a plan is a query.
          const received = current.findLast(value => value.source?.kind === 'team-envelope'
            && objects(value.content).some(item => item.sourceKind === 'simulated-actor' && item.entityId === marker.entityId
              || item.kind === 'mediated-contact' && item.representativeEntityId === marker.entityId))
          if (received !== undefined) {
            assert.equal(received.source?.kind, 'team-envelope')
            if (received.source?.kind !== 'team-envelope') throw new Error('Representative reply lost its received Channel source')
            const contact = objects(received.content).find(value => value.sourceKind === 'simulated-actor'
              || value.kind === 'mediated-contact')!
            const observed = objects(options.messages).findLast(value => value.status === 'observed')
            assert.ok(observed)
            assert.equal(typeof contact.unit, 'string')
            assert.equal(typeof contact.requesterEntityId, 'string')
            action = { kind: 'communication/post', recipient: contact.requesterEntityId, channelId: received.source.channelId,
              deliverAt: observed.time, text: `I represent the supplier. I received your inquiry about ${String(contact.unit)}.` }
          }
        }
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
  ctx.effect(() => ctx.llm.registerAdapter(['world-external-mediated-actor-scripted'], new Model()))
}
