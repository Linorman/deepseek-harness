import { afterEach, describe, expect, it, vi } from 'vitest'
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { Context } from '@clocky/cordis'
import ProductPrincipalRegistry from '@clocky/clocky-product-principal'
import * as LocalProductPrincipal from '../src/index.ts'

const temporaryRoots: string[] = []

async function statePath(): Promise<string> {
  const root = await mkdtemp(join(process.cwd(), '.tmp-product-principal-local-'))
  temporaryRoots.push(root)
  return join(root, 'private', 'principal.json')
}

afterEach(async () => {
  vi.unstubAllEnvs()
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('LocalProductPrincipalProvider', () => {
  it('persists a stable non-secret principal while rotating a 256-bit credential generation', async () => {
    const path = await statePath()
    const provider = await LocalProductPrincipal.LocalProductPrincipalProvider.open(
      LocalProductPrincipal.resolveLocalProductPrincipalSpec({ path }),
    )
    try {
      const credential = provider.bootstrapCredential()
      const lease = await provider.authenticate({ credential })
      const before = lease.principal
      const stored = await readFile(path, 'utf8')

      expect(credential).toHaveLength(43)
      expect(stored).not.toContain(credential)
      const persisted: unknown = JSON.parse(stored) as unknown
      expect(persisted).toMatchObject({
        version: 1,
        principalId: before.id,
        credentialGeneration: before.credentialGeneration,
      })
      expect(stored).toMatch(/"credentialDigest":"[a-f0-9]{64}"/)
      /* v8 ignore next -- Windows ACLs do not expose POSIX mode bits. */
      if (process.platform !== 'win32') expect((await stat(path)).mode & 0o077).toBe(0)

      await provider.rotateBootstrapCredential()
      const nextCredential = provider.bootstrapCredential()
      const nextLease = await provider.authenticate({ credential: nextCredential })

      expect(nextCredential).not.toBe(credential)
      expect(lease.signal.aborted).toBe(true)
      expect(nextLease.principal.id).toBe(before.id)
      expect(nextLease.principal.credentialGeneration).toBe(before.credentialGeneration + 1)
      await expect(provider.authenticate({ credential })).rejects.toMatchObject({ code: 'PRODUCT_AUTH_INVALID' })
      expect(await readFile(path, 'utf8')).not.toContain(nextCredential)
    } finally {
      await provider.close()
    }
  })

  it('invalidates an earlier process generation while retaining its stable principal id', async () => {
    const path = await statePath()
    const first = await LocalProductPrincipal.LocalProductPrincipalProvider.open(
      LocalProductPrincipal.resolveLocalProductPrincipalSpec({ path }),
    )
    const firstCredential = first.bootstrapCredential()
    const firstLease = await first.authenticate({ credential: firstCredential })
    await first.close()

    const replacement = await LocalProductPrincipal.LocalProductPrincipalProvider.open(
      LocalProductPrincipal.resolveLocalProductPrincipalSpec({ path }),
    )
    try {
      const secondCredential = replacement.bootstrapCredential()
      const secondLease = await replacement.authenticate({ credential: secondCredential })

      expect(secondCredential).not.toBe(firstCredential)
      expect(secondLease.principal.id).toBe(firstLease.principal.id)
      expect(secondLease.principal.credentialGeneration).toBe(firstLease.principal.credentialGeneration + 1)
      await expect(replacement.authenticate({ credential: firstCredential })).rejects.toMatchObject({ code: 'PRODUCT_AUTH_INVALID' })
      await expect(first.rotateBootstrapCredential()).rejects.toMatchObject({ code: 'PRODUCT_AUTH_INVALID' })
    } finally {
      await replacement.close()
    }
  })

  it('revokes a live provider generation when another Host rotates the same state path', async () => {
    const path = await statePath()
    const first = await LocalProductPrincipal.LocalProductPrincipalProvider.open(
      LocalProductPrincipal.resolveLocalProductPrincipalSpec({ path }),
    )
    const firstCredential = first.bootstrapCredential()
    const firstLease = await first.authenticate({ credential: firstCredential })
    const replacement = await LocalProductPrincipal.LocalProductPrincipalProvider.open(
      LocalProductPrincipal.resolveLocalProductPrincipalSpec({ path }),
    )
    try {
      await expect(first.rotateBootstrapCredential()).rejects.toMatchObject({ code: 'PRODUCT_AUTH_INVALID' })
      await expect(first.authenticate({ credential: firstCredential })).rejects.toMatchObject({ code: 'PRODUCT_AUTH_INVALID' })
      if (firstLease.validate === undefined) throw new Error('local credential lease lacks generation validation')
      await expect(firstLease.validate()).rejects.toMatchObject({ code: 'PRODUCT_AUTH_INVALID' })
      expect(firstLease.signal.aborted).toBe(true)
      await expect(replacement.authenticate({ credential: replacement.bootstrapCredential() })).resolves.toMatchObject({
        principal: { id: firstLease.principal.id },
      })
    } finally {
      await first.close()
      await replacement.close()
    }
  })

  it('rejects malformed private state and invalid provider configuration before opening', async () => {
    const valid = JSON.stringify({
      version: 1,
      principalId: 'valid-principal',
      credentialGeneration: 1,
      credentialDigest: 'a'.repeat(64),
    })
    const malformed = [
      'not-json',
      'null',
      '{}',
      valid.replace('"version":1', '"version":2'),
      valid.replace('valid-principal', ' invalid '),
      valid.replace('"credentialGeneration":1', '"credentialGeneration":0'),
    ]
    for (const source of malformed) {
      const path = await statePath()
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, source)
      await chmod(path, 0o600)
      await expect(LocalProductPrincipal.LocalProductPrincipalProvider.open(
        LocalProductPrincipal.resolveLocalProductPrincipalSpec({ path }),
      )).rejects.toThrow(/malformed/u)
    }
    expect(() => LocalProductPrincipal.resolveLocalProductPrincipalSpec({ providerName: ' invalid ' }))
      .toThrow(/providerName/u)
    const root = await mkdtemp(join(process.cwd(), '.tmp-product-principal-local-home-'))
    temporaryRoots.push(root)
    vi.stubEnv('CLOCKY_HOME', root)
    const fallback = LocalProductPrincipal.resolveLocalProductPrincipalSpec()
    expect(fallback.path).toBe(join(root, LocalProductPrincipal.PRODUCT_PRINCIPAL_STATE_FILENAME))
  })

  it('contains lease revocation, missing state, and failed rotation paths', async () => {
    const path = await statePath()
    const provider = await LocalProductPrincipal.LocalProductPrincipalProvider.open(
      LocalProductPrincipal.resolveLocalProductPrincipalSpec({ path }),
    )
    const lease = await provider.authenticate({ credential: provider.bootstrapCredential() })
    const aborted = new AbortController()
    aborted.abort()
    await expect(provider.authenticate({ credential: provider.bootstrapCredential(), signal: aborted.signal }))
      .rejects.toMatchObject({ code: 'PRODUCT_AUTH_INVALID' })
    await lease.revoke()
    await lease.revoke()
    await expect(lease.validate?.()).rejects.toMatchObject({ code: 'PRODUCT_AUTH_INVALID' })
    await provider.close()
    await expect(provider.authenticate({ credential: 'anything' })).rejects.toMatchObject({ code: 'PRODUCT_AUTH_INVALID' })
    await expect(provider.rotateBootstrapCredential()).rejects.toMatchObject({ code: 'PRODUCT_AUTH_INVALID' })
    expect(() => provider.bootstrapCredential()).toThrow(expect.objectContaining({ code: 'PRODUCT_AUTH_INVALID' }))

    const secondPath = await statePath()
    const second = await LocalProductPrincipal.LocalProductPrincipalProvider.open(
      LocalProductPrincipal.resolveLocalProductPrincipalSpec({ path: secondPath }),
    )
    const secondLease = await second.authenticate({ credential: second.bootstrapCredential() })
    await writeFile(secondPath, 'not-json')
    await chmod(secondPath, 0o600)
    await expect(secondLease.validate?.()).rejects.toMatchObject({ code: 'PRODUCT_AUTH_INVALID' })
    await expect(second.rotateBootstrapCredential()).rejects.toMatchObject({ code: 'PRODUCT_AUTH_INVALID' })
    await second.close()

    const missingPath = await statePath()
    const missing = await LocalProductPrincipal.LocalProductPrincipalProvider.open(
      LocalProductPrincipal.resolveLocalProductPrincipalSpec({ path: missingPath }),
    )
    const missingLease = await missing.authenticate({ credential: missing.bootstrapCredential() })
    await rm(missingPath)
    await expect(missingLease.validate?.()).rejects.toMatchObject({ code: 'PRODUCT_AUTH_INVALID' })
    await missing.close()
  })

  it('retries concurrent stale-generation invalidation and rejects a malformed digest state', async () => {
    const path = await statePath()
    const provider = await LocalProductPrincipal.LocalProductPrincipalProvider.open(
      LocalProductPrincipal.resolveLocalProductPrincipalSpec({ path }),
    )
    const lease = await provider.authenticate({ credential: provider.bootstrapCredential() })
    const state = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>
    state.credentialDigest = 'b'.repeat(64)
    await writeFile(path, `${JSON.stringify(state)}\n`)
    await Promise.allSettled([lease.validate?.(), lease.validate?.()])
    await provider.close()
  })

  it('applies with default configuration under an explicit temporary home', async () => {
    const root = await mkdtemp(join(process.cwd(), '.tmp-product-principal-local-home-'))
    temporaryRoots.push(root)
    vi.stubEnv('CLOCKY_HOME', root)
    const ctx = new Context()
    const core = await ctx.plugin(ProductPrincipalRegistry)
    await LocalProductPrincipal.apply(ctx)
    expect(ctx.productPrincipals.listProviders()).toEqual([{ name: 'local' }])
    await core.dispose()
    await ctx.fiber.dispose()
  })

  it('rejects absent and bad credentials without exposing a supplied secret', async () => {
    const path = await statePath()
    const provider = await LocalProductPrincipal.LocalProductPrincipalProvider.open(
      LocalProductPrincipal.resolveLocalProductPrincipalSpec({ path }),
    )
    const secret = 'never-include-this-secret-in-a-diagnostic'
    try {
      await expect(provider.authenticate({})).rejects.toMatchObject({ code: 'PRODUCT_AUTH_REQUIRED' })
      await expect(provider.authenticate({ credential: secret })).rejects.toMatchObject({ code: 'PRODUCT_AUTH_INVALID' })
      try {
        await provider.authenticate({ credential: secret })
      } catch (error: unknown) {
        expect(String(error)).not.toContain(secret)
      }
    } finally {
      await provider.close()
    }
  })

  it('registers through the core seam and revokes a connection lease on provider disposal', async () => {
    const path = await statePath()
    const ctx = new Context()
    const core = await ctx.plugin(ProductPrincipalRegistry)
    const local = await ctx.plugin(LocalProductPrincipal, { path })
    const provider = ctx.productPrincipals.listProviders()[0]
    if (provider === undefined) throw new Error('local provider was not registered')

    try {
      const credential = ctx.productPrincipals.bootstrapCredential(provider.name)
      const lease = await ctx.productPrincipals.authenticate({ provider: provider.name, credential })
      await expect(lease.withCall(async call => call.principal.id)).resolves.toBeTypeOf('string')

      await local.dispose()
      await expect(lease.withCall(async () => 'unreachable')).rejects.toMatchObject({ code: 'PRODUCT_AUTH_INVALID' })
      expect(ctx.productPrincipals.listProviders()).toEqual([])
    } finally {
      await core.dispose()
      await ctx.fiber.dispose()
    }
  })
})
