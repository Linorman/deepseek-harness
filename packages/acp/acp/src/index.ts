/**
 * Automation-only Agent Client Protocol server over JSON-RPC stdio.
 *
 * ACP projects local Team runs onto the ACP wire. TeamRun owns durable input,
 * coordinator residency, final output, and release.
 *
 * @module @clocky/clocky-acp
 */

import type { Context } from '@clocky/cordis'
import { randomUUID } from 'node:crypto'
import { isAbsolute } from 'node:path'
import { Readable, Writable } from 'node:stream'
import Schema from '@clocky/schemastery'
import { errorChain } from '@clocky/clocky-llm'
import {
  AgentSideConnection,
  ndJsonStream,
  PROTOCOL_VERSION,
  RequestError,
  type Agent as AcpAgent,
  type AuthenticateRequest,
  type CancelNotification,
  type InitializeRequest,
  type InitializeResponse,
  type NewSessionRequest,
  type NewSessionResponse,
  type PromptRequest,
  type PromptResponse,
  type SessionNotification,
  type Stream,
} from '@agentclientprotocol/sdk'
import type { Agent } from '@clocky/clocky-agent'
import type {} from '@clocky/clocky-agent-default-model'
import { TeamError } from '@clocky/clocky-team'
import { TeamRunError, type TeamRunHandle } from '@clocky/clocky-team-run'
import type {} from '@clocky/clocky-team-run'
import type {} from '@clocky/clocky-user-approval'
import { AcpContentError, admitAcpPrompt, assistantBlockToAcp, supportsAcpImagePrompts } from './content.ts'

export const name = 'acp'
/** TeamRun owns product runs, including the trusted human-to-coordinator interrupt authority. */
export const inject = ['teamRuns', 'teams', 'agentDefaultModel']

const ACP_TEAM_OBJECTIVE = 'Complete the trusted ACP automation request.'
const DEFAULT_INTERRUPT_RETRY_ATTEMPTS = 3

/** Runtime-only ACP transport configuration. Production uses stdin and stdout. */
export interface AcpConfig {
  /** Bounded fresh-read attempts when a concurrent Team update races soft-interrupt admission. */
  readonly interruptRetryAttempts?: number
  /** Transport override used by in-process protocol tests. */
  readonly stream?: Stream
}

/** Schemastery validator for {@link AcpConfig}. */
export const Config: Schema<AcpConfig> = Schema.object({
  interruptRetryAttempts: Schema.number().step(1).min(1).default(DEFAULT_INTERRUPT_RETRY_ATTEMPTS),
})

/** Opaque ACP session projection of one local Team run. */
interface SessionRecord {
  /** ACP wire id, intentionally distinct from the coordinator Session id. */
  readonly sessionId: string
  /** Current local Team topology and coordinator lease. */
  readonly run: TeamRunHandle
  /** Coordinator used only to project ACP output and permission requests. */
  readonly agent: Agent
  /** Ordered committed-assistant output projection. */
  outputTail: Promise<void>
  /** Current prompt admission and final-result wait. */
  inflight: PromptRecord | undefined
  /** A final answer completed and released this one-Team ACP session. */
  completed: boolean
}

/** One prompt's cancellable durable admission and Team final wait. */
interface PromptRecord {
  readonly admissionController: AbortController
  readonly finalController: AbortController
  readonly admissionDone: Promise<void>
  readonly finishAdmission: () => void
  cancelRequested: boolean
  outputError: Error | undefined
  projectedText: string
}

/** Preserve invalid-parameter detail in the SDK wire error message. */
function invalidParams(detail: string): RequestError {
  return RequestError.invalidParams(undefined, detail)
}

/** Preserve operational failure detail in the SDK wire error message. */
function internalError(detail: string): RequestError {
  return RequestError.internalError(undefined, detail)
}

/**
 * Mount the automation-only ACP server.
 * @param ctx - Context carrying Team-run ownership and Team authority.
 * @param config - runtime transport override, when one is supplied.
 */
export function apply(ctx: Context, config: AcpConfig = {}): void {
  const teamRuns = ctx.teamRuns
  const teams = ctx.teams
  const agentDefaultModel = ctx.agentDefaultModel
  const sessions = new Map<string, SessionRecord>()
  const coordinatorSessions = new Map<Agent['session']['id'], SessionRecord>()
  const logger = ctx.logger
  let closed = false
  let conn: AgentSideConnection
  let imagePromptEnabled = false
  const interruptRetryAttempts = positiveSafeInteger(
    'interruptRetryAttempts',
    config.interruptRetryAttempts ?? DEFAULT_INTERRUPT_RETRY_ATTEMPTS,
  )

  const assertOpen = (): void => {
    if (closed) throw internalError('the ACP bridge has been disposed')
  }

  const requireSession = (sessionId: string): SessionRecord => {
    const record = sessions.get(sessionId)
    if (record === undefined) throw invalidParams(`unknown session: ${sessionId}`)
    return record
  }

  const ownedRecord = (agent: Agent): SessionRecord | undefined => {
    const record = coordinatorSessions.get(agent.session.id)
    return record?.agent === agent ? record : undefined
  }

  /** Send one ordered protocol update while containing transport-only failure. */
  const notify = async (notification: SessionNotification): Promise<void> => {
    try {
      await conn.sessionUpdate(notification)
    /* v8 ignore start -- the ACP SDK isolates notification-handler failures; only a transport write reaches this guard. */
    } catch (error: unknown) {
      logger.warn(`acp: session/update failed: ${String(error)}`)
    }
    /* v8 ignore stop */
  }

  ctx.on('session/event', (session, event) => {
    const record = coordinatorSessions.get(session.header.id)
    if (record === undefined || record.agent.session !== session || event.type !== 'assistant/message') return
    const prompt = record.inflight
    const delivery = record.outputTail.then(async () => {
      for (const block of event.data.message.content) {
        const content = await assistantBlockToAcp(ctx, block)
        if (content === undefined) continue
        if (content.type === 'text' && prompt !== undefined && record.inflight === prompt) {
          prompt.projectedText += content.text
        }
        await notify({
          sessionId: record.sessionId,
          update: { sessionUpdate: 'agent_message_chunk', content },
        })
      }
    })
    record.outputTail = delivery.catch((error: unknown) => {
      const failure = error as Error
      if (prompt !== undefined && record.inflight === prompt) prompt.outputError ??= failure
      logger.warn(`acp: assistant output conversion failed: ${errorChain(error)}`)
    })
  })

  ctx.on('approval/request', (request, next) => {
    const record = ownedRecord(request.agent)
    if (record === undefined || request.callId === undefined) return next()
    return conn.requestPermission({
      sessionId: record.sessionId,
      toolCall: { toolCallId: request.callId },
      options: [
        { optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' },
        { optionId: 'reject-once', name: 'Reject', kind: 'reject_once' },
      ],
    }).then(({ outcome }) => {
      if (outcome.outcome === 'cancelled') return 'cancelled'
      return outcome.optionId === 'allow-once' ? 'allowed-once' : 'rejected'
    })
  })

  /** Commit a human-authorized soft interrupt for the Team's current coordinator activation. */
  const requestInterrupt = async (record: SessionRecord): Promise<void> => {
    for (let attempt = 0; attempt < interruptRetryAttempts; attempt += 1) {
      try {
        const interrupt = await teamRuns.requestCoordinatorInterrupt(record.run.teamId)
        if (interrupt === undefined) return
        return
      } catch (error: unknown) {
        if (!isTeamCursorConflict(error) || attempt + 1 === interruptRetryAttempts) throw error
      }
    }
  }

  const makeAgent = (connection: AgentSideConnection): AcpAgent => {
    conn = connection
    return {
      async initialize(_params: InitializeRequest): Promise<InitializeResponse> {
        const selection = agentDefaultModel.currentSelection()
        imagePromptEnabled = await supportsAcpImagePrompts(ctx, selection?.provider, selection?.model)
        return {
          protocolVersion: PROTOCOL_VERSION,
          agentInfo: { name: 'clocky-acp', version: '0.0.1' },
          agentCapabilities: {
            promptCapabilities: { image: imagePromptEnabled, audio: false, embeddedContext: false },
          },
          authMethods: [],
        }
      },

      authenticate(_params: AuthenticateRequest): Promise<void> {
        return Promise.resolve()
      },

      async newSession(params: NewSessionRequest): Promise<NewSessionResponse> {
        assertOpen()
        validateSessionParams(params)
        const run = await teamRuns.create({ objective: ACP_TEAM_OBJECTIVE, cwd: params.cwd })
        const agent = run.coordinatorLease.localAgent
        if (agent === undefined) {
          await teamRuns.cancel(run.teamId)
          throw internalError('the Team run did not publish a local coordinator')
        }
        if (closed) {
          await teamRuns.cancel(run.teamId)
          throw internalError('connection closed during session/new')
        }
        const sessionId = randomUUID()
        const record: SessionRecord = {
          sessionId,
          run,
          agent,
          outputTail: Promise.resolve(),
          inflight: undefined,
          completed: false,
        }
        sessions.set(sessionId, record)
        coordinatorSessions.set(agent.session.id, record)
        return { sessionId }
      },

      async prompt(params: PromptRequest): Promise<PromptResponse> {
        assertOpen()
        const record = requireSession(params.sessionId)
        if (record.completed) throw invalidParams('the ACP session is complete')
        if (record.inflight !== undefined) throw invalidParams('a prompt is already in flight for this session')
        const admission = Promise.withResolvers<void>()
        const prompt: PromptRecord = {
          admissionController: new AbortController(),
          finalController: new AbortController(),
          admissionDone: admission.promise,
          finishAdmission: admission.resolve,
          cancelRequested: false,
          outputError: undefined,
          projectedText: '',
        }
        record.inflight = prompt
        try {
          const content = await admitAcpPrompt(
            ctx,
            record.agent,
            params.prompt,
            imagePromptEnabled,
            prompt.admissionController.signal,
          )
          prompt.admissionController.signal.throwIfAborted()
          const channel = await teams.getChannel({ channelId: record.run.channel.manifest.id })
          await teamRuns.postHumanInput({
            teamId: record.run.teamId,
            content,
            delivery: 'turn',
          })
          const final = await teamRuns.waitForFinal({
            teamId: record.run.teamId,
            afterCursor: channel.cursor,
            signal: prompt.finalController.signal,
          })
          await record.outputTail
          if (prompt.cancelRequested) return { stopReason: 'cancelled' }
          if (prompt.outputError !== undefined) {
            throw internalError(`assistant output delivery failed: ${prompt.outputError.message}`)
          }
          if (!prompt.projectedText.endsWith(final.text)) {
            await notify({
              sessionId: record.sessionId,
              update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: final.text } },
            })
          }
          record.completed = true
          return { stopReason: 'end_turn' }
        } catch (error: unknown) {
          if (prompt.cancelRequested) return { stopReason: 'cancelled' }
          throw promptError(error)
        } finally {
          prompt.finishAdmission()
          record.inflight = undefined
        }
      },

      async cancel(params: CancelNotification): Promise<void> {
        const record = sessions.get(params.sessionId)
        if (record === undefined || record.completed) return
        const prompt = record.inflight
        if (prompt !== undefined) {
          prompt.cancelRequested = true
          prompt.admissionController.abort(new Error('ACP prompt cancelled'))
          prompt.finalController.abort(new Error('ACP prompt cancelled'))
        }
        try {
          await requestInterrupt(record)
        } catch (error: unknown) {
          logger.warn(`acp: Team interrupt request failed: ${errorChain(error)}`)
        }
      },
    }
  }

  /* v8 ignore next 4 -- production stdio wiring; tests inject config.stream. */
  const stream: Stream = config.stream ?? ndJsonStream(
    Writable.toWeb(process.stdout) as WritableStream<Uint8Array>,
    Readable.toWeb(process.stdin) as ReadableStream<Uint8Array>,
  )
  conn = new AgentSideConnection(makeAgent, stream)

  let quiescing: Promise<void> | undefined
  const quiesce = (): Promise<void> => {
    if (quiescing !== undefined) return quiescing
    closed = true
    const records = [...sessions.values()]
    sessions.clear()
    coordinatorSessions.clear()
    const prompts = records.map(record => ({ record, prompt: record.inflight }))
    for (const { prompt } of prompts) {
      if (prompt === undefined) continue
      prompt.cancelRequested = true
      prompt.admissionController.abort(new Error('ACP bridge disposed'))
      prompt.finalController.abort(new Error('ACP bridge disposed'))
    }
    quiescing = (async () => {
      const outcomes = await Promise.allSettled(prompts.map(async ({ record, prompt }) => {
        await prompt?.admissionDone
        await teamRuns.cancel(record.run.teamId)
        await record.outputTail
      }))
      const failures = outcomes
        .filter((outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected')
        .map(outcome => outcome.reason as unknown)
      if (failures.length > 0) {
        throw new AggregateError(failures, `ACP Team teardown failed for ${failures.length} session(s): ${failures.map(errorChain).join('; ')}`)
      }
    })()
    return quiescing
  }

  /* v8 ignore start -- production transport rejection and teardown failure. */
  void conn.closed
    .catch((error: unknown) => { logger.warn(`acp: connection closed with an error: ${String(error)}`) })
    .then(quiesce)
    .catch((error: unknown) => { logger.warn(`acp: connection-close teardown failed: ${String(error)}`) })
  /* v8 ignore stop */

  ctx.effect(() => quiesce, 'acp.connection')
}

/** Map content admission and Team-run failures to ACP request errors. */
function promptError(error: unknown): Error {
  if (error instanceof AcpContentError) {
    return error.kind === 'invalid' ? invalidParams(error.message) : internalError(error.message)
  }
  if (error instanceof TeamRunError) return internalError(error.message)
  if (error instanceof RequestError) return error
  return internalError(`prompt was not queued: ${(error as Error).message}`)
}

/** Recognize the Hub conflict that requires a fresh Team projection before retry. */
function isTeamCursorConflict(error: unknown): boolean {
  return error instanceof TeamError && error.code === 'TEAM_CURSOR_CONFLICT'
}

/** Validate a deployment-facing bounded retry count for direct plugin callers. */
function positiveSafeInteger(field: string, value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`${field} must be a positive safe integer`)
  return value
}

/** Reject session features outside the automation contract. */
function validateSessionParams(params: NewSessionRequest): void {
  if (!isAbsolute(params.cwd)) throw invalidParams(`cwd must be an absolute path: ${params.cwd}`)
  if (params.additionalDirectories !== undefined && params.additionalDirectories.length > 0) {
    throw invalidParams('additionalDirectories is not supported')
  }
  if (params.mcpServers.length > 0) throw invalidParams('mcpServers is not supported')
}
