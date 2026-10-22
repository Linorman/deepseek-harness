/** Separate real Host processes share parent-owned test roots; crash hooks only pause durable publication. */
import { spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { launchWebScaffold } from './scaffold.ts'
import { REPO_ROOT } from './support.ts'
import { LlmAdapter, type GenerateOptions, type LlmModelInfo } from '@clocky/clocky-llm'
import type { SimulationRun } from '@clocky/clocky-simulation'
import { companyModel } from '../../../packages/simulation/simulation-product/tests/company-model.ts'
import { defaultWorldModel } from './default-world-model.ts'
import type {} from '../../../examples/headless-agent/tests/fixtures/simulation/simulation-administration/model.ts'

type Stage = 'accepted-create' | 'completed-checkpoint' | 'completed-review'
interface Settings {
  workspaceCwd: string
  persistenceRoot: string
  overlay?: string
  port: number
  published?: boolean
  model?: string
  world?: boolean
}
type Command = { type: 'arm'; stage: Stage } | { type: 'observe' }
interface Ready { type: 'ready'; pid: number; baseUrl: string; credential: string }
interface Held { type: 'held'; stage: Stage; runId: string; commandId: string; checkpointId?: string }
interface Observation {
  type: 'observation'
  requests: number
  postCompactionSubmissions?: number
  correctedReplies?: number
  compactions?: number
  opens?: number
  tasks: number
  reports: number
  transfers: number
  completedCheckpoints: number
  entityCount: number
  channelCount: number
  decisionCount: number
  ingressCount: number
  time?: string
  driver?: string
  stop?: string
  inFlight?: boolean
  phase?: string
  teamPhase?: string
  teamStallCode?: string
  stock?: string
  received?: string
}
type Message = Ready | Held | Observation | { type: 'armed'; stage: Stage }
interface StoredCommand { kind: string; receipt: { runId: string; commandId: string; checkpointId?: string } }
interface Waiter {
  type: Message['type']
  resolve: (message: Message) => void
  reject: (cause: Error) => void
  timer: ReturnType<typeof setTimeout>
}
const stages: readonly string[] = ['accepted-create', 'completed-checkpoint', 'completed-review']

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Malformed Simulation process message')
  return value as Record<string, unknown>
}
function stage(value: unknown): Stage {
  if (typeof value !== 'string' || !stages.includes(value)) throw new Error('Unknown Simulation crash stage')
  return value as Stage
}
function parseMessage(value: unknown): Message {
  const input = record(value)
  switch (input.type) {
    case 'ready':
      if (typeof input.pid === 'number' && Number.isSafeInteger(input.pid) && input.pid > 0
        && typeof input.baseUrl === 'string' && typeof input.credential === 'string') return input as unknown as Ready
      break
    case 'armed': return { type: 'armed', stage: stage(input.stage) }
    case 'held':
      if (typeof input.runId === 'string' && typeof input.commandId === 'string'
        && (input.checkpointId === undefined || typeof input.checkpointId === 'string')) {
        return { type: 'held', stage: stage(input.stage), runId: input.runId, commandId: input.commandId,
          ...input.checkpointId === undefined ? {} : { checkpointId: input.checkpointId } }
      }
      break
    case 'observation':
      if (['correctedReplies', 'postCompactionSubmissions', 'compactions', 'requests', 'tasks', 'reports', 'transfers', 'completedCheckpoints', 'entityCount', 'channelCount',
        'decisionCount', 'ingressCount'].every(key =>
        typeof input[key] === 'number' && Number.isSafeInteger(input[key]) && input[key] >= 0)
        && ['phase', 'teamPhase', 'teamStallCode', 'stock', 'received', 'time', 'driver', 'stop'].every(key => input[key] === undefined || typeof input[key] === 'string')
        && (input.inFlight === undefined || typeof input.inFlight === 'boolean')) {
        if (input.opens !== undefined && (typeof input.opens !== 'number' || !Number.isSafeInteger(input.opens) || input.opens < 0)) break
        return input as unknown as Observation
      }
      break
  }
  throw new Error('Malformed Simulation process message')
}
function parseCommand(value: unknown): Command {
  const input = record(value)
  if (input.type === 'arm') return { type: 'arm', stage: stage(input.stage) }
  if (input.type === 'observe') return { type: 'observe' }
  throw new Error('Unknown Simulation process command')
}
function parseSettings(value: unknown): Settings {
  const input = record(value)
  if (['workspaceCwd', 'persistenceRoot'].every(key => typeof input[key] === 'string')
    && (input.overlay === undefined || typeof input.overlay === 'string')
    && (input.published === undefined || typeof input.published === 'boolean')
    && (input.model === undefined || typeof input.model === 'string')
    && (input.world === undefined || typeof input.world === 'boolean')
    && (input.published === true || typeof input.overlay === 'string')
    && typeof input.port === 'number' && Number.isSafeInteger(input.port) && input.port > 0 && input.port < 65536) {
    return input as unknown as Settings
  }
  throw new Error('Malformed Simulation process settings')
}

/** Ready credentials stay inside the test process/IPC and are never emitted to stdout or snapshots. */
export interface SimulationProcessHost {
  readonly ready: Ready
  /** Arm one journal-publication crash point; the actual accepted work is driven by the browser. */
  arm(stage: Stage): Promise<void>
  /** Await a reached durable crash point before terminating the process. */
  held(): Promise<Held>
  /** Read coarse evidence without opening, recovering or mutating a run. */
  observe(): Promise<Extract<Message, { type: 'observation' }>>
  /** Kill and await OS process exit; parent retains sole ownership of filesystem cleanup. */
  kill(): Promise<void>
}

/**
 * Launch a separately owned Node Host using the actual Web composition and immutable retained roots.
 * @param settings - Parent-owned roots, fixed origin port and trusted fixture overlay.
 * @returns IPC-ready child whose crash points and lifetime are controlled by the parent test.
 */
export async function launchSimulationProcessHost(settings: Settings): Promise<SimulationProcessHost> {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/KEY|TOKEN|SECRET|PASSWORD/i.test(key)))
  const child = spawn(process.execPath, ['--import', 'tsx/esm', fileURLToPath(import.meta.url), '--child', JSON.stringify(settings)], {
    cwd: REPO_ROOT, env: { ...env, CLOCKY_SNAPSHOT: 'replay', TSX_TSCONFIG_PATH: join(REPO_ROOT, 'tsconfig.base.json') },
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  })
  // Diagnostic streams can carry private provider data; the test never publishes child log text.
  child.stderr?.resume()
  const pending: Message[] = [], waiters: Waiter[] = []
  child.on('message', (value: unknown) => {
    let parsed: Message
    try { parsed = parseMessage(value) }
    catch { child.kill('SIGKILL'); return }
    const index = waiters.findIndex(waiter => waiter.type === parsed.type)
    if (index < 0) pending.push(parsed)
    else { const waiter = waiters.splice(index, 1)[0]!; clearTimeout(waiter.timer); waiter.resolve(parsed) }
  })
  const exited = new Promise<void>((resolveExit) => { child.once('exit', () => { resolveExit() }) })
  const rejectWaiters = (cause: Error) => {
    for (const waiter of waiters.splice(0)) { clearTimeout(waiter.timer); waiter.reject(cause) }
  }
  child.once('exit', () => { rejectWaiters(new Error('Independent Simulation Host exited')) })
  const next = <T extends Message['type']>(type: T): Promise<Extract<Message, { type: T }>> => {
    const index = pending.findIndex(message => message.type === type)
    if (index >= 0) return Promise.resolve(pending.splice(index, 1)[0] as Extract<Message, { type: T }>)
    if (!child.connected) return Promise.reject(new Error('Independent Simulation Host is disconnected'))
    return new Promise((resolveNext, reject) => {
      const timer = setTimeout(() => {
        const index = waiters.indexOf(waiter)
        if (index >= 0) waiters.splice(index, 1)
        reject(new Error(`Simulation Host did not publish ${type}`))
      }, 30000)
      const waiter: Waiter = { type, resolve: (message) => { resolveNext(message as Extract<Message, { type: T }>) }, reject, timer }
      waiters.push(waiter)
    })
  }
  const request = async <T extends 'armed' | 'observation'>(type: T, command: Command): Promise<Extract<Message, { type: T }>> => {
    if (!child.connected) throw new Error('Independent Simulation Host is disconnected')
    const result = next(type)
    child.send(command, (cause: Error | null) => { if (cause !== null) rejectWaiters(cause) })
    return await result
  }
  try {
    const ready = await next('ready')
    return { ready,
      async arm(stage) { await request('armed', { type: 'arm', stage }) },
      held: () => next('held'),
      async observe() { return await request('observation', { type: 'observe' }) },
      async kill() { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); await exited },
    }
  } catch (cause: unknown) { child.kill('SIGKILL'); await exited; throw cause }
}

async function serveChild(): Promise<void> {
  const settings = parseSettings(JSON.parse(process.argv[3] ?? '{}'))
  const scaffold = await launchWebScaffold({ retainedWorld: settings, port: settings.port,
    productPrincipalId: 'simulation-restart-owner', ...settings.published ? {} : {
      disableDefaultSimulation: true, extraOverlayPath: settings.overlay!, agentPresets: { default: 'simulation',
        roots: [{ path: join(REPO_ROOT, 'examples/simulation-company/presets'), trust: 'system' as const }] },
    } })
  let publishedRun: SimulationRun | undefined
  let opens = 0
  const requests: Array<{ stage: string; tools: string[]; goal: string }> = []
  // Residency may evict SessionStore entries before observation; retain only event positions, never model bodies.
  const compactionProofs = new Map<string, { views: Map<string, number>; shadowed: Set<number> }>()
  scaffold.ctx.on('session/event', (session, event) => {
    if (event.type !== 'simulation/context-view' && event.type !== 'compaction/summary') return
    const proof = compactionProofs.get(session.id) ?? { views: new Map<string, number>(), shadowed: new Set<number>() }
    compactionProofs.set(session.id, proof)
    if (event.type === 'simulation/context-view') proof.views.set(event.data.inputId, event.seq)
    else for (const seq of event.data.shadowedSeqs) proof.shadowed.add(seq)
  }, { global: true })
  if (settings.published) {
    const open = scaffold.ctx.simulations.open.bind(scaffold.ctx.simulations)
    scaffold.ctx.simulations.open = async (...args) => { opens++; publishedRun = await open(...args); return publishedRun }
    const scripts = new WeakMap<SimulationRun, ReturnType<typeof companyModel>>()
    const worldScript = settings.world ? defaultWorldModel(requests) : undefined
    scaffold.ctx.llm.registerAdapter(['published-restart'], new class extends LlmAdapter {
      override listModels(provider: string): Promise<readonly LlmModelInfo[]> {
        return Promise.resolve([{ provider, id: settings.model ?? 'procurement', name: 'Procurement replay' }])
      }
      override async resolveModel(provider: string, model: string) {
        return settings.world ? { provider, id: model, name: model, context: { contextWindow: 1048576 } }
          : super.resolveModel(provider, model)
      }
      override async *stream(options: GenerateOptions) {
        if (publishedRun === undefined) throw new Error('Published model request has no accepted world')
        let script = scripts.get(publishedRun)
        if (script === undefined) { script = worldScript ?? companyModel(publishedRun, requests); scripts.set(publishedRun, script) }
        // External response pacing leaves real accepted work to pause/recover;
        // production driver timers and native scheduling remain unchanged.
        for await (const chunk of script.stream(options)) { await delay(100); yield chunk }
      }
    }())
    await scaffold.ctx.agentDefaultModel.saveSelection({ provider: 'published-restart', model: settings.model ?? 'procurement' })
  }
  const send = (message: Message): void => { process.send?.(message) }
  let armed: Stage | undefined
  const commands = new Map<string, StoredCommand>()
  const stream = scaffold.ctx.storageLog.get(settings.published ? 'web-simulation-commands-v1' : 'browser-simulation-commands')
  if (stream === undefined) throw new Error('Simulation restart has no durable administration journal')
  const append = stream.append.bind(stream)
  const hold = async (stage: Stage, commandId: string): Promise<void> => {
    if (armed !== stage) return
    const command = commands.get(commandId)
    if (command === undefined) throw new Error('Simulation crash point lost its original command')
    armed = undefined
    send({ type: 'held', stage, runId: command.receipt.runId, commandId,
      ...command.receipt.checkpointId === undefined ? {} : { checkpointId: command.receipt.checkpointId } })
    await new Promise<void>(() => {})
  }
  stream.append = async (...args) => {
    const entry = args[1][0] as { kind: string; commandId?: string; command?: StoredCommand }
    if (entry.kind === 'command/accepted' && entry.command !== undefined) commands.set(entry.command.receipt.commandId, entry.command)
    if (entry.kind === 'command/completed' && entry.commandId !== undefined) {
      const kind = commands.get(entry.commandId)?.kind
      if (kind === 'checkpoint') await hold('completed-checkpoint', entry.commandId)
      if (kind === 'review') await hold('completed-review', entry.commandId)
    }
    const result = await append(...args)
    if (entry.kind === 'command/accepted' && entry.command?.kind === 'create') await hold('accepted-create', entry.command.receipt.commandId)
    return result
  }
  process.on('message', (value: unknown) => {
    const command = parseCommand(value)
    if (command.type === 'arm') { armed = command.stage; send({ type: 'armed', stage: armed }); return }
    const state = settings.published ? publishedRun?.snapshot() : scaffold.ctx.simulationBrowserProbe.run?.snapshot()
    // Read scheduling metadata from the exact fixture owner without an authenticated write or another run open.
    const administration = scaffold.ctx.simulationAdministration as unknown as {
      held: Map<string, { owner?: { observe(): { driver: string; inFlight: boolean; stop?: string } } }>
    }
    const control = state === undefined ? undefined : administration.held.get(String(state.spec.runId))?.owner?.observe()
    const observation: Extract<Message, { type: 'observation' }> = { type: 'observation',
      postCompactionSubmissions: Object.values(state?.decisions ?? {}).filter((decision) => {
        const proof = decision.consumption
        if (proof === undefined) return false
        const evidence = compactionProofs.get(proof.sessionId)
        return (evidence?.views.get(proof.inputId) ?? -1) > proof.consumedSequence
          && evidence?.shadowed.has(proof.viewSequence) === true
      }).length,
      correctedReplies: requests.filter(value => value.stage === 'reply-correction').length,
      compactions: requests.filter(value => value.stage === 'compaction').length,
      requests: settings.published ? requests.length : scaffold.ctx.simulationBrowserProbe.systemPrompts.length,
      ...settings.published ? { opens } : {},
      tasks: Object.values(state?.taskExecutions ?? {}).length,
      reports: Object.values(state?.operations ?? {}).filter(operation => operation.action.kind === 'communication/post').length,
      transfers: Object.values(state?.operations ?? {}).filter(operation => operation.action.kind === 'resource/transfer').length,
      completedCheckpoints: Object.values(state?.checkpoints ?? {}).filter(checkpoint => checkpoint.status === 'completed').length,
      entityCount: Object.keys(state?.entities ?? {}).length,
      channelCount: Object.values(state?.channelReservations ?? {}).filter(channel => channel.confirmed).length,
      decisionCount: Object.keys(state?.decisions ?? {}).length,
      ingressCount: Object.keys(state?.ingresses ?? {}).length,
      ...state === undefined ? {} : { time: state.time },
      ...control === undefined ? {} : { driver: control.driver, inFlight: control.inFlight,
        ...control.stop === undefined ? {} : { stop: control.stop } },
      ...state === undefined ? {} : { phase: state.phase },
      ...state?.resources['stock' as never] === undefined ? {} : { stock: state.resources['stock' as never]!.quantity },
      ...state?.resources['received' as never] === undefined ? {} : { received: state.resources['received' as never]!.quantity },
    }
    const teamId = state?.teamReservation?.teamId
    if (teamId === undefined) send(observation)
    else void scaffold.ctx.teams.getTeam({ teamId }).then((team) => {
      send({ ...observation, teamPhase: team.team.phase,
        ...team.team.stallReason === undefined ? {} : { teamStallCode: team.team.stallReason.code } })
    }).catch(() => { process.stderr.write('Simulation Team observation failed\n'); process.exit(1) })
  })
  const principal = scaffold.ctx.get('productPrincipals')
  if (principal === undefined) throw new Error('Simulation restart has no authenticated bootstrap owner')
  send({ type: 'ready', pid: process.pid, baseUrl: scaffold.baseUrl, credential: principal.bootstrapCredential('local') })
}

if (process.argv[2] === '--child') {
  void serveChild().catch(() => { process.stderr.write('Independent Simulation Host bootstrap failed\n'); process.exit(1) })
}
