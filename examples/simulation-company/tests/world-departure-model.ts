/** Departure cognition receives only actual recorded goal, director-plan and result material through its original Session. */
import assert from 'node:assert/strict'
import type { Context } from '@clocky/cordis'
import { CallId, LlmAdapter } from '@clocky/clocky-llm'
import type { GenerateOptions, StreamChunk } from '@clocky/clocky-llm'
import { simulationWorldDepartPayloadSchema, simulationOperationSchema } from '@clocky/clocky-simulation'

export const name = 'world-departure-scripted-model'
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
    catch { return [] /* Unstructured text cannot provide an authorized person, assignment or plan reference. */ }
    return objects(parsed)
  })
  if (value === null || typeof value !== 'object') return []
  if (Array.isArray(value)) return value.flatMap(objects)
  const item = record(value)
  return [item, ...Object.values(item).flatMap(objects)]
}
/** Register a keyless external adapter with no Native, Team, driver, actor catalog or environment identity access. */
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
      if (marker.purpose === 'message') {
        const task = values.findLast(value => value.kind === 'departure-create-task' && value.wakeId === marker.contextKey)
        if (task !== undefined) action = simulationOperationSchema.parse({ kind: 'task/create', task: task.task, deliverAt: task.time })
      } else {
        const input = values.findLast(value => value.kind === 'world-context')
        assert.ok(input)
        if (marker.purpose === 'goal') {
          const wake = values.findLast(value => value.kind === 'world-goal')
          assert.ok(wake && (wake.goal === 'depart-keep-personal' || wake.goal === 'depart-retire'))
          const installed = (input.operations as unknown[]).map(record).find(value => record(value.pin).operation === 'depart')
          assert.ok(installed)
          const material = record(installed.material)
          assert.equal(material.kind, 'departure-opportunities')
          const opportunity = record((material.opportunities as unknown[])[0])
          const payload = simulationWorldDepartPayloadSchema.parse({ organizationEntityId: opportunity.organizationEntityId,
            personId: opportunity.personId, assignmentId: opportunity.assignmentId, assignmentRevision: opportunity.assignmentRevision,
            requestedEffectiveAt: null, description: 'Close the original assignment after its actual obligations settle.',
            retire: wake.goal === 'depart-retire' })
          action = { kind: 'world/request', domain: 'organization', operation: 'depart', version: '1',
            businessKey: 'original-person-departure', expectedTime: payload.requestedEffectiveAt, evidence: [], payload }
        } else if (marker.purpose === 'resolve') {
          const request = record(input.request), payload = simulationWorldDepartPayloadSchema.parse(input.personnel)
          action = { kind: 'world/resolve', requestId: request.id,
            supersedes: request.priorPlan === null ? null : record(request.priorPlan).id,
            resolution: { kind: 'apply', payload, rationale: 'DIRECTOR-PRIVATE-DEPARTURE-CANARY' } }
        } else if (marker.purpose === 'result') action = record(record(input.authority).notification)
        else throw new Error(`Departure has no replacement or invented first action: ${marker.purpose}`)
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
  ctx.effect(() => ctx.llm.registerAdapter(['world-departure-scripted'], new Model()))
}
