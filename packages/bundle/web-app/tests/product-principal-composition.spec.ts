/** Shipped product-principal rows over a real Loader tree. */

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@clocky/cordis'
import Include from '@clocky/cordis-plugin-include'
import Loader from '@clocky/cordis-plugin-loader'
import { provideCmdline } from '@clocky/clocky-cmdline'
import ProductPrincipalRegistry from '@clocky/clocky-product-principal'
import * as LocalProductPrincipal from '@clocky/clocky-host-product-principal-local'
import * as WebStartup from '../src/startup.ts'

const PRODUCT_PRINCIPALS = '@clocky/clocky-product-principal'
const LOCAL_PROVIDER = '@clocky/clocky-host-product-principal-local'
const WEB_STARTUP = '@clocky/clocky-web-app/startup'
const packageRoot = fileURLToPath(new URL('..', import.meta.url))
const baseRoot = resolve(packageRoot, '../base')

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

/** Read one indented row from a bundle patch. */
function row(source: string, id: string): string {
  const start = source.indexOf(`    - id: ${id}\n`)
  if (start < 0) throw new Error(`missing composition row '${id}'`)
  const next = source.indexOf('\n    - id: ', start + 1)
  return source.slice(start, next < 0 ? source.length : next)
}

/** Boot the registry and shipped provider through the same Loader shape as Web. */
async function loadComposition(): Promise<Context> {
  root = await mkdtemp(join(process.cwd(), '.tmp-product-principal-composition-'))
  const configPath = join(root, 'cordis.yml')
  const statePath = join(root, 'product-principal.json')
  await writeFile(configPath, [
    '- id: product-principals',
    `  name: '${PRODUCT_PRINCIPALS}'`,
    '- id: product-principal-local',
    `  name: '${LOCAL_PROVIDER}'`,
    '  inject: [webStartup]',
    '  config:',
    `    path: '${statePath}'`,
    '- id: web-startup',
    `  name: '${WEB_STARTUP}'`,
    '',
  ].join('\n'))

  context = new Context()
  context.baseUrl = `${pathToFileURL(root).href}/`
  await context.plugin(Loader)
  provideCmdline(context, { args: ['--no-open'], exit: () => {} })
  context.loader.builtins.include = Include
  context.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (specifier === PRODUCT_PRINCIPALS) return ProductPrincipalRegistry
      if (specifier === LOCAL_PROVIDER) return LocalProductPrincipal
      if (specifier === WEB_STARTUP) return WebStartup
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

describe('shipped local product-principal composition', () => {
  it('mounts the shared seam in base and the local provider only in the Web Host layer', async () => {
    const [basePatch, webPatch, headlessPatch] = await Promise.all([
      readFile(join(baseRoot, 'cordis.patch.yml'), 'utf8'),
      readFile(join(packageRoot, 'cordis.patch.yml'), 'utf8'),
      readFile(join(packageRoot, '../headless/cordis.patch.yml'), 'utf8'),
    ])
    const baseManifest = JSON.parse(await readFile(join(baseRoot, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>
    }
    const webManifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>
    }

    expect(row(basePatch, 'product-principals')).toContain(`name: '${PRODUCT_PRINCIPALS}'`)
    expect(row(webPatch, 'product-principal-local')).toContain(`name: '${LOCAL_PROVIDER}'`)
    expect(row(webPatch, 'product-principal-local')).toContain('inject: [webStartup]')
    expect(row(webPatch, 'api-gateway')).toContain('inject: [teamHumanActors]')
    expect(webPatch.indexOf('    - id: product-principal-local')).toBeLessThan(webPatch.indexOf('    - id: api-gateway'))
    expect(headlessPatch).not.toContain(LOCAL_PROVIDER)
    expect(baseManifest.dependencies[PRODUCT_PRINCIPALS]).toBe('workspace:^')
    expect(webManifest.dependencies[LOCAL_PROVIDER]).toBe('workspace:^')

    const ctx = await loadComposition()
    expect(ctx.productPrincipals.listProviders()).toEqual([{ name: 'local' }])
    const credential = ctx.productPrincipals.bootstrapCredential('local')
    const lease = await ctx.productPrincipals.authenticate({ provider: 'local', credential })
    await expect(lease.withCall(async call => call.principal)).resolves.toMatchObject({
      issuer: 'local', subject: 'local-user', assurance: 'local-bootstrap', credentialGeneration: 1,
    })

    const providerEntry = [...ctx.loader.entries()].find(entry => entry.options.id === 'product-principal-local')
    expect(providerEntry?.fiber).toBeDefined()
    await providerEntry!.fiber!.dispose()
    expect(ctx.productPrincipals.listProviders()).toEqual([])
    await expect(lease.withCall(async call => call.principal)).rejects.toMatchObject({ code: 'PRODUCT_AUTH_INVALID' })
  })
})
