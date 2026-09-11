/** Explicit bounded extractive summaries committed through the authoritative Team provider. @module @clocky/clocky-team-channel-summary */

import { Context, Service } from '@clocky/cordis'
import { addAbortListener } from 'node:events'
import z from '@clocky/schemastery'
import { TeamError, channelSummarySelectionInputSchema } from '@clocky/clocky-team'
import type { ChannelSummaryRecord, ChannelSummarySourceRequest, TeamEnvelope,
  TeamSystemChannelSummaryProof, TeamSystemChannelSummaryScope } from '@clocky/clocky-team'
import { deadline, MAX_TIMER_DELAY_MS } from '@clocky/clocky-timeout'

/** Cordis plugin identity. */
export const name = 'team-channel-summary'
/** The Team provider owns caller authorization, source reads and durable commits. */
export const inject = ['teams']

/** Deployment bounds for the deterministic extractive implementation. */
export interface Config {
  /** View-policy types that this deployment permits for explicit summaries. */
  readonly allowedPolicies: string[]
  /** Maximum source Envelope count in one command. */
  readonly maxSourceEnvelopes: number
  /** Maximum UTF-8 bytes of the complete ordered source Envelope array. */
  readonly maxSourceBytes: number
  /** Maximum UTF-8 bytes of newly generated summary text. */
  readonly maxSummaryBytes: number
  /** Maximum inclusive WAL range length in one command. */
  readonly maxHistorySpan: number
  /** Maximum milliseconds for admitted operations to settle on disposal. */
  readonly disposalTimeoutMs: number
}

/** Load-time configuration validation; no model-generation strategy is registered. */
export const Config: z<Config> = z.object({
  allowedPolicies: z.array(z.string()).min(1).required(),
  maxSourceEnvelopes: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).required(),
  maxSourceBytes: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).required(),
  maxSummaryBytes: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).required(),
  maxHistorySpan: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).required(),
  disposalTimeoutMs: z.number().step(1).min(1).max(MAX_TIMER_DELAY_MS).required(),
})

declare module '@clocky/cordis' {
  interface Context {
    /** Explicit extractive channel-summary Consumer. */
    teamChannelSummaries: TeamChannelSummary
  }
}

/** Keep a Unicode prefix within the complete summary's UTF-8 byte allowance. */
function boundedPrefix(text: string, bytes: number): string {
  let used = 0
  let result = ''
  for (const character of text) {
    const size = Buffer.byteLength(character, 'utf8')
    if (used + size > bytes) break
    result += character
    used += size
  }
  return result.trim()
}

/** Extract ordered text with source sequence labels, without interpreting source instructions. */
function extract(envelopes: readonly TeamEnvelope[], maxBytes: number): string {
  const lines = envelopes.map((envelope) => {
    const content = envelope.payload['content']
    const blocks: readonly unknown[] = Array.isArray(content) ? content : []
    const text = typeof envelope.payload['text'] === 'string' ? envelope.payload['text']
      : blocks.map((block) => {
        if (block === null || typeof block !== 'object' || !('type' in block) || block.type !== 'text'
          || !('text' in block) || typeof block.text !== 'string') {
          throw new TeamError('Extractive summaries require text-only source messages', 'TEAM_INVALID_ARGUMENT')
        }
        return block.text
      }).join('\n')
    if (text.trim().length === 0) {
      throw new TeamError('Extractive summaries require non-empty text in every selected source message', 'TEAM_INVALID_ARGUMENT')
    }
    return `[${String(envelope.sequence)}] ${text.trim().replace(/\s+/gu, ' ')}`
  })
  const result = boundedPrefix(lines.join('\n'), maxBytes)
  const first = envelopes[0]
  if (first === undefined || result.length <= `[${String(first.sequence)}] `.length) {
    throw new TeamError('Summary byte allowance cannot retain source text', 'TEAM_CHANNEL_BACKPRESSURE')
  }
  return result
}

/** Concrete Consumer with one ephemeral proof per exact summary commit. */
export class TeamChannelSummary extends Service {
  private readonly config: Config
  private readonly proofs = new Map<TeamSystemChannelSummaryProof, TeamSystemChannelSummaryScope>()
  private readonly pending = new Set<Promise<ChannelSummaryRecord>>()
  private closed = false

  /** Return detached public bounds for command discovery.
   * @returns Summary policies and input/output limits of this Consumer.
   */
  describe(): import('@clocky/clocky-team').ChannelSummaryCapabilities {
    return { allowedPolicies: [...this.config.allowedPolicies], maxSourceEnvelopes: this.config.maxSourceEnvelopes,
      maxSourceBytes: this.config.maxSourceBytes, maxSummaryBytes: this.config.maxSummaryBytes,
      maxHistorySpan: this.config.maxHistorySpan }
  }

  /**
   * @param ctx - Context supplying the authoritative Team provider.
   * @param config - Explicit generation and lifecycle bounds.
   */
  constructor(ctx: Context, config: Config) {
    super(ctx, 'teamChannelSummaries')
    if (new Set(config.allowedPolicies).size !== config.allowedPolicies.length
      || config.allowedPolicies.some(policy => policy.length === 0 || policy.trim() !== policy)) {
      throw new TypeError('allowedPolicies must contain distinct non-empty trimmed policy names')
    }
    this.config = { allowedPolicies: [...config.allowedPolicies], maxSourceEnvelopes: config.maxSourceEnvelopes,
      maxSourceBytes: config.maxSourceBytes, maxSummaryBytes: config.maxSummaryBytes, maxHistorySpan: config.maxHistorySpan,
      disposalTimeoutMs: config.disposalTimeoutMs }
    ctx.effect(() => ctx.teams.registerSystemChannelSummaryProofSource({
      name: 'team-channel-summary',
      resolveChannelSummaryProof: proof => this.closed ? undefined : this.proofs.get(proof),
    }), 'teamChannelSummary.source()')
  }

  /**
   * Generate one explicit channel-wide summary or return its committed retry result.
   * @param request - Current coordinator/human proof and exact bounded source selection.
   * @returns The durable summary with its original source fingerprint and retry identity.
   */
  summarize(request: ChannelSummarySourceRequest): Promise<ChannelSummaryRecord> {
    if (this.closed) return Promise.reject(new TeamError('Channel summary Consumer is closed', 'TEAM_DISPOSED'))
    const operation = this.summarizeOwned(request)
    this.pending.add(operation)
    void operation.then(() => this.pending.delete(operation), () => this.pending.delete(operation))
    return operation
  }

  /** Stop new admissions, revoke outstanding proofs and await owned operations. @returns Completion after accepted operations settle. */
  async close(): Promise<void> {
    this.closed = true
    this.proofs.clear()
    using timeout = deadline(undefined, this.config.disposalTimeoutMs, 'TEAM_SUMMARY_DISPOSAL_TIMEOUT')
    const stopped = Promise.withResolvers<never>()
    using _listener = addAbortListener(timeout.signal, () => { stopped.reject(timeout.signal.reason as unknown) })
    await Promise.race([Promise.allSettled([...this.pending]), stopped.promise])
  }

  private async summarizeOwned(request: ChannelSummarySourceRequest): Promise<ChannelSummaryRecord> {
    const { requester, ...raw } = request
    const input = channelSummarySelectionInputSchema.parse(raw)
    if (input.coveredSequenceRange.to - input.coveredSequenceRange.from + 1 > this.config.maxHistorySpan) {
      throw new TeamError('Selected summary range exceeds maxHistorySpan', 'TEAM_CHANNEL_BACKPRESSURE')
    }
    const source = await this.ctx.teams.readChannelSummarySource({ requester, ...input })
    if (this.closed) throw new TeamError('Channel summary Consumer is closed', 'TEAM_DISPOSED')
    if (source.existing !== undefined) return source.existing
    const policy = source.channel.manifest.viewPolicy
    if (policy === undefined || !this.config.allowedPolicies.includes(policy.type)) {
      throw new TeamError('Channel view policy is not allowed for explicit summaries', 'TEAM_INVALID_ARGUMENT')
    }
    if (source.envelopes.length > this.config.maxSourceEnvelopes
      || Buffer.byteLength(JSON.stringify(source.envelopes), 'utf8') > this.config.maxSourceBytes) {
      throw new TeamError('Selected summary source exceeds its Envelope or UTF-8 byte allowance', 'TEAM_CHANNEL_BACKPRESSURE')
    }
    const adapterLease = this.ctx.teams.acquireAdapter(source.channel.manifest.adapter)
    try {
      const policyLease = this.ctx.teams.acquireViewPolicy(policy)
      try {
        const text = extract(source.envelopes, this.config.maxSummaryBytes)
        const scope: TeamSystemChannelSummaryScope = { kind: 'channel-summary', ...input,
          sourceEnvelopeIds: source.envelopes.map(envelope => envelope.id), sourceFingerprint: source.sourceFingerprint,
          policy: { ...policy }, text }
        const token: object = Object.freeze({ toJSON(): never { throw new TypeError('Channel summary proof is runtime-only') } })
        const proof = token as TeamSystemChannelSummaryProof
        this.proofs.set(proof, scope)
        try {
          return await this.ctx.teams.summarizeChannel({ actor: proof, requester, ...input,
            sourceEnvelopeIds: scope.sourceEnvelopeIds, sourceFingerprint: scope.sourceFingerprint, policy, text })
        } finally { this.proofs.delete(proof) }
      } finally { policyLease.release() }
    } finally { adapterLease.release() }
  }
}

/**
 * Mount the concrete summary Consumer and its disposal boundary.
 * @param ctx - Team-enabled context.
 * @param config - Explicit deployment limits.
 */
export function apply(ctx: Context, config: Config): void {
  const service = new TeamChannelSummary(ctx, config)
  ctx.effect(() => () => service.close(), 'teamChannelSummary.close()')
}
