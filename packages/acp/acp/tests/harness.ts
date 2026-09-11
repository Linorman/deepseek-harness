/** Real local Team-run ACP transport fixture. */

import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { Context } from '@clocky/cordis'
import {
  ClientSideConnection,
  ndJsonStream,
  type Client,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SessionNotification,
  type Stream,
} from '@agentclientprotocol/sdk'
import AttachmentStore, { AttachmentError, AttachmentId } from '@clocky/clocky-attachment'
import type { ImageAttachmentLimits, ImageAttachmentRef, SaveImageAttachment, StoredImageAttachment } from '@clocky/clocky-attachment'
import AgentDefaultModelConfig from '@clocky/clocky-agent-default-model'
import AgentLoop from '@clocky/clocky-agent-loop'
import { mountAgentLoopTestDependencies } from '@clocky/clocky-agent-loop-testkit'
import AgentRuntime from '@clocky/clocky-agent-runtime'
import * as InProcessRuntime from '@clocky/clocky-agent-runtime-in-process'
import { CallId, LlmAdapter, type GenerateOptions, type LlmResolvedModelInfo, type StreamChunk } from '@clocky/clocky-llm'
import JsonlSessionPersistence from '@clocky/clocky-session-persistence-jsonl'
import Storage from '@clocky/clocky-storage'
import * as StorageJson from '@clocky/clocky-storage-json'
import * as StorageLog from '@clocky/clocky-storage-log'
import TeamHub from '@clocky/clocky-team-hub'
import * as TeamActivationController from '@clocky/clocky-team-activation-controller'
import * as TeamAgentClient from '@clocky/clocky-team-agent-client'
import * as DirectChannel from '@clocky/clocky-team-channel-direct'
import TeamChannelAdmission from '@clocky/clocky-team-channel-admission'
import * as TeamClosureDriver from '@clocky/clocky-team-closure-driver'
import TeamClosureDriverHub from '@clocky/clocky-team-closure-driver/hub'
import TeamClosureDriveBackendRegistry from '@clocky/clocky-team-closure-driver/registry'
import TeamLinkRegistry from '@clocky/clocky-team-link'
import * as TeamLinkLocal from '@clocky/clocky-team-link-local'
import * as TeamRun from '@clocky/clocky-team-run'
import * as ToolTeam from '@clocky/clocky-tool-team'
import * as AcpPlugin from '../src/index.ts'
import type { AcpConfig } from '../src/index.ts'

const IMAGE_LIMITS: ImageAttachmentLimits = {
  maxImageBytes: 1024,
  maxImagesPerMessage: 4,
  maxMessageImageBytes: 2048,
  maxImagePixels: 1024,
  maxImageDimension: 2000,
  mediaTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
}

export type Scenario =
  | { readonly kind: 'final'; readonly text: string; readonly assistantText?: string; readonly missingImage?: boolean }
  | { readonly kind: 'hang' }
  | { readonly kind: 'no-final' }
  | { readonly kind: 'error'; readonly message: string }

/** Scripted adapter that finishes a Team task with `team_final` unless its scenario says otherwise. */
class TeamRunAdapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = []
  readonly started = Promise.withResolvers<undefined>()

  constructor(
    private readonly scenarios: Scenario[],
    private readonly imageCapable: boolean,
  ) {
    super()
  }

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({
      provider,
      id: model,
      name: model,
      inputModalities: this.imageCapable ? ['text', 'image'] : ['text'],
    })
  }

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    if (options.purpose === 'session-title') {
      yield { type: 'finish', reason: { kind: 'stop' } }
      return
    }
    this.requests.push(options)
    if (hasTeamFinal(options.messages)) {
      yield { type: 'finish', reason: { kind: 'stop' } }
      return
    }
    const scenario = this.scenarios.shift()
    if (scenario === undefined) throw new Error('TeamRunAdapter: scenario exhausted')
    switch (scenario.kind) {
      case 'final':
        yield* finalChunks(finalChannelId(options.system), scenario.text, scenario.assistantText, scenario.missingImage)
        return
      case 'hang':
        this.started.resolve(undefined)
        yield { type: 'block-start', index: 0, blockType: 'text' }
        yield { type: 'text-delta', index: 0, text: 'partial' }
        await new Promise<void>((_resolve, reject) => {
          if (options.signal?.aborted) {
            reject(abortError(options.signal.reason))
            return
          }
          options.signal?.addEventListener('abort', () => { reject(abortError(options.signal?.reason)) }, { once: true })
        })
        return
      case 'no-final':
        yield { type: 'finish', reason: { kind: 'stop' } }
        return
      case 'error':
        yield { type: 'finish', reason: { kind: 'error', failure: { code: 'MOCK', message: scenario.message } } }
        return
      default:
        scenario satisfies never
    }
  }
}

/** In-memory attachment store used for ACP image admission and output projection tests. */
class MemoryAttachmentStore extends AttachmentStore {
  readonly imageLimits = IMAGE_LIMITS
  readonly saved: SaveImageAttachment[] = []
  readonly objects = new Map<string, StoredImageAttachment>()
  beforeValidate: (() => Promise<void>) | undefined
  beforeRead: (() => Promise<void>) | undefined

  async validateImage(input: SaveImageAttachment): Promise<void> {
    await this.beforeValidate?.()
    if (input.data.byteLength === 0) throw new AttachmentError('Image is empty.', 'INVALID_IMAGE')
  }

  saveImage(input: SaveImageAttachment): Promise<ImageAttachmentRef> {
    this.saved.push(input)
    const ref: ImageAttachmentRef = {
      attachmentId: AttachmentId(`memory:${this.saved.length}`),
      mediaType: input.mediaType,
      bytes: input.data.byteLength,
      width: 1,
      height: 1,
    }
    this.objects.set(ref.attachmentId, { ref, data: Uint8Array.from(input.data) })
    return Promise.resolve(ref)
  }

  async readImage(ref: ImageAttachmentRef): Promise<StoredImageAttachment> {
    await this.beforeRead?.()
    const stored = this.objects.get(ref.attachmentId)
    if (stored === undefined) throw new AttachmentError('Attachment object is missing.', 'ATTACHMENT_NOT_FOUND')
    return { ref: stored.ref, data: Uint8Array.from(stored.data) }
  }
}

type CapturedUpdate = SessionNotification['update']

export interface BridgeHarness {
  readonly ctx: Context
  readonly client: ClientSideConnection
  readonly adapter: TeamRunAdapter
  readonly attachments: MemoryAttachmentStore | undefined
  readonly updates: CapturedUpdate[]
  readonly sessionUpdates: { readonly sessionId: string; readonly update: CapturedUpdate }[]
  readonly permissionRequests: RequestPermissionRequest[]
  onPermission: (request: RequestPermissionRequest) => RequestPermissionResponse
  beforeSessionUpdate: (() => Promise<void>) | undefined
  readonly acpFiber: Awaited<ReturnType<Context['plugin']>>
  readonly closeClientTransport: () => Promise<void>
  readonly dispose: () => Promise<void>
}

/** Compose the real local Team path behind a connected in-memory ACP client. */
export async function makeBridgeHarness(options: {
  readonly scenarios?: Scenario[]
  readonly imageCapable?: boolean
  readonly attachments?: boolean
  readonly persona?: string
  readonly config?: Omit<AcpConfig, 'stream'>
} = {}): Promise<BridgeHarness> {
  const root = await temporaryRoot()
  const ctx = new Context()
  const adapter = new TeamRunAdapter(options.scenarios ?? [{ kind: 'final', text: 'done' }], options.imageCapable === true)
  await mountAgentLoopTestDependencies(ctx, { systemPrompt: { persona: options.persona ?? '' } })
  if (options.attachments !== false) await ctx.plugin(MemoryAttachmentStore)
  ctx.llm.registerAdapter(['mock'], adapter)
  await ctx.plugin(AgentDefaultModelConfig, { provider: 'mock', model: 'mock' })
  await ctx.plugin(JsonlSessionPersistence, { root, compression: 'none' })
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(Storage)
  await ctx.plugin(StorageJson, { root: join(root, 'hub') })
  await ctx.plugin(StorageLog, { backend: 'json', routes: {} })
  await ctx.plugin(TeamHub)
  await ctx.plugin(DirectChannel)
  await ctx.plugin(TeamChannelAdmission)
  await ctx.plugin(AgentRuntime)
  await ctx.plugin(InProcessRuntime, { providerName: 'in-process' })
  await ctx.plugin(TeamActivationController)
  await ctx.plugin(TeamLinkRegistry)
  await ctx.plugin(TeamLinkLocal, {
    providerName: 'local', pageSize: 32, disposalTimeoutMs: 100, notificationRetryDelayMs: 1,
  })
  await ctx.plugin(TeamAgentClient, { reconnectDelayMs: 1, disposalTimeoutMs: 100 })
  await ctx.plugin(TeamClosureDriveBackendRegistry)
  await ctx.plugin(TeamClosureDriverHub, { backend: 'hub' })
  await ctx.plugin(TeamClosureDriver, {
    backend: 'hub', maxTeamsPerDrive: 128, pageSize: 32, disposalTimeoutMs: 100,
  })
  await ctx.plugin(ToolTeam)
  await ctx.plugin(TeamRun)

  const agentToClient = new TransformStream<Uint8Array, Uint8Array>()
  const clientToAgent = new TransformStream<Uint8Array, Uint8Array>()
  const clientToAgentWriter = clientToAgent.writable.getWriter()
  const agentStream: Stream = ndJsonStream(agentToClient.writable, clientToAgent.readable)
  const clientStream: Stream = ndJsonStream(new WritableStream<Uint8Array>({
    write: chunk => clientToAgentWriter.write(chunk),
  }), agentToClient.readable)
  const updates: CapturedUpdate[] = []
  const sessionUpdates: { sessionId: string; update: CapturedUpdate }[] = []
  const permissionRequests: RequestPermissionRequest[] = []
  const harness = {
    ctx,
    adapter,
    attachments: ctx.get('attachments') as MemoryAttachmentStore | undefined,
    updates,
    sessionUpdates,
    permissionRequests,
    onPermission: (_request: RequestPermissionRequest): RequestPermissionResponse => ({ outcome: { outcome: 'cancelled' } }),
    beforeSessionUpdate: undefined as (() => Promise<void>) | undefined,
    client: undefined as unknown as ClientSideConnection,
    acpFiber: undefined as unknown as Awaited<ReturnType<Context['plugin']>>,
    closeClientTransport: async () => { await clientToAgentWriter.close() },
    dispose: async () => {
      try {
        await ctx.fiber.dispose()
      } finally {
        await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 25 })
      }
    },
  } satisfies Omit<BridgeHarness, 'client' | 'acpFiber'> & {
    client: ClientSideConnection
    acpFiber: Awaited<ReturnType<Context['plugin']>>
  }
  const client: Client = {
    sessionUpdate(params): Promise<void> {
      updates.push(params.update)
      sessionUpdates.push({ sessionId: params.sessionId, update: params.update })
      return harness.beforeSessionUpdate?.() ?? Promise.resolve()
    },
    requestPermission(params): Promise<RequestPermissionResponse> {
      permissionRequests.push(params)
      return Promise.resolve(harness.onPermission(params))
    },
  }
  harness.acpFiber = await ctx.plugin({
    name: 'acp-test',
    inject: [...AcpPlugin.inject],
    apply: (inner: Context) => { AcpPlugin.apply(inner, { ...options.config, stream: agentStream }) },
  })
  harness.client = new ClientSideConnection(() => client, clientStream)
  return harness
}

/** Return the one final Team channel id injected into a coordinator system prompt. */
function finalChannelId(system: string | undefined): string {
  const channelId = system?.match(/call team_final with channel_id ([^\s]+) and/u)?.[1]
  if (channelId === undefined) throw new Error('TeamRunAdapter: coordinator prompt did not include a final channel id')
  return channelId
}

/** Detect a follow-up model request after a `team_final` tool call. */
function hasTeamFinal(messages: GenerateOptions['messages']): boolean {
  return messages.some(message => message.role === 'assistant'
    && message.content.some(block => block.type === 'tool-call' && block.name === 'team_final'))
}

/** Emit one optional committed assistant text block and the required explicit final tool call. */
function* finalChunks(
  channelId: string,
  text: string,
  assistantText: string | undefined,
  missingImage: boolean | undefined,
): Generator<StreamChunk> {
  let index = 0
  if (assistantText !== undefined) {
    yield { type: 'block-start', index, blockType: 'text' }
    yield { type: 'text-delta', index, text: assistantText }
    yield { type: 'block-end', index, block: { type: 'text', text: assistantText } }
    index += 1
  }
  if (missingImage) {
    yield { type: 'block-start', index, blockType: 'image' }
    yield {
      type: 'block-end',
      index,
      block: {
        type: 'image',
        attachment: {
          attachmentId: AttachmentId('missing'),
          mediaType: 'image/png',
          bytes: 1,
          width: 1,
          height: 1,
        },
      },
    }
    index += 1
  }
  const id = CallId(`team-final-${text}`)
  const argumentsText = JSON.stringify({ channel_id: channelId, text })
  yield { type: 'block-start', index, blockType: 'tool-call' }
  yield { type: 'tool-call-delta', index, id, name: 'team_final', argumentsDelta: argumentsText }
  yield { type: 'block-end', index, block: { type: 'tool-call', id, name: 'team_final', arguments: argumentsText } }
  yield { type: 'finish', reason: { kind: 'tool-calls' } }
}

/** Allocate a repository-local durable fixture root. */
async function temporaryRoot(): Promise<string> {
  const parent = join(process.cwd(), '.tmp')
  await mkdir(parent, { recursive: true })
  return await mkdtemp(join(parent, 'acp-team-'))
}

/** Normalize optional AbortSignal reasons for Promise rejection linting. */
function abortError(reason: unknown): Error {
  return reason instanceof Error ? reason : new Error('aborted')
}
