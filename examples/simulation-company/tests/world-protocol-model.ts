/** Keyless external model reads only admitted messages and returns bounded world tool proposals. */
import assert from 'node:assert/strict'
import type { Context } from '@clocky/cordis'
import { CallId, LlmAdapter } from '@clocky/clocky-llm'
import type { GenerateOptions, StreamChunk } from '@clocky/clocky-llm'
import { worldIntentIdSchema, worldRequestIdSchema, simulationWorldTemplateSchema, simulationHireIntentRequestSchema } from '@clocky/clocky-simulation'

export const name = 'world-protocol-scripted-model'
export const inject = ['llm']
export const requests: string[] = []
function record(value: unknown): Record<string, unknown> {
  assert.ok(value !== null && typeof value === 'object' && !Array.isArray(value))
  return value as Record<string, unknown>
}
function parseInput(value: unknown) {
  const input = record(value), authority = record(input.authority)
  assert.equal(input.kind, 'world-context')
  assert.ok(authority.kind === 'request' || authority.kind === 'resolve')
  assert.ok(Array.isArray(input.templates))
  const { description: _description, ...application } = record(input.application)
  return { authority: { kind: authority.kind, intentId: worldIntentIdSchema.parse(authority.intentId) },
    request: input.request === undefined ? undefined : { id: worldRequestIdSchema.parse(record(input.request).id) },
    templates: input.templates.map(value => simulationWorldTemplateSchema.parse(value)),
    application: simulationHireIntentRequestSchema.parse(application) }
}

/** Read nested observe output and exact JSON lines from the actual message stream. */
function worldInput(value: unknown): unknown[] {
  if (typeof value === 'string') {
    return value.split('\n').flatMap((line) => {
      if (!line.trimStart().startsWith('{') && !line.trimStart().startsWith('[')) return []
      let parsed: unknown
      try { parsed = JSON.parse(line) }
      catch { return [] /* Ordinary model-facing prose is not a JSON world fact. */ }
      return worldInput(parsed)
    })
  }
  if (value === null || typeof value !== 'object') return []
  if (Array.isArray(value)) return value.flatMap(worldInput)
  const record = value as Record<string, unknown>
  return record.kind === 'world-context' ? [record] : Object.values(record).flatMap(worldInput)
}

/** Register one script whose only business inputs are durable model messages. */
export function apply(ctx: Context, input: unknown): void {
  const config = record(input)
  assert.deepEqual(Object.keys(config), ['resolution'])
  assert.ok(config.resolution === 'apply' || config.resolution === 'reject')
  const calls = new Map<string, number>()
  class ScriptedModel extends LlmAdapter {
    async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
      const input = parseInput(worldInput(options.messages).at(-1))
      const key = `${input.authority.kind}/${input.authority.intentId}`
      const index = calls.get(key) ?? 0
      calls.set(key, index + 1)
      const tool = ['simulation_observe', 'simulation_stage', 'simulation_submit'][index]
      assert.ok(tool, 'World script must conclude after its three tools')
      assert.deepEqual(options.tools?.map(value => value.name).sort(), ['simulation_observe', 'simulation_stage', 'simulation_submit'])
      requests.push(`${input.authority.kind}/${tool}`)
      const template = input.templates[0]
      const action = input.authority.kind === 'request'
        ? { kind: 'world/request', domain: 'organization', operation: 'generate-and-hire', version: '1',
          businessKey: input.application.applicationId, expectedTime: null, evidence: [], payload: {
            organizationEntityId: input.application.organizationEntityId, positionEntityId: input.application.positionEntityId,
            description: 'We need a research colleague.',
            ...input.application.priorRequestId === undefined ? {} : { priorRequestId: input.application.priorRequestId },
          } }
        : { kind: 'world/resolve', requestId: input.request?.id, supersedes: null,
          resolution: config.resolution === 'reject'
            ? { kind: 'reject', reason: 'insufficient-information', rationale: 'Private assessment needs more information.' }
            : { kind: 'apply', payload: { templateId: template?.id, templateVersion: template?.version, persona: { name: template?.names[0], skills: template?.skills, traits: template?.traits, goals: template?.goals } }, rationale: 'Private assessment selects the supplied research template.' } }
      const args = JSON.stringify(index === 1 ? { proposals: [{ after: [], action }] } : {})
      const id = CallId(`${input.authority.kind}-${index}`)
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 0, id, name: tool, argumentsDelta: args }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name: tool, arguments: args } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
    }
  }
  ctx.effect(() => ctx.llm.registerAdapter(['world-scripted'], new ScriptedModel()))
}
