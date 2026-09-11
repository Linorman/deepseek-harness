import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@clocky/cordis'
import Include from '@clocky/cordis-plugin-include'
import Loader from '@clocky/cordis-plugin-loader'
import ProductPrincipalRegistry from '@clocky/clocky-product-principal'
import * as DigestProductPrincipal from '../src/index.ts'

const CREDENTIAL = 'digest-provider-test-credential'
const PROVIDER_NAME = 'sdk-digest'
const runtimeConfigPath = fileURLToPath(new URL(
  '../../../../python/sdk-runtime/src/clocky_runtime/runtime/cordis.yml', import.meta.url,
))

let root: string | undefined
let context: Context | undefined

/** Return a deterministic non-secret digest used only by this test configuration. */
function digest(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

/** Create one configured provider spec that never retains the plaintext test credential. */
function config(overrides: Partial<DigestProductPrincipal.Config> = {}): DigestProductPrincipal.Config {
  return {
    providerName: PROVIDER_NAME,
    credentialSha256: digest(CREDENTIAL),
    principalId: 'sdk-test-principal',
    subject: 'sdk-test-subject',
    credentialGeneration: 7,
    ...overrides,
  }
}

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

/** Boot the provider through the Loader route used by deployment configuration. */
async function loadProvider(): Promise<Context> {
  root = await mkdtemp(join(process.cwd(), '.tmp-product-principal-digest-'))
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    '- id: product-principals',
    "  name: '@clocky/clocky-product-principal'",
    '- id: product-principal-digest',
    "  name: '@clocky/clocky-host-product-principal-digest'",
    '  config:',
    `    providerName: ${PROVIDER_NAME}`,
    `    credentialSha256: ${digest(CREDENTIAL)}`,
    '    principalId: sdk-test-principal',
    '    subject: sdk-test-subject',
    '    credentialGeneration: 7',
    '',
  ].join('\n'))
  context = new Context()
  context.baseUrl = `${pathToFileURL(root).href}/`
  await context.plugin(Loader)
  context.loader.builtins.include = Include
  context.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (specifier === '@clocky/clocky-product-principal') return ProductPrincipalRegistry
      if (specifier === '@clocky/clocky-host-product-principal-digest') return DigestProductPrincipal
      throw new Error(`unexpected Loader import '${specifier}'`)
    },
  } as unknown as NonNullable<typeof context.loader.internal>
  await context.loader.create({
    name: 'cordis:include',
    config: { path: pathToFileURL(configPath).href },
  })
  await context.loader.await()
  return context
}

describe('DigestProductPrincipalProvider', () => {
  it('authenticates only a matching plaintext handshake and retains only configured non-secret facts', async () => {
    const spec = DigestProductPrincipal.resolveDigestProductPrincipalSpec(config())
    expect(DigestProductPrincipal.resolveDigestProductPrincipalSpec(config({ providerName: undefined } as never)).providerName)
      .toBe(DigestProductPrincipal.DEFAULT_DIGEST_PRODUCT_PRINCIPAL_PROVIDER_NAME)
    const defaultGeneration = DigestProductPrincipal.resolveDigestProductPrincipalSpec(
      config({ credentialGeneration: undefined } as never),
    ).credentialGeneration
    expect(defaultGeneration)
      .toBe(1)
    const provider = new DigestProductPrincipal.DigestProductPrincipalProvider(spec)
    const lease = await provider.authenticate({ credential: CREDENTIAL })

    try {
      expect(await Promise.resolve(lease.validate?.())).toBeUndefined()
      expect(lease.principal).toMatchObject({
        id: 'sdk-test-principal',
        issuer: PROVIDER_NAME,
        subject: 'sdk-test-subject',
        assurance: DigestProductPrincipal.DIGEST_PRODUCT_PRINCIPAL_ASSURANCE,
        credentialGeneration: 7,
      })
      expect(JSON.stringify(spec)).not.toContain(CREDENTIAL)
      await expect(provider.authenticate({ credential: `${CREDENTIAL}-wrong` })).rejects.toMatchObject({
        code: 'PRODUCT_AUTH_INVALID',
      })
      try {
        await provider.authenticate({ credential: `${CREDENTIAL}-wrong` })
      } catch (error: unknown) {
        expect(String(error)).not.toContain(CREDENTIAL)
      }
      await expect(provider.authenticate({})).rejects.toMatchObject({ code: 'PRODUCT_AUTH_REQUIRED' })
      await lease.revoke()
      await lease.revoke()
    } finally {
      provider.close()
      provider.close()
    }
  })

  it('fails closed for malformed deployment configuration and revokes provider-owned leases', async () => {
    expect(() => DigestProductPrincipal.resolveDigestProductPrincipalSpec(
      config({ credentialSha256: 'not-a-sha256' }),
    )).toThrow('credentialSha256')
    expect(() => DigestProductPrincipal.resolveDigestProductPrincipalSpec(
      config({ principalId: ' invalid ' }),
    )).toThrow('principalId')
    expect(() => DigestProductPrincipal.resolveDigestProductPrincipalSpec(
      config({ credentialGeneration: 0 }),
    )).toThrow('credentialGeneration')

    const provider = new DigestProductPrincipal.DigestProductPrincipalProvider(
      DigestProductPrincipal.resolveDigestProductPrincipalSpec(config()),
    )
    const lease = await provider.authenticate({ credential: CREDENTIAL })

    await expect(provider.authenticate(new Proxy({ credential: CREDENTIAL }, {
      get() { throw 'non-error provider failure' },
    }) as never)).rejects.toMatchObject({ code: 'PRODUCT_AUTH_INVALID' })
    provider.close()
    provider.close()
    expect(lease.signal.aborted).toBe(true)
    await expect(Promise.resolve().then(() => lease.validate?.())).rejects.toMatchObject({ code: 'PRODUCT_AUTH_INVALID' })
    await expect(provider.authenticate({ credential: CREDENTIAL })).rejects.toMatchObject({ code: 'PRODUCT_AUTH_INVALID' })
  })

  it('loads through Cordis, exposes its configured name, and revokes a connection lease on disposal', async () => {
    const ctx = await loadProvider()
    expect(ctx.productPrincipals.listProviders()).toEqual([{ name: PROVIDER_NAME }])
    const lease = await ctx.productPrincipals.authenticate({ provider: PROVIDER_NAME, credential: CREDENTIAL })
    await expect(lease.withCall(async call => call.principal)).resolves.toMatchObject({
      id: 'sdk-test-principal', subject: 'sdk-test-subject', credentialGeneration: 7,
    })

    const entry = [...ctx.loader.entries()].find(value => value.options.id === 'product-principal-digest')
    expect(entry?.fiber).toBeDefined()
    await entry!.fiber!.dispose()
    expect(ctx.productPrincipals.listProviders()).toEqual([])
    await expect(lease.withCall(async () => 'unreachable')).rejects.toMatchObject({ code: 'PRODUCT_AUTH_INVALID' })
  })

  it('declares a digest-only provider and authenticated-human binder in the bundled SDK runtime', async () => {
    const [runtimeConfig, manifest] = await Promise.all([
      readFile(runtimeConfigPath, 'utf8'),
      readFile(fileURLToPath(new URL('../../../../python/sdk-runtime/package.json', import.meta.url)), 'utf8'),
    ])
    const manifestData = JSON.parse(manifest) as { readonly dependencies: Record<string, string> }

    expect(runtimeConfig).toContain("name: '@clocky/clocky-host-product-principal-digest'")
    expect(runtimeConfig).toContain('credentialSha256: !!js process.env.CLOCKY_PRODUCT_CREDENTIAL_SHA256')
    expect(runtimeConfig).toContain('productPrincipalProvider: sdk-digest')
    expect(runtimeConfig).toContain("name: '@clocky/clocky-team-human-actor'")
    expect(runtimeConfig).not.toContain("name: './sdk-product-principal.ts'")
    expect(manifestData.dependencies['@clocky/clocky-host-product-principal-digest']).toBe('workspace:^')
  })
})
