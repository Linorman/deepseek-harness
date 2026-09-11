/**
 * @clocky/clocky-web-app — the browser-surface bundle's runtime glue plugin
 * plus the bundle patch (`cordis.patch.yml`, declared by the `clocky.bundle.patch`
 * manifest field). The plugin owns the browser-surface glue: it resolves
 * the built frontend dist (workspace knowledge of this bundle, never user
 * config), mounts the `frontend-static` fallback owner over it, registers the
 * harness-source and web-surface prompt sections, the bash-visible web runtime
 * variable, the URL line, and the default-browser handoff. App command-line
 * values arrive through the `webStartup` service expressions in the bundle
 * patch.
 * @module @clocky/clocky-web-app
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { chmod, mkdir, mkdtemp, open, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { networkInterfaces } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type { Context } from '@clocky/cordis'
import z from '@clocky/schemastery'
import { addHarnessSourceSection } from '@clocky/clocky-app-boot'
import * as FrontendStatic from '@clocky/clocky-host-frontend-static'
import { PRODUCT_AUTH_BOOTSTRAP_PATH } from '@clocky/clocky-client-connection'
import { resolveClockyHome } from '@clocky/clocky-home-paths'
import { launchEnvironmentOf } from '@clocky/clocky-launch-environment'
import { scrubbedParentEnv } from '@clocky/clocky-subprocess'
import type {} from '@clocky/cordis-plugin-loader'
import type {} from '@clocky/clocky-host-webserver'
import type {} from '@clocky/clocky-system-prompt'
import type {} from '@clocky/clocky-shell-env'
import type {} from '@clocky/clocky-product-principal'

/** Stable Cordis plugin name. */
export const name = 'web-app'

/** This clocky installation's root, from either this package's source or built entry. */
const SOURCE_ROOT = fileURLToPath(new URL('../../../..', import.meta.url))

/** Runtime service that releases Web rows after bind-dependent values resolve. */
const WEB_RUNTIME_SERVICE = 'webRuntime'

/** Services required before the web runtime can mount. */
export const inject = ['webServer']

/** Private directory name below the Harness home for one-time browser handoff documents. */
const BROWSER_HANDOFF_DIRECTORY_NAME = 'browser-handoffs'
/** Default upper bound for a private document awaiting browser navigation. */
const DEFAULT_BROWSER_HANDOFF_TTL_MS = 60_000

/** Plugin config: composed deployment settings plus per-invocation command-line values. */
export interface Config {
  /** Permit default-browser handoff after the Loader tree settles; an SSH launch suppresses it. */
  openBrowser: boolean
  /** Print the URL line on activation; a non-interactive layer can turn it off. */
  printUrl: boolean
  /**
   * Register the model-visible surface context (the `app:web-surface` prompt
   * section and the `CLOCKY_WEB_URL` bash variable). A one-shot non-interactive
   * layer can turn it off when its user is not in the GUI, so the
   * orientation text would be false.
   */
  surfaceContext: boolean
  /** Explicit `--trusted-host` authorities from this invocation. */
  trustedHosts: string[]
  /** Product-principal provider selected by the Web transport and browser handoff. */
  productPrincipalProvider?: string
  /** Owner-only directory for temporary browser bootstrap handoff documents. */
  browserHandoffDirectory?: string
  /** Maximum lifetime of one unopened browser bootstrap handoff document. */
  browserHandoffTtlMs?: number
}

export const Config: z<Config> = z.object({
  openBrowser: z.boolean().default(true),
  printUrl: z.boolean().default(true),
  surfaceContext: z.boolean().default(true),
  trustedHosts: z.array(String).default([]),
  productPrincipalProvider: z.string().default('local'),
  browserHandoffDirectory: z.string(),
  browserHandoffTtlMs: z.number().step(1).min(1_000).default(DEFAULT_BROWSER_HANDOFF_TTL_MS),
})

/** Bind-dependent Web values shared by the trust fence and URL display. */
export interface WebRuntimeValues {
  /** LAN IPv4 literals sampled once when the server binds all interfaces. */
  lanAddresses: string[]
  /** LAN literals followed by explicit invocation authorities. */
  trustedHosts: string[]
  /** Named product-principal provider shared with the connection transport. */
  productPrincipalProvider: string
}

/** Environment variable naming the canonical local URL of this Web GUI. */
const CLOCKY_WEB_URL = 'CLOCKY_WEB_URL' as const

// Display-only mirror of the webserver schema's loopback host: the address the
// local URL always prints. Not a source of truth — the schema is.
const LOOPBACK_HOST = '127.0.0.1'
/** The webserver schema's all-interfaces bind literal. */
const ALL_INTERFACES_HOST = '0.0.0.0'

/** Whether this process was launched through SSH, including a forwarded-port session. */
function launchedThroughSsh(ctx: Context): boolean {
  const environment = launchEnvironmentOf(ctx)
  return ['SSH_CONNECTION', 'SSH_TTY'].some((name) => {
    const value = environment.getFrom(name, ['process'])?.value
    return value !== undefined && value !== ''
  })
}

const BROWSER_OPENER_MODULE = import.meta.resolve('open')

const BROWSER_OPENER_PROGRAM = `
try {
  const { default: open } = await import(${JSON.stringify(BROWSER_OPENER_MODULE)})
  const launcher = await open(process.argv[1])
  if (process.platform === 'win32') {
    // open resolves at PowerShell spawn; keep it referenced until that launcher hands the URL to Windows.
    const code = launcher.exitCode ?? await new Promise((resolve, reject) => {
      function onError(error) {
        launcher.off('close', onClose)
        reject(error)
      }
      function onClose(code) {
        launcher.off('error', onError)
        resolve(code)
      }
      launcher.ref()
      launcher.once('error', onError)
      launcher.once('close', onClose)
    })
    if (code !== 0) throw new Error('browser operating-system launcher exited with code ' + String(code))
  }
  process.exitCode = 0
} catch (error) {
  // The parent turns this exit into the handoff warning.
  console.error(error)
  process.exitCode = 1
}
`

/** Resolved private filesystem location and lifetime for browser bootstrap handoff documents. */
export interface BrowserHandoffSpec {
  /** Absolute directory controlled by this Harness installation. */
  readonly directory: string
  /** Upper bound before an unopened handoff document is removed. */
  readonly ttlMs: number
}

/** One owner-only browser handoff document retained until expiry or Web teardown. */
class BrowserHandoffArtifact {
  private readonly timer: ReturnType<typeof setTimeout>
  private closed = false

  /**
   * @param directory - unique private directory containing this exact document.
   * @param onClose - removes the artifact from its manager.
   * @param ttlMs - expiry bound for an unopened document.
   */
  constructor(
    readonly id: string,
    readonly url: string,
    private readonly directory: string,
    private readonly onClose: (artifact: BrowserHandoffArtifact) => void,
    ttlMs: number,
  ) {
    this.timer = setTimeout(() => { void this.close().catch(() => undefined) }, ttlMs)
    this.timer.unref()
  }

  /** Delete the complete private document directory exactly once. */
  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    clearTimeout(this.timer)
    this.onClose(this)
    await rm(this.directory, { recursive: true, force: true })
  }
}

/** Creates and owns short-lived, owner-only file documents that post one bootstrap credential. */
export class BrowserHandoffManager {
  private readonly artifacts = new Set<BrowserHandoffArtifact>()
  private readonly artifactsById = new Map<string, BrowserHandoffArtifact>()
  private closed = false

  /** @param spec - resolved private storage and expiry policy. */
  constructor(private readonly spec: BrowserHandoffSpec) {}

  /**
   * Render and retain one private form document without placing its credential in a URL or process argument.
   * @param webUrl - loopback Web URL that owns the bootstrap endpoint.
   * @param credential - plaintext bootstrap credential retained only in the private document body.
   * @returns the one-time handoff artifact opened by the operating-system launcher.
   */
  async create(webUrl: string, credential: string): Promise<BrowserHandoffArtifact> {
    if (this.closed) throw new Error('web-app: browser handoff manager is closed')
    const endpoint = bootstrapEndpoint(webUrl)
    await mkdir(this.spec.directory, { recursive: true, mode: 0o700 })
    await chmod(this.spec.directory, 0o700)
    const directory = await mkdtemp(join(this.spec.directory, 'handoff-'))
    let handle: Awaited<ReturnType<typeof open>> | undefined
    try {
      await chmod(directory, 0o700)
      const document = join(directory, 'index.html')
      const id = randomBytes(32).toString('base64url')
      handle = await open(document, 'wx', 0o600)
      await handle.writeFile(renderBrowserHandoffDocument(endpoint, credential, id), 'utf8')
      await handle.close()
      handle = undefined
      if (this.isClosed()) throw new Error('web-app: browser handoff manager is closed')
      const artifact = new BrowserHandoffArtifact(
        id,
        pathToFileURL(document).href,
        directory,
        (value) => {
          this.artifacts.delete(value)
          this.artifactsById.delete(value.id)
        },
        this.spec.ttlMs,
      )
      this.artifacts.add(artifact)
      this.artifactsById.set(id, artifact)
      return artifact
    } catch (error: unknown) {
      if (handle !== undefined) await handle.close().catch(() => undefined)
      await rm(directory, { recursive: true, force: true }).catch(() => undefined)
      throw error
    }
  }

  /** Remove every remaining credential document when the Web runtime leaves. */
  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    await Promise.all([...this.artifacts].map(artifact => artifact.close()))
  }

  /**
   * Delete one artifact after its exact one-time form credential was accepted.
   * @param id - opaque handoff identity emitted after successful bootstrap.
   * @returns resolution after the owner-only document has been removed.
   */
  async consume(id: string): Promise<void> {
    await this.artifactsById.get(id)?.close()
  }

  /** Re-read mutable teardown state after asynchronous document writes. */
  private isClosed(): boolean {
    return this.closed
  }
}

/** Resolve the private browser-handoff directory only at the Web runtime boundary. */
function resolveBrowserHandoffSpec(config: Config): BrowserHandoffSpec {
  const directory = resolve(config.browserHandoffDirectory
    ?? join(resolveClockyHome(), BROWSER_HANDOFF_DIRECTORY_NAME))
  const ttlMs = config.browserHandoffTtlMs ?? DEFAULT_BROWSER_HANDOFF_TTL_MS
  return Object.freeze({ directory, ttlMs })
}

/** Require the loopback bootstrap endpoint encoded only in a private handoff document body. */
function bootstrapEndpoint(webUrl: string): URL {
  const endpoint = new URL(PRODUCT_AUTH_BOOTSTRAP_PATH, webUrl)
  if (endpoint.protocol !== 'http:' || endpoint.hostname !== LOOPBACK_HOST) {
    throw new Error('web-app: browser bootstrap handoff requires a loopback HTTP URL')
  }
  return endpoint
}

/** Escape one text value for a handoff document attribute without serializing it anywhere else. */
function escapeHtmlAttribute(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

/** Render the ephemeral local-file navigation that posts one credential body then redirects to the Web app. */
function renderBrowserHandoffDocument(endpoint: URL, credential: string, handoffId: string): string {
  return `<!doctype html><meta charset="utf-8"><meta http-equiv="Cache-Control" content="no-store"><meta name="referrer" content="no-referrer"><form id="clocky-bootstrap" method="post" action="${escapeHtmlAttribute(endpoint.href)}" autocomplete="off"><input type="hidden" name="credential" value="${escapeHtmlAttribute(credential)}"><input type="hidden" name="handoffId" value="${escapeHtmlAttribute(handoffId)}"></form><script>document.getElementById('clocky-bootstrap').submit()</script>`
}

/**
 * Resolve one LAN-trust snapshot from the active server bind.
 *
 * Derived entries are port-less IP literals: DNS rebinding needs an
 * attacker-controlled name, while an IP-literal Host is safe on any port and
 * an OS-assigned port is unknowable before bind.
 * @param bindHost - the active webserver bind host.
 * @param extra - explicit `--trusted-host` values, in argument order.
 * @param productPrincipalProvider - named local product-principal provider used by the browser handoff.
 * @returns the LAN display addresses and invocation-derived fence authorities.
 */
export function resolveLanTrust(
  bindHost: string,
  extra: readonly string[],
  productPrincipalProvider = 'local',
): WebRuntimeValues {
  const lanAddresses = bindHost === ALL_INTERFACES_HOST
    ? Object.values(networkInterfaces()).flat()
      .filter((iface): iface is NonNullable<typeof iface> => iface !== undefined && iface.family === 'IPv4' && !iface.internal)
      .map(iface => iface.address)
    : []
  if (productPrincipalProvider.length === 0 || productPrincipalProvider.trim() !== productPrincipalProvider) {
    throw new Error('web-app: productPrincipalProvider must be non-empty without surrounding whitespace')
  }
  return { lanAddresses, trustedHosts: [...lanAddresses, ...extra], productPrincipalProvider }
}

/** Model-visible orientation and acceptance boundary for sessions created through `clocky web`. */
function webSurfacePrompt(webUrl: string): string {
  const updateContract = 'The client-plugin HMR receiver is active, but client-plugin changes reload without a refresh only while '
    + '`pnpm run dev:web` is also running from this same checkout to rebuild their bundles; verify that watcher before promising automatic updates. '
    + 'Every other change — the apps/web shell and plain packages — requires rebuilding the affected Web artifacts and verifying this existing URL after a page refresh. '
  return `You are interacting with the user through the Clocky Web GUI at ${webUrl}. `
    + 'When the user refers to "this page", "this GUI", or "this app" without naming another target, they mean this GUI. '
    + 'The browser provides no implicit DOM, route, or screenshot context. '
    + updateContract
    + 'Starting another server does not update this GUI. '
    + 'The apps/web Vite entry builds the shell but is not a standalone application because only clocky web injects window.__CLOCKY_BOOT__. '
    + 'Do not start a replacement server unless the user asks; if one is needed, use a managed background job and verify its exact URL.'
}

/** Resolve the canonical loopback URL from the active Web server. */
function localWebUrl(ctx: Context): string {
  const port = ctx.get('webServer')?.port
  if (port === undefined) throw new Error('web-app: webServer service missing while resolving Web runtime')
  return `http://${LOOPBACK_HOST}:${String(port)}`
}

/** Dist location is workspace knowledge of this bundle: resolved through the frontend package exports, not configured. */
function resolveDistIndex(): string {
  const require = createRequire(import.meta.url)
  try {
    return require.resolve('@clocky/clocky-web-frontend/dist/index.html')
  } catch {
    /* v8 ignore next 2 -- reachable only on a checkout without a built dist; the test tree builds it */
    throw new Error('web-app: frontend dist not built; run pnpm run build from the repository root first')
  }
}

/** Start the maintained platform opener with only a credential-free target URL. */
function spawnBrowserLauncher(url: string): ChildProcess {
  return spawn(process.execPath, [
    '--input-type=module',
    '--eval', BROWSER_OPENER_PROGRAM,
    '--', url,
  ], {
    env: scrubbedParentEnv(),
    stdio: ['ignore', 'inherit', 'pipe'],
  })
}

/** Redact a credential from an unexpected helper diagnostic before forwarding it. */
function redactBrowserLauncherOutput(value: string, bootstrapCredential: string | undefined): string {
  if (bootstrapCredential === undefined) return value
  return value
    .replaceAll(bootstrapCredential, '[redacted]')
    .replaceAll(encodeURIComponent(bootstrapCredential), '[redacted]')
}

/** Hand a credential-free URL or owner-only handoff document to the operating system's default browser. */
async function openBrowser(
  url: string,
  bootstrapCredential?: string,
  handoffs?: BrowserHandoffManager,
): Promise<void> {
  let artifact: BrowserHandoffArtifact | undefined
  if (bootstrapCredential !== undefined) {
    if (handoffs === undefined) {
      throw new Error('web-app: browser credential handoff requires an owner-only handoff manager')
    }
    artifact = await handoffs.create(url, bootstrapCredential)
  }
  const launcher = spawnBrowserLauncher(artifact?.url ?? url)
  let launcherStderr = ''
  launcher.stderr?.setEncoding('utf8')
  launcher.stderr?.on('data', (chunk: string) => { launcherStderr += chunk })
  try {
    await new Promise<void>((resolve, reject) => {
      function onError(error: Error): void {
        launcher.off('close', onClose)
        reject(error)
      }
      function onClose(code: number | null): void {
        launcher.off('error', onError)
        if (code !== 0) {
          const firstLine = redactBrowserLauncherOutput(launcherStderr, bootstrapCredential).trim().split(/\r?\n/u)[0]
          const reason = firstLine === undefined || firstLine === ''
            ? `browser launcher exited with code ${String(code)}`
            : firstLine.replace(/^(?:[A-Za-z]*Error):\s*/u, '')
          reject(new Error(reason))
          return
        }
        if (launcherStderr !== '') process.stderr.write(redactBrowserLauncherOutput(launcherStderr, bootstrapCredential))
        resolve()
      }
      launcher.once('error', onError)
      launcher.once('close', onClose)
    })
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : String(error)
    if (artifact !== undefined) {
      throw new Error(`${reason}; open ${artifact.url} manually before it expires`)
    }
    throw error
  }
}

/** Test hooks for the built dist and native browser handoff; production never mutates them. */
export const internals: {
  resolveDistIndex: () => string
  openBrowser: (url: string, bootstrapCredential?: string, handoffs?: BrowserHandoffManager) => Promise<void>
} = { resolveDistIndex, openBrowser }

/**
 * Mount the Web runtime: dist serving, surface prompt, the bash runtime
 * variable, the URL line, and the default-browser handoff.
 * @param ctx - plugin context carrying the webServer service.
 * @param config - validated {@link Config}.
 */
export function apply(ctx: Context, config: Config): void {
  const runtime = resolveLanTrust(ctx.webServer.host, config.trustedHosts, config.productPrincipalProvider ?? 'local')
  const browserHandoffs = new BrowserHandoffManager(resolveBrowserHandoffSpec(config))
  ctx.effect(() => async () => { await browserHandoffs.close() }, 'web-app: browser handoffs')
  ctx.on('product-auth/browser-handoff-consumed', (handoffId) => {
    void browserHandoffs.consume(handoffId).catch(() => {
      ctx.logger.warn('web-app: browser handoff cleanup failed')
    })
  })
  // The loopback URL belongs to this host. Under SSH, the operator reaches it
  // through a local forwarding address that this process cannot derive.
  const handoffBrowser = config.openBrowser && !launchedThroughSsh(ctx)
  // Release dependent rows only after bind-dependent trust has been sampled once.
  ctx.provide(WEB_RUNTIME_SERVICE, runtime)
  ctx.plugin(FrontendStatic, { distIndex: internals.resolveDistIndex() })
  if (config.surfaceContext) {
    ctx.inject(['systemPrompt'], (promptCtx) => {
      addHarnessSourceSection(promptCtx, SOURCE_ROOT)
      promptCtx.systemPrompt.section({
        name: 'app:web-surface',
        order: -98,
        text: () => webSurfacePrompt(localWebUrl(promptCtx)),
      })
    })
    ctx.inject(['shellEnv'], (runtimeCtx) => {
      runtimeCtx.shellEnv.register({
        name: 'web-runtime',
        variables: {
          [CLOCKY_WEB_URL]: { description: 'Canonical local URL of the Clocky Web GUI serving this session.' },
        },
        resolve: () => ({ [CLOCKY_WEB_URL]: localWebUrl(runtimeCtx) }),
      })
    })
  }
  if (config.printUrl || handoffBrowser) {
    // The URL line and browser handoff are readiness signals: supervisors RPC
    // as soon as they observe the line, while a browser requests the page as
    // soon as it opens. Neither may run while sibling rows such as the /api
    // route owner are still mounting. Await Loader settlement first; a
    // hand-built tree without a Loader is already the complete tree.
    const announceReady = (): void => {
      const webUrl = localWebUrl(ctx)
      // Reuse the exact LAN snapshot provided to the /api trust fence.
      const lanCandidate = runtime.lanAddresses[0]
      const port = ctx.webServer.port
      if (config.printUrl) {
        console.log(`clocky web: ${webUrl}${lanCandidate === undefined ? '' : ` (LAN: http://${lanCandidate}:${String(port)})`}`)
      }
      if (handoffBrowser) {
        console.log('clocky web: opening the default browser; pass --no-open to disable')
        const principals = ctx.get('productPrincipals')
        if (principals === undefined) {
          console.error('web-app: browser handoff requires the configured product-principal provider')
          return
        }
        let bootstrapCredential: string
        try {
          bootstrapCredential = principals.bootstrapCredential(runtime.productPrincipalProvider)
        } catch {
          console.error('web-app: browser handoff requires the configured product-principal provider')
          return
        }
        void internals.openBrowser(webUrl, bootstrapCredential, browserHandoffs).catch((error: unknown) => {
          const reason = error instanceof Error ? error.message : String(error)
          console.error(`web-app: could not open the default browser because ${reason}`)
        })
      }
    }
    // This row's own activation can precede a sibling failure. The app owns
    // readiness by waiting for its Loader tree, or announces at once in a
    // hand-built context without Loader.
    const settled = ctx.get('loader')?.await()
    if (settled === undefined) announceReady()
    else {
      void settled.then(() => {
        // The tree can be disposed while the boot was in flight (early
        // SIGTERM); a URL line or browser tab for a dead server would only
        // mislead, and reading the torn-down port would turn a clean shutdown
        // into a crash.
        if (ctx.get('webServer') !== undefined) announceReady()
      // Loader reports a failed boot; this row only stays quiet.
      }, () => {})
    }
  }
}
