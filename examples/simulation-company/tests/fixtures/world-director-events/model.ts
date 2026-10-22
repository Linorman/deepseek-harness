/** Capability-free model proposes only what the original persisted view permits. */
import assert from 'node:assert/strict'
import type { Context } from '@clocky/cordis'
import { CallId, LlmAdapter } from '@clocky/clocky-llm'
import type { GenerateOptions, StreamChunk } from '@clocky/clocky-llm'
export const name = 'world-director-events-model'
export const inject = ['llm']
export const directorModelRequests: Array<{ actor: string; purpose: string; contextKey: string; tool: string; messages: unknown }> = []
function objects(value: unknown): Record<string, unknown>[] {
  if (typeof value === 'string') return value.split('\n').flatMap((line) => {
    if (!line.trimStart().startsWith('{')) return []
    let parsed: unknown
    try { parsed = JSON.parse(line) }
    catch { return [] /* Non-JSON instruction prose carries no Native authority. */ }
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
/** @param ctx - Actual Loader services; the adapter receives only ordinary model inputs. */
export function apply(ctx: Context): void {
  const counts = new Map<string, number>()
  class Model extends LlmAdapter {
    async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
      const primary = objects(options.messages.filter(value => value.role === 'user'
        && !value.content.some(block => block.type === 'tool-result')))
      const marker = primary.findLast(value => value.kind === 'world-driver'); assert.ok(marker)
      const key = `${String(marker.entityId)}/${String(marker.contextKey)}`, step = counts.get(key) ?? 0
      counts.set(key, step + 1)
      const tool = ['simulation_observe', 'simulation_stage', 'simulation_submit'][step]; assert.ok(tool, 'Exactly three tools per original decision')
      assert.deepEqual(options.tools?.map(value => value.name).sort(), ['simulation_observe', 'simulation_stage', 'simulation_submit'])
      const input = primary.filter(value => value.kind === 'world-context').toSorted((a, b) =>
        Number(record(a.authority).baseRevision) - Number(record(b.authority).baseRevision)).at(-1)
      const purpose = String(marker.purpose)
      directorModelRequests.push({ actor: String(marker.entityId), purpose, contextKey: String(marker.contextKey),
        tool, messages: options.messages })
      let action: object | undefined
      if (purpose === 'director-event' || purpose === 'goal') {
        assert.ok(input)
        const authority = record(input.authority)
        const operation = purpose === 'goal' ? record((input.operations as unknown[])[0]) : undefined
        const target = operation === undefined ? authority : record((operation.targets as unknown[])[0])
        const goal = primary.findLast(value => value.kind === 'world-goal')?.goal
        const businessKey = purpose === 'director-event' ? authority.businessKey : goal
        const pin = record(purpose === 'director-event' ? authority.pin : operation?.pin)
        const version = String(pin.version)
        assert.equal(typeof businessKey, 'string')
        action = { kind: 'world/request', domain: 'external', operation: 'interact', version, businessKey,
          expectedTime: null, evidence: [], payload: { scope: target.scopeEntityId, subjectRef: target.targetEntityId,
            externalKey: 'vendor', ...version === '1'
              ? { sourceKind: 'simulated-rule', policyRef: 'clocky.external.availability/1', input: { kind: 'availability', unit: 'widget' } }
              : { sourceKind: 'director-mediated', policyRef: 'clocky.external.adjudication/1',
                input: { kind: 'adjudicate', question: String(businessKey) }, responseScope: {
                  allowed: ['delayed-event', 'failure', 'environmental-fact'], disclosure: { kind: 'requester' } } } } }
      } else if (purpose === 'scenario-resolve' || purpose === 'resolve') {
        assert.ok(input)
        const observed = objects(options.messages).findLast(value => value.status === 'observed')
        const time = typeof observed?.time === 'string' ? observed.time : '0'
        const mediated = input.externalMediated === undefined ? undefined : record(input.externalMediated)
        const common = mediated === undefined ? undefined : { subjectRef: mediated.subjectRef, sourceKind: 'director-mediated',
          policyRef: 'clocky.external.adjudication/1', attribution: 'scenario-generated', evidence: [], disclosure: { kind: 'requester' } }
        const deliverAt = String(BigInt(time) + 1n)
        const payload = common === undefined ? { kind: 'evaluate-rule' } : { kind: 'adjudicate', outcome: { ...common,
          kind: 'delayed-event', key: `environment-${String(record(input.request).id).replaceAll(':', '-')}`, deliverAt,
          outcome: purpose === 'resolve' ? { ...common, kind: 'failure', code: 'unavailable',
            description: 'The original ordinary environmental inquiry has a finite simulated response.' }
            : { ...common, kind: 'environmental-fact', factKey: `condition-${String(record(input.request).id).replaceAll(':', '-')}`,
              effectiveFrom: deliverAt, effectiveUntil: String(BigInt(deliverAt) + 1n),
              claim: { kind: 'condition', predicate: 'lead-time', schemaRef: 'lead-time/1', value: { ticks: '2' } } } } }
        action = { kind: 'world/resolve', requestId: record(input.request).id, supersedes: null,
          resolution: { kind: 'apply', payload, rationale: 'Evaluate the original persisted inventory without creating resources.' } }
      } else if (purpose === 'result') { assert.ok(input); action = record(record(input.authority).notification) }
      else assert.ok(['scenario-result', 'message'].includes(purpose), purpose)
      const args = JSON.stringify(step === 1 ? { proposals: action === undefined ? [] : [{ after: [], action }] } : {})
      const id = CallId(`${key}:${step}`)
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 0, id, name: tool, argumentsDelta: args }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name: tool, arguments: args } }
      yield { type: 'usage', usage: { inputTokens: 10, outputTokens: 5 } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
    }
  }
  ctx.effect(() => ctx.llm.registerAdapter(['world-director-events-scripted'], new Model()))
}
