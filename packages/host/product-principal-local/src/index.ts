/** Local single-user product-principal provider. @module @clocky/clocky-host-product-principal-local */

import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { mkdir, readFile, stat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import type { Context } from '@clocky/cordis'
import z from '@clocky/schemastery'
import { withFileLock, writeFileAtomic } from '@clocky/clocky-atomic-write'
import { resolveClockyHome } from '@clocky/clocky-home-paths'
import { ProductPrincipalError, productPrincipalId } from '@clocky/clocky-product-principal'
import type {
  ProductPrincipal,
  ProductPrincipalProvider,
  ProductPrincipalProviderAuthenticateRequest,
  ProductPrincipalProviderLease,
} from '@clocky/clocky-product-principal'

/** Cordis plugin name. */
export const name = 'product-principal-local'
/** The product-principal registry must exist before this provider registers. */
export const inject = ['productPrincipals']

/** Default registry name for the shipped single-user provider. */
export const LOCAL_PRODUCT_PRINCIPAL_PROVIDER_NAME = 'local'
/** Private state filename below the harness home when no explicit path is configured. */
export const PRODUCT_PRINCIPAL_STATE_FILENAME = 'product-principal.json'

/** Local provider configuration. */
export interface Config {
  /** Registry name used by Host and SDK transport consumers. */
  readonly providerName?: string
  /** Private state path; defaults below the resolved harness home. */
  readonly path?: string
  /** Harness home used when `path` is omitted. */
  readonly clockyHome?: string
}

/** Schemastery boundary for local provider configuration. */
export const Config: z<Config> = z.object({
  providerName: z.string().default(LOCAL_PRODUCT_PRINCIPAL_PROVIDER_NAME),
  path: z.string(),
  clockyHome: z.string(),
})

/** Fully resolved local provider parameters. */
export interface LocalProductPrincipalSpec {
  /** Registry identity. */
  readonly providerName: string
  /** Absolute state filename. */
  readonly path: string
}

interface PersistedState {
  readonly version: 1
  readonly principalId: string
  readonly credentialGeneration: number
  readonly credentialDigest: string
}

interface RotatedState {
  readonly persisted: PersistedState
  readonly credential: string
}

const STATE_VERSION = 1 as const
const GROUP_OTHER_BITS = 0o077
const SHA256_HEX = /^[a-f0-9]{64}$/

/**
 * Resolve defaulting at the owning provider boundary.
 * @param config - optional deployment values for the local provider.
 * @returns validated provider identity and absolute private state path.
 */
export function resolveLocalProductPrincipalSpec(config: Config = {}): LocalProductPrincipalSpec {
  const providerName = config.providerName ?? LOCAL_PRODUCT_PRINCIPAL_PROVIDER_NAME
  if (providerName.length === 0 || providerName.trim() !== providerName) {
    throw new Error('product-principal-local: providerName must be non-empty without surrounding whitespace')
  }
  return Object.freeze({
    providerName,
    path: resolve(config.path ?? join(resolveClockyHome(config.clockyHome), PRODUCT_PRINCIPAL_STATE_FILENAME)),
  })
}

/** Return a credential-safe product authentication rejection. */
function authenticationInvalid(): ProductPrincipalError {
  return new ProductPrincipalError('Product authentication is invalid', 'PRODUCT_AUTH_INVALID')
}

/** Return a credential-safe missing-authentication rejection. */
function authenticationRequired(): ProductPrincipalError {
  return new ProductPrincipalError('Product authentication is required', 'PRODUCT_AUTH_REQUIRED')
}

/** Whether a filesystem failure means that no state file exists yet. */
function isENOENT(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === 'ENOENT'
}

/** Hash opaque credential bytes without retaining their plaintext in durable state. */
function credentialDigest(credential: string): string {
  return createHash('sha256').update(credential, 'utf8').digest('hex')
}

/** Compare two SHA-256 digests without credential-dependent timing. */
function sameDigest(left: string, right: string): boolean {
  /* v8 ignore next -- both digests come from the validated private state or fresh SHA-256 output. */
  if (!SHA256_HEX.test(left) || !SHA256_HEX.test(right)) return false
  return timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'))
}

/** Compare the complete durable credential generation retained by one provider instance. */
function samePersistedGeneration(left: PersistedState, right: PersistedState): boolean {
  return left.principalId === right.principalId
    && left.credentialGeneration === right.credentialGeneration
    && sameDigest(left.credentialDigest, right.credentialDigest)
}

/** Reject state that is malformed rather than silently creating another product identity. */
function parsePersistedState(source: string): PersistedState {
  let value: unknown
  try {
    value = JSON.parse(source)
  } catch {
    throw new Error('product-principal-local: private principal state is malformed')
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('product-principal-local: private principal state is malformed')
  }
  const record = value as Record<string, unknown>
  if (Object.keys(record).length !== 4 || record['version'] !== STATE_VERSION) {
    throw new Error('product-principal-local: private principal state is malformed')
  }
  const principalId = record['principalId']
  const credentialGeneration = record['credentialGeneration']
  const credentialDigestValue = record['credentialDigest']
  if (typeof principalId !== 'string'
    || typeof credentialGeneration !== 'number'
    || !Number.isSafeInteger(credentialGeneration)
    || credentialGeneration < 1
    || typeof credentialDigestValue !== 'string'
    || !SHA256_HEX.test(credentialDigestValue)) {
    throw new Error('product-principal-local: private principal state is malformed')
  }
  try {
    productPrincipalId(principalId)
  } catch {
    throw new Error('product-principal-local: private principal state is malformed')
  }
  return Object.freeze({
    version: STATE_VERSION,
    principalId,
    credentialGeneration,
    credentialDigest: credentialDigestValue,
  })
}

/** Read private state only after rejecting a POSIX file readable by another user. */
async function readPersistedState(path: string): Promise<PersistedState | undefined> {
  try {
    const metadata = await stat(path)
    /* v8 ignore next -- Windows has no POSIX mode boundary to inspect. */
    if (process.platform !== 'win32' && (metadata.mode & GROUP_OTHER_BITS) !== 0) {
      throw new Error('product-principal-local: private principal state is readable beyond its owner')
    }
    return parsePersistedState(await readFile(path, 'utf8'))
  } catch (error: unknown) {
    if (isENOENT(error)) return undefined
    throw error
  }
}

/** Generate a 256-bit URL-safe bootstrap credential. */
function mintCredential(): string {
  return randomBytes(32).toString('base64url')
}

/** Render state without ever serializing the corresponding plaintext credential. */
function renderPersistedState(state: PersistedState): string {
  return `${JSON.stringify(state)}\n`
}

/** One provider-owned credential lease. */
class LocalProviderLease implements ProductPrincipalProviderLease {
  private readonly controller = new AbortController()

  /**
   * @param principal - Immutable principal authenticated by this lease.
   * @param onValidate - Rechecks the owning provider generation.
   * @param onRevoke - Removes the lease from its owner.
   */
  constructor(
    readonly principal: ProductPrincipal,
    private readonly onValidate: () => Promise<void>,
    private readonly onRevoke: (lease: LocalProviderLease) => void,
  ) {}

  /** Aborts when rotation or provider retirement revokes this lease. */
  get signal(): AbortSignal { return this.controller.signal }

  /** Reject calls after another Host instance rotated this credential generation. */
  async validate(): Promise<void> {
    if (this.isRevoked()) throw authenticationInvalid()
    await this.onValidate()
    /* v8 ignore next -- only a provider rotation interleaving this asynchronous check can hit the post-check fence. */
    if (this.isRevoked()) throw authenticationInvalid()
  }

  /** Revoke this lease exactly once. */
  revoke(): void {
    if (this.controller.signal.aborted) return
    this.controller.abort()
    this.onRevoke(this)
  }

  /** Read the mutable lease cancellation signal after generation validation. */
  private isRevoked(): boolean {
    return this.controller.signal.aborted
  }
}

/** File-backed local principal provider that rotates its bootstrap credential on every open. */
export class LocalProductPrincipalProvider implements ProductPrincipalProvider {
  private readonly leases = new Set<LocalProviderLease>()
  private rotation: Promise<void> = Promise.resolve()
  private closed = false
  private stale = false

  private constructor(
    readonly name: string,
    private readonly path: string,
    private state: PersistedState,
    private credential: string,
  ) {}

  /**
   * Open the private state, retain its stable principal id, and rotate the credential generation.
   * @param spec - validated local provider identity and private state path.
   * @returns an open provider holding the new in-memory bootstrap credential.
   */
  static async open(spec: LocalProductPrincipalSpec): Promise<LocalProductPrincipalProvider> {
    await mkdir(dirname(spec.path), { recursive: true, mode: 0o700 })
    const rotated = await withFileLock(spec.path, async (): Promise<RotatedState> => {
      const prior = await readPersistedState(spec.path)
      const credential = mintCredential()
      const persisted: PersistedState = Object.freeze({
        version: STATE_VERSION,
        principalId: prior?.principalId ?? randomUUID(),
        credentialGeneration: (prior?.credentialGeneration ?? 0) + 1,
        credentialDigest: credentialDigest(credential),
      })
      await writeFileAtomic(spec.path, renderPersistedState(persisted), { mode: 0o600, dirMode: 0o700 })
      return { persisted, credential }
    })
    return new LocalProductPrincipalProvider(spec.providerName, spec.path, rotated.persisted, rotated.credential)
  }

  /**
   * Return the current plaintext bootstrap credential to a trusted transport bootstrap owner.
   * @returns the current opaque bootstrap credential.
   */
  bootstrapCredential(): string {
    if (this.closed || this.stale) throw authenticationInvalid()
    return this.credential
  }

  /** Rotate the bootstrap credential, persist only its digest, and revoke prior leases. */
  rotateBootstrapCredential(): Promise<void> {
    const operation = this.rotation.then(async () => {
      if (this.closed || this.stale) throw authenticationInvalid()
      const rotated = await withFileLock(this.path, async (): Promise<RotatedState> => {
        const current = await readPersistedState(this.path)
        if (current === undefined || !samePersistedGeneration(current, this.state)) {
          this.revokeStaleGeneration()
          throw authenticationInvalid()
        }
        const credential = mintCredential()
        const persisted: PersistedState = Object.freeze({
          version: STATE_VERSION,
          principalId: current.principalId,
          credentialGeneration: current.credentialGeneration + 1,
          credentialDigest: credentialDigest(credential),
        })
        await writeFileAtomic(this.path, renderPersistedState(persisted), { mode: 0o600, dirMode: 0o700 })
        return { persisted, credential }
      })
      this.state = rotated.persisted
      this.credential = rotated.credential
      for (const lease of [...this.leases]) lease.revoke()
    })
    this.rotation = operation.catch(() => {})
    return operation
  }

  /** Validate one bootstrap or SDK credential into a distinct revocable lease. */
  async authenticate(request: ProductPrincipalProviderAuthenticateRequest): Promise<ProductPrincipalProviderLease> {
    if (this.closed || this.stale || request.signal?.aborted === true) throw authenticationInvalid()
    await this.assertCurrentGeneration()
    const credential = request.credential
    if (credential === undefined || credential.length === 0) throw authenticationRequired()
    if (!sameDigest(credentialDigest(credential), this.state.credentialDigest)) throw authenticationInvalid()
    const principal: ProductPrincipal = Object.freeze({
      id: productPrincipalId(this.state.principalId),
      issuer: this.name,
      subject: 'local-user',
      assurance: 'local-bootstrap',
      credentialGeneration: this.state.credentialGeneration,
    })
    const lease = new LocalProviderLease(
      principal,
      async () => { await this.assertCurrentGeneration() },
      (revokedLease) => { this.leases.delete(revokedLease) },
    )
    this.leases.add(lease)
    return lease
  }

  /** Reject a locally retained generation once another Host has replaced the durable credential state. */
  private async assertCurrentGeneration(): Promise<void> {
    /* v8 ignore next -- public lifecycle methods revoke leases before this private re-entry check can observe closure. */
    if (this.closed || this.stale) throw authenticationInvalid()
    let current: PersistedState | undefined
    try {
      current = await readPersistedState(this.path)
    } catch {
      this.revokeStaleGeneration()
      throw authenticationInvalid()
    }
    if (current === undefined || !samePersistedGeneration(current, this.state)) {
      this.revokeStaleGeneration()
      throw authenticationInvalid()
    }
  }

  /** Mark this instance stale and revoke every credential lease it issued. */
  private revokeStaleGeneration(): void {
    if (this.stale) return
    this.stale = true
    for (const lease of [...this.leases]) lease.revoke()
  }

  /** Close admission and revoke every lease this provider issued. */
  async close(): Promise<void> {
    this.closed = true
    await this.rotation
    for (const lease of [...this.leases]) lease.revoke()
  }
}

/** Open and register the shipped local principal provider. */
export async function apply(ctx: Context, config?: Config): Promise<void> {
  const provider = await LocalProductPrincipalProvider.open(resolveLocalProductPrincipalSpec(config ?? {}))
  const dispose = ctx.productPrincipals.registerProvider(provider)
  ctx.effect(() => async () => {
    await dispose()
    await provider.close()
  }, 'product-principal-local: provider')
}
