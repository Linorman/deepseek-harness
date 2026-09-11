/** Host-only local product-auth bootstrap and cookie-session carrier. */

import { randomBytes } from 'node:crypto'
import type { IncomingMessage } from 'node:http'
import type {
  AuthenticatedProductCall,
  AuthenticatedProductPrincipalLease,
  ProductPrincipalRegistry,
} from '@clocky/clocky-product-principal'
import {
  PRODUCT_AUTH_BOOTSTRAP_PATH,
  PRODUCT_AUTH_COOKIE_NAME,
} from './product-auth-contract.ts'

const COOKIE_TOKEN = /^[A-Za-z0-9_-]{43}$/
const FORM_MEDIA_TYPE = 'application/x-www-form-urlencoded'

interface ProductAuthSession {
  readonly lease: AuthenticatedProductPrincipalLease
  readonly controller: AbortController
}

/** Result of trying to admit one HTTP or upgraded-WebSocket request. */
export type ProductAuthAdmission<T> =
  | { readonly kind: 'authenticated'; readonly value: T }
  | { readonly kind: 'required' | 'invalid' }

/** Return a safe process-local cookie token that carries no principal identity. */
function mintCookieToken(): string {
  return randomBytes(32).toString('base64url')
}

/** Extract exactly one syntactically valid cookie value without decoding it. */
function cookieToken(header: string | undefined): string | undefined {
  if (header === undefined) return undefined
  let token: string | undefined
  for (const part of header.split(';')) {
    const separator = part.indexOf('=')
    if (separator < 1) continue
    if (part.slice(0, separator).trim() !== PRODUCT_AUTH_COOKIE_NAME) continue
    const candidate = part.slice(separator + 1).trim()
    if (!COOKIE_TOKEN.test(candidate) || token !== undefined) return undefined
    token = candidate
  }
  return token
}

/** Decode only the bootstrap endpoint's exact JSON request shape. */
function jsonBootstrapCredential(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  if (Object.keys(record).length !== 1 || typeof record['credential'] !== 'string') return undefined
  const credential = record['credential']
  return credential.length > 0 ? credential : undefined
}

/** Private form fields retained only until the bootstrap endpoint accepts or rejects them. */
interface FormBootstrapPayload {
  readonly credential: string
  readonly handoffId: string
}

/** Decode only the private handoff document's exact form payload. */
function formBootstrapPayload(value: string): FormBootstrapPayload | undefined {
  const fields = new Map(new URLSearchParams(value))
  if (fields.size !== 2 || [...new URLSearchParams(value)].length !== 2) return undefined
  const credential = fields.get('credential')
  const handoffId = fields.get('handoffId')
  if (credential === undefined || credential.length === 0 || handoffId === undefined || !COOKIE_TOKEN.test(handoffId)) {
    return undefined
  }
  return { credential, handoffId }
}

/** Normalize a content type to its media type without accepting a missing header. */
function mediaType(value: string | undefined | null): string | undefined {
  return value?.split(';', 1)[0]?.trim().toLowerCase()
}

/** Recognize the credential-safe error codes the registry guarantees at this transport boundary. */
function isProductAuthenticationError(error: unknown): boolean {
  const code = typeof error === 'object' && error !== null
    ? (error as { code?: unknown }).code
    : undefined
  return code === 'PRODUCT_AUTH_REQUIRED' || code === 'PRODUCT_AUTH_INVALID'
}

/** Private session cookie attributes. Cookies are session-only and never persist a credential. */
function sessionCookie(token: string): string {
  return `${PRODUCT_AUTH_COOKIE_NAME}=${token}; Path=/api; HttpOnly; SameSite=Strict`
}

/** Expire a rejected cookie without reflecting its value. */
function expiredSessionCookie(): string {
  return `${PRODUCT_AUTH_COOKIE_NAME}=; Path=/api; HttpOnly; SameSite=Strict; Max-Age=0`
}

/** Authenticate browser bootstrap credentials and retain only revocable server-memory leases. */
export class ProductAuthSessions {
  private readonly sessions = new Map<string, ProductAuthSession>()
  private readonly consumedBootstrapGenerations = new Set<number>()
  private bootstrapChain = Promise.resolve()
  private closed = false

  /**
   * @param registry - product-principal registry selected by the Web composition.
   * @param provider - named provider that owns this transport's bootstrap credential.
   * @param onFormBootstrapAccepted - schedules owner-only handoff artifact cleanup after successful form authentication.
   */
  constructor(
    private readonly registry: Pick<ProductPrincipalRegistry, 'authenticate'>,
    private readonly provider: string,
    private readonly onFormBootstrapAccepted?: (handoffId: string) => void,
  ) {}

  /**
   * Whether a request targets the credential-exchange endpoint.
   * @param pathname - decoded request pathname.
   * @returns whether the pathname is the product-auth bootstrap endpoint.
   */
  isBootstrapPath(pathname: string): boolean {
    return pathname === PRODUCT_AUTH_BOOTSTRAP_PATH
  }

  /**
   * Whether a Node request is the private local-file form carrier.
   * @param request - incoming request headers and method.
   * @returns whether the request uses the exact private form media type.
   */
  isFormBootstrapRequest(request: Pick<IncomingMessage, 'method' | 'headers'>): boolean {
    const contentType = request.headers['content-type']
    return request.method === 'POST' && typeof contentType === 'string' && mediaType(contentType) === FORM_MEDIA_TYPE
  }

  /**
   * Exchange one request-body credential for a non-persistent HttpOnly session cookie.
   * @param request - loopback bootstrap request carrying a JSON or private-form credential once.
   * @returns the credential-safe bootstrap response.
   */
  bootstrap(request: Request): Promise<Response> {
    const exchange = this.bootstrapChain.then(() => this.exchangeBootstrap(request))
    this.bootstrapChain = exchange.then(() => undefined, () => undefined)
    return exchange
  }

  /** Authenticate and consume one provider generation while the bootstrap serializer is held. */
  private async exchangeBootstrap(request: Request): Promise<Response> {
    if (this.closed) return this.invalidBootstrap(401)
    if (request.method !== 'POST') return new Response('not found', { status: 404 })
    const type = mediaType(request.headers.get('content-type'))
    let credential: string | undefined
    let formHandoffId: string | undefined
    if (type === 'application/json') {
      try {
        credential = jsonBootstrapCredential(await request.json())
      } catch {
        return this.invalidBootstrap(400)
      }
    } else if (type === FORM_MEDIA_TYPE) {
      try {
        const form = formBootstrapPayload(await request.text())
        credential = form?.credential
        formHandoffId = form?.handoffId
      } catch {
        return this.invalidBootstrap(400)
      }
    } else {
      return this.invalidBootstrap(415)
    }
    if (credential === undefined) return this.invalidBootstrap(400)
    let lease: AuthenticatedProductPrincipalLease
    try {
      lease = await this.registry.authenticate({ provider: this.provider, credential, signal: request.signal })
    } catch {
      return this.invalidBootstrap(401)
    }
    if (this.isClosedOrAborted(request.signal)) {
      await lease.revoke()
      return this.invalidBootstrap(401)
    }
    let generation: number
    try {
      generation = await lease.withCall(call => Promise.resolve(call.credentialGeneration))
    } catch {
      await lease.revoke()
      return this.invalidBootstrap(401)
    }
    if (this.isClosedOrAborted(request.signal)) {
      await lease.revoke()
      return this.invalidBootstrap(401)
    }
    if (this.consumedBootstrapGenerations.has(generation)) {
      await lease.revoke()
      return this.invalidBootstrap(401)
    }
    this.consumedBootstrapGenerations.add(generation)
    const token = mintCookieToken()
    const session: ProductAuthSession = { lease, controller: new AbortController() }
    this.sessions.set(token, session)
    try {
      if (formHandoffId !== undefined) this.onFormBootstrapAccepted?.(formHandoffId)
    } catch {
      // Artifact cleanup cannot invalidate an accepted authentication exchange.
    }
    return new Response(null, {
      status: type === FORM_MEDIA_TYPE ? 303 : 204,
      headers: {
        'cache-control': 'no-store',
        'set-cookie': sessionCookie(token),
        ...type === FORM_MEDIA_TYPE ? { location: '/' } : {},
      },
    })
  }

  /**
   * Admit one request through its session lease without exposing cookie material to the operation.
   * @param req - carrier headers containing the HttpOnly session cookie.
   * @param operation - protected dispatch receiving only runtime principal facts.
   * @returns authenticated operation output or a credential-safe denial classification.
   */
  async withCall<T>(
    req: Pick<IncomingMessage, 'headers'>,
    operation: (call: AuthenticatedProductCall) => Promise<T>,
  ): Promise<ProductAuthAdmission<T>> {
    const token = cookieToken(req.headers.cookie)
    if (token === undefined) return { kind: 'required' }
    const session = this.sessions.get(token)
    if (session === undefined || session.controller.signal.aborted) return { kind: 'invalid' }
    try {
      const value = await session.lease.withCall(operation, session.controller.signal)
      return { kind: 'authenticated', value }
    } catch (error: unknown) {
      if (!isProductAuthenticationError(error)) throw error
      await this.drop(token, session)
      return { kind: 'invalid' }
    }
  }

  /**
   * Return a credential-safe response for an HTTP request that did not authenticate.
   * @param kind - whether the cookie was absent or invalid.
   * @returns a non-cacheable HTTP authentication denial.
   */
  rejection(kind: 'required' | 'invalid'): Response {
    return new Response(
      kind === 'required' ? 'product authentication required' : 'product authentication invalid',
      {
        status: 401,
        headers: {
          'cache-control': 'no-store',
          ...kind === 'invalid' ? { 'set-cookie': expiredSessionCookie() } : {},
        },
      },
    )
  }

  /** Stop live calls before revoking each retained product-principal lease. */
  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    const entries = [...this.sessions]
    this.sessions.clear()
    await Promise.all(entries.map(async ([, session]) => {
      session.controller.abort()
      await session.lease.revoke()
    }))
  }

  /** Forget an invalid session, abort any streaming call, and revoke its lease. */
  private async drop(token: string, session: ProductAuthSession): Promise<void> {
    this.sessions.delete(token)
    session.controller.abort()
    await session.lease.revoke()
  }

  /** Keep bootstrap diagnostics credential-safe and cache-free. */
  private invalidBootstrap(status: 400 | 401 | 415): Response {
    return new Response('product authentication invalid', {
      status,
      headers: { 'cache-control': 'no-store' },
    })
  }

  /** Re-read mutable teardown and request state after an asynchronous authentication step. */
  private isClosedOrAborted(signal: AbortSignal): boolean {
    return this.closed || signal.aborted
  }
}
