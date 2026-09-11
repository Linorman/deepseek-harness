import { describe, expect, it, vi } from 'vitest'
import { Context } from '@clocky/cordis'
import ProductPrincipalRegistry, { ProductPrincipalError, productPrincipalId } from '../src/index.ts'
import type {
  ProductPrincipalBootstrapProvider,
  ProductPrincipalProviderLease,
} from '../src/index.ts'

interface ProviderHarness {
  readonly provider: ProductPrincipalBootstrapProvider
  readonly revoke: ReturnType<typeof vi.fn>
}

function provider(secret = 'test-product-secret'): ProviderHarness {
  const revoke = vi.fn()
  return {
    provider: {
      name: 'local',
      bootstrapCredential() { return secret },
      async authenticate(request): Promise<ProductPrincipalProviderLease> {
        if (request.credential !== secret) throw new Error(`credential rejected: ${request.credential ?? 'missing'}`)
        const controller = new AbortController()
        return {
          principal: {
            id: productPrincipalId('principal-local'),
            issuer: 'local',
            subject: 'single-user',
            assurance: 'local-bootstrap',
            credentialGeneration: 1,
          },
          signal: controller.signal,
          revoke: () => {
            revoke()
            controller.abort()
          },
        }
      },
    },
    revoke,
  }
}

async function setup(): Promise<{ readonly ctx: Context; readonly fiber: Context['fiber'] }> {
  const ctx = new Context()
  const fiber = await ctx.plugin(ProductPrincipalRegistry)
  return { ctx, fiber }
}

describe('ProductPrincipalRegistry', () => {
  it('registers named providers and exposes a fresh immutable call context for each admitted operation', async () => {
    const { ctx, fiber } = await setup()
    const source = provider()
    const dispose = ctx.productPrincipals.registerProvider(source.provider)

    expect(ctx.productPrincipals.listProviders()).toEqual([{ name: 'local' }])
    expect(ctx.productPrincipals.bootstrapCredential('local')).toBe('test-product-secret')
    const lease = await ctx.productPrincipals.authenticate({ provider: 'local', credential: 'test-product-secret' })
    const first = await lease.withCall(async call => call)
    const second = await lease.withCall(async call => call)

    expect(first).toMatchObject({
      principal: { id: 'principal-local', issuer: 'local', credentialGeneration: 1 },
      credentialGeneration: 1,
    })
    expect(first).not.toBe(second)
    expect(first.principal).not.toBe(second.principal)
    expect(Object.isFrozen(first)).toBe(true)
    expect(Object.isFrozen(first.principal)).toBe(true)
    expect(first.signal.aborted).toBe(false)

    await dispose()
    await dispose()
    expect(ctx.productPrincipals.listProviders()).toEqual([])
    await expect(lease.withCall(async () => 'unreachable')).rejects.toMatchObject({ code: 'PRODUCT_AUTH_INVALID' })
    expect(source.revoke).toHaveBeenCalledOnce()
    expect(() => ctx.productPrincipals.bootstrapCredential('local')).toThrow(expect.objectContaining({
      code: 'PRODUCT_AUTH_INVALID',
    }))

    await fiber.dispose()
    await ctx.fiber.dispose()
  })

  it('detaches principal facts at authentication instead of observing provider mutations later', async () => {
    const { ctx, fiber } = await setup()
    const mutablePrincipal = {
      id: productPrincipalId('mutable-principal'),
      issuer: 'mutable',
      subject: 'before',
      assurance: 'test',
      credentialGeneration: 1,
    }
    ctx.productPrincipals.registerProvider({
      name: 'mutable',
      authenticate: async () => ({
        principal: mutablePrincipal,
        signal: new AbortController().signal,
        revoke: () => {},
      }),
    })
    const lease = await ctx.productPrincipals.authenticate({ provider: 'mutable', credential: 'secret' })
    mutablePrincipal.subject = 'after'
    await expect(lease.withCall(async call => call.principal.subject)).resolves.toBe('before')

    await fiber.dispose()
    await ctx.fiber.dispose()
  })

  it('stops new calls while provider retirement waits for an already admitted call', async () => {
    const { ctx, fiber } = await setup()
    const source = provider()
    const dispose = ctx.productPrincipals.registerProvider(source.provider)
    const lease = await ctx.productPrincipals.authenticate({ provider: 'local', credential: 'test-product-secret' })
    let complete!: () => void
    const admitted = lease.withCall(async () => await new Promise<string>((resolve) => {
      complete = () => { resolve('settled') }
    }))
    await vi.waitFor(() => {
      expect(complete).toBeTypeOf('function')
    })

    const retiring = dispose()
    await expect(lease.withCall(async () => 'unreachable')).rejects.toMatchObject({ code: 'PRODUCT_AUTH_INVALID' })
    expect(source.revoke).not.toHaveBeenCalled()

    complete()
    await expect(admitted).resolves.toBe('settled')
    await retiring
    expect(source.revoke).toHaveBeenCalledOnce()

    await fiber.dispose()
    await ctx.fiber.dispose()
  })

  it('maps missing, malformed, and provider-thrown authentication failures without echoing credential material', async () => {
    const { ctx, fiber } = await setup()
    ctx.productPrincipals.registerProvider(provider().provider)
    const secret = 'do-not-render-this-product-secret'

    await expect(ctx.productPrincipals.authenticate({ provider: 'local' })).rejects.toMatchObject({ code: 'PRODUCT_AUTH_REQUIRED' })
    await expect(ctx.productPrincipals.authenticate({ provider: 'missing', credential: secret })).rejects.toMatchObject({
      code: 'PRODUCT_AUTH_INVALID',
    })
    await expect(ctx.productPrincipals.authenticate({ provider: 'local', credential: secret })).rejects.toMatchObject({
      code: 'PRODUCT_AUTH_INVALID',
    })
    try {
      await ctx.productPrincipals.authenticate({ provider: 'local', credential: secret })
    } catch (error: unknown) {
      expect(String(error)).not.toContain(secret)
      expect(error).toBeInstanceOf(ProductPrincipalError)
    }

    await fiber.dispose()
    await ctx.fiber.dispose()
  })

  it('rejects duplicate provider registration before replacing the accepting provider', async () => {
    const { ctx, fiber } = await setup()
    const first = provider()
    ctx.productPrincipals.registerProvider(first.provider)

    expect(() => ctx.productPrincipals.registerProvider(provider().provider)).toThrow(expect.objectContaining({
      code: 'PRODUCT_PRINCIPAL_PROVIDER_DUPLICATE',
    }))
    expect(ctx.productPrincipals.listProviders()).toEqual([{ name: 'local' }])

    await fiber.dispose()
    await ctx.fiber.dispose()
  })

  it('revokes a provider lease whose principal facts fail registry validation', async () => {
    const { ctx, fiber } = await setup()
    const revoke = vi.fn()
    ctx.productPrincipals.registerProvider({
      name: 'malformed',
      authenticate: async () => ({
        principal: {
          id: '' as never, issuer: 'malformed', subject: 'user', assurance: 'test', credentialGeneration: 1,
        },
        signal: new AbortController().signal,
        revoke,
      }),
    })

    await expect(ctx.productPrincipals.authenticate({ provider: 'malformed', credential: 'secret' }))
      .rejects.toMatchObject({ code: 'PRODUCT_AUTH_INVALID' })
    expect(revoke).toHaveBeenCalledOnce()

    await fiber.dispose()
    await ctx.fiber.dispose()
  })

  it('revokes a lease when its provider validation fails before a call is admitted', async () => {
    const { ctx, fiber } = await setup()
    const revoke = vi.fn()
    ctx.productPrincipals.registerProvider({
      name: 'validation-failure',
      authenticate: async () => ({
        principal: {
          id: productPrincipalId('validation-principal'),
          issuer: 'validation-failure',
          subject: 'user',
          assurance: 'test',
          credentialGeneration: 1,
        },
        signal: new AbortController().signal,
        validate: () => { throw new Error('validation failed') },
        revoke,
      }),
    })

    const lease = await ctx.productPrincipals.authenticate({ provider: 'validation-failure', credential: 'secret' })
    await expect(lease.withCall(async () => 'unreachable')).rejects.toMatchObject({ code: 'PRODUCT_AUTH_INVALID' })
    expect(revoke).toHaveBeenCalledOnce()
    await expect(lease.withCall(async () => 'unreachable')).rejects.toMatchObject({ code: 'PRODUCT_AUTH_INVALID' })
    expect(revoke).toHaveBeenCalledOnce()

    await fiber.dispose()
    await ctx.fiber.dispose()
  })

  it('rejects malformed provider leases and principal facts without retaining them', async () => {
    const { ctx, fiber } = await setup()
    const validSignal = new AbortController().signal
    const validPrincipal = {
      id: productPrincipalId('malformed-test-principal'),
      issuer: 'malformed-test',
      subject: 'user',
      assurance: 'test',
      credentialGeneration: 1,
    }
    const cases: readonly [string, unknown][] = [
      ['null-lease', null],
      ['empty-lease', {}],
      ['null-principal', { principal: null, signal: validSignal, revoke: vi.fn() }],
      ['array-principal', { principal: [], signal: validSignal, revoke: vi.fn() }],
      ['bad-generation', { principal: { ...validPrincipal, credentialGeneration: 0 }, signal: validSignal, revoke: vi.fn() }],
    ]
    for (const [name, result] of cases) {
      const revoke = typeof result === 'object' && result !== null && 'revoke' in result
        ? (result as { revoke: ReturnType<typeof vi.fn> }).revoke
        : undefined
      ctx.productPrincipals.registerProvider({
        name,
        authenticate: async () => result as never,
      })
      await expect(ctx.productPrincipals.authenticate({ provider: name, credential: 'secret' }))
        .rejects.toMatchObject({ code: 'PRODUCT_AUTH_INVALID' })
      if (revoke !== undefined) expect(revoke).toHaveBeenCalledOnce()
    }
    ctx.productPrincipals.registerProvider({
      name: 'malformed-cleanup',
      authenticate: async () => ({
        principal: {
          id: '' as never, issuer: 'malformed-cleanup', subject: 'user', assurance: 'test', credentialGeneration: 1,
        },
        signal: validSignal,
        revoke: async () => { throw new Error('cleanup failed') },
      }),
    })
    await expect(ctx.productPrincipals.authenticate({ provider: 'malformed-cleanup', credential: 'secret' }))
      .rejects.toMatchObject({ code: 'PRODUCT_AUTH_INVALID' })

    await fiber.dispose()
    await ctx.fiber.dispose()
  })

  it('handles provider and carrier aborts while retaining no callable lease', async () => {
    const { ctx, fiber } = await setup()
    const providerController = new AbortController()
    const revoke = vi.fn()
    ctx.productPrincipals.registerProvider({
      name: 'abortable',
      authenticate: async (request) => {
        if (request.signal?.aborted === true) throw new Error('aborted')
        return {
          principal: {
            id: productPrincipalId('abortable-principal'),
            issuer: 'abortable',
            subject: 'user',
            assurance: 'test',
            credentialGeneration: 1,
          },
          signal: providerController.signal,
          revoke,
        }
      },
    })
    const lease = await ctx.productPrincipals.authenticate({
      provider: 'abortable', credential: 'secret', signal: new AbortController().signal,
    })
    const carrier = new AbortController()
    await expect(lease.withCall(async (call) => {
      carrier.abort()
      await Promise.resolve()
      expect(call.signal.aborted).toBe(true)
      return 'carrier-aborted'
    }, carrier.signal)).resolves.toBe('carrier-aborted')
    const abortedCarrier = new AbortController()
    abortedCarrier.abort()
    await expect(lease.withCall(async () => 'unreachable', abortedCarrier.signal))
      .rejects.toMatchObject({ code: 'PRODUCT_AUTH_INVALID' })
    providerController.abort()
    await expect(lease.withCall(async () => 'unreachable')).rejects.toMatchObject({ code: 'PRODUCT_AUTH_INVALID' })
    expect(revoke).toHaveBeenCalledOnce()

    const alreadyAborted = new AbortController()
    alreadyAborted.abort()
    await expect(lease.withCall(async () => 'unreachable', alreadyAborted.signal))
      .rejects.toMatchObject({ code: 'PRODUCT_AUTH_INVALID' })

    await fiber.dispose()
    await ctx.fiber.dispose()
  })

  it('revokes a lease when the provider retires it during validation and rejects aborted authentication', async () => {
    const { ctx, fiber } = await setup()
    const controller = new AbortController()
    const revoke = vi.fn()
    ctx.productPrincipals.registerProvider({
      name: 'validating-abort',
      authenticate: async () => ({
        principal: {
          id: productPrincipalId('validating-abort-principal'),
          issuer: 'validating-abort',
          subject: 'user',
          assurance: 'test',
          credentialGeneration: 1,
        },
        signal: controller.signal,
        validate: () => { controller.abort() },
        revoke,
      }),
    })
    const lease = await ctx.productPrincipals.authenticate({ provider: 'validating-abort', credential: 'secret' })
    await expect(lease.withCall(async () => 'unreachable')).rejects.toMatchObject({ code: 'PRODUCT_AUTH_INVALID' })
    expect(revoke).toHaveBeenCalledOnce()

    const aborted = new AbortController()
    aborted.abort()
    await expect(ctx.productPrincipals.authenticate({ provider: 'validating-abort', credential: 'secret', signal: aborted.signal }))
      .rejects.toMatchObject({ code: 'PRODUCT_AUTH_INVALID' })

    await fiber.dispose()
    await ctx.fiber.dispose()
  })

  it('rejects invalid provider registrations, empty bootstrap credentials, and retired in-flight authentication', async () => {
    const { ctx, fiber } = await setup()
    expect(() => ctx.productPrincipals.registerProvider({ name: 'invalid', authenticate: undefined } as never))
      .toThrow(expect.objectContaining({ code: 'PRODUCT_PRINCIPAL_PROVIDER_INVALID' }))
    ctx.productPrincipals.registerProvider({
      name: 'empty-bootstrap',
      bootstrapCredential: () => '',
      authenticate: async () => { throw new Error('not used') },
    } as ProductPrincipalBootstrapProvider)
    expect(() => ctx.productPrincipals.bootstrapCredential('empty-bootstrap'))
      .toThrow(expect.objectContaining({ code: 'PRODUCT_AUTH_INVALID' }))

    const pending = Promise.withResolvers<ProductPrincipalProviderLease>()
    const revoke = vi.fn()
    const dispose = ctx.productPrincipals.registerProvider({
      name: 'retired-during-auth',
      authenticate: async () => await pending.promise,
    })
    const authentication = ctx.productPrincipals.authenticate({ provider: 'retired-during-auth', credential: 'secret' })
    const retiring = dispose()
    pending.resolve({
      principal: {
        id: productPrincipalId('retired-principal'),
        issuer: 'retired-during-auth',
        subject: 'user',
        assurance: 'test',
        credentialGeneration: 1,
      },
      signal: new AbortController().signal,
      revoke,
    })
    await expect(authentication).rejects.toMatchObject({ code: 'PRODUCT_AUTH_INVALID' })
    await retiring
    expect(revoke).toHaveBeenCalledOnce()

    await fiber.dispose()
    await ctx.fiber.dispose()
  })

  it('maps a required provider error and contains provider cleanup failures', async () => {
    const { ctx, fiber } = await setup()
    ctx.productPrincipals.registerProvider({
      name: 'required-error',
      authenticate: async () => { throw new ProductPrincipalError('required', 'PRODUCT_AUTH_REQUIRED') },
    })
    await expect(ctx.productPrincipals.authenticate({ provider: 'required-error', credential: 'secret' }))
      .rejects.toMatchObject({ code: 'PRODUCT_AUTH_REQUIRED' })

    const pending = Promise.withResolvers<ProductPrincipalProviderLease>()
    const dispose = ctx.productPrincipals.registerProvider({
      name: 'retired-cleanup-error',
      authenticate: async () => await pending.promise,
    })
    const authentication = ctx.productPrincipals.authenticate({ provider: 'retired-cleanup-error', credential: 'secret' })
    const retiring = dispose()
    pending.resolve({
      principal: {
        id: productPrincipalId('retired-cleanup-principal'),
        issuer: 'retired-cleanup-error',
        subject: 'user',
        assurance: 'test',
        credentialGeneration: 1,
      },
      signal: new AbortController().signal,
      revoke: async () => { throw new Error('cleanup failed') },
    })
    await expect(authentication).rejects.toMatchObject({ code: 'PRODUCT_AUTH_INVALID' })
    await retiring

    const malformedPending = Promise.withResolvers<unknown>()
    const malformedDispose = ctx.productPrincipals.registerProvider({
      name: 'retired-malformed-lease',
      authenticate: async () => await malformedPending.promise as never,
    })
    const malformedAuthentication = ctx.productPrincipals.authenticate({ provider: 'retired-malformed-lease', credential: 'secret' })
    const malformedRetiring = malformedDispose()
    malformedPending.resolve(null)
    await expect(malformedAuthentication).rejects.toMatchObject({ code: 'PRODUCT_AUTH_INVALID' })
    await malformedRetiring

    await fiber.dispose()
    await ctx.fiber.dispose()
  })
})
