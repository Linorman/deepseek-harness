/**
 * Fresh-process SDK subagent client. Drives one child Clocky
 * runtime over stdio JSON-RPC through `@clocky/clocky-sdk-client` and owns
 * cancellation and quiescent disposal. Structure mirrors the ACP backend
 * (`@clocky/clocky-compat-subagent-acp`): publish after the child handshake,
 * flatten child failures into stop reasons, tear down to quiescence. The
 * child is spawned BY the SDK client rather than through `ctx.subprocess` —
 * the subprocess seam's documented exception for SDK-managed transports —
 * so this driver applies the seam's shared env scrub itself.
 *
 * @module @clocky/clocky-compat-subagent-clocky-sdk/run
 */

import { randomUUID } from 'node:crypto'
import { Clocky, HarnessTeam, SdkProtocolError, type HarnessNotification, type NotificationSubscription } from '@clocky/clocky-sdk-client'
import type { ContentBlock } from '@clocky/clocky-llm'
import { SessionId, type SessionEvent } from '@clocky/clocky-session'
import type { SubagentRun, SubagentStartRequest, SubagentStopReason } from '@clocky/clocky-compat-subagent'
import { AssistantOutputFold, settleRunResult, subprocessRunHandle } from '@clocky/clocky-compat-subagent'
import { scrubbedParentEnv } from '@clocky/clocky-subprocess'

/** Resolved spawn spec for an SDK runtime child process (no defaults — see Config). */
export interface SdkRunSpec {
  /** The executable to spawn (the child runtime — a `clocky-jsonrpc-agent` bin or packaged exe). */
  command: string
  /** Arguments passed to {@link command} (typically the child's `cordis.yml` path). */
  args: string[]
  /**
   * Absolute working directory for the child process AND the workspace cwd
   * of its SDK session. The provider resolves it before this spec exists:
   * config override, else the delegating parent session's workspace.
   */
  cwd: string
  /** Provider route the child runtime initializes with. */
  provider: string
  /** Model the child runtime initializes with. */
  model: string
  /** Opaque product credential sent only in the child runtime initialization handshake. */
  credential?: string
  /** Optional per-request output-token cap sent in the child runtime's initialize handshake. */
  maxTokens?: number
  /**
   * Extra environment variables to ADD for the child (e.g. the child
   * runtime's own `DEEPSEEK_API_KEY`, or `CLOCKY_CORDIS_CONFIG`). Merged after
   * the seam's `scrubbedParentEnv()` base, so an explicit credential or
   * current `CLOCKY_*` fact survives while ambient namesakes never leak.
   */
  env: Record<string, string>
  /** Bound (ms) on the protocol `shutdown` exchange during dispose. */
  shutdownTimeoutMs: number
  /** Grace period (ms) for the child's EOF-driven quiesce on dispose. */
  disposeEofGraceMs: number
  /** Termination confirmation window (ms), including forced exit on every platform. */
  disposeGraceMs: number
  /**
   * Sink for a child-level failure that the run flattened into a stop reason
   * (the seam contract forbids `result` rejecting). A throw from the sink
   * itself is contained. Optional — omitted in unit tests that assert the
   * stop reason directly.
   */
  onError?: (error: Error, stopReason: SubagentStopReason) => void
}

/** EOF grace for child flush and nested-process teardown; wider than the signal grace below. */
export const DEFAULT_DISPOSE_EOF_GRACE_MS = 6_000

/** Default POSIX grace between SIGTERM and SIGKILL on dispose (the `disposeGraceMs` config). */
export const DEFAULT_DISPOSE_GRACE_MS = 3_000

/** Default bound on the protocol `shutdown` exchange during dispose. */
export const DEFAULT_SHUTDOWN_TIMEOUT_MS = 1_000

/** Normalize an unknown thrown value to an Error (the catch binding is `unknown`). */
function toError(value: unknown): Error {
  // The catch only sees rejections from the SDK client, which are always
  // `Error`s; the `String(value)` arm is a defensive fallback for a non-Error
  // throw that the typed surfaces cannot produce.
  /* v8 ignore next */
  return value instanceof Error ? value : new Error(String(value))
}

/** Fold one validated coordinator event from the raw SDK notification stream. */
function foldCoordinatorOutput(
  fold: AssistantOutputFold,
  notification: HarnessNotification,
  coordinatorSessionId: string,
): void {
  if (notification.method !== 'session.event' || notification.params.sessionId !== coordinatorSessionId) return
  const event = notification.params.event
  if (!isRecord(event) || typeof event.type !== 'string') {
    throw new SdkProtocolError(`session.event carried no event envelope: ${JSON.stringify(event)}`)
  }
  if (event.type === 'assistant/message') {
    const message = isRecord(event.data) ? event.data.message : undefined
    const content = isRecord(message) ? message.content : undefined
    if (!Array.isArray(content) || !content.every(block => isRecord(block) && typeof block.type === 'string')) {
      throw new SdkProtocolError(`assistant/message event carried malformed content: ${JSON.stringify(event)}`)
    }
  }
  fold.push(event as unknown as SessionEvent)
}

/** Await an explicit Team final while retaining coordinator output notifications. */
async function waitForTeamFinal(
  team: HarnessTeam,
  subscription: NotificationSubscription,
  fold: AssistantOutputFold,
  cancelled: Promise<void>,
): Promise<string | undefined> {
  const completion = team.waitForFinal()
  while (true) {
    const notification = subscription.next()
    const settled = await Promise.race([
      completion.then(final => ({ kind: 'final' as const, text: final.text })),
      notification.then(value => ({ kind: 'notification' as const, value })),
      cancelled.then(() => ({ kind: 'cancelled' as const })),
    ])
    if (settled.kind === 'cancelled') return undefined
    if (settled.kind === 'final') return settled.text
    foldCoordinatorOutput(fold, settled.value, team.coordinatorSessionId)
  }
}

/** Narrow an unknown JSON-RPC value to a record. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Start and publish one SDK runtime child after its `initialize` handshake.
 * Child failures resolve through the run result; startup failures reject
 * after process reap. Disposal shuts the runtime down and reaps it.
 * @param request - the start request; its signal is the cancellation channel.
 * @param spec - the resolved spawn spec: command/args/cwd, the child's
 * provider/model route, env, timeouts, and the optional error sink.
 * @returns the ready run handle for the child subprocess.
 */
export async function startSdkRun(request: SubagentStartRequest, spec: SdkRunSpec): Promise<SubagentRun> {
  if (request.signal.aborted) throw new Error('subagent request was aborted before the SDK child started')
  if (spec.credential === undefined || spec.credential.length === 0) {
    throw new Error('subagent SDK child requires an explicitly configured product credential')
  }
  // The run id lives in the parent namespace; the child runtime's session id
  // (minted below, private to the wire) exists only inside the child process.
  const id = SessionId(randomUUID())

  const harness = new Clocky({
    launch: {
      command: spec.command,
      args: spec.args,
      cwd: spec.cwd,
      env: { ...scrubbedParentEnv(), ...spec.env },
      shutdownTimeoutMs: spec.shutdownTimeoutMs,
      disposeEofGraceMs: spec.disposeEofGraceMs,
      disposeGraceMs: spec.disposeGraceMs,
    },
    credential: spec.credential,
    cwd: spec.cwd,
    provider: spec.provider,
    model: spec.model,
    ...spec.maxTokens === undefined ? {} : { maxTokens: spec.maxTokens },
  })

  const flags = { cancelled: false }
  let teamFinalized = false
  let signalCancelSettled!: () => void
  const cancelSettled = new Promise<void>((resolve) => { signalCancelSettled = resolve })
  let team: HarnessTeam | undefined
  let teamCancellation: Promise<void> | undefined
  const cancelTeam = (): void => {
    if (team === undefined || teamCancellation !== undefined) return
    teamCancellation = team.cancel().then(() => undefined, () => {})
  }
  const requestCancel = (): void => {
    if (flags.cancelled) return
    flags.cancelled = true
    signalCancelSettled()
    if (!teamFinalized) cancelTeam()
  }
  const onAbort = (): void => { requestCancel() }
  request.signal.addEventListener('abort', onAbort, { once: true })

  // Establish the child handshake before publishing a handle. Any failure
  // owns the still-private process and reaps it before rejecting.
  try {
    await Promise.race([
      harness.start(),
      cancelSettled.then((): never => { throw new Error('subagent cancelled before the SDK child initialized') }),
    ])
    // Defensive: an abort() is a macrotask and no user callback runs inside
    // the microtask drain between handshake fulfillment and this continuation,
    // so the recheck is not schedulable today; it guards future reentrancy.
    /* v8 ignore next */
    if (flags.cancelled) throw new Error('subagent cancelled before the SDK child initialized')
  } catch (error: unknown) {
    request.signal.removeEventListener('abort', onAbort)
    await harness.close()
    if (flags.cancelled) throw new Error('subagent request was aborted before the SDK child started')
    throw toError(error)
  }

  const fold = new AssistantOutputFold()
  const collectOutput = (): ContentBlock[] => fold.collect() ?? []
  const subscription = harness.client.subscribe()

  const settled = settleRunResult({
    attempt: async () => {
      const creation = harness.createTeam(request.prompt)
      void creation.then(
        (created) => {
          team = created
          if (flags.cancelled) cancelTeam()
        },
        () => {},
      )
      const created = await Promise.race([
        creation,
        cancelSettled.then(() => undefined),
      ])
      if (created === undefined) return { output: collectOutput(), stopReason: 'aborted' }
      const finalText = await waitForTeamFinal(created, subscription, fold, cancelSettled)
      if (finalText === undefined) return { output: collectOutput(), stopReason: 'aborted' }
      teamFinalized = true
      const output = fold.collect() ?? [{ type: 'text', text: finalText }]
      return { output, stopReason: 'completed' }
    },
    collectOutput,
    cancelled: () => flags.cancelled,
    onError: spec.onError,
    signal: request.signal,
    onAbort,
  })
  const result = settled.finally(() => { subscription.close() })

  return subprocessRunHandle({
    id,
    result,
    signal: request.signal,
    onAbort,
    requestCancel,
    teardown: () => harness.close(),
  })
}
