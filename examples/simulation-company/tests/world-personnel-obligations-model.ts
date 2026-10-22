/** Task creation and private messaging use only the original actor's recorded ordinary decision inputs. */
import assert from 'node:assert/strict'
import type { Context } from '@clocky/cordis'
import { CallId, LlmAdapter } from '@clocky/clocky-llm'
import type { GenerateOptions, StreamChunk } from '@clocky/clocky-llm'
import { simulationTaskSpecSchema } from '@clocky/clocky-simulation'

export const name = 'world-personnel-obligations-scripted-model'
export const inject = ['llm']
export const requests: Array<{ entityId: string; tool: string }> = []

function objects(value: unknown): Record<string, unknown>[] {
  if (typeof value === 'string') return value.split('\n').flatMap((line) => {
    if (!line.trimStart().startsWith('{') && !line.trimStart().startsWith('[')) return []
    let parsed: unknown
    try { parsed = JSON.parse(line) }
    catch { return [] /* Ordinary prose does not contain a structured task or message instruction. */ }
    return objects(parsed)
  })
  if (value === null || typeof value !== 'object') return []
  if (Array.isArray(value)) return value.flatMap(objects)
  const record = value as Record<string, unknown>
  return [record, ...Object.values(record).flatMap(objects)]
}

/** Register external scripted cognition; no Native, Team, writer or query objects enter the adapter. */
export function apply(ctx: Context): void {
  const calls = new Map<string, number>()
  class Model extends LlmAdapter {
    async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
      const values = objects(options.messages.filter(message => message.role === 'user'
        && !message.content.some(block => block.type === 'tool-result')))
      const marker = values.findLast(value => value.kind === 'world-driver')
      assert.ok(marker && typeof marker.entityId === 'string' && marker.purpose === 'message')
      const key = `${marker.entityId}/${String(marker.contextKey)}`, step = calls.get(key) ?? 0
      calls.set(key, step + 1)
      const tool = ['simulation_observe', 'simulation_stage', 'simulation_submit'][step]
      assert.ok(tool)
      requests.push({ entityId: marker.entityId, tool })
      const control = values.findLast(value => value.kind === 'personnel-obligation-task' || value.kind === 'personnel-obligation-message')
      let action: object | undefined
      if (control?.kind === 'personnel-obligation-task') {
        action = { kind: 'task/create', deliverAt: control.time, task: simulationTaskSpecSchema.parse(control.task) }
      } else if (control?.kind === 'personnel-obligation-message') {
        assert.equal(typeof control.text, 'string')
        action = { kind: 'communication/post', recipient: control.recipient, channelId: control.channelId,
          deliverAt: control.time, text: control.text }
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
  ctx.effect(() => ctx.llm.registerAdapter(['world-personnel-obligations-scripted'], new Model()))
}
