/** Default-browser startup over a real Loader tree and listening Web server. */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@clocky/cordis'
import Include from '@clocky/cordis-plugin-include'
import Loader from '@clocky/cordis-plugin-loader'
import WebServer from '@clocky/clocky-host-webserver'
import type {} from '@clocky/clocky-product-principal'
import { apply, internals } from '../src/index.ts'

const contexts: Context[] = []
const tempRoots: string[] = []
const originalResolveDistIndex = internals.resolveDistIndex
const originalOpenBrowser = internals.openBrowser
const TEST_TEMP_ROOT = join(process.cwd(), '.tmp', 'p0-security-audit')

beforeEach(() => {
  vi.stubEnv('SSH_CONNECTION', '')
  vi.stubEnv('SSH_TTY', '')
})

afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true })
  internals.resolveDistIndex = originalResolveDistIndex
  internals.openBrowser = originalOpenBrowser
  vi.unstubAllEnvs()
  Reflect.deleteProperty(globalThis, '__clockyWebAppApply')
  Reflect.deleteProperty(globalThis, '__clockyWebServer')
})

describe('web app browser startup', () => {
  it('opens the canonical URL only after the complete page is reachable', async () => {
    mkdirSync(TEST_TEMP_ROOT, { recursive: true, mode: 0o700 })
    const root = mkdtempSync(join(TEST_TEMP_ROOT, 'clocky-web-browser-open-'))
    tempRoots.push(root)
    const dist = join(root, 'dist')
    mkdirSync(dist)
    const index = join(dist, 'index.html')
    writeFileSync(index, '<!doctype html><title>ready</title>')
    internals.resolveDistIndex = () => index

    const webserverModule = join(root, 'webserver.mjs')
    const webAppModule = join(root, 'web-app.mjs')
    writeFileSync(webserverModule, 'export default globalThis.__clockyWebServer\n')
    writeFileSync(webAppModule, [
      "export const name = 'fixture-web-app'",
      "export const inject = ['webServer']",
      'export const apply = (ctx, config) => globalThis.__clockyWebAppApply(ctx, config)',
      '',
    ].join('\n'))
    const config = join(root, 'cordis.yml')
    writeFileSync(config, [
      '- id: webserver',
      `  name: ${pathToFileURL(webserverModule).href}`,
      '  config:',
      '    host: 127.0.0.1',
      '    port: 0',
      '- id: web-app',
      `  name: ${pathToFileURL(webAppModule).href}`,
      '  config:',
      '    openBrowser: true',
      '    printUrl: false',
      '    surfaceContext: false',
      '    trustedHosts: []',
      '',
    ].join('\n'))

    const globals = globalThis as unknown as {
      __clockyWebAppApply: typeof apply
      __clockyWebServer: typeof WebServer
    }
    globals.__clockyWebAppApply = apply
    globals.__clockyWebServer = WebServer

    let openedUrl: string | undefined
    let openedCredential: string | undefined
    let openedStatus: number | undefined
    let resolveOpened!: () => void
    const opened = new Promise<void>((resolve) => { resolveOpened = resolve })
    internals.openBrowser = async (url, credential) => {
      openedUrl = url
      openedCredential = credential
      openedStatus = (await fetch(url)).status
      resolveOpened()
    }

    const ctx = new Context()
    contexts.push(ctx)
    ctx.provide('productPrincipals', {
      bootstrapCredential: (provider: string) => {
        if (provider !== 'local') throw new Error('unexpected product-principal provider')
        return 'browser-open-test-credential'
      },
    } as never)
    await ctx.plugin(Loader)
    ctx.loader.builtins.include = Include
    await ctx.loader.create({
      name: 'cordis:include',
      config: { path: pathToFileURL(config).href },
    })
    await ctx.loader.await()
    await opened

    expect(openedUrl).toBe(`http://127.0.0.1:${String(ctx.webServer.port)}`)
    expect(openedCredential).toBe('browser-open-test-credential')
    expect(openedStatus).toBe(200)
  })
})
