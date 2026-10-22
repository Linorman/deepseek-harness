/** External scripted model consumes only real message frames and exercises the public three-tool protocol. */
import assert from 'node:assert/strict'
import { CallId, LlmAdapter } from '@clocky/clocky-llm'
import type { GenerateOptions, StreamChunk } from '@clocky/clocky-llm'

/** Actual model request messages, retained by this external fixture for comparison with durable context views. */
export const factModelMessages: string[] = []

function contexts(value: unknown): Record<string, unknown>[] {
  if (typeof value === 'string') return value.split('\n').flatMap((line) => {
    if (!line.trimStart().startsWith('{') && !line.trimStart().startsWith('[')) return []
    let parsed: unknown
    try { parsed = JSON.parse(line) }
    catch { return [] /* Ordinary instruction prose is not a recorded World JSON view. */ }
    return contexts(parsed)
  })
  if (value === null || typeof value !== 'object') return []
  if (Array.isArray(value)) return value.flatMap(contexts)
  const record = value as Record<string, unknown>
  return record.kind === 'world-context' ? [record] : Object.values(record).flatMap(contexts)
}

/** Script inputs come from durable World context; a director also attempts a rejected fact publication tool action. */
export class WorldFactsModel extends LlmAdapter {
  private readonly calls = new Map<string, number>()

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    factModelMessages.push(JSON.stringify(options.messages))
    // Current context can precede old observe replies in the assembled messages; its recorded revision identifies it.
    const input = contexts(options.messages).toSorted((a, b) =>
      (a.authority as { baseRevision: number }).baseRevision - (b.authority as { baseRevision: number }).baseRevision).at(-1)
    assert.ok(input)
    const authority = input.authority as { kind: 'request' | 'resolve'; intentId: string }
    const key = `${authority.kind}/${authority.intentId}`, index = this.calls.get(key) ?? 0
    this.calls.set(key, index + 1)
    const director = authority.kind === 'resolve'
    const tool = index === 0 ? 'simulation_observe' : index === (director ? 3 : 2) ? 'simulation_submit' : 'simulation_stage'
    assert.ok(index < (director ? 4 : 3), 'Fact script must finish its finite public-tool sequence')
    assert.deepEqual(options.tools?.map(value => value.name).sort(), ['simulation_observe', 'simulation_stage', 'simulation_submit'])
    const application = input.application as {
      organizationEntityId: string
      positionEntityId: string
      applicationId: string
      description: string
    }
    const template = (input.templates as Array<{
      id: string
      version: string
      names: string[]
      skills: string[]
      traits: string[]
      goals: string[]
    }>)[0]
    const action = director && index === 1 ? { kind: 'world/fact-recorded', factId: 'forged-from-summary',
      source: { kind: 'owner', owner: 'director' }, payload: { body: 'Director summary is not a fact publisher.' } }
      : director ? { kind: 'world/resolve', requestId: (input.request as { id: string }).id, supersedes: null,
        resolution: { kind: 'apply', rationale: 'Planning does not publish beliefs as authoritative facts.', payload: {
          templateId: template!.id, templateVersion: template!.version, persona: {
            name: template!.names[0], skills: template!.skills, traits: template!.traits, goals: template!.goals } } } }
        : { kind: 'world/request', domain: 'organization', operation: 'generate-and-hire', version: '1',
          businessKey: application.applicationId, expectedTime: null, evidence: [], payload: {
            organizationEntityId: application.organizationEntityId, positionEntityId: application.positionEntityId,
            description: application.description } }
    if (director && index === 2) assert.ok(JSON.stringify(options.messages).includes('"isError":true'),
      'The real tool response must reject the director publication before a legal plan is staged')
    const args = JSON.stringify(tool === 'simulation_stage' ? { proposals: [{ after: [], action }] } : {})
    const id = CallId(`facts-${key}-${index}`)
    yield { type: 'block-start', index: 0, blockType: 'tool-call' }
    yield { type: 'tool-call-delta', index: 0, id, name: tool, argumentsDelta: args }
    yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name: tool, arguments: args } }
    yield { type: 'finish', reason: { kind: 'tool-calls' } }
  }
}
