/**
 * SDK-facing JSON-RPC plugin over stdio. An external `cordis.yml` decides
 * whether to load it; see the single-executable Agent Note and package README.
 * Stdout is reserved for protocol frames, so the tree must not load a stdout logger.
 * This plugin answers `shutdown`, disposes the complete root runtime, and exits 0; the app bin
 * owns EOF and signal exits. Keep named plugin exports with no default export so
 * Loader `unwrapExports` preserves `name`, `inject`, `Config`, and `apply`.
 *
 * @module @clocky/clocky-sdk-jsonrpc-server
 */

import type { Context } from '@clocky/cordis'
import type { Readable, Writable } from 'node:stream'
import Schema from '@clocky/schemastery'
import type {} from '@clocky/cordis-plugin-loader'
import type {} from '@clocky/clocky-product-principal'
import { JsonRpcLineTransport } from '@clocky/clocky-sdk-protocol'
import { HarnessSdkJsonRpcServer } from './server.ts'

export * from './server.ts'

export const name = 'sdk-jsonrpc-server'
// Activation placement needs the Agent factory; every product request owns a TeamRun and authenticated connection.
export const inject = ['agents', 'teamRuns', 'productPrincipals']

/** JSON-RPC deployment config plus runtime-only test hooks. */
export interface JsonRpcConfig {
  /** Product-principal provider that authenticates one SDK connection handshake. */
  productPrincipalProvider?: string
  /** Transport input override; production uses `process.stdin`. */
  input?: Readable
  /** Transport output override; production uses `process.stdout`. */
  output?: Writable
  /** Process-exit override; production uses `process.exit`. */
  exit?: (code: number) => void
}

export const Config: Schema<JsonRpcConfig> = Schema.object({
  productPrincipalProvider: Schema.string().min(1).pattern(/^\S(?:.*\S)?$/).default('local'),
})

/**
 * Serve SDK requests over the configured streams. Effect disposal shuts down
 * SDK-created Teams and closes the transport. A `shutdown` response is flushed
 * before the root runtime is disposed and the process exits 0; the app bin
 * owns root-context disposal for EOF and signals.
 */
export function apply(ctx: Context, config: JsonRpcConfig): void {
  // Protocol shutdown owns the complete runtime process, so it must await the
  // root lifecycle (including persistence) before exiting.
  const rootFiber = ctx.root.fiber
  /* v8 ignore next -- production stdio wiring; tests always inject the runtime hooks */
  const input = config.input ?? process.stdin
  /* v8 ignore next -- production stdio wiring; tests always inject the runtime hooks */
  const output = config.output ?? process.stdout
  /* v8 ignore next -- production exit wiring; tests always inject the runtime hooks */
  const exit = config.exit ?? ((code: number): void => { process.exit(code) })

  const transport = new JsonRpcLineTransport(input, output)
  const server = new HarnessSdkJsonRpcServer(ctx, transport, config.productPrincipalProvider ?? 'local')

  // Share one exit task so racing shutdown requests cannot dispose the root or
  // exit the process more than once.
  let exitTask: Promise<void> | undefined
  const disposeAndExit = (): Promise<void> => {
    exitTask ??= (async () => {
      await Promise.allSettled([Promise.resolve().then(() => transport.flush())])
      await Promise.allSettled([Promise.resolve().then(() => rootFiber.dispose())])
      exit(0)
    })()
    return exitTask
  }

  transport.onRequest(async (method, params) => {
    // `initialize` is the SDK's readiness boundary. This plugin can activate
    // before async sibling Loader entries (for example an MCP client's initial
    // tool discovery), so do not advertise a ready runtime until the complete
    // current tree has settled. A hand-built context without Loader remains
    // immediately usable.
    if (method === 'initialize') await ctx.get('loader')?.await()
    const result = await server.handleRequest(method, params)
    if (method === 'shutdown') {
      // Run after the handler result is written; the task then flushes, disposes, and exits.
      setImmediate(() => { void disposeAndExit() })
    }
    return result
  })

  ctx.effect(() => {
    transport.start()
    return async () => {
      await server.shutdown()
      transport.close()
    }
  }, 'jsonrpc.serve')
}
