import { Context } from '@clocky/cordis'
import type { Agent } from '@clocky/clocky-agent'
import AgentLoop from '@clocky/clocky-agent-loop'
import { mountAgentLoopTestDependencies } from '@clocky/clocky-agent-loop-testkit'
import { createUserMessage, LlmAdapter } from '@clocky/clocky-llm'
import type { GenerateOptions, StreamChunk } from '@clocky/clocky-llm'
import JsonlSessionPersistence from '@clocky/clocky-session-persistence-jsonl'
import {
  activationBindingSnapshotSchema,
} from '@clocky/clocky-team'
import type { ActivationBindingSnapshot } from '@clocky/clocky-team'
import TeamLinkRegistry from '@clocky/clocky-team-link'
import type { TeamLink } from '@clocky/clocky-team-link'
import * as WebSocketClient from '@clocky/clocky-team-link-websocket'
import { FixedBindingTeamAgentLinkDelivery } from '../../src/index.ts'

const capabilityEnv = 'CLOCKY_TEAM_AGENT_CLIENT_WEBSOCKET_E2E_CAPABILITY'
const timeoutMs = 5_000

interface BootCommand {
  readonly kind: 'boot'
  readonly requestId: number
  readonly endpoint: string
  readonly binding: ActivationBindingSnapshot
  readonly persistenceRoot: string
}

interface RequestCommand {
  readonly kind: 'drop' | 'drop-interrupt-ack' | 'release-receipt' | 'start-turn' | 'wait-interrupted' | 'observed' | 'close'
  readonly requestId: number
}

type Command = BootCommand | RequestCommand

type Message =
  | { readonly kind: 'ready' }
  | { readonly kind: 'booted' | 'dropped' | 'released' | 'turn-started' | 'interrupted' | 'closed'; readonly requestId: number }
  | { readonly kind: 'persisted'; readonly envelopeId: string; readonly durableEnvelopeIds: readonly string[] }
  | { readonly kind: 'observed'; readonly requestId: number; readonly durableEnvelopeIds: readonly string[] }
  | { readonly kind: 'error'; readonly requestId: number; readonly message: string }

interface DeliveryConnection {
  readonly link?: TeamLink
}

interface DeliveryInternals {
  readonly connections: ReadonlyMap<string, DeliveryConnection>
}

interface Runtime {
  readonly ctx: Context
  readonly agent: Agent
  readonly binding: ActivationBindingSnapshot
  readonly delivery: FixedBindingTeamAgentLinkDelivery
  readonly adapter: InterruptibleAdapter
  readonly receiptGate: PromiseWithResolvers<undefined>
  receiptHeld: boolean
}

if (process.send === undefined) throw new Error('fixed-binding WebSocket fixture requires a Node IPC channel')

const send = process.send.bind(process)
let runtime: Runtime | undefined

class InterruptibleAdapter extends LlmAdapter {
  readonly started = Promise.withResolvers<undefined>()

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const signal = options.signal
    if (signal === undefined) throw new Error('fixed-binding WebSocket fixture requires a turn signal')
    this.started.resolve(undefined)
    if (!signal.aborted) {
      await new Promise<void>((resolve) => {
        signal.addEventListener('abort', () => { resolve() }, { once: true })
      })
    }
    yield { type: 'finish', reason: { kind: 'aborted', failure: { code: 'ABORTED', message: 'Team soft interrupt' } } }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requestId(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error('IPC requestId must be a non-negative safe integer')
  }
  return value
}

function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`IPC ${field} must be a non-empty string`)
  return value
}

function parseCommand(value: unknown): Command {
  if (!isRecord(value)) throw new Error('IPC command must be an object')
  const id = requestId(value.requestId)
  switch (value.kind) {
    case 'boot': return {
      kind: 'boot',
      requestId: id,
      endpoint: text(value.endpoint, 'endpoint'),
      binding: activationBindingSnapshotSchema.parse(value.binding),
      persistenceRoot: text(value.persistenceRoot, 'persistenceRoot'),
    }
    case 'drop':
    case 'drop-interrupt-ack':
    case 'release-receipt':
    case 'start-turn':
    case 'wait-interrupted':
    case 'observed':
    case 'close': return { kind: value.kind, requestId: id }
    default: throw new Error('IPC command kind is invalid')
  }
}

async function sendMessage(message: Message): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    send(message, undefined, undefined, (error) => {
      if (error === null || error === undefined) resolve()
      else reject(error)
    })
  })
}

function requireRuntime(): Runtime {
  if (runtime === undefined) throw new Error('IPC boot must complete before this command')
  return runtime
}

function bindingKey(binding: ActivationBindingSnapshot): string {
  return JSON.stringify([binding.activation.teamId, binding.activation.participantId])
}

function currentLink(current: Runtime): TeamLink | undefined {
  const internal = current.delivery as unknown as DeliveryInternals
  return internal.connections.get(bindingKey(current.binding))?.link
}

async function waitForValue<T>(read: () => T | undefined, label: string): Promise<T> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = read()
    if (value !== undefined) return value
    if (Date.now() >= deadline) throw new Error(`${label} exceeded ${String(timeoutMs)}ms`)
    await new Promise<void>(resolve => setTimeout(resolve, 10))
  }
}

function durableEnvelopeIds(events: readonly { readonly type: string; readonly data: unknown }[]): string[] {
  const ids: string[] = []
  for (const event of events) {
    if (event.type === 'user/message') {
      const source = (event.data as { readonly source?: { readonly kind?: unknown; readonly envelopeId?: unknown } }).source
      if (source?.kind === 'team-envelope' && typeof source.envelopeId === 'string') ids.push(source.envelopeId)
      continue
    }
    if (event.type !== 'agent/inbox/spliced') continue
    const inserted = (event.data as {
      readonly inserted?: readonly { readonly source?: { readonly kind?: unknown; readonly envelopeId?: unknown } }[]
    }).inserted
    for (const message of inserted ?? []) {
      if (message.source?.kind === 'team-envelope' && typeof message.source.envelopeId === 'string') {
        ids.push(message.source.envelopeId)
      }
    }
  }
  return ids
}

async function inspectEnvelopeIds(current: Runtime): Promise<string[]> {
  const stored = await current.ctx.sessionPersistence.inspect(current.agent.id)
  return durableEnvelopeIds(stored.events)
}

function gateInitialReceipt(current: Runtime, link: TeamLink): void {
  const original = link.acknowledge.bind(link)
  const mutable = link as unknown as { acknowledge: TeamLink['acknowledge'] }
  mutable.acknowledge = async (channelId, envelopeId, expectedCursor) => {
    if (!current.receiptHeld) {
      current.receiptHeld = true
      await sendMessage({ kind: 'persisted', envelopeId, durableEnvelopeIds: await inspectEnvelopeIds(current) })
      await current.receiptGate.promise
    }
    return await original(channelId, envelopeId, expectedCursor)
  }
}

async function boot(command: BootCommand): Promise<void> {
  if (runtime !== undefined) throw new Error('IPC boot may run only once')
  const ctx = new Context()
  try {
    await mountAgentLoopTestDependencies(ctx)
    const adapter = new InterruptibleAdapter()
    ctx.llm.registerAdapter(['mock'], adapter)
    await ctx.plugin(JsonlSessionPersistence, { root: command.persistenceRoot, compression: 'none' })
    await ctx.plugin(AgentLoop, { agents: [] })
    await ctx.plugin(TeamLinkRegistry)
    await ctx.plugin(WebSocketClient, {
      providerName: 'websocket',
      endpoint: command.endpoint,
      capabilityEnv,
      connectTimeoutMs: 1_000,
      responseTimeoutMs: 1_000,
      maxFrameBytes: 16 * 1024,
      maxPendingRequests: 8,
      maxBufferedNotifications: 8,
    })
    const handle = await ctx.agents.create({
      sessionId: command.binding.sessionId,
      agentOptions: { provider: 'mock', model: 'mock' },
    })
    const delivery = new FixedBindingTeamAgentLinkDelivery(ctx, {
      agent: handle.agent,
      binding: command.binding,
    }, {
      linkProvider: 'websocket',
      reconnectDelayMs: 10,
      disposalTimeoutMs: timeoutMs,
    })
    const current: Runtime = {
      ctx,
      agent: handle.agent,
      binding: command.binding,
      delivery,
      adapter,
      receiptGate: Promise.withResolvers<undefined>(),
      receiptHeld: false,
    }
    runtime = current
    delivery.start()
    const link = await waitForValue(() => currentLink(current), 'fixed-binding WebSocket connection')
    gateInitialReceipt(current, link)
  } catch (error) {
    runtime = undefined
    await ctx.fiber.dispose()
    throw error
  }
  await sendMessage({ kind: 'booted', requestId: command.requestId })
}

async function drop(command: RequestCommand, requireHeldReceipt: boolean): Promise<void> {
  const current = requireRuntime()
  if (requireHeldReceipt && !current.receiptHeld) throw new Error('receipt gate must hold before the test disconnects')
  const previous = currentLink(current)
  if (previous === undefined) throw new Error('fixed-binding WebSocket Link is not connected')
  const socket = previous as unknown as { readonly socket: { terminate(): void } }
  socket.socket.terminate()
  await previous.done.then(
    () => { throw new Error('forced socket termination must reject the Team Link') },
    () => undefined,
  )
  await waitForValue(() => {
    const next = currentLink(current)
    return next !== undefined && next !== previous ? next : undefined
  }, 'fixed-binding WebSocket reconnect')
  await sendMessage({ kind: 'dropped', requestId: command.requestId })
}

async function releaseReceipt(command: RequestCommand): Promise<void> {
  const current = requireRuntime()
  if (!current.receiptHeld) throw new Error('receipt gate is not waiting')
  current.receiptGate.resolve(undefined)
  await sendMessage({ kind: 'released', requestId: command.requestId })
}

async function startTurn(command: RequestCommand): Promise<void> {
  const current = requireRuntime()
  current.agent.followup(createUserMessage({
    content: [{ type: 'text', text: 'Wait for the Team soft interrupt.' }],
    source: { kind: 'user' },
  }))
  await current.adapter.started.promise
  await sendMessage({ kind: 'turn-started', requestId: command.requestId })
}

async function waitInterrupted(command: RequestCommand): Promise<void> {
  const current = requireRuntime()
  await current.agent.whenIdle()
  const end = current.agent.session.events.findLast(event => event.type === 'turn/end')
  const reason = end?.type === 'turn/end' ? end.data.reason : undefined
  if (reason?.kind !== 'aborted' || reason.reason?.kind !== 'user') {
    throw new Error('Team soft interrupt did not end the target Agent turn')
  }
  await sendMessage({ kind: 'interrupted', requestId: command.requestId })
}

async function observed(command: RequestCommand): Promise<void> {
  const current = requireRuntime()
  await sendMessage({ kind: 'observed', requestId: command.requestId, durableEnvelopeIds: await inspectEnvelopeIds(current) })
}

async function close(command: RequestCommand): Promise<void> {
  const current = runtime
  runtime = undefined
  if (current !== undefined) {
    current.receiptGate.resolve(undefined)
    await current.delivery.close()
    await current.ctx.fiber.dispose()
  }
  await sendMessage({ kind: 'closed', requestId: command.requestId })
  if (process.connected) process.disconnect()
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function receive(value: unknown): Promise<void> {
  let id = 0
  try {
    const command = parseCommand(value)
    id = command.requestId
    switch (command.kind) {
      case 'boot': await boot(command); return
      case 'drop': await drop(command, true); return
      case 'drop-interrupt-ack': await drop(command, false); return
      case 'release-receipt': await releaseReceipt(command); return
      case 'start-turn': await startTurn(command); return
      case 'wait-interrupted': await waitInterrupted(command); return
      case 'observed': await observed(command); return
      case 'close': await close(command); return
    }
  } catch (error) {
    await sendMessage({ kind: 'error', requestId: id, message: errorMessage(error) })
  }
}

process.on('message', (value: unknown) => {
  void receive(value).catch(() => { process.exitCode = 1 })
})

void sendMessage({ kind: 'ready' }).catch(() => { process.exitCode = 1 })
