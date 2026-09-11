/** Published clocky web + pnpm dev:web → browser HMR, with no page reload. */

import { existsSync, globSync, statSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { chromium } from 'playwright'
import { expect, it } from 'vitest'
import { Context } from '@clocky/cordis'
import type { Fiber } from '@clocky/cordis'
import LocalSubprocessRuntime from '@clocky/clocky-subprocess-local'
import type { SubprocessHandle, SubprocessSpawnSpec } from '@clocky/clocky-subprocess'
import { readClientBuildRecord } from '../../../scripts/client-build-environment.ts'
import { REPO_ROOT } from './support.ts'

const PRODUCT_AUTH_CREDENTIAL = 'clocky-web-hmr-product-credential'
const PRODUCT_AUTH_COOKIE_NAME = 'clocky_product_auth'
const PRODUCT_AUTH_DIGEST = createHash('sha256').update(PRODUCT_AUTH_CREDENTIAL, 'utf8').digest('hex')

function spawnSpec(argv: readonly string[], cwd: string, env?: Record<string, string>): SubprocessSpawnSpec {
  return {
    argv,
    cwd,
    stdio: { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' },
    graceMs: 5_000,
    ...env === undefined ? {} : { env },
  }
}

function waitForOutput(child: SubprocessHandle, pattern: RegExp, label: string): Promise<string> {
  return new Promise((resolveReady, reject) => {
    let output = ''
    let settled = false
    const cleanup = (): void => {
      clearTimeout(timer)
      child.stdout?.off('data', onData)
      child.stderr?.off('data', onData)
    }
    const resolveOnce = (value: string): void => {
      if (settled) return
      settled = true
      cleanup()
      resolveReady(value)
    }
    const rejectOnce = (error: Error): void => {
      if (settled) return
      settled = true
      cleanup()
      reject(error)
    }
    const onData = (chunk: Buffer): void => {
      output += chunk.toString()
      const match = pattern.exec(output)
      if (match === null) return
      resolveOnce(match[1] ?? match[0])
    }
    const timer = setTimeout(() => { rejectOnce(new Error(`${label} not ready:\n${output}`)) }, 60_000)
    child.stdout?.on('data', onData)
    child.stderr?.on('data', onData)
    void child.done.then((outcome) => {
      rejectOnce(new Error(`${label} exited before ready (${JSON.stringify(outcome)}):\n${output}`))
    }, (error: unknown) => {
      rejectOnce(new Error(`${label} failed before ready:\n${output}`, { cause: error }))
    })
  })
}

async function stopTree(child: SubprocessHandle): Promise<void> {
  child.terminate()
  const stopped = await child.waitForExit(AbortSignal.timeout(15_000))
  if (!stopped) throw new Error(`process tree ${String(child.pid)} did not stop after termination escalation`)
  await child.done
}

it('hot-reloads a real client-plugin source edit without refreshing the page', async () => {
  const world = await mkdtemp(join(tmpdir(), 'clocky-web-hmr-world-'))
  const sourcePath = join(REPO_ROOT, 'packages/client/ui-conversation/src/client/locales.ts')
  const binPath = join(REPO_ROOT, 'apps/cli/lib/bin.js')
  if (!existsSync(binPath)) throw new Error('HMR browser test needs the built clocky bin; run pnpm run build first')
  const clientBuildEnvironment = readClientBuildRecord(REPO_ROOT).environment
  const clientArtifactPaths = [
    ...globSync('packages/*/*/lib/client.js{,.map}', { cwd: REPO_ROOT }),
    ...globSync('apps/web/dist/**/*', { cwd: REPO_ROOT })
      .filter(path => statSync(join(REPO_ROOT, path)).isFile()),
  ]
    .map(path => join(REPO_ROOT, path))
  const originalClientArtifacts = await Promise.all(
    clientArtifactPaths.map(async path => [path, await readFile(path)] as const),
  )
  const originalClientArtifactSet = new Set(originalClientArtifacts.map(([path]) => path))
  const originalSource = await readFile(sourcePath)
  const oldText = 'Into the Unknown'
  const sourceNeedle = "'hero.headline': 'Into the Unknown'"
  const newText = `HMR UPDATED ${'x'.repeat(80)}`
  const updatedSource = originalSource.toString().replace(sourceNeedle, `'hero.headline': '${newText}'`)
  if (updatedSource === originalSource.toString()) throw new Error(`HMR source lacks ${JSON.stringify(sourceNeedle)}`)

  const subprocessCtx = new Context()
  let subprocessFiber: Fiber | undefined
  let watcher: SubprocessHandle | undefined
  let host: SubprocessHandle | undefined
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
  const failures: unknown[] = []
  try {
    subprocessFiber = await subprocessCtx.plugin(LocalSubprocessRuntime)
    watcher = subprocessCtx.subprocess.spawn(spawnSpec(
      ['pnpm', 'run', 'dev:web'],
      REPO_ROOT,
      { ...clientBuildEnvironment },
    ))
    await waitForOutput(watcher, /dev-web: watching/, 'pnpm run dev:web')
    const productAuthPatch = join(world, 'product-auth.patch.yml')
    await writeFile(productAuthPatch, [
      '- id: product-principal-local',
      '  disabled: true',
      '- insert:',
      '    - id: hmr-product-principal',
      `      name: ${JSON.stringify(pathToFileURL(join(REPO_ROOT, 'packages/host/product-principal-digest/lib/index.js')).href)}`,
      '      config:',
      '        providerName: local',
      `        credentialSha256: ${PRODUCT_AUTH_DIGEST}`,
      '        principalId: hmr-user',
      '        subject: hmr-user',
      '',
    ].join('\n'))
    host = subprocessCtx.subprocess.spawn(spawnSpec(
      [process.execPath, binPath, 'web', '--patch', productAuthPatch, '--no-open', '--port', '0'],
      world,
      {
        DEEPSEEK_API_KEY: 'keyless-hmr-no-call',
        CLOCKY_HOME: join(world, '.clocky'),
      },
    ))
    const baseUrl = await waitForOutput(host, /clocky web: (http:\/\/[^\s]+)/, 'built clocky web')
    const bootstrap = await fetch(`${baseUrl}/api/bootstrap`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ credential: PRODUCT_AUTH_CREDENTIAL }),
    })
    if (bootstrap.status !== 204) throw new Error(`HMR product authentication bootstrap failed with HTTP ${String(bootstrap.status)}`)
    const cookie = bootstrap.headers.get('set-cookie')?.split(';', 1)[0]
    const separator = cookie?.indexOf('=') ?? -1
    const token = cookie === undefined || separator < 1 ? '' : cookie.slice(separator + 1)
    if (cookie === undefined || cookie.slice(0, separator) !== PRODUCT_AUTH_COOKIE_NAME || token.length === 0) {
      throw new Error('HMR product authentication bootstrap returned an invalid cookie')
    }
    browser = await chromium.launch()
    const page = await browser.newPage()
    await page.context().addCookies([{ name: PRODUCT_AUTH_COOKIE_NAME, value: token, url: baseUrl }])
    const pageErrors: string[] = []
    page.on('pageerror', error => pageErrors.push(String(error)))
    await page.goto(baseUrl, { waitUntil: 'load' })
    await page.getByText(oldText, { exact: true }).waitFor({ timeout: 15_000 })
    const pageIdentity = await page.evaluate(() => {
      const identity = crypto.randomUUID()
      Object.defineProperty(window, '__clockyHmrPageIdentity', { value: identity })
      return identity
    })

    await writeFile(sourcePath, updatedSource)
    await page.getByText(newText, { exact: true }).waitFor({ timeout: 30_000 })
    expect(await page.evaluate(() => (window as Window & { __clockyHmrPageIdentity?: string }).__clockyHmrPageIdentity))
      .toBe(pageIdentity)
    expect(pageErrors).toEqual([])
  } catch (error) {
    failures.push(error)
  } finally {
    // Stop the watcher before restoring the source. Restoring first schedules
    // one more build, which can finish after the original bundles are put back
    // and leave the complete-build record out of sync for the next test.
    if (watcher !== undefined) await stopTree(watcher).catch((error: unknown) => failures.push(error))
    await writeFile(sourcePath, originalSource).catch((error: unknown) => failures.push(error))
    await Promise.all(originalClientArtifacts.map(async ([path, content]) => {
      await writeFile(path, content).catch((error: unknown) => failures.push(error))
    }))
    const currentClientArtifactPaths = [
      ...globSync('packages/*/*/lib/client.js{,.map}', { cwd: REPO_ROOT }),
      ...globSync('apps/web/dist/**/*', { cwd: REPO_ROOT })
        .filter(path => statSync(join(REPO_ROOT, path)).isFile()),
    ].map(path => join(REPO_ROOT, path))
    await Promise.all(currentClientArtifactPaths
      .filter(path => !originalClientArtifactSet.has(path))
      .map(async (path) => {
        await rm(path, { force: true }).catch((error: unknown) => failures.push(error))
      }))
    if (host !== undefined) await stopTree(host).catch((error: unknown) => failures.push(error))
    await browser?.close().catch((error: unknown) => failures.push(error))
    await subprocessFiber?.dispose().catch((error: unknown) => failures.push(error))
    await rm(world, { recursive: true, force: true }).catch((error: unknown) => failures.push(error))
  }
  if (failures.length > 0) throw new AggregateError(failures, 'HMR browser test or cleanup failed')
}, 120_000)
