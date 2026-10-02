/** Separate real Host processes share parent-owned test roots; crash hooks only pause durable publication. */
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { launchWebScaffold } from './scaffold.ts'
import { REPO_ROOT } from './support.ts'
import type {} from '../../../examples/headless-agent/tests/fixtures/simulation/simulation-administration/model.ts'

type Stage = 'accepted-create' | 'completed-checkpoint' | 'completed-review'
interface Settings { workspaceCwd: string; persistenceRoot: string; overlay: string; port: number }
type Command = { type: 'arm'; stage: Stage } | { type: 'observe' }
interface Ready { type: 'ready'; pid: number; baseUrl: string; credential: string }
interface Held { type: 'held'; stage: Stage; runId: string; commandId: string; checkpointId?: string }
interface Observation {
  type: 'observation'
  requests: number
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
  inFlight?: boolean
  phase?: string
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
      if (['requests', 'tasks', 'reports', 'transfers', 'completedCheckpoints', 'entityCount', 'channelCount',
        'decisionCount', 'ingressCount'].every(key =>
        typeof input[key] === 'number' && Number.isSafeInteger(input[key]) && input[key] >= 0)
        && ['phase', 'stock', 'received', 'time', 'driver'].every(key => input[key] === undefined || typeof input[key] === 'string')
        && (input.inFlight === undefined || typeof input.inFlight === 'boolean')) {
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
  if (['workspaceCwd', 'persistenceRoot', 'overlay'].every(key => typeof input[key] === 'string')
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
  child.once('exit', () => {
    for (const waiter of waiters.splice(0)) { clearTimeout(waiter.timer); waiter.reject(new Error('Independent Simulation Host exited')) }
  })
  const next = <T extends Message['type']>(type: T): Promise<Extract<Message, { type: T }>> => {
    const index = pending.findIndex(message => message.type === type)
    if (index >= 0) return Promise.resolve(pending.splice(index, 1)[0] as Extract<Message, { type: T }>)
    return new Promise((resolveNext, reject) => {
      const timer = setTimeout(() => { reject(new Error(`Simulation Host did not publish ${type}`)) }, 30000)
      waiters.push({ type, resolve: (message) => { resolveNext(message as Extract<Message, { type: T }>) }, reject, timer })
    })
  }
  try {
    const ready = await next('ready')
    return { ready,
      async arm(stage) { const armed = next('armed'); child.send({ type: 'arm', stage }); await armed },
      held: () => next('held'),
      async observe() { const result = next('observation'); child.send({ type: 'observe' }); return await result },
      async kill() { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); await exited },
    }
  } catch (cause: unknown) { child.kill('SIGKILL'); await exited; throw cause }
}

async function serveChild(): Promise<void> {
  const settings = parseSettings(JSON.parse(process.argv[3] ?? '{}'))
  const scaffold = await launchWebScaffold({ retainedWorld: settings, port: settings.port, extraOverlayPath: settings.overlay,
    productPrincipalId: 'simulation-restart-owner', agentPresets: { default: 'simulation',
      roots: [{ path: join(REPO_ROOT, 'examples/simulation-company/presets'), trust: 'system' }] } })
  const send = (message: Message): void => { process.send?.(message) }
  let armed: Stage | undefined
  const commands = new Map<string, StoredCommand>()
  const stream = scaffold.ctx.storageLog.get('browser-simulation-commands')
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
    const state = scaffold.ctx.simulationBrowserProbe.run?.snapshot()
    // Read scheduling metadata from the exact fixture owner without an authenticated write or another run open.
    const administration = scaffold.ctx.simulationAdministration as unknown as {
      held: Map<string, { owner?: { observe(): { driver: string; inFlight: boolean } } }>
    }
    const control = state === undefined ? undefined : administration.held.get(String(state.spec.runId))?.owner?.observe()
    const observation: Extract<Message, { type: 'observation' }> = { type: 'observation',
      requests: scaffold.ctx.simulationBrowserProbe.systemPrompts.length,
      tasks: Object.values(state?.taskExecutions ?? {}).length,
      reports: Object.values(state?.operations ?? {}).filter(operation => operation.action.kind === 'communication/post').length,
      transfers: Object.values(state?.operations ?? {}).filter(operation => operation.action.kind === 'resource/transfer').length,
      completedCheckpoints: Object.values(state?.checkpoints ?? {}).filter(checkpoint => checkpoint.status === 'completed').length,
      entityCount: Object.keys(state?.entities ?? {}).length,
      channelCount: Object.values(state?.channelReservations ?? {}).filter(channel => channel.confirmed).length,
      decisionCount: Object.keys(state?.decisions ?? {}).length,
      ingressCount: Object.keys(state?.ingresses ?? {}).length,
      ...state === undefined ? {} : { time: state.time },
      ...control === undefined ? {} : { driver: control.driver, inFlight: control.inFlight },
      ...state === undefined ? {} : { phase: state.phase },
      ...state?.resources['stock' as never] === undefined ? {} : { stock: state.resources['stock' as never]!.quantity },
      ...state?.resources['received' as never] === undefined ? {} : { received: state.resources['received' as never]!.quantity },
    }
    send(observation)
  })
  const principal = scaffold.ctx.get('productPrincipals')
  if (principal === undefined) throw new Error('Simulation restart has no authenticated bootstrap owner')
  send({ type: 'ready', pid: process.pid, baseUrl: scaffold.baseUrl, credential: principal.bootstrapCredential('local') })
}

if (process.argv[2] === '--child') {
  void serveChild().catch(() => { process.stderr.write('Independent Simulation Host bootstrap failed\n'); process.exit(1) })
}
