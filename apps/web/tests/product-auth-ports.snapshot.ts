/** Two real keyless Web Hosts share a browser-style cookie header without replacing each other's authentication. */
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { expect, it } from 'vitest'
import { launchWebScaffold } from './scaffold.ts'

it('keeps independent local Hosts authenticated when the cookie jar contains both listener sessions', async () => {
  const root = await mkdtemp(resolve('.tmp/product-auth-ports-'))
  const hosts: Awaited<ReturnType<typeof launchWebScaffold>>[] = []
  let passed = false
  try {
    for (const name of ['a', 'b']) {
      const tempRoot = join(root, name)
      await mkdir(tempRoot)
      hosts.push(await launchWebScaffold({ tempRoot, disableDefaultSimulation: true, productPrincipalId: `port-${name}` }))
    }
    const cookies: string[] = []
    for (const host of hosts) {
      const credential = host.ctx.productPrincipals.bootstrapCredential('local')
      const response = await fetch(`${host.baseUrl}/api/bootstrap`, { method: 'POST',
        headers: { 'content-type': 'application/json' }, body: JSON.stringify({ credential }) })
      expect(response.status).toBe(204)
      const cookie = response.headers.get('set-cookie')?.split(';', 1)[0]
      if (cookie === undefined) throw new Error('Authenticated Host omitted its cookie')
      cookies.push(cookie)
    }
    expect(new Set(cookies.map(cookie => cookie.split('=', 1)[0])).size).toBe(2)
    for (const [index, host] of hosts.entries()) {
      const call = (cookie: string) => fetch(`${host.baseUrl}/api/host.describe`, { method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ type: 'client-request', rpcId: 'parallel-auth', method: 'host.describe', payload: {} }) })
      const admitted = await call(cookies.join('; '))
      expect(admitted.status).toBe(200)
      expect(await admitted.json()).toMatchObject({ result: { ok: true } })
      const foreign = cookies[1 - index]
      if (foreign === undefined) throw new Error('Peer cookie is absent')
      const refused = await call(foreign)
      expect(refused.status).toBe(401)
      expect(refused.headers.has('set-cookie')).toBe(false)
      expect((await call(cookies.join('; '))).status).toBe(200)
    }
    passed = true
  } finally {
    for (const host of hosts.reverse()) await host.close()
    if (passed) await rm(root, { recursive: true, force: true })
  }
}, 120000)
