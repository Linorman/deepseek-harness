/** Full-envelope admission over the shared replay token meter. */
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { freezeMessage, MessageId } from '@clocky/clocky-llm'
import type { GenerateOptions } from '@clocky/clocky-llm'
import { estimateRequestTokens } from '@clocky/clocky-token-meter'
import type { TokenMeter } from '@clocky/clocky-token-meter'
import type { Session } from '@clocky/clocky-session'
import { simulationContextBytes } from '@clocky/clocky-simulation/context-size'
import type { SimulationContextRequest, SimulationRequestBudgetBlock } from '@clocky/clocky-simulation'

/** Optional deployment guard; original Native reservations remain the upper admission bound. */
export const requestBudgetPolicySchema = z.strictObject({
  maxOutputTokens: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  safetyMarginTokens: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  inputSafetyFactor: z.number().min(1).max(4),
  compactionAttempts: z.number().int().min(0).max(2),
})
/** Validated deployment policy, never a model-selected allowance. */
export type RequestBudgetPolicy = z.infer<typeof requestBudgetPolicySchema>

/** Resolve an explicit output cap before the loop logs its canonical header.
 * @param policy - Installed output and safety bounds.
 * @param reservation - Immutable per-request Native allowance.
 * @param requested - Caller cap, if present.
 * @returns a positive cap or an explicit unusable-deployment error.
 */
export function requestOutputCap(policy: RequestBudgetPolicy, reservation: number, requested?: number): number {
  const cap = Math.min(policy.maxOutputTokens, requested ?? Infinity, reservation - policy.safetyMarginTokens - 1)
  if (!Number.isSafeInteger(cap) || cap < 1) throw new Error('Simulation request allowance cannot fit its output and safety margin')
  return cap
}

/** Measure the actual outgoing input, retaining a provider-backed replay floor for conversation requests.
 * @param options - Complete logged request; auxiliary requests are measured directly rather than as the whole Session.
 * @param session - Canonical request owner.
 * @param meter - Shared estimator and provider usage fold.
 * @param policy - Explicit safety policy.
 * @param reservation - Immutable Native upper bound.
 * @param modelWindow - Actual recorded model context capacity when known.
 * @returns refusal facts only when the complete estimate plus output and margin exceeds the smaller bound.
 */
export function requestBudgetBlock(options: GenerateOptions, session: Session, meter: TokenMeter,
  policy: RequestBudgetPolicy, reservation: number, modelWindow?: number): SimulationRequestBudgetBlock | undefined {
  const measured = Math.max(estimateRequestTokens(options),
    options.purpose === 'compaction' ? 0 : meter.measure(session).totalTokens)
  const estimatedInputTokens = Math.ceil(measured * policy.inputSafetyFactor)
  const maxOutputTokens = options.maxTokens ?? policy.maxOutputTokens
  const limit = Math.min(reservation, modelWindow ?? Infinity)
  if (estimatedInputTokens + maxOutputTokens + policy.safetyMarginTokens <= limit) return undefined
  const { signal: _signal, ...envelope } = options
  return { sessionSequence: session.events.length - 1,
    requestHash: createHash('sha256').update(JSON.stringify(envelope)).digest('hex'),
    estimatedInputTokens, maxOutputTokens, safetyMarginTokens: policy.safetyMarginTokens, limit }
}

/** Input bound shared by preview and allocation admission; callers never select deployment limits. */
export interface RequestCapacityInput {
  /** Frozen Native reservation ceiling, unchanged by preflight. */
  readonly tokensPerRequest: number
  /** Actual selected provider's model capacity when metadata supplies it. */
  readonly contextWindow?: number | undefined
  /** Exact fixed sections shared with runtime rendering; additional envelope/history remains unknown. */
  readonly knownRequiredContext?: readonly SimulationContextRequest['sections'][number][] | undefined
}

/** Exact known byte count and policy-estimated input floor, never a complete request or future spend forecast. */
export interface InitialContextSizing {
  /** Only fixed runtime-required sections are included. */
  readonly coverage: 'required-subset'
  /** Exact UTF-8 JSON bytes, including the runtime block-array wrapper and escaping. */
  readonly requiredContextBytes: number
  /** Shared token-meter estimate after the installed input safety factor; not provider tokenizer usage. */
  readonly estimatedInputTokens: number
  /** System/tools, dynamic domain sections and history have not been assembled. */
  readonly completeEnvelope: 'unknown'
  /** A minimum input bound cannot forecast later decisions or total spend. */
  readonly futureConsumption: 'unknown'
}

/** Refusal under the installed byte/admission policy, or known-subset sizing with overall feasibility still unknown. */
export type RequestCapacityResult = ({ readonly status: 'unknown' } | { readonly status: 'impossible'
  readonly dimension: 'context-bytes' | 'request-limit' | 'context-window'
  readonly minimumRequired: string
  readonly limit: number }) & { readonly sizing?: InitialContextSizing }

/**
 * Refuse bounds that cannot admit the known required subset plus minimum input/output and installed safety.
 * @param policy - Installed output/safety admission policy, if any; token refusal needs this policy.
 * @param request - Frozen reservation, optional actual provider window, and runtime-shared fixed sections.
 * @param maxContextBytes - Context owner's validated deployment byte limit, not a caller-selected allowance.
 * @returns a provable byte/policy refusal or partial sizing with unknown complete-envelope and long-run capacity.
 */
export function requestCapacity(policy: RequestBudgetPolicy | undefined, request: RequestCapacityInput,
  maxContextBytes?: number): RequestCapacityResult {
  const content = request.knownRequiredContext?.flatMap(section => section.blocks)
  const input = content === undefined || content.length === 0 ? undefined : freezeMessage({
    role: 'user', id: MessageId('simulation/preflight-known-context'), content, source: { kind: 'plugin', plugin: 'simulation-team' },
  })
  const estimatedInputTokens = input === undefined ? 0 : Math.ceil(estimateRequestTokens({
    provider: 'preflight', model: 'preflight', messages: [input],
  }) * (policy?.inputSafetyFactor ?? 1))
  const sizing: InitialContextSizing | undefined = request.knownRequiredContext === undefined ? undefined : {
    coverage: 'required-subset', requiredContextBytes: simulationContextBytes(request.knownRequiredContext),
    estimatedInputTokens, completeEnvelope: 'unknown', futureConsumption: 'unknown',
  }
  const measured = sizing === undefined ? {} : { sizing }
  if (sizing !== undefined && maxContextBytes !== undefined && sizing.requiredContextBytes > maxContextBytes) {
    return { status: 'impossible', dimension: 'context-bytes', minimumRequired: String(sizing.requiredContextBytes),
      limit: maxContextBytes, ...measured }
  }
  if (policy === undefined) return { status: 'unknown', ...measured }
  const minimumRequired = BigInt(policy.safetyMarginTokens) + BigInt(Math.max(1, estimatedInputTokens)) + 1n
  if (BigInt(request.tokensPerRequest) < minimumRequired) return { status: 'impossible', dimension: 'request-limit',
    minimumRequired: minimumRequired.toString(), limit: request.tokensPerRequest, ...measured }
  if (request.contextWindow !== undefined && BigInt(request.contextWindow) < minimumRequired)
    return { status: 'impossible', dimension: 'context-window', minimumRequired: minimumRequired.toString(),
      limit: request.contextWindow, ...measured }
  return { status: 'unknown', ...measured }
}
