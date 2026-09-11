import { Context } from '@clocky/cordis'
import {
  activationBindingSnapshotSchema,
  channelIdSchema,
  envelopeIdSchema,
} from '@clocky/clocky-team'
import type {
  ActivationBindingSnapshot,
  ChannelId,
  EnvelopeId,
} from '@clocky/clocky-team'
import TeamLinkRegistry from '@clocky/clocky-team-link'
import type { TeamLink } from '@clocky/clocky-team-link'
import * as WebSocketClient from '@clocky/clocky-team-link-websocket'

const capabilityEnv = 'CLOCKY_TEAM_LINK_WEBSOCKET_HUB_TEST_CAPABILITY'

interface BootCommand {
  readonly kind: 'boot'
  readonly requestId: number
  readonly endpoint: string
  readonly binding: ActivationBindingSnapshot
  readonly capability?: string
}

interface ConnectCommand {
  readonly kind: 'connect'
  readonly requestId: number
}

interface DropCommand {
  readonly kind: 'drop'
  readonly requestId: number
}

interface ClaimAckCommand {
  readonly kind: 'claim-ack'
  readonly requestId: number
  readonly channelId: ChannelId
  readonly envelopeId: EnvelopeId
}

interface ObservedCommand {
  readonly kind: 'observed'
  readonly requestId: number
}

interface CloseCommand {
  readonly kind: 'close'
  readonly requestId: number
}

type Command = BootCommand | ConnectCommand | DropCommand | ClaimAckCommand | ObservedCommand | CloseCommand

type Message =
  | { readonly kind: 'ready' }
  | { readonly kind: 'booted'; readonly requestId: number }
  | { readonly kind: 'connected'; readonly requestId: number }
  | { readonly kind: 'dropped'; readonly requestId: number }
  | { readonly kind: 'acknowledged'; readonly requestId: number; readonly envelopeId: string }
  | { readonly kind: 'observed'; readonly requestId: number; readonly envelopeIds: readonly string[] }
  | { readonly kind: 'closed'; readonly requestId: number }
  | { readonly kind: 'notify'; readonly envelopeId: string }
  | { readonly kind: 'termination-requested'; readonly code: string; readonly message: string }
  | { readonly kind: 'error'; readonly requestId: number; readonly message: string }

if (process.send === undefined) throw new Error('two-process Team Link fixture requires a Node IPC channel')

const send = process.send.bind(process)

let ctx: Context | undefined
let binding: ActivationBindingSnapshot | undefined
let link: TeamLink | undefined
let notificationIds: string[] = []

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
    case 'boot':
      return {
        kind: 'boot',
        requestId: id,
        endpoint: text(value.endpoint, 'endpoint'),
        binding: activationBindingSnapshotSchema.parse(value.binding),
        ...value.capability === undefined ? {} : { capability: text(value.capability, 'capability') },
      }
    case 'connect': return { kind: 'connect', requestId: id }
    case 'drop': return { kind: 'drop', requestId: id }
    case 'claim-ack': return {
      kind: 'claim-ack',
      requestId: id,
      channelId: channelIdSchema.parse(value.channelId),
      envelopeId: envelopeIdSchema.parse(value.envelopeId),
    }
    case 'observed': return { kind: 'observed', requestId: id }
    case 'close': return { kind: 'close', requestId: id }
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

function requireContext(): Context {
  if (ctx === undefined || binding === undefined) throw new Error('IPC boot must complete before this command')
  return ctx
}

function requireLink(): TeamLink {
  if (link === undefined) throw new Error('IPC connect must complete before this command')
  return link
}

async function boot(command: BootCommand): Promise<void> {
  if (ctx !== undefined) throw new Error('IPC boot may run only once')
  if (command.capability !== undefined) process.env[capabilityEnv] = command.capability
  const next = new Context()
  await next.plugin(TeamLinkRegistry)
  await next.plugin(WebSocketClient, {
    providerName: 'websocket',
    endpoint: command.endpoint,
    capabilityEnv,
    connectTimeoutMs: 1_000,
    responseTimeoutMs: 1_000,
    maxFrameBytes: 16 * 1024,
    maxPendingRequests: 8,
    maxBufferedNotifications: 8,
  })
  ctx = next
  binding = command.binding
  await sendMessage({ kind: 'booted', requestId: command.requestId })
}

async function connect(command: ConnectCommand): Promise<void> {
  const current = requireContext()
  if (link !== undefined) throw new Error('IPC connect requires no live Link')
  notificationIds = []
  const connected = await current.teamLinks.connect({
    provider: 'websocket',
    binding: binding!,
    onTerminate: async (reason) => {
      await sendMessage({ kind: 'termination-requested', code: reason.code, message: reason.message })
    },
  })
  connected.onNotify(async (envelope) => {
    notificationIds.push(envelope.id)
    await sendMessage({ kind: 'notify', envelopeId: envelope.id })
  })
  void connected.done.catch(() => {})
  link = connected
  await sendMessage({ kind: 'connected', requestId: command.requestId })
}

async function drop(command: DropCommand): Promise<void> {
  const current = requireLink()
  const socket = current as unknown as { readonly socket: { terminate(): void } }
  socket.socket.terminate()
  await current.done.then(
    () => { throw new Error('forced socket termination must reject the Link') },
    () => undefined,
  )
  if (link === current) link = undefined
  await sendMessage({ kind: 'dropped', requestId: command.requestId })
}

async function claimAck(command: ClaimAckCommand): Promise<void> {
  const current = requireLink()
  const claim = await current.claim(command.channelId, command.envelopeId)
  if (claim === undefined) throw new Error('pending Envelope was not claimable in the child process')
  await current.acknowledge(command.channelId, command.envelopeId, claim.channel.cursor)
  await sendMessage({ kind: 'acknowledged', requestId: command.requestId, envelopeId: command.envelopeId })
}

async function close(command: CloseCommand): Promise<void> {
  const active = link
  link = undefined
  if (active !== undefined) {
    await active.close().catch((error: unknown) => {
      if (error instanceof Error && error.message === 'Team Link WebSocket closed remotely') return
      throw error
    })
  }
  const current = ctx
  ctx = undefined
  binding = undefined
  if (current !== undefined) await current.fiber.dispose()
  await sendMessage({ kind: 'closed', requestId: command.requestId })
  if (process.connected) process.disconnect()
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function receive(value: unknown): Promise<void> {
  let id = 0
  try {
    const command = parseCommand(value)
    id = command.requestId
    switch (command.kind) {
      case 'boot':
        await boot(command)
        return
      case 'connect':
        await connect(command)
        return
      case 'drop':
        await drop(command)
        return
      case 'claim-ack':
        await claimAck(command)
        return
      case 'observed':
        await sendMessage({ kind: 'observed', requestId: command.requestId, envelopeIds: notificationIds })
        return
      case 'close':
        await close(command)
        return
    }
  } catch (error: unknown) {
    await sendMessage({ kind: 'error', requestId: id, message: message(error) })
  }
}

process.on('message', (value: unknown) => {
  void receive(value).catch(() => { process.exitCode = 1 })
})

void sendMessage({ kind: 'ready' }).catch(() => { process.exitCode = 1 })
