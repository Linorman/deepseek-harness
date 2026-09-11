import { Context } from '@clocky/cordis'
import { join } from 'node:path'
import WebServer from '@clocky/clocky-host-webserver'
import Storage from '@clocky/clocky-storage'
import * as StorageLog from '@clocky/clocky-storage-log'
import * as StorageSqlite from '@clocky/clocky-storage-sqlite'
import {
  activationBindingSnapshotSchema,
  type ActivationBindingSnapshot,
} from '@clocky/clocky-team'
import TeamLinkRegistry from '@clocky/clocky-team-link'
import type { TeamLinkEnrollment } from '@clocky/clocky-team-link'
import TeamHub from '@clocky/clocky-team-hub'
import TeamWorkspaceRegistry from '@clocky/clocky-team-workspace'
import * as DirectChannel from '@clocky/clocky-team-channel-direct'
import * as TaskAssignmentChannel from '@clocky/clocky-team-channel-task-assignment'
import * as WebSocketHub from '../../src/index.ts'

const enrollmentProvider = 'websocket'

type Command =
  | { readonly kind: 'boot'; readonly requestId: number; readonly root: string }
  | { readonly kind: 'reserve'; readonly requestId: number; readonly binding: ActivationBindingSnapshot }
  | { readonly kind: 'close'; readonly requestId: number }

type Message =
  | { readonly kind: 'ready' }
  | { readonly kind: 'booted'; readonly requestId: number; readonly endpoint: string }
  | { readonly kind: 'reserved'; readonly requestId: number; readonly endpoint: string; readonly capability: string }
  | { readonly kind: 'closed'; readonly requestId: number }
  | { readonly kind: 'error'; readonly requestId: number; readonly message: string }

if (process.send === undefined) throw new Error('two-process Team Link Hub fixture requires a Node IPC channel')

const send = process.send.bind(process)
let context: Context | undefined
const enrollments: TeamLinkEnrollment[] = []

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requestId(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error('IPC requestId must be a non-negative integer')
  }
  return value
}

function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`IPC ${field} must be a non-empty string`)
  return value
}

function parseCommand(value: unknown): Command {
  if (!isRecord(value) || typeof value.kind !== 'string') throw new Error('IPC command must be an object')
  const id = requestId(value.requestId)
  switch (value.kind) {
    case 'boot': return { kind: 'boot', requestId: id, root: text(value.root, 'root') }
    case 'reserve': return {
      kind: 'reserve',
      requestId: id,
      binding: activationBindingSnapshotSchema.parse(value.binding),
    }
    case 'close': return { kind: 'close', requestId: id }
    default: throw new Error('IPC Hub command kind is invalid')
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
  if (context === undefined) throw new Error('IPC Hub boot must complete before this command')
  return context
}

async function boot(command: Extract<Command, { readonly kind: 'boot' }>): Promise<void> {
  if (context !== undefined) throw new Error('IPC Hub boot may run only once')
  const next = new Context()
  await next.plugin(WebServer, { host: '127.0.0.1', port: 0 })
  await next.plugin(Storage)
  await next.plugin(StorageSqlite, { path: join(command.root, 'hub.sqlite') })
  await next.plugin(StorageLog, { backend: 'sqlite', routes: {} })
  await next.plugin(TeamHub)
  await next.plugin(TeamWorkspaceRegistry)
  await next.plugin(TeamLinkRegistry)
  await next.plugin(DirectChannel)
  await next.plugin(TaskAssignmentChannel)
  const endpoint = `ws://127.0.0.1:${String(next.webServer.port)}/team-link`
  await next.plugin(WebSocketHub, {
    path: '/team-link',
    endpoint,
    enrollmentProviderName: enrollmentProvider,
    bindings: [],
    pageSize: 2,
    maxFrameBytes: 16 * 1024,
    maxConnections: 8,
    maxPendingRequests: 8,
    maxQueuedBytes: 64 * 1024,
    maxOutstandingDeliveries: 8,
    requestWindowMs: 1_000,
    maxRequestsPerWindow: 32,
    closeTimeoutMs: 100,
    handshakeTimeoutMs: 1_000,
    heartbeatIntervalMs: 1_000,
    heartbeatTimeoutMs: 100,
    retryableNackDelayMs: 1,
    backpressureRetryAfterMs: 100,
  })
  context = next
  await sendMessage({ kind: 'booted', requestId: command.requestId, endpoint })
}

async function reserve(command: Extract<Command, { readonly kind: 'reserve' }>): Promise<void> {
  const enrollment = await requireContext().teamLinks.reserveEnrollment({
    provider: enrollmentProvider,
    binding: command.binding,
  })
  enrollments.push(enrollment)
  await sendMessage({
    kind: 'reserved',
    requestId: command.requestId,
    endpoint: enrollment.endpoint,
    capability: enrollment.capability,
  })
}

async function close(command: Extract<Command, { readonly kind: 'close' }>): Promise<void> {
  const current = context
  context = undefined
  enrollments.length = 0
  if (current !== undefined) await current.fiber.dispose()
  await sendMessage({ kind: 'closed', requestId: command.requestId })
  process.exit(0)
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
      case 'boot': await boot(command); return
      case 'reserve': await reserve(command); return
      case 'close': await close(command); return
    }
  } catch (error: unknown) {
    await sendMessage({ kind: 'error', requestId: id, message: message(error) })
  }
}

process.on('message', (value: unknown) => {
  void receive(value).catch(() => { process.exitCode = 1 })
})

void sendMessage({ kind: 'ready' }).catch(() => { process.exitCode = 1 })
