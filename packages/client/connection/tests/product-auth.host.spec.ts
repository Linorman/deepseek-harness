/** Local browser bootstrap and in-memory product-auth session behavior. */

import { describe, expect, it } from 'vitest'
import { PRODUCT_AUTH_BOOTSTRAP_PATH } from '../src/product-auth-contract.ts'
import { ProductAuthSessions } from '../src/product-auth.ts'

const credential = 'product-auth-test-credential'
const invalidAuthentication = Object.assign(new Error('invalid'), { code: 'PRODUCT_AUTH_INVALID' })

class Lease {
  readonly revoked = { count: 0 }
  failCall = false

  async withCall<T>(
    operation: (call: {
      principal: { id: string; issuer: string; subject: string; assurance: string; credentialGeneration: number }
      credentialGeneration: number
      signal: AbortSignal
    }) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    if (this.failCall) throw invalidAuthentication
    return await operation({
      principal: { id: 'test-principal', issuer: 'test', subject: 'test-user', assurance: 'test', credentialGeneration: 1 },
      credentialGeneration: 1,
      signal: signal ?? new AbortController().signal,
    })
  }

  async revoke(): Promise<void> {
    this.revoked.count += 1
  }
}

/** Build one manager and expose leases so each assertion can control a provider result. */
function sessions(options: {
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
  } as never, 'local', options.onFormBootstrapAccepted)
}

/** Read the opaque session cookie from a successful bootstrap response. */
function cookie(response: Response): string {
  const value = response.headers.get('set-cookie')
  if (value === null) throw new Error('bootstrap response omitted its session cookie')
  return value.split(';', 1)[0]!
}

describe('ProductAuthSessions', () => {
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
    expect(cookie(admitted)).toMatch(/^clocky_product_auth=[A-Za-z0-9_-]{43}$/)
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
    await expect(auth.withCall({ headers: { cookie: 'clocky_product_auth=short' } }, async () => 'unreachable'))
      .resolves.toEqual({ kind: 'required' })
    await expect(auth.withCall({ headers: {
      cookie: `clocky_product_auth=${'a'.repeat(43)}; clocky_product_auth=${'b'.repeat(43)}`,
    } }, async () => 'unreachable')).resolves.toEqual({ kind: 'required' })
    await expect(auth.withCall({ headers: { cookie: `clocky_product_auth=${'x'.repeat(43)}` } }, async () => 'unreachable'))
      .resolves.toEqual({ kind: 'invalid' })
    await expect(auth.withCall({ headers: { cookie: sessionCookie } }, async call => call.principal.id))
      .resolves.toEqual({ kind: 'authenticated', value: 'test-principal' })
    await expect(auth.withCall({ headers: { cookie: sessionCookie } }, async () => {
      throw new Error('ordinary operation failure')
    })).rejects.toThrow('ordinary operation failure')
    await expect(auth.withCall({ headers: { cookie: sessionCookie } }, () => Promise.reject(new Error('operation failure'))))
      .rejects.toThrow('operation failure')

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
    const auth = new ProductAuthSessions({ authenticate: async () => await pending } as never, 'local')
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
