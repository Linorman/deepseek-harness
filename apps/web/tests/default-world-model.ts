/** Keyless external responses use only the actual actor context and never access a simulation owner. */
import assert from 'node:assert/strict'
import { CallId, LlmAdapter } from '@clocky/clocky-llm'
import type { GenerateOptions, StreamChunk } from '@clocky/clocky-llm'
import { simulationWorldTemplateSchema } from '@clocky/clocky-simulation'

function record(value: unknown): Record<string, unknown> {
  assert.ok(value !== null && typeof value === 'object' && !Array.isArray(value))
  return value as Record<string, unknown>
}
function objects(value: unknown): Record<string, unknown>[] {
  if (typeof value === 'string') return value.split('\n').flatMap((line) => {
    if (!line.trimStart().startsWith('{')) return []
    let parsed: unknown
    try { parsed = JSON.parse(line) }
    catch { return [] /* Ordinary prose supplies no structured authority. */ }
    return objects(parsed)
  })
  if (Array.isArray(value)) return value.flatMap(objects)
  if (value === null || typeof value !== 'object') return []
  return [record(value), ...Object.values(value).flatMap(objects)]
}

export function defaultWorldModel(requests: { stage: string; tools: string[]; goal: string }[], overrun = false): LlmAdapter {
  const calls = new Map<string, number>()
  return new class extends LlmAdapter {
    override async resolveModel(provider: string, model: string) {
      return { provider, id: model, name: model, context: { contextWindow: 1048576 } }
    }
    override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
      assert.ok(options.maxTokens !== undefined && options.maxTokens <= 4096, 'Every default request must cap generated output')
      if (options.purpose === 'compaction') {
        requests.push({ stage: 'compaction', tools: [], goal: 'summary' })
        yield { type: 'block-start', index: 0, blockType: 'text' }
        yield { type: 'text-delta', index: 0, text: 'Continue using the current recorded world context and pending decision.' }
        yield { type: 'block-end', index: 0, block: { type: 'text', text: 'Continue using the current recorded world context and pending decision.' } }
        yield { type: 'usage', usage: { inputTokens: 10000, outputTokens: 200 } }
        yield { type: 'finish', reason: { kind: 'stop' } }
        return
      }
      assert.ok(options.system?.includes([
        'You are an independent participant in a simulated world. Use simulation_observe,',
        'simulation_stage and simulation_submit to act on the current recorded decision context.',
        'Your role, permitted operations, evidence and available knowledge come from that context.',
        'A world director proposes plans; an ordinary participant requests changes or communicates',
        'through its own channels. Submitted plans are not completed effects. Report only recorded',
        "results, preserve unknown facts, and never claim another participant's approval or identity.",
        'Finish the current decision before waiting for a world change.',
      ].join(' ')), 'The shipped World preset must reach each actual model request')
      assert.deepEqual(options.tools?.map(tool => tool.name).sort(), ['simulation_observe', 'simulation_stage', 'simulation_submit'])
      const values = objects(options.messages.filter(message => message.role === 'user'
        && !message.content.some(block => block.type === 'tool-result')))
      const marker = values.findLast(value => value.kind === 'world-driver')
      assert.ok(marker)
      const key = `${String(marker.entityId)}/${String(marker.contextKey)}`
      const index = calls.get(key) ?? 0
      calls.set(key, index + 1)
      if (marker.purpose === 'resolve' && !requests.some(value => value.goal === String(marker.entityId)))
        assert.ok(!values.some(value => value.kind === 'world-message-route'), 'A domain resolution must not offer an ordinary reply route')
      const reply = marker.purpose === 'message' && marker.entityId === 'organiser'
        ? values.findLast(value => value.kind === 'world-message-route') : undefined
      // A fourth goal step forces pressure between staging and submission, after the original input was consumed.
      const sequence = reply !== undefined ? ['simulation_observe', 'simulation_stage', 'simulation_stage', 'simulation_submit']
        : marker.purpose === 'goal'
          ? ['simulation_observe', 'simulation_stage', 'simulation_observe', 'simulation_submit']
          : ['simulation_observe', 'simulation_stage', 'simulation_submit']
      const tool = sequence[index]
      assert.ok(tool, `Unexpected extra tool step for ${key}`)
      let action: object | undefined
      if (marker.purpose !== 'message') {
        const input = values.findLast(value => value.kind === 'world-context')
        assert.ok(input)
        if (marker.purpose === 'goal') {
          const installed = (input.operations as unknown[]).map(record)
            .find(value => record(value.pin).operation === 'generate-and-hire')
          assert.ok(installed)
          const target = record((installed.targets as unknown[])[0]), pin = record(installed.pin)
          action = { kind: 'world/request', domain: pin.domain, operation: pin.operation, version: pin.version,
            businessKey: 'starter-colleague', expectedTime: null, evidence: [], payload: {
              organizationEntityId: target.scopeEntityId, positionEntityId: target.targetEntityId,
              description: 'One colleague for the recorded vacant position.',
            } }
        } else if (marker.purpose === 'resolve') {
          const template = simulationWorldTemplateSchema.parse((input.templates as unknown[])[0])
          const request = record(input.request)
          action = { kind: 'world/resolve', requestId: request.id, supersedes: null,
            resolution: { kind: 'apply', payload: { templateId: template.id, templateVersion: template.version,
              persona: { name: template.names.at(-1), skills: template.skills, traits: template.traits, goals: template.goals } },
            rationale: 'The recorded position and finite template permit this colleague.' } }
        } else if (marker.purpose === 'result') action = record(record(input.authority).notification)
        else if (marker.purpose === 'first-action') {
          const route = record(input.communication), result = record(input.result)
          action = { kind: 'communication/post', recipient: route.recipient, channelId: route.channelId,
            deliverAt: result.time, text: 'I am ready to help with our shared goal.' }
        } else throw new Error(`Unexpected starter purpose: ${String(marker.purpose)}`)
      }
      if (reply !== undefined) {
        const target = record(reply.replyTarget)
        assert.ok(String(target.entityId).startsWith('world-person:'))
        assert.ok(String(target.participantId).startsWith('participant-'))
        action = { kind: 'communication/post', recipient: index === 1 ? target.participantId : target.entityId,
          channelId: target.channelId, deliverAt: record(values.findLast(value => value.kind === 'world-background')!.worldFacts).time,
          text: 'Thank you. I have recorded your message.' }
        if (index === 2) {
          assert.ok(options.messages.some(message => message.content.some(block => block.type === 'tool-result'
            && block.isError && JSON.stringify(block.content).includes('simulation Entity ID'))), 'Bad Participant ID must be rejected during staging')
        }
      }
      requests.push({ stage: reply !== undefined && index === 2 ? 'reply-correction' : marker.purpose, tools: [tool], goal: String(marker.entityId) })
      const args = JSON.stringify(tool === 'simulation_submit' && marker.purpose === 'result'
        ? { notification: { resultId: record(values.findLast(value => value.kind === 'world-context')!.authority).resultId } }
        : tool === 'simulation_stage' ? { proposals: marker.purpose === 'result' || action === undefined ? [] : [{ after: [], action }] } : marker.purpose === 'goal' && index === 0 ? { sections: ['input', 'goals'] } : {})
      const id = CallId(`${key}/${index}`)
      const history = marker.purpose === 'goal' ? 'Retain the recorded staffing constraints and distinguish proposed plans from completed hiring. '.repeat(130) : ''
      if (history) {
        yield { type: 'block-start', index: 1, blockType: 'text' }
        yield { type: 'text-delta', index: 1, text: history }
        yield { type: 'block-end', index: 1, block: { type: 'text', text: history } }
      }
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 0, id, name: tool, argumentsDelta: args }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name: tool, arguments: args } }
      yield { type: 'usage', usage: overrun ? { inputTokens: 54305, cacheReadTokens: 14848, outputTokens: 847 } : marker.purpose === 'goal'
        ? { inputTokens: 20000, cacheReadTokens: 10000, outputTokens: 4096 }
        : { inputTokens: 11295, cacheReadTokens: 14848, outputTokens: 847 } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
    }
  }()
}
