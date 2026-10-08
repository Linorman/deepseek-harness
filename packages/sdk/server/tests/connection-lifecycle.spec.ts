/** Connection replacement retains only the current authenticated lease. */
import { Context } from '@clocky/cordis'
import { ProductPrincipalError, productPrincipalId, type AuthenticatedProductCall, type AuthenticatedProductPrincipalLease } from '@clocky/clocky-product-principal'
import { expect, it, vi } from 'vitest'
import { HarnessSdkJsonRpcServer } from '../src/server.ts'

function lease(id: string, options: { abortAfterIdentity?: boolean; revokeFailure?: Error } = {}) {
  const controller = new AbortController()
  const principal = Object.freeze({ id: productPrincipalId(id), issuer: 'test', subject: id,
    assurance: 'test', credentialGeneration: 1 })
  const revoke = vi.fn(async () => {
    controller.abort()
    if (options.revokeFailure !== undefined) throw options.revokeFailure
  })
  const value: AuthenticatedProductPrincipalLease = { signal: controller.signal, revoke,
    async withCall<T>(operation: (call: AuthenticatedProductCall) => Promise<T>): Promise<T> {
      const result = await operation(Object.freeze({ principal, credentialGeneration: 1, signal: controller.signal }))
      if (options.abortAfterIdentity === true) controller.abort()
      return result
    },
  }
  return { value, revoke, retire: () => { controller.abort() } }
}

function serverWith(leases: readonly AuthenticatedProductPrincipalLease[]) {
  const authenticate = vi.fn(async () => {
    const next = leases[authenticate.mock.calls.length - 1]
    if (next === undefined) throw new Error('No product lease scripted')
    return next
  })
  const ctx = { on: vi.fn(() => () => undefined), agents: { create: vi.fn(), get: vi.fn() }, teamRuns: {},
    get: (name: string) => name === 'productPrincipals' ? { authenticate }
      : name === 'teams' ? { getMetrics: () => ({ activeAdmissions: 0 }) }
        : { listProviders: () => [{ id: 'test', name: 'test' }] },
  } as unknown as Context
  const server = new HarnessSdkJsonRpcServer(ctx, { request: vi.fn(), notify: vi.fn() })
  const initialize = async (credential: string) => await server.initialize({ credential, cwd: process.cwd(), provider: 'test', model: 'test' })
  return { server, authenticate, initialize }
}

it('preserves an issuer-required authentication failure during initialization', async () => {
  const { server, authenticate, initialize } = serverWith([])
  authenticate.mockRejectedValueOnce(new ProductPrincipalError('Credential required', 'PRODUCT_AUTH_REQUIRED'))
  try {
    await expect(initialize('missing')).rejects.toMatchObject({ data: { code: 'PRODUCT_AUTH_REQUIRED' } })
    await expect(server.handleRequest('team/metrics', {})).rejects.toMatchObject({ data: { code: 'PRODUCT_AUTH_REQUIRED' } })
  } finally { await server.shutdown() }
})

it('rejects an authentication lease retired before its route becomes available', async () => {
  const retired = lease('retired', { abortAfterIdentity: true })
  const { server, initialize } = serverWith([retired.value])
  try {
    await expect(initialize('retired')).rejects.toMatchObject({ data: { code: 'PRODUCT_AUTH_INVALID' } })
    await expect(server.handleRequest('team/metrics', {})).rejects.toMatchObject({ data: { code: 'PRODUCT_AUTH_REQUIRED' } })
    expect(retired.revoke).toHaveBeenCalledOnce()
  } finally {
    await server.shutdown()
  }
})

it('keeps a newly authenticated connection usable when the replaced lease revocation fails', async () => {
  const previous = lease('previous', { revokeFailure: new Error('Old lease cleanup failed') })
  const current = lease('current')
  const { server, initialize, authenticate } = serverWith([previous.value, current.value])
  try {
    await initialize('previous')
    await initialize('current')
    expect(authenticate).toHaveBeenCalledTimes(2)
    expect(previous.revoke).toHaveBeenCalledOnce()
    await expect(server.handleRequest('team/metrics', {})).resolves.toEqual({ activeAdmissions: 0 })
  } finally {
    await server.shutdown()
  }
  expect(current.revoke).toHaveBeenCalledOnce()
})

it('contains rejection from a credential lease already retired by its issuer', async () => {
  const current = lease('current', { revokeFailure: new Error('Issuer cleanup failed after retirement') })
  const { server, initialize } = serverWith([current.value])
  await initialize('current')
  current.retire()
  await expect(server.handleRequest('team/metrics', {})).rejects.toMatchObject({
    data: { code: 'PRODUCT_AUTH_REQUIRED' },
  })
  expect(current.revoke).toHaveBeenCalledOnce()
  await server.shutdown()
})
