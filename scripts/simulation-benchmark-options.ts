/** Explicit workload and process bounds for the local Simulation benchmark. @module */
import { parseArgs } from 'node:util'
import { resolve, relative, isAbsolute, sep } from 'node:path'

/** Shared sizes and deadlines for each isolated benchmark process. */
interface BenchmarkBounds {
  readonly backend: 'json' | 'sqlite'
  readonly entities: number
  readonly operations: number
  readonly durationMs: number
  readonly timeoutMs: number
  readonly sampleEvery: number
  readonly entityBatchSize: number
  readonly replayPageSize: number
  readonly output: string
}

/** Each workload declares its storage, placement, policy and model bounds explicitly. */
export type SimulationBenchmarkOptions = BenchmarkBounds & (
  | { readonly workload: 'live-model'; readonly endpoint: string; readonly model: string; readonly reasoningEffort: 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'; readonly thinkingFormat: 'openai' | 'deepseek'; readonly tokenBudget: number; readonly tokensPerRequest: number; readonly maxOutputTokens: number; readonly maxModelCalls: number; readonly contextWindow: number }
  | { readonly workload: 'ingress' }
  | { readonly workload: 'world'; readonly worldBatchSize: number }
  | { readonly workload: 'actors-world'; readonly worldEvents: number; readonly worldBatchSize: number; readonly residents: number; readonly models: number; readonly modelDelayMs: number }
  | { readonly workload: 'organization'; readonly residents: number; readonly departments: number; readonly managers: number; readonly days: number }
  | { readonly workload: 'actors' | 'messages' | 'parallel-messages'; readonly residents: number; readonly models: number; readonly modelDelayMs: number }
)

/**
 * Parse explicit benchmark sizes and deadlines; outputs stay inside this checkout.
 * @param args - Command-line flags without the executable or script.
 * @returns validated workload parameters; missing, unsafe and inconsistent bounds reject.
 */
export function parseSimulationBenchmarkOptions(args: string[]): SimulationBenchmarkOptions {
  const { values } = parseArgs({ args, options: {
    endpoint: { type: 'string' }, model: { type: 'string' }, 'token-budget': { type: 'string' },
    'tokens-per-request': { type: 'string' }, 'max-output-tokens': { type: 'string' }, 'max-model-calls': { type: 'string' },
    'context-window': { type: 'string' }, 'reasoning-effort': { type: 'string' }, 'thinking-format': { type: 'string' },
    backend: { type: 'string' }, workload: { type: 'string' }, entities: { type: 'string' }, operations: { type: 'string' },
    'duration-ms': { type: 'string' }, 'timeout-ms': { type: 'string' }, 'sample-every': { type: 'string' },
    'entity-batch-size': { type: 'string' }, 'replay-page-size': { type: 'string' }, residents: { type: 'string' }, models: { type: 'string' },
    'model-delay-ms': { type: 'string' }, 'world-events': { type: 'string' }, departments: { type: 'string' }, managers: { type: 'string' }, days: { type: 'string' }, 'world-batch-size': { type: 'string' }, output: { type: 'string' },
  } })
  const positive = (name: keyof typeof values): number => {
    const value = Number(values[name])
    if (!Number.isSafeInteger(value) || value < 1) throw new Error(`--${name} must be a positive safe integer`)
    return value
  }
  if (values.backend !== 'json' && values.backend !== 'sqlite') throw new Error('--backend must be json or sqlite')
  if (values.workload !== 'live-model' && values.workload !== 'ingress' && values.workload !== 'world' && values.workload !== 'actors' && values.workload !== 'messages' && values.workload !== 'parallel-messages' && values.workload !== 'organization' && values.workload !== 'actors-world') {
    throw new Error('--workload must be ingress, world, actors, messages, parallel-messages, organization actors-world or live-model')
  }
  if (!values.output) throw new Error('--output is required')
  const output = resolve(values.output)
  const within = relative(process.cwd(), output)
  if (within === '..' || within.startsWith(`..${sep}`) || isAbsolute(within)) throw new Error('--output must be inside the checkout')
  const durationMs = positive('duration-ms'), timeoutMs = positive('timeout-ms')
  if (timeoutMs <= durationMs || timeoutMs > 2_147_483_647) throw new Error('--timeout-ms must exceed --duration-ms and fit a Node timer')
  const bounds = { backend: values.backend, entities: positive('entities'), operations: positive('operations'),
    durationMs, timeoutMs, sampleEvery: positive('sample-every'), entityBatchSize: positive('entity-batch-size'), replayPageSize: positive('replay-page-size'), output }
  if (values.workload !== 'world' && values.workload !== 'actors-world' && values['world-batch-size'] !== undefined) {
    throw new Error('--world-batch-size applies only to world or actors-world workloads')
  }
  if (values.workload !== 'actors-world' && values['world-events'] !== undefined) {
    throw new Error('--world-events applies only to the actors-world workload')
  }
  const liveFlags = ['endpoint', 'model', 'token-budget', 'tokens-per-request', 'max-output-tokens', 'max-model-calls', 'context-window', 'reasoning-effort', 'thinking-format'] as const
  if (values.workload === 'live-model') {
    if (bounds.entities !== 1 || bounds.operations !== 1) throw new Error('Live model sample requires one entity and one decision')
    for (const key of ['residents', 'models', 'model-delay-ms', 'departments', 'managers', 'days'] as const) {
      if (values[key] !== undefined) throw new Error('Live model sample uses one resident and one stream')
    }
    if (!values.endpoint || !values.model?.trim()) throw new Error('Live model sample requires --endpoint and --model')
    const reasoningEffort = values['reasoning-effort'], thinkingFormat = values['thinking-format']
    if (reasoningEffort !== 'off' && reasoningEffort !== 'minimal' && reasoningEffort !== 'low' && reasoningEffort !== 'medium'
      && reasoningEffort !== 'high' && reasoningEffort !== 'xhigh' && reasoningEffort !== 'max') {
      throw new Error('--reasoning-effort must be off, minimal, low, medium, high, xhigh or max')
    }
    if (thinkingFormat !== 'openai' && thinkingFormat !== 'deepseek') throw new Error('--thinking-format must be openai or deepseek')
    const endpoint = new URL(values.endpoint)
    if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
      throw new Error('Live endpoint must be HTTP(S) without credentials, query or fragment')
    }
    const tokenBudget = positive('token-budget'), tokensPerRequest = positive('tokens-per-request')
    const maxOutputTokens = positive('max-output-tokens'), maxModelCalls = positive('max-model-calls'), contextWindow = positive('context-window')
    if (tokensPerRequest > tokenBudget || maxOutputTokens > tokensPerRequest || maxOutputTokens > contextWindow) {
      throw new Error('Live request reservation must fit the token budget and output must fit reservation/context')
    }
    return { ...bounds, backend: values.backend, workload: 'live-model', endpoint: endpoint.href, model: values.model,
      reasoningEffort, thinkingFormat, tokenBudget, tokensPerRequest, maxOutputTokens, maxModelCalls, contextWindow }
  }
  if (liveFlags.some(key => values[key] !== undefined)) throw new Error('Live model flags apply only to live-model')
  if (values.workload === 'organization') {
    const departments = positive('departments'), managers = positive('managers'), days = positive('days'), residents = positive('residents')
    const employees = bounds.entities - departments - managers
    if (employees < 1 || residents > employees + managers || managers < departments
      || !Number.isSafeInteger(employees * days) || bounds.operations !== employees * days
      || !Number.isSafeInteger(bounds.operations * 6) || !Number.isSafeInteger(days + 2)) {
      throw new Error('Organization requires employees = entities - departments - managers > 0, managers >= departments, residents <= employees + managers and operations = employees * days within safe bounds')
    }
    if (values.models !== undefined || values['model-delay-ms'] !== undefined) throw new Error('Organization uses deterministic policies without model controls')
    return { ...bounds, backend: values.backend, workload: values.workload, residents, departments, managers, days }
  }
  if (values.departments !== undefined || values.managers !== undefined || values.days !== undefined) {
    throw new Error('Organization bounds apply only to the organization workload')
  }
  if (values.workload === 'actors' || values.workload === 'actors-world' || values.workload === 'messages' || values.workload === 'parallel-messages') {
    const residents = positive('residents'), models = positive('models'), modelDelayMs = positive('model-delay-ms')
    if (residents > bounds.entities || models > residents || modelDelayMs > durationMs) {
      throw new Error('Cognition workload requires models <= residents <= entities and model-delay-ms <= duration-ms')
    }
    if (values.workload === 'messages' && (residents < 2 || models !== 1)) {
      throw new Error('Message workload requires at least two residents and exactly one model permit')
    }
    if (values.workload === 'parallel-messages' && (residents < 4 || models > Math.floor(residents / 2))) {
      throw new Error('Parallel messages require at least four residents and models <= floor(residents / 2)')
    }
    if (values.workload === 'actors-world') return { ...bounds, backend: values.backend, workload: values.workload,
      residents, models, modelDelayMs, worldEvents: positive('world-events'), worldBatchSize: positive('world-batch-size') }
    return { ...bounds, backend: values.backend, workload: values.workload, residents, models, modelDelayMs }
  }
  if (values.residents !== undefined || values.models !== undefined || values['model-delay-ms'] !== undefined) {
    throw new Error('Model and resident limits apply only to cognition workloads')
  }
  if (values.workload === 'world') return { ...bounds, backend: values.backend, workload: values.workload,
    worldBatchSize: positive('world-batch-size') }
  return { ...bounds, backend: values.backend, workload: values.workload }
}
