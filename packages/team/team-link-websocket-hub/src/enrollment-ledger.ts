/** Durable, provider-owned dynamic WebSocket enrollment credentials. @module @clocky/clocky-team-link-websocket-hub/enrollment-ledger */

import { createHash, timingSafeEqual } from 'node:crypto'
import type { Context } from '@clocky/cordis'
import { defineLogStream } from '@clocky/clocky-storage-log'
import type { LogStream, LogStreamDescriptor } from '@clocky/clocky-storage-log'
import { teamLinkBindingIdentitySchema } from '@clocky/clocky-team-link'
import type { TeamLinkBindingIdentity } from '@clocky/clocky-team-link'
import { z } from 'zod'

/** Durable stream format for the WebSocket enrollment ledger. */
export const WEBSOCKET_ENROLLMENT_LEDGER_FORMAT_VERSION = 1

/** Record format accepted inside a stream from {@link enrollmentLedgerStream}. */
export const WEBSOCKET_ENROLLMENT_LEDGER_RECORD_VERSION = 1

/**
 * Return the provider-namespaced stream that owns one enrollment registry.
 * @param enrollmentProviderName - Registered dynamic-enrollment provider name.
 * @returns the exact durable stream descriptor for that provider.
 */
export function enrollmentLedgerStream(enrollmentProviderName: string): LogStreamDescriptor {
  const provider = normalizeEnrollmentProviderName(enrollmentProviderName)
  return defineLogStream({
    name: `team-link-websocket-hub/enrollment/${encodeURIComponent(provider)}`,
    version: WEBSOCKET_ENROLLMENT_LEDGER_FORMAT_VERSION,
  })
}

/** Stable failure codes for durable enrollment loading and mutation. */
export type EnrollmentLedgerErrorCode =
  | 'TEAM_LINK_ENROLLMENT_LEDGER_ALREADY_ISSUED'
  | 'TEAM_LINK_ENROLLMENT_LEDGER_CLOSED'
  | 'TEAM_LINK_ENROLLMENT_LEDGER_MALFORMED'
  | 'TEAM_LINK_ENROLLMENT_LEDGER_NOT_FOUND'
  | 'TEAM_LINK_ENROLLMENT_LEDGER_NOT_ISSUED'
  | 'TEAM_LINK_ENROLLMENT_LEDGER_STALE_GENERATION'
  | 'TEAM_LINK_ENROLLMENT_LEDGER_UNSUPPORTED_RECORD'

/** Typed failure from the provider-owned enrollment ledger. */
export class EnrollmentLedgerError extends Error {
  /** Machine-routable failure classification. */
  readonly code: EnrollmentLedgerErrorCode

  /**
   * @param message - Credential-safe description of the rejected operation.
   * @param code - Stable enrollment-ledger error classification.
   */
  constructor(message: string, code: EnrollmentLedgerErrorCode) {
    super(message)
    this.name = 'EnrollmentLedgerError'
    this.code = code
  }
}

/** One caller-visible enrollment state without its credential digest. */
export interface EnrollmentLedgerEntry {
  /** Exact immutable Team Link binding that owns this enrollment. */
  readonly binding: TeamLinkBindingIdentity
  /** Monotonic generation for this binding, beginning at one. */
  readonly generation: number
  /** Whether the current generation can authenticate an attach request. */
  readonly state: 'issued' | 'revoked'
  /** Milliseconds since Unix epoch when this generation was issued. */
  readonly issuedAt: number
  /** Milliseconds since Unix epoch when this generation was revoked, if revoked. */
  readonly revokedAt?: number
}

/** Required bounded page size for durable enrollment recovery. */
export interface EnrollmentLedgerOptions {
  /** Registered dynamic-enrollment provider name that namespaces this ledger. */
  readonly enrollmentProviderName: string
  /** Maximum durable enrollment records read in one recovery page. */
  readonly recoveryPageSize: number
  /** Optional clock for durable timestamps and deterministic provider tests. */
  readonly now?: () => number
}

interface EnrollmentIssuedRecord {
  readonly version: typeof WEBSOCKET_ENROLLMENT_LEDGER_RECORD_VERSION
  readonly type: 'enrollment'
  readonly enrollmentProviderName: string
  readonly state: 'issued'
  readonly binding: TeamLinkBindingIdentity
  readonly generation: number
  readonly credentialDigest: string
  readonly issuedAt: number
}

interface EnrollmentRevokedRecord {
  readonly version: typeof WEBSOCKET_ENROLLMENT_LEDGER_RECORD_VERSION
  readonly type: 'enrollment'
  readonly enrollmentProviderName: string
  readonly state: 'revoked'
  readonly binding: TeamLinkBindingIdentity
  readonly generation: number
  readonly revokedAt: number
}

type EnrollmentRecord = EnrollmentIssuedRecord | EnrollmentRevokedRecord

interface EnrollmentState extends EnrollmentLedgerEntry {
  readonly credentialDigest?: string
}

const generationSchema = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER)
const timestampSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
const credentialDigestSchema = z.string().regex(/^[a-f0-9]{64}$/)
const enrollmentRecordSchema = z.discriminatedUnion('state', [
  z.object({
    version: z.literal(WEBSOCKET_ENROLLMENT_LEDGER_RECORD_VERSION),
    type: z.literal('enrollment'),
    enrollmentProviderName: z.string().min(1),
    state: z.literal('issued'),
    binding: teamLinkBindingIdentitySchema,
    generation: generationSchema,
    credentialDigest: credentialDigestSchema,
    issuedAt: timestampSchema,
  }).strict(),
  z.object({
    version: z.literal(WEBSOCKET_ENROLLMENT_LEDGER_RECORD_VERSION),
    type: z.literal('enrollment'),
    enrollmentProviderName: z.string().min(1),
    state: z.literal('revoked'),
    binding: teamLinkBindingIdentitySchema,
    generation: generationSchema,
    revokedAt: timestampSchema,
  }).strict(),
]) as z.ZodType<EnrollmentRecord>

/**
 * A restart-recoverable credential ledger for dynamic WebSocket enrollment.
 * The durable stream retains only SHA-256 digests; credential plaintext exists
 * only in the caller stack while issuance or attach matching runs.
 */
export class EnrollmentLedger {
  private readonly entries = new Map<string, EnrollmentState>()
  private tail = Promise.resolve()
  private cursor = -1
  private closing = false
  private disposal: Promise<void> | undefined

  private constructor(
    private readonly stream: LogStream,
    private readonly enrollmentProviderName: string,
    private readonly recoveryPageSize: number,
    private readonly now: () => number,
  ) {}

  /**
   * Open and fully validate the provider-owned enrollment stream before its
   * recovered state becomes available to WebSocket admission.
   * @param ctx - Context carrying the routed `storageLog` facility.
   * @param options - Required bounded recovery page size.
   * @returns a caller-owned recovered ledger.
   */
  static async open(ctx: Context, options: EnrollmentLedgerOptions): Promise<EnrollmentLedger> {
    assertRecoveryPageSize(options.recoveryPageSize)
    const enrollmentProviderName = normalizeEnrollmentProviderName(options.enrollmentProviderName)
    const stream = await ctx.storageLog.open(enrollmentLedgerStream(enrollmentProviderName))
    const ledger = new EnrollmentLedger(stream, enrollmentProviderName, options.recoveryPageSize, options.now ?? Date.now)
    try {
      await ledger.recover()
      return ledger
    } catch (error: unknown) {
      await stream.close()
      throw error
    }
  }

  /**
   * Issue the next generation for a binding with no active credential. A
   * revoked binding may receive a later generation; an issued one must rotate.
   * @param binding - Exact immutable binding receiving the credential.
   * @param credential - Opaque plaintext used only to calculate a SHA-256 digest.
   * @returns the newly issued binding generation.
   */
  async issue(binding: TeamLinkBindingIdentity, credential: string): Promise<EnrollmentLedgerEntry> {
    const normalized = normalizeBinding(binding)
    const digest = credentialDigest(credential)
    return await this.admit(async () => {
      const current = this.entries.get(identityKey(normalized))
      if (current?.state === 'issued') {
        throw new EnrollmentLedgerError('an active enrollment already exists for this binding', 'TEAM_LINK_ENROLLMENT_LEDGER_ALREADY_ISSUED')
      }
      return await this.appendIssued(normalized, (current?.generation ?? 0) + 1, digest, this.timestamp())
    })
  }

  /**
   * Replace the active credential only when its caller still owns the current
   * generation. A stale rotator cannot replace a newer enrollment.
   * @param binding - Exact immutable binding receiving the replacement.
   * @param generation - Current generation observed by the rotator.
   * @param credential - Opaque plaintext used only to calculate a SHA-256 digest.
   * @returns the replacement generation.
   */
  async rotate(
    binding: TeamLinkBindingIdentity,
    generation: number,
    credential: string,
  ): Promise<EnrollmentLedgerEntry> {
    const normalized = normalizeBinding(binding)
    assertGeneration(generation)
    const digest = credentialDigest(credential)
    return await this.admit(async () => {
      const current = this.requireCurrent(normalized, generation)
      if (current.state !== 'issued') {
        throw new EnrollmentLedgerError('a revoked enrollment cannot rotate', 'TEAM_LINK_ENROLLMENT_LEDGER_NOT_ISSUED')
      }
      return await this.appendIssued(normalized, generation + 1, digest, this.timestamp())
    })
  }

  /**
   * Revoke one exact current generation. Repeating the same completed revoke
   * is idempotent, while an older generation cannot revoke a replacement.
   * @param binding - Exact immutable binding whose credential is revoked.
   * @param generation - Current generation held by the revoker.
   * @returns the durable revoked enrollment state.
   */
  async revoke(binding: TeamLinkBindingIdentity, generation: number): Promise<EnrollmentLedgerEntry> {
    const normalized = normalizeBinding(binding)
    assertGeneration(generation)
    return await this.admit(async () => {
      const current = this.requireCurrent(normalized, generation)
      if (current.state === 'revoked') return publicEntry(current)
      const record: EnrollmentRevokedRecord = {
        version: WEBSOCKET_ENROLLMENT_LEDGER_RECORD_VERSION,
        type: 'enrollment',
        state: 'revoked',
        binding: normalized,
        generation,
        enrollmentProviderName: this.enrollmentProviderName,
        revokedAt: this.timestamp(),
      }
      return await this.append(record)
    })
  }

  /**
   * Resolve an active credential to its binding generation without exposing a
   * digest. Revoked and mismatched credentials do not authenticate.
   * @param binding - Exact immutable binding supplied by the remote attach frame.
   * @param credential - Opaque plaintext credential supplied by the remote attach frame.
   * @returns the active generation, or `undefined` when authentication fails.
   */
  resolve(binding: TeamLinkBindingIdentity, credential: string): EnrollmentLedgerEntry | undefined {
    this.assertOpen()
    const current = this.entries.get(identityKey(normalizeBinding(binding)))
    if (current?.state !== 'issued' || current.credentialDigest === undefined) return undefined
    const digest = credentialDigest(credential)
    if (!timingSafeEqual(Buffer.from(current.credentialDigest, 'hex'), Buffer.from(digest, 'hex'))) return undefined
    return publicEntry(current)
  }

  /**
   * Return one recovered state without exposing a credential digest.
   * @param binding - Exact immutable binding to inspect.
   * @returns the current enrollment state, when the binding has history.
   */
  get(binding: TeamLinkBindingIdentity): EnrollmentLedgerEntry | undefined {
    this.assertOpen()
    const current = this.entries.get(identityKey(normalizeBinding(binding)))
    return current === undefined ? undefined : publicEntry(current)
  }

  /**
   * Close admission, settle already accepted ledger writes, then release the
   * caller-owned storage stream.
   * @returns resolution after the stream handle releases.
   */
  close(): Promise<void> {
    if (!this.closing) this.closing = true
    this.disposal ??= this.tail.then(async () => { await this.stream.close() })
    return this.disposal
  }

  /** Validate and fold every retained record in strictly increasing sequence order. */
  private async recover(): Promise<void> {
    if (this.stream.firstSequence > 0) {
      throw malformed('enrollment ledger retained prefix cannot reconstruct complete credential generations')
    }
    let cursor = -1
    while (true) {
      const entries = await this.stream.read(cursor, this.recoveryPageSize)
      if (entries.length === 0) break
      for (const entry of entries) {
        if (entry.sequence !== cursor + 1) throw malformed('enrollment ledger contains a sequence gap')
        this.fold(parseRecord(entry.value))
        cursor = entry.sequence
      }
    }
    this.cursor = cursor
  }

  /** Serialize one accepted mutation after every earlier write settles. */
  private admit<T>(operation: () => Promise<T>): Promise<T> {
    this.assertOpen()
    const result = this.tail.then(operation, operation)
    this.tail = result.then(() => undefined, () => undefined)
    return result
  }

  /** Append one issued record after its credential has already become a digest. */
  private async appendIssued(
    binding: TeamLinkBindingIdentity,
    generation: number,
    digest: string,
    issuedAt: number,
  ): Promise<EnrollmentLedgerEntry> {
    const record: EnrollmentIssuedRecord = {
      version: WEBSOCKET_ENROLLMENT_LEDGER_RECORD_VERSION,
      type: 'enrollment',
      state: 'issued',
      binding,
      generation,
      credentialDigest: digest,
      enrollmentProviderName: this.enrollmentProviderName,
      issuedAt,
    }
    return await this.append(record)
  }

  /** Append and fold one record only after the expected durable tail accepts it. */
  private async append(record: EnrollmentRecord): Promise<EnrollmentLedgerEntry> {
    const appended = await this.stream.append(this.cursor, [record])
    if (appended.tailSequence !== this.cursor + 1) {
      throw malformed('enrollment ledger append returned an unexpected durable tail')
    }
    this.fold(record)
    this.cursor = appended.tailSequence
    const current = this.entries.get(identityKey(record.binding))
    /* v8 ignore next -- a successful fold always retains the record binding. */
    if (current === undefined) throw malformed('enrollment ledger lost an appended binding')
    return publicEntry(current)
  }

  /** Fold a syntactically valid record while enforcing its binding generation relation. */
  private fold(record: EnrollmentRecord): void {
    if (record.enrollmentProviderName !== this.enrollmentProviderName) {
      throw malformed('enrollment ledger record belongs to a different enrollment provider')
    }
    const key = identityKey(record.binding)
    const current = this.entries.get(key)
    if (record.state === 'issued') {
      const expectedGeneration = (current?.generation ?? 0) + 1
      if (record.generation !== expectedGeneration) {
        throw malformed('enrollment ledger issued generation is not monotonic')
      }
      this.entries.set(key, Object.freeze({
        binding: record.binding,
        generation: record.generation,
        state: 'issued',
        credentialDigest: record.credentialDigest,
        issuedAt: record.issuedAt,
      }))
      return
    }
    if (current === undefined || current.generation !== record.generation || current.state !== 'issued') {
      throw malformed('enrollment ledger revocation does not match an issued generation')
    }
    this.entries.set(key, Object.freeze({
      binding: record.binding,
      generation: record.generation,
      state: 'revoked',
      issuedAt: current.issuedAt,
      revokedAt: record.revokedAt,
    }))
  }

  /** Return the exact current state or reject a stale generation holder. */
  private requireCurrent(binding: TeamLinkBindingIdentity, generation: number): EnrollmentState {
    const current = this.entries.get(identityKey(binding))
    if (current === undefined) {
      throw new EnrollmentLedgerError('the enrollment binding has no durable state', 'TEAM_LINK_ENROLLMENT_LEDGER_NOT_FOUND')
    }
    if (current.generation !== generation) {
      throw new EnrollmentLedgerError('the enrollment generation is no longer current', 'TEAM_LINK_ENROLLMENT_LEDGER_STALE_GENERATION')
    }
    return current
  }

  /** Reject a new operation once close has stopped ledger admission. */
  private assertOpen(): void {
    if (this.closing) {
      throw new EnrollmentLedgerError('the enrollment ledger is closed', 'TEAM_LINK_ENROLLMENT_LEDGER_CLOSED')
    }
  }

  /** Read one validated timestamp only when an accepted mutation needs it. */
  private timestamp(): number {
    const value = this.now()
    if (!Number.isSafeInteger(value) || value < 0) {
      throw malformed('enrollment ledger clock returned an invalid timestamp')
    }
    return value
  }
}

/** Calculate the only durable representation of a supplied credential. */
function credentialDigest(credential: string): string {
  if (credential.length === 0) {
    throw new EnrollmentLedgerError('an enrollment credential must be non-empty', 'TEAM_LINK_ENROLLMENT_LEDGER_MALFORMED')
  }
  return createHash('sha256').update(credential, 'utf8').digest('hex')
}

/** Validate and detach an identity before it becomes a durable record field. */
function normalizeBinding(binding: TeamLinkBindingIdentity): TeamLinkBindingIdentity {
  const parsed = teamLinkBindingIdentitySchema.safeParse(binding)
  if (!parsed.success) throw malformed('enrollment ledger binding is invalid')
  return Object.freeze({
    activationId: parsed.data.activationId,
    teamId: parsed.data.teamId,
    participantId: parsed.data.participantId,
    sessionId: parsed.data.sessionId,
    provider: parsed.data.provider,
  })
}

/** Parse one stored record without retaining a potentially sensitive parser error. */
function parseRecord(value: unknown): EnrollmentRecord {
  if (!isRecord(value) || !Object.hasOwn(value, 'version') || typeof value.version !== 'number') {
    throw malformed('enrollment ledger record has no format version')
  }
  if (value.version !== WEBSOCKET_ENROLLMENT_LEDGER_RECORD_VERSION) {
    throw new EnrollmentLedgerError('enrollment ledger record format is unsupported', 'TEAM_LINK_ENROLLMENT_LEDGER_UNSUPPORTED_RECORD')
  }
  const parsed = enrollmentRecordSchema.safeParse(value)
  if (!parsed.success) throw malformed('enrollment ledger record is malformed')
  return {
    ...parsed.data,
    binding: normalizeBinding(parsed.data.binding),
  }
}

/** Build an externally safe state copy without a reusable credential digest. */
function publicEntry(entry: EnrollmentState): EnrollmentLedgerEntry {
  return Object.freeze({
    binding: entry.binding,
    generation: entry.generation,
    state: entry.state,
    issuedAt: entry.issuedAt,
    ...(entry.revokedAt === undefined ? {} : { revokedAt: entry.revokedAt }),
  })
}

/** Return a collision-free key for one immutable Team Link binding. */
function identityKey(binding: TeamLinkBindingIdentity): string {
  return JSON.stringify([
    binding.activationId,
    binding.teamId,
    binding.participantId,
    binding.sessionId,
    binding.provider,
  ])
}

/** Reject invalid page bounds before a recovery reads a storage stream. */
function assertRecoveryPageSize(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError('enrollment ledger recoveryPageSize must be a positive safe integer')
  }
}

/** Validate a provider name before it chooses a durable storage namespace. */
function normalizeEnrollmentProviderName(value: string): string {
  if (value.length === 0 || value.trim() !== value) {
    throw new TypeError('enrollment ledger enrollmentProviderName must be non-empty without surrounding whitespace')
  }
  return value
}

/** Reject invalid generation fences before they reach the durable stream. */
function assertGeneration(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new EnrollmentLedgerError('an enrollment generation must be a positive safe integer', 'TEAM_LINK_ENROLLMENT_LEDGER_MALFORMED')
  }
}

/** Build a credential-safe malformed-ledger failure. */
function malformed(message: string): EnrollmentLedgerError {
  return new EnrollmentLedgerError(message, 'TEAM_LINK_ENROLLMENT_LEDGER_MALFORMED')
}

/** Narrow one storage value before inspecting its record-version field. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
