/** Scripted external model driven by the actual admitted request, shared by unit and Loader evidence. */
import assert from 'node:assert/strict'
import { z } from 'zod'
import { CallId, LlmAdapter } from '@clocky/clocky-llm'
import type { GenerateOptions, StreamChunk } from '@clocky/clocky-llm'
import type { SimulationRun } from '@clocky/clocky-simulation'

const modelInput = z.object({ stage: z.enum(['request', 'accept', 'transfer', 'task', 'task-recovery', 'task-report', 'result', 'report', 'input']), channelId: z.string(),
  reportText: z.string().optional(),
  task: z.record(z.string(), z.unknown()).optional(),
  interaction: z.object({ id: z.string(), revision: z.number(), commitmentId: z.string().optional() }).optional(),
  transfer: z.object({ id: z.string() }).optional(),
  resources: z.array(z.object({ id: z.string(), revision: z.number(), quantity: z.string().optional() })),
  requestAt: z.string(), reportAt: z.string(), replyBy: z.string(), completeBy: z.string() })

export function companyModel(run: SimulationRun, requests: Array<{ stage: string; tools: string[]; goal: string }>,
  alter?: (stage: string, proposals: unknown[]) => unknown[]): LlmAdapter {
  const calls = new Map<string, number>()
  return new class extends LlmAdapter {
    async *stream(options: GenerateOptions): AsyncGenerator<StreamChunk> {
      assert.ok(!JSON.stringify(options.messages).includes('PRIVATE_COMPANY_PROFILE'))
      const state = run.snapshot()
      const window = state.activeWindowId === undefined ? undefined : state.windows![state.activeWindowId]!
      const decisionId = window?.request.decisions[0]!.id ?? state.activeDecisionId
      assert.ok(decisionId)
      const decision = state.decisions[decisionId]!
      assert.equal(decision.context?.status, 'prepared')
      if (decision.context?.status !== 'prepared') throw new Error('Model has no prepared input')
      const text = options.messages.flatMap(message => message.content).filter(block => block.type === 'text')
        .map(block => block.text).findLast(value => value.includes('Company decision: '))
      assert.ok(text)
      const line = text.slice(text.indexOf('Company decision: ') + 'Company decision: '.length).split('\n')[0]!
      const input = modelInput.parse(JSON.parse(line))
      const index = calls.get(decision.id) ?? 0
      calls.set(decision.id, index + 1)
      const tools = options.tools?.map(tool => tool.name).sort() ?? []
      assert.deepEqual(tools, ['simulation_observe', 'simulation_stage', 'simulation_submit'])
      const goal = decision.context.view.content.find(section => section.kind === 'goals')?.blocks
        .filter(block => block.type === 'text').map(block => block.text).join('\n')
      assert.ok(goal)
      requests.push({ stage: input.stage, tools, goal })
      const name = ['simulation_observe', 'simulation_stage', 'simulation_submit'][index]
      assert.ok(name)
      const proposals: unknown[] = input.stage === 'request' ? [
        { after: [], action: { kind: 'interaction/request', id: 'purchase', assignee: 'supplier', description: 'Deliver one inventory unit',
          replyBy: input.replyBy, completeBy: input.completeBy, fulfillment: { kind: 'transfer', from: 'stock', to: 'received', quantity: '1' } } },
        { after: [0], action: { kind: 'communication/post', recipient: 'supplier', channelId: input.channelId,
          text: 'Request purchase: deliver one inventory unit.', deliverAt: input.requestAt } },
      ] : input.stage === 'accept' ? [
        { after: [], action: { kind: 'interaction/accept', id: 'purchase', expectedRevision: input.interaction!.revision } },
      ] : input.stage === 'task' ? [
        { after: [], action: { kind: 'task/create', deliverAt: state.time, task: input.task } },
      ] : input.stage === 'transfer' ? [
        { after: [], action: { kind: 'resource/transfer', grants: [], transaction: { commitmentId: input.interaction!.commitmentId,
          reads: input.resources.map(value => ({ resourceId: value.id, revision: value.revision })),
          transfers: [{ from: 'stock', to: 'received', quantity: '1' }] } } },
      ] : input.stage === 'task-report' ? [{ after: [], action: { kind: 'communication/post', recipient: 'buyer',
        channelId: input.channelId, text: input.reportText, deliverAt: state.time } }]
        : input.stage === 'task-recovery' ? [] : input.stage === 'result' ? [
          { after: [], action: { kind: 'interaction/result', id: 'purchase', expectedRevision: input.interaction!.revision, evidence: [input.transfer!.id] } },
          { after: [0], action: { kind: 'communication/post', recipient: 'buyer', channelId: input.channelId,
            text: `Purchase fulfilled; evidence ${input.transfer!.id}.`, deliverAt: input.reportAt } },
        ] : []
      const id = CallId(`${decision.id}/${index}`)
      const args = JSON.stringify(index === 1 ? { proposals: alter?.(input.stage, proposals) ?? proposals } : {})
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 0, id, name, argumentsDelta: args }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name, arguments: args } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
    }
  }()
}
