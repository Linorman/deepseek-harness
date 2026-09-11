/** Host HTTP bridge for browser-client RPC. */
import type { ServerResponse } from 'node:http'
import type { Context } from '@clocky/cordis'
import z from '@clocky/schemastery'
import type {} from '@clocky/clocky-attachment'
import type { AuthenticatedProductCall } from '@clocky/clocky-product-principal'
// Activates the webServer Context merge used below.
import type { WebRoute, WebUpgradeRoute } from '@clocky/clocky-host-webserver'
import { toFetchHandler } from '@clocky/clocky-host-apiproxy'
import { API_PATH, HOST_EVENTS_PATH, MUX_EVENTS_PATH } from './api-path.ts'
import { bridge, DEFAULT_MAX_REQUEST_BODY_BYTES } from './http-bridge.ts'
import { assertTrustedAuthority, isTrustedApiRequest } from './api-request-trust.ts'
import { ProductAuthSessions } from './product-auth.ts'
import { HostConnectionService } from './rpc-host.ts'
import { rejectWebSocketUpgrade, WebSocketDownlinks } from './websocket-downlink.ts'

export type {
  ConnectionRpcAuthority,
  ConnectionRpcEndpointMatcher,
  ConnectionRpcHandler,
  ConnectionRpcHandlerOptions,
  HostConnectionHandle,
  HostConnectionRpc,
} from './rpc.ts'
export { HostConnectionService } from './rpc-host.ts'

export { API_PATH, HOST_EVENTS_PATH, MUX_EVENTS_PATH } from './api-path.ts'
export { PRODUCT_AUTH_BOOTSTRAP_PATH, PRODUCT_AUTH_BOOTSTRAP_PROMISE } from './product-auth-contract.ts'

/** Stable Cordis plugin name. */
export const name = 'client-connection'

declare module '@clocky/cordis' {
  interface Events {
    /**
     * Private browser handoff credential accepted by the loopback bootstrap endpoint.
     * @mode emit
     * @param handoffId - opaque cleanup-only handoff identity.
     */
    'product-auth/browser-handoff-consumed'(handoffId: string): void
  }
}

/** Headroom for RPC JSON fields around aggregate base64 image payloads. */
const REQUEST_ENVELOPE_HEADROOM_BYTES = 1024 * 1024

function assertImageBodyCapacity(ctx: Context, maxRequestBodyBytes: number): void {
  const attachments = ctx.get('attachments')
  if (attachments === undefined) return
  const requiredImageBodyBytes = Math.ceil(
    attachments.imageLimits.maxMessageImageBytes * 4 / 3,
  ) + REQUEST_ENVELOPE_HEADROOM_BYTES
  if (maxRequestBodyBytes < requiredImageBodyBytes) {
    throw new Error(
      `client-connection maxRequestBodyBytes (${String(maxRequestBodyBytes)}) must be at least `
      + `${String(requiredImageBodyBytes)} for the configured aggregate image limit`,
    )
  }
}

/** Services required before providing Connection; API Proxy is an optional `/api` fallback. */
export const inject = ['webServer']

/** Plugin config: the deployment's non-loopback serving authorities. */
export interface ConnectionConfig {
  /**
   * Authorities this deployment serves beyond loopback: exact `host:port`, or
   * port-less `host` matching any port. The /api trust fence refuses any
   * request whose Host is neither loopback nor listed here, so a
   * non-loopback (`0.0.0.0`) deployment must declare the names it is reached
   * by (the clocky CLI derives the machine's LAN IP literals itself). An entry
   * that is not a bare, canonical authority fails the plugin load.
   */
  trustedHosts?: string[]
  /** Named product-principal provider trusted for this Web Host's bootstrap credential. */
  productPrincipalProvider?: string
  /** Maximum buffered JSON body for every `/api` request. Default: 300 MiB. */
  maxRequestBodyBytes?: number
}

export const Config: z<ConnectionConfig> = z.object({
  trustedHosts: z.array(String).default([]),
  productPrincipalProvider: z.string().default('local'),
  maxRequestBodyBytes: z.natural().min(1).default(DEFAULT_MAX_REQUEST_BODY_BYTES),
})

/**
 * Methods gated to loopback even on a trusted-host deployment. Native dialogs
 * act on the host machine; the settings and credential domains mutate the
 * user's configuration and secret store, and READING them is equally
 * privileged — `settings.describe` returns every exposed namespace's
 * configuration and `credentials.describe` reports whether an arbitrary
 * environment-variable name is configured and where from, which is
 * reconnaissance no anonymous caller should have. `trustedHosts` is a
 * DNS-rebinding fence, independent of product authentication, so the whole
 * configuration plane stays loopback-same-origin. `llm.discoverModels` belongs to that plane on both counts: it
 * carries a draft credential, and it makes the HOST issue a GET to a URL the
 * caller chose and reports back the status or the parsed body — an anonymous
 * LAN caller would have a probe for whatever the host can reach and the
 * browser cannot.
 *
 * The model catalog (`llm.providers`, `llm.models`) is deliberately NOT here:
 * it carries provider ids, display names, and model lists — no endpoints,
 * keys, or key state — and a LAN client's model picker legitimately needs it.
 */
const PRIVILEGED_METHODS = new Set([
  // A preset composition names the plugins a Team runs, so reading one is
  // reconnaissance; copy and remove rearrange what the deployment offers, and
  // openDocument drives the host desktop — all more than the roster beside
  // them. (Authoring is copy-only, so no method here accepts composition text
  // or a path; the pin is about who may manage the roster at all.)
  //
  // CHOOSING one is not pinned, and `agentPreset.list` is not either. Picking a
  // preset looks like escalation — one of them mounts the toolset that edits the
  // live runtime — but `team.start` already takes an `agentPreset`, so
  // pinning only the switch would leave the same capability one method over.
  // The deeper reason is that the capability is not the preset's to grant: the
  // deployment's own default already carries `bash` and the filesystem tools, so
  // any caller that may start a Team at all can already run commands as this
  // process. Pinning the switch would be a fence beside an open gate.
  'agentPreset.read',
  'agentPreset.copy',
  'agentPreset.openDocument',
  'agentPreset.remove',
  'host.pickDirectory',
  'host.openPath',
  'settings.describe',
  'settings.openDocument',
  'settings.update',
  'settings.replace',
  'settings.mutate',
  'credentials.describe',
  'credentials.set',
  'credentials.unset',
  'llm.discoverModels',
])

/** Write one small credential-safe rejection without reading an unauthenticated request body. */
async function writeProductAuthRejection(
  res: ServerResponse,
  sessions: ProductAuthSessions,
  kind: 'required' | 'invalid',
): Promise<void> {
  const response = sessions.rejection(kind)
  res.writeHead(response.status, Object.fromEntries(response.headers.entries()))
  res.end(await response.text())
}

type AuthenticatedDownlinkHandler = (
  req: Parameters<WebUpgradeRoute['handler']>[0],
  socket: Parameters<WebUpgradeRoute['handler']>[1],
  head: Parameters<WebUpgradeRoute['handler']>[2],
  productSignal?: AbortSignal,
) => Promise<void>

/**
 * Mounts the API gateway under the browser transport prefix. Every request on
 * the prefix passes the browser-trust fence first (DNS-rebinding and
 * cross-site defense — [api-request-trust](./api-request-trust.ts));
 * privileged methods additionally pass it with an empty trust list, which
 * pins them to loopback.
 * @param ctx - Host plugin context.
 * @param config - resolved plugin config (schema defaults applied).
 */
export function apply(ctx: Context, config?: ConnectionConfig): void {
  // The Loader resolves schema defaults; hand-built test contexts may pass none.
  const trustedHosts = config?.trustedHosts ?? []
  const productPrincipalProvider = config?.productPrincipalProvider ?? 'local'
  const maxRequestBodyBytes = config?.maxRequestBodyBytes ?? DEFAULT_MAX_REQUEST_BODY_BYTES
  // Config boundary: a malformed entry fails the load loudly here rather than
  // silently authorizing its hostname prefix at request time.
  for (const entry of trustedHosts) assertTrustedAuthority(entry)
  if (productPrincipalProvider.length === 0 || productPrincipalProvider.trim() !== productPrincipalProvider) {
    throw new Error('client-connection: productPrincipalProvider must be non-empty without surrounding whitespace')
  }
  if (ctx.get('apiProxy') !== undefined) assertImageBodyCapacity(ctx, maxRequestBodyBytes)
  const connection = new HostConnectionService(ctx, trustedHosts)
  const productPrincipals = ctx.get('productPrincipals')
  const productAuth = productPrincipals === undefined
    ? undefined
    : new ProductAuthSessions(
      productPrincipals,
      productPrincipalProvider,
      (handoffId) => { ctx.emit('product-auth/browser-handoff-consumed', handoffId) },
    )
  if (productAuth !== undefined) {
    ctx.effect(() => () => productAuth.close(), 'client-connection: product-auth sessions')
  }
  const fetchHandlerFor = (authenticatedProductCall: AuthenticatedProductCall | undefined) =>
    connection.createSharedFetchHandler(API_PATH, {
      async fetch(request) {
        const pathname = new URL(request.url).pathname
        const method = pathname.startsWith(`${API_PATH}/`)
          ? pathname.slice(API_PATH.length + 1)
          : undefined
        if (method !== undefined
          && PRIVILEGED_METHODS.has(method)
          && !isTrustedApiRequest(request, [])) {
          return new Response('forbidden', { status: 403 })
        }
        if (request.method === 'GET' && (pathname === MUX_EVENTS_PATH || pathname === HOST_EVENTS_PATH)) {
          return new Response('upgrade required', {
            status: 426,
            headers: { connection: 'Upgrade', upgrade: 'websocket' },
          })
        }
        const apiProxy = ctx.get('apiProxy')
        if (apiProxy === undefined) return new Response('not found', { status: 404 })
        return toFetchHandler(apiProxy, { authenticatedProductCall }).fetch(request)
      },
    })
  const route: WebRoute = {
    kind: 'prefix',
    path: API_PATH,
    handler: async (req, res) => {
      const pathname = new URL(req.url ?? '/', 'http://clocky.internal').pathname
      const opaqueBootstrapNavigation = productAuth?.isBootstrapPath(pathname) === true
        && productAuth.isFormBootstrapRequest(req)
      if (!isTrustedApiRequest(req, trustedHosts, { allowOpaqueLoopbackNavigation: opaqueBootstrapNavigation })) {
        res.writeHead(403)
        res.end('forbidden')
        return
      }
      if (productAuth?.isBootstrapPath(pathname) === true) {
        if (!isTrustedApiRequest(req, [], {
          allowOpaqueLoopbackNavigation: opaqueBootstrapNavigation,
        })) {
          res.writeHead(403)
          res.end('forbidden')
          return
        }
        await bridge(req, res, { fetch: request => productAuth.bootstrap(request) }, maxRequestBodyBytes)
        return
      }
      if (productAuth === undefined) {
        await bridge(req, res, fetchHandlerFor(undefined), maxRequestBodyBytes)
        return
      }
      const admission = await productAuth.withCall(req, async (call) => {
        await bridge(req, res, fetchHandlerFor(call), maxRequestBodyBytes, call.signal)
      })
      if (admission.kind !== 'authenticated') {
        await writeProductAuthRejection(res, productAuth, admission.kind)
      }
    },
  }
  ctx.effect(() => ctx.webServer.register(route), 'client-connection: /api route')
  ctx.inject(['apiProxy'], (apiCtx) => {
    assertImageBodyCapacity(apiCtx, maxRequestBodyBytes)
    const downlinks = new WebSocketDownlinks(apiCtx.apiProxy)
    const registerDownlink = (
      path: string,
      handle: AuthenticatedDownlinkHandler,
    ): void => {
      apiCtx.effect(() => apiCtx.webServer.registerUpgrade({
        path,
        handler: async (req, socket, head) => {
          if (!isTrustedApiRequest(req, trustedHosts)) {
            rejectWebSocketUpgrade(socket)
            return
          }
          if (productAuth === undefined) {
            await handle(req, socket, head)
            return
          }
          const admission = await productAuth.withCall(req, async (call) => {
            await handle(req, socket, head, call.signal)
          })
          if (admission.kind !== 'authenticated') rejectWebSocketUpgrade(socket)
        },
      }), `client-connection: ${path} WebSocket`)
    }
    apiCtx.effect(() => () => downlinks.close(), 'client-connection: WebSocket downlinks')
    registerDownlink(MUX_EVENTS_PATH, (req, socket, head, productSignal) => downlinks.handleMux(req, socket, head, productSignal))
    registerDownlink(HOST_EVENTS_PATH, (req, socket, head, productSignal) => downlinks.handleHost(req, socket, head, productSignal))
  })
}
