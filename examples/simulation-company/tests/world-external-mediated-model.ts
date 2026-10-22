/** Finite actual Agent proposals consume recorded views; Native alone validates and publishes each adjudication. */
import assert from 'node:assert/strict'
import type { Context } from '@clocky/cordis'
import { CallId, LlmAdapter } from '@clocky/clocky-llm'
import type { GenerateOptions, StreamChunk } from '@clocky/clocky-llm'
import { simulationExternalMediatedRequestSchema, simulationExternalMediatedPlanSchema } from '@clocky/clocky-simulation'
export const name = 'world-external-mediated-scripted-model'
export const inject = ['llm']
export const mediatedModelRequests: Array<{ entityId: string; purpose: string; tool: string; input: string }> = []
function objects(value: unknown): Record<string, unknown>[] {
  if (typeof value === 'string') return value.split('\n').flatMap((line) => {
    if (!line.trimStart().startsWith('{')) return []
    let decoded: unknown
    try { decoded = JSON.parse(line) }
    catch { return [] /* Ordinary instruction prose is not a Native context. */ }
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
/** The Loader-installed adapter has no Native/Team/Session capabilities; it can only propose through the original tools. */
export function apply(ctx: Context): void {
  const calls = new Map<string, number>()
  class Model extends LlmAdapter {
    async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
      const values = objects(options.messages)
      const primary = objects(options.messages.filter(value => value.role === 'user'
        && !value.content.some(block => block.type === 'tool-result')))
      const markers = primary.filter(value => value.kind === 'world-driver')
      const marker = markers.at(-1)
      assert.ok(marker)
      const key = `${String(marker.entityId)}/${String(marker.contextKey)}`, step = calls.get(key) ?? 0
      calls.set(key, step + 1)
      const purpose = String(marker.purpose)
      const stageProbe = process.env.WORLD_MEDIATED_CASE === 'report-preflight' && purpose === 'resolve'
      const tool = (stageProbe ? ['simulation_observe', 'simulation_stage', 'simulation_stage', 'simulation_submit']
        : ['simulation_observe', 'simulation_stage', 'simulation_submit', 'simulation_stage', 'simulation_submit'])[step]
      assert.ok(tool, 'The mediated script is finite; only a rejected conflict proposal gets one explicit replacement')
      assert.deepEqual(options.tools?.map(value => value.name).sort(), ['simulation_observe', 'simulation_stage', 'simulation_submit'])
      const input = primary.filter(value => value.kind === 'world-context').toSorted((a, b) =>
        Number(record(a.authority).baseRevision) - Number(record(b.authority).baseRevision)).at(-1)
      mediatedModelRequests.push({ entityId: String(marker.entityId), purpose, tool, input: JSON.stringify(options.messages) })
      let action: object | undefined
      if (purpose === 'goal') {
        assert.ok(input)
        const available = record((input.operations as unknown[]).find(value => record(record(value).pin).version === '3'))
        const target = record((available.targets as unknown[])[0])
        const goal = values.findLast(value => value.kind === 'world-goal')?.goal
        assert.equal(typeof goal, 'string')
        const mode = String(goal)
        action = { kind: 'world/request', domain: 'external', operation: 'interact', version: '3', businessKey: mode,
          expectedTime: null, evidence: [], payload: { scope: target.scopeEntityId, subjectRef: target.targetEntityId,
            externalKey: 'mediated-vendor', sourceKind: 'director-mediated', policyRef: 'clocky.external.adjudication/1',
            input: { kind: 'adjudicate', question: mode,
              ...mode === 'report' ? { quoteScope: { unit: 'widget', currency: 'credit' } } : {},
              ...['stock', 'stock-conflict'].includes(mode) ? { inventoryUnit: 'widget' } : {} }, responseScope: {
              allowed: ['environmental-fact', 'unverified-report', 'failure', 'delayed-event'], disclosure: { kind: 'requester' } } } }
      } else if (purpose === 'request') {
        assert.ok(input)
        const request = simulationExternalMediatedRequestSchema.parse(input.externalMediated)
        action = { kind: 'world/request', domain: 'external', operation: 'interact', version: '3', businessKey: request.input.question,
          expectedTime: null, evidence: [], payload: request }
      } else if (purpose === 'resolve') {
        assert.ok(input)
        const request = simulationExternalMediatedRequestSchema.parse(input.externalMediated)
        const mode = request.input.question
        const observed = values.findLast(value => value.status === 'observed')
        const time = observed?.time
        if (step > 0) assert.equal(typeof time, 'string', 'Plans use the time from the actual observation tool result')
        const now = typeof time === 'string' ? time : '0'
        const common = { subjectRef: request.subjectRef, sourceKind: request.sourceKind, policyRef: request.policyRef,
          attribution: 'scenario-generated', evidence: [], disclosure: { kind: 'requester' } }
        const factItems = record(input.worldFacts).items as Array<{ fact: { factId: string; payload: { body?: string } } }>
        const privateBody = factItems.find(value => value.fact.factId === 'director-only-canary')?.fact.payload.body
        assert.equal(typeof privateBody, 'string', 'The director must actually consume the private canary before the propagation probe')
        let outcome: object
        if (step >= 3 && !stageProbe) {
          assert.ok(['fact-conflict', 'stock-conflict'].includes(mode))
          const rejected = options.messages.flatMap(value => value.content).find(value => value.type === 'tool-result'
            && value.toolCallId === `${key}:2`)
          assert.ok(rejected?.type === 'tool-result' && rejected.isError, 'The actual original submit receipt must reject the claim')
          outcome = { ...common, kind: 'failure', code: 'dependency-unmet', description: privateBody }
        } else if (mode === 'report') outcome = { ...common, kind: 'unverified-report', reliability: 'unverified',
          statement: privateBody, quote: { unit: 'widget', quantity: '8',
            price: { currency: 'credit', quantity: '9' }, validUntil: null } }
        else if (mode === 'failure') outcome = { ...common, kind: 'failure', code: 'unavailable', description: privateBody }
        else if (mode === 'delayed' || mode === 'delayed-blocked') {
          const deliverAt = String(BigInt(now) + 3n)
          outcome = { ...common, kind: 'delayed-event', key: `${String(privateBody)}-${mode}`, deliverAt,
            outcome: { ...common, kind: 'environmental-fact', factKey: `${String(privateBody)}-delayed-lead-time`, effectiveFrom: deliverAt, effectiveUntil: null,
              claim: { kind: 'condition', predicate: 'lead-time', schemaRef: 'lead-time/1', value: { ticks: mode === 'delayed-blocked' ? '5' : '2' } } } }
        } else {
          let claim: object
          if (mode === 'stock' || mode === 'stock-conflict') {
            const inventory = (input.inventory as Array<{ unit: string; quantity: string }>).find(value => value.unit === 'widget')
            assert.ok(inventory)
            assert.equal(inventory.quantity, '7')
            claim = { kind: 'inventory-as-of', unit: 'widget', availability: { status: 'known',
              quantity: mode === 'stock-conflict' ? '8' : inventory.quantity } }
          } else if (mode === 'lead-current') claim = { kind: 'condition', predicate: 'lead-time', schemaRef: 'lead-time/1', value: { ticks: '3' } }
          else if (mode === 'money-private' || mode === 'money-control') {
            const balance = (input.balances as Array<{ id: string; quantity: string }>).find(value => value.id === 'supplier-money')
            if (mode === 'money-control') assert.ok(balance, 'A monetary observation requires its actual authorized source')
            else assert.equal(balance, undefined, 'Interaction permission cannot disclose the private monetary source')
            claim = { kind: 'balance-as-of', resourceId: 'supplier-money', quantity: balance?.quantity ?? '999' }
          }
          else claim = { kind: 'condition', predicate: 'weather', schemaRef: 'weather/1',
            value: { status: mode === 'fact-conflict' ? 'clear' : 'rain' } }
          outcome = { ...common, kind: 'environmental-fact', factKey: `${String(privateBody)}-${mode}`, claim, effectiveFrom: now, effectiveUntil: null }
        }
        // Observe does not stage a plan; its preliminary time is unused. Every actual stage uses the parsed observed time.
        const payload = simulationExternalMediatedPlanSchema.parse({ kind: 'adjudicate', outcome })
        if (stageProbe && step === 1) delete (payload.outcome as { subjectRef?: string }).subjectRef
        if (stageProbe && step === 2) {
          const rejected = options.messages.flatMap(value => value.content).find(value => value.type === 'tool-result'
            && value.toolCallId === `${key}:1`)
          assert.ok(rejected?.type === 'tool-result' && rejected.isError)
          const diagnostic = JSON.stringify(rejected.content)
          assert.ok(diagnostic.includes('proposals.0.action.resolution.payload.outcome.subjectRef'))
          assert.ok(diagnostic.includes('invalid_type'))
          assert.ok(!diagnostic.includes(String(privateBody)))
          assert.ok(!diagnostic.includes('factKey'))
        }
        const actual = record(input.request)
        action = { kind: 'world/resolve', requestId: actual.id, supersedes: null,
          resolution: { kind: 'apply', payload, rationale: 'PRIVATE-MEDIATED-DIRECTOR-RATIONALE-MUST-NOT-BECOME-A-NOTIFICATION' } }
      } else if (purpose === 'result') { assert.ok(input); action = record(record(input.authority).notification) }
      else assert.equal(purpose, 'message')
      const args = JSON.stringify(tool === 'simulation_stage' ? { proposals: action === undefined ? [] : [{ after: [], action }] } : {})
      const id = CallId(`${key}:${step}`)
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 0, id, name: tool, argumentsDelta: args }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name: tool, arguments: args } }
      yield { type: 'usage', usage: { inputTokens: 10, outputTokens: 5 } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
    }
  }
  ctx.effect(() => ctx.llm.registerAdapter(['world-external-mediated-scripted'], new Model()))
}
