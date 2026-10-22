/** Local browser bootstrap and in-memory product-auth session behavior. */

import { describe, expect, it, vi } from 'vitest'
import { PRODUCT_AUTH_BOOTSTRAP_PATH, productAuthCookieName } from '../src/product-auth-contract.ts'
import { ProductAuthSessions } from '../src/product-auth.ts'

const credential = 'product-auth-test-credential'
const invalidAuthentication = Object.assign(new Error('invalid'), { code: 'PRODUCT_AUTH_INVALID' })

class Lease {
  readonly revoked = { count: 0 }
  failCall = false
  generation = 1
  afterCall: (() => void) | undefined

  async withCall<T>(
    operation: (call: {
      principal: { id: string; issuer: string; subject: string; assurance: string; credentialGeneration: number }
      credentialGeneration: number
      signal: AbortSignal
    }) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    if (this.failCall) throw invalidAuthentication
    const result = await operation({
      principal: { id: 'test-principal', issuer: 'test', subject: 'test-user', assurance: 'test', credentialGeneration: this.generation },
      credentialGeneration: this.generation,
      signal: signal ?? new AbortController().signal,
    })
    this.afterCall?.()
    return result
  }

  async revoke(): Promise<void> {
    this.revoked.count += 1
  }
}

/** Build one manager and expose leases so each assertion can control a provider result. */
function sessions(options: {
  port?: number
  rejectAuthenticate?: boolean
  leases?: Lease[]
  onFormBootstrapAccepted?: (handoffId: string) => void
} = {}): ProductAuthSessions {
  const leases = options.leases ?? [new Lease()]
  let next = 0
  return new ProductAuthSessions({
    authenticate: async (request: { credential?: string }) => {
      if (options.rejectAuthenticate === true || request.credential !== credential) throw invalidAuthentication
      const lease = leases[next++]
      if (lease === undefined) throw invalidAuthentication
      return lease
    },
  } as never, 'local', () => options.port ?? 3080, options.onFormBootstrapAccepted)
}

/** Read the opaque session cookie from a successful bootstrap response. */
function cookie(response: Response): string {
  const value = response.headers.get('set-cookie')
  if (value === null) throw new Error('bootstrap response omitted its session cookie')
  return value.split(';', 1)[0]!
}

describe('ProductAuthSessions', () => {
  it('refuses bootstrap after shutdown and remains closed after repeated disposal', async () => {
    const auth = sessions()
    await auth.close(); await auth.close()
    expect((await auth.bootstrap(new Request('http://x/api/bootstrap', { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ credential }) }))).status).toBe(401)
  })

  it('rejects failed form body reads before acquiring a credential lease', async () => {
    const lease = new Lease(), auth = sessions({ leases: [lease] })
    const request = new Request('http://x/api/bootstrap', { method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'credential=value&handoffId=' + 'h'.repeat(43) })
    vi.spyOn(request, 'text').mockRejectedValueOnce(new Error('Request body disconnected'))
    expect((await auth.bootstrap(request)).status).toBe(400)
    expect(lease.revoked.count).toBe(0)
    await auth.close()
  })

  it('revokes an admitted lease when its request retires while reading the provider generation', async () => {
    const lease = new Lease(), auth = sessions({ leases: [lease] }), controller = new AbortController()
    lease.afterCall = () => { controller.abort() }
    const response = await auth.bootstrap(new Request('http://x/api/bootstrap', { method: 'POST', signal: controller.signal,
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ credential }) }))
    expect(response.status).toBe(401)
    expect(response.headers.get('set-cookie')).toBeNull()
    expect(lease.revoked.count).toBe(1)
    await auth.close()
  })

  it.each(['failure', 'abort'] as const)('revokes the new lease when replacing the old cookie encounters %s', async (outcome) => {
    const first = new Lease(), second = new Lease(); second.generation = 2
    const auth = sessions({ leases: [first, second] }), controller = new AbortController()
    const initial = await auth.bootstrap(new Request('http://x/api/bootstrap', { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ credential }) }))
    const revoke = first.revoke.bind(first)
    vi.spyOn(first, 'revoke').mockImplementationOnce(async () => {
      await revoke()
      if (outcome === 'failure') throw new Error('Lease revocation failed')
      controller.abort()
    })
    const replacement = auth.bootstrap(new Request('http://x/api/bootstrap', { method: 'POST', signal: controller.signal,
      headers: { 'content-type': 'application/json', cookie: cookie(initial) }, body: JSON.stringify({ credential }) }))
    if (outcome === 'failure') await expect(replacement).rejects.toThrow('Lease revocation failed')
    else expect((await replacement).status).toBe(401)
    expect(second.revoked.count).toBe(1)
    expect(await auth.withCall({ headers: { cookie: cookie(initial) } }, async () => 'old')).toEqual({ kind: 'invalid' })
    await auth.close()
  })

  it('accepts only the exact JSON bootstrap shape and returns credential-safe failures', async () => {
    const auth = sessions({ rejectAuthenticate: true })
    expect(auth.isBootstrapPath(PRODUCT_AUTH_BOOTSTRAP_PATH)).toBe(true)
    expect(auth.isBootstrapPath('/api/other')).toBe(false)
    await expect(auth.bootstrap(new Request('http://x/api/bootstrap'))).resolves.toMatchObject({ status: 404 })
    await expect(auth.bootstrap(new Request('http://x/api/bootstrap', { method: 'POST' }))).resolves.toMatchObject({ status: 415 })
    await expect(auth.bootstrap(new Request('http://x/api/bootstrap', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{',
    }))).resolves.toMatchObject({ status: 400 })
    for (const body of [[], {}, { credential: '' }, { credential, ignored: true }]) {
      await expect(auth.bootstrap(new Request('http://x/api/bootstrap', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      }))).resolves.toMatchObject({ status: 400 })
    }
    const rejected = await auth.bootstrap(new Request('http://x/api/bootstrap', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ credential }),
    }))
    expect(rejected.status).toBe(401)
    expect(await rejected.text()).not.toContain(credential)
  })

  it('accepts one exact private-form bootstrap and redirects without reflecting its credential', async () => {
    const accepted: string[] = []
    const auth = sessions({ onFormBootstrapAccepted: (handoffId) => { accepted.push(handoffId) } })
    expect(auth.isFormBootstrapRequest({
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded; charset=UTF-8' },
    })).toBe(true)
    expect(auth.isFormBootstrapRequest({
      method: 'POST', headers: { 'content-type': 'application/json' },
    })).toBe(false)
    const handoffId = 'h'.repeat(43)
    for (const body of ['', 'credential=', `credential=${encodeURIComponent(credential)}&extra=1`, 'other=value', `credential=${encodeURIComponent(credential)}&handoffId=short`]) {
      await expect(auth.bootstrap(new Request('http://x/api/bootstrap', {
        method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body,
      }))).resolves.toMatchObject({ status: 400 })
    }
    const admitted = await auth.bootstrap(new Request('http://x/api/bootstrap', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: `credential=${encodeURIComponent(credential)}&handoffId=${handoffId}`,
    }))
    expect(admitted.status).toBe(303)
    expect(admitted.headers.get('location')).toBe('/')
    expect(cookie(admitted)).not.toContain(credential)
    expect(await admitted.text()).not.toContain(credential)
    expect(accepted).toEqual([handoffId])
    await auth.close()
  })

  it('consumes a provider generation once and retains no credential in its session cookie', async () => {
    const first = new Lease()
    const replay = new Lease()
    const auth = sessions({ leases: [first, replay] })
    const request = (): Request => new Request('http://x/api/bootstrap', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ credential }),
    })

    const admitted = await auth.bootstrap(request())
    expect(admitted.status).toBe(204)
    expect(cookie(admitted)).toMatch(/^clocky_product_auth_3080=[A-Za-z0-9_-]{43}$/)
    expect(cookie(admitted)).not.toContain(credential)
    const duplicate = await auth.bootstrap(request())
    expect(duplicate.status).toBe(401)
    expect(replay.revoked.count).toBe(1)
    await auth.close()
    expect(first.revoked.count).toBe(1)
  })

  it('rejects a credential lease that cannot produce a live call context', async () => {
    const broken = new Lease()
    broken.failCall = true
    const auth = sessions({ leases: [broken] })
    const response = await auth.bootstrap(new Request('http://x/api/bootstrap', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ credential }),
    }))
    expect(response.status).toBe(401)
    expect(broken.revoked.count).toBe(1)
  })

  it('resets its bootstrap serializer after an unexpected request failure', async () => {
    const auth = sessions()
    const poisoned = new Proxy(new Request('http://x/api/bootstrap', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ credential }),
    }), {
      get(target, key, receiver) {
        if (key === 'method') throw new Error('synthetic request failure')
        return Reflect.get(target, key, receiver) as unknown
      },
    })
    await expect(auth.bootstrap(poisoned)).rejects.toThrow('synthetic request failure')
    await expect(auth.bootstrap(new Request('http://x/api/bootstrap', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ credential }),
    }))).resolves.toMatchObject({ status: 204 })
  })

  it('admits only one valid cookie, drops revoked leases, and keeps ordinary operation failures visible', async () => {
    const lease = new Lease()
    const invalidLease = new Lease()
    const auth = sessions({ leases: [lease, invalidLease] })
    const boot = await auth.bootstrap(new Request('http://x/api/bootstrap', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ credential }),
    }))
    const sessionCookie = cookie(boot)

    await expect(auth.withCall({ headers: {} }, async () => 'unreachable')).resolves.toEqual({ kind: 'required' })
    await expect(auth.withCall({ headers: { cookie: 'malformed; another=value' } }, async () => 'unreachable'))
      .resolves.toEqual({ kind: 'required' })
    await expect(auth.withCall({ headers: { cookie: 'clocky_product_auth_3080=short' } }, async () => 'unreachable'))
      .resolves.toEqual({ kind: 'required' })
    await expect(auth.withCall({ headers: {
      cookie: `clocky_product_auth_3080=${'a'.repeat(43)}; clocky_product_auth_3080=${'b'.repeat(43)}`,
    } }, async () => 'unreachable')).resolves.toEqual({ kind: 'required' })
    await expect(auth.withCall({ headers: { cookie: `clocky_product_auth_3080=${'x'.repeat(43)}` } }, async () => 'unreachable'))
      .resolves.toEqual({ kind: 'invalid' })
    await expect(auth.withCall({ headers: { cookie: sessionCookie } }, async call => call.principal.id))
      .resolves.toEqual({ kind: 'authenticated', value: 'test-principal' })
    await expect(auth.withCall({ headers: { cookie: sessionCookie } }, async () => {
      throw new Error('ordinary operation failure')
    })).rejects.toThrow('ordinary operation failure')
    await expect(auth.withCall({ headers: { cookie: sessionCookie } }, () => Promise.reject(new Error('operation failure'))))
      .rejects.toThrow('operation failure')
    // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- Opaque caller failures must preserve authentication.
    await expect(auth.withCall({ headers: { cookie: sessionCookie } }, () => Promise.reject('raw operation failure')))
      .rejects.toBe('raw operation failure')

    lease.failCall = true
    await expect(auth.withCall({ headers: { cookie: sessionCookie } }, async () => 'unreachable'))
      .resolves.toEqual({ kind: 'invalid' })
    expect(lease.revoked.count).toBe(1)
    expect(auth.rejection('required').headers.get('set-cookie')).toBeNull()
    expect(auth.rejection('invalid').headers.get('set-cookie')).toContain('Max-Age=0')
  })

  it('revokes retained sessions when the transport closes', async () => {
    const lease = new Lease()
    const auth = sessions({ leases: [lease] })
    const boot = await auth.bootstrap(new Request('http://x/api/bootstrap', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ credential }),
    }))
    await auth.close()
    await expect(auth.withCall({ headers: { cookie: cookie(boot) } }, async () => 'unreachable'))
      .resolves.toEqual({ kind: 'invalid' })
    expect(lease.revoked.count).toBe(1)
  })

  it('does not retain a bootstrap session when the transport closes during authentication', async () => {
    let release!: (lease: Lease) => void
    const pending = new Promise<Lease>((resolve) => { release = resolve })
    const auth = new ProductAuthSessions({ authenticate: async () => await pending } as never, 'local', () => 3080)
    const exchange = auth.bootstrap(new Request('http://x/api/bootstrap', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ credential }),
    }))
    await Promise.resolve()
    await auth.close()
    const lease = new Lease()
    release(lease)
    await expect(exchange).resolves.toMatchObject({ status: 401 })
    expect(lease.revoked.count).toBe(1)
  })
})

it('replacing the current browser credential aborts old calls and rejects the old cookie', async () => {
  const first = new Lease()
  const second = new Lease(); second.generation = 2
  const manager = sessions({ leases: [first, second] })
  const bootstrap = (headers: Record<string, string> = {}) => manager.bootstrap(new Request(`http://localhost${PRODUCT_AUTH_BOOTSTRAP_PATH}`, {
    method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify({ credential }),
  }))
  const oldCookie = cookie(await bootstrap())
  let signal: AbortSignal | undefined
  await manager.withCall({ headers: { cookie: oldCookie } }, async (call) => { signal = call.signal })
  const nextCookie = cookie(await bootstrap({ cookie: oldCookie }))
  expect(signal?.aborted).toBe(true)
  expect(first.revoked.count).toBe(1)
  expect(await manager.withCall({ headers: { cookie: oldCookie } }, async () => 'old')).toEqual({ kind: 'invalid' })
  expect(await manager.withCall({ headers: { cookie: nextCookie } }, async () => 'new')).toEqual({ kind: 'authenticated', value: 'new' })
  await manager.close()
})

it('keeps simultaneous listener cookies independent during authentication, replacement and rejection', async () => {
  const first = new Lease(), replacement = new Lease(), other = new Lease()
  replacement.generation = 2
  const a = sessions({ port: 3080, leases: [first, replacement] }), b = sessions({ port: 3081, leases: [other] })
  const bootstrap = (port: number, cookies?: string) => new Request(`http://127.0.0.1:${port}/api/bootstrap`, {
    method: 'POST', headers: { 'content-type': 'application/json', ...cookies === undefined ? {} : { cookie: cookies } },
    body: JSON.stringify({ credential }),
  })
  try {
    const ca = cookie(await a.bootstrap(bootstrap(3080))), cb = cookie(await b.bootstrap(bootstrap(3081)))
    const shared = `${ca}; ${cb}`
    expect(ca.startsWith(`${productAuthCookieName(3080)}=`)).toBe(true)
    expect(cb.startsWith(`${productAuthCookieName(3081)}=`)).toBe(true)
    expect(await a.withCall({ headers: { cookie: shared, host: '127.0.0.1:9999' } }, async () => 'a')).toEqual({ kind: 'authenticated', value: 'a' })
    expect(await b.withCall({ headers: { cookie: shared } }, async () => 'b')).toEqual({ kind: 'authenticated', value: 'b' })
    const next = cookie(await a.bootstrap(bootstrap(3080, shared)))
    expect(first.revoked.count).toBe(1)
    expect(other.revoked.count).toBe(0)
    expect(await b.withCall({ headers: { cookie: `${next}; ${cb}` } }, async () => 'b')).toEqual({ kind: 'authenticated', value: 'b' })
    expect(await b.withCall({ headers: { cookie: `clocky_product_auth_3080=malformed; ${cb}` } }, async () => 'b')).toEqual({ kind: 'authenticated', value: 'b' })
    expect(a.rejection('invalid').headers.get('set-cookie')).toBe('clocky_product_auth_3080=; Path=/api; HttpOnly; SameSite=Strict; Max-Age=0')
    expect(b.rejection('invalid').headers.get('set-cookie')).toBe('clocky_product_auth_3081=; Path=/api; HttpOnly; SameSite=Strict; Max-Age=0')
  } finally { await a.close(); await b.close() }
})

it('requires a resolved listener port rather than deriving cookie names from request authorities', () => {
  for (const port of [0, -1, 65536, 1.5, NaN, Infinity]) expect(() => productAuthCookieName(port)).toThrow('resolved listening port')
  expect(productAuthCookieName(65535)).toBe('clocky_product_auth_65535')
})
