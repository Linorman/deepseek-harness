/** Representative cognition reads only actual Agent input, including canonical received Channel messages. */
import assert from 'node:assert/strict'
import type { Context } from '@clocky/cordis'
import { CallId, LlmAdapter } from '@clocky/clocky-llm'
import type { GenerateOptions, StreamChunk } from '@clocky/clocky-llm'
import { simulationWorldTemplateSchema } from '@clocky/clocky-simulation'

export const name = 'world-external-cancel-scripted-model'
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
      let action: object | undefined
      if (marker.purpose === 'goal') {
        assert.ok(input)
        const available = record((input.operations as unknown[]).find((value) => {
          const pin = record(record(value).pin)
          return pin.domain === 'external' && pin.version === '2'
        }))
        const target = record((available.targets as unknown[])[0])
        const goal = String(values.findLast(value => value.kind === 'world-goal')?.goal)
        const [businessKey, externalKey, unit] = goal.split('/')
        assert.ok(businessKey && externalKey && unit)
        action = { kind: 'world/request', domain: 'external', operation: 'interact', version: '2', businessKey,
          expectedTime: null, evidence: [], payload: { scope: target.scopeEntityId, subjectRef: target.targetEntityId,
            externalKey, sourceKind: 'simulated-actor', policyRef: 'clocky.external.representative/1', input: { kind: 'contact', unit } } }
      } else if (marker.purpose === 'resolve') {
        assert.ok(input)
        const template = simulationWorldTemplateSchema.parse((input.templates as unknown[])[0])
        const selected = template.names.at(-1)
        assert.ok(selected)
        action = { kind: 'world/resolve', requestId: record(input.request).id, supersedes: null,
          resolution: { kind: 'apply', payload: { templateId: template.id, templateVersion: template.version,
            persona: { name: selected, skills: template.skills, traits: template.traits, goals: template.goals } },
          rationale: 'PRIVATE-DIRECTOR-REPRESENTATIVE-RATIONALE' } }
      } else if (marker.purpose === 'result') {
        assert.ok(input)
        assert.ok(input.externalContact)
        action = record(record(input.authority).notification)
      } else {
        assert.equal(marker.purpose, 'message')
        if (step === 1) {
          // A durable Team source identifies the received query. Neither arbitrary context prose nor a plan is a query.
          const received = current.findLast(value => value.source?.kind === 'team-envelope'
            && objects(value.content).some(item => item.sourceKind === 'simulated-actor' && item.entityId === marker.entityId))
          if (received !== undefined) {
            assert.equal(received.source?.kind, 'team-envelope')
            if (received.source?.kind !== 'team-envelope') throw new Error('Representative reply lost its received Channel source')
            const contact = objects(received.content).find(value => value.sourceKind === 'simulated-actor')!
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
  ctx.effect(() => ctx.llm.registerAdapter(['world-external-cancel-scripted'], new Model()))
}
