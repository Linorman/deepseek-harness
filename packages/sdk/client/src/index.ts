/**
 * TypeScript client SDK for Clocky runtime: spawn the
 * `clocky-jsonrpc-agent` runtime as a subprocess and drive agent turns over
 * stdio JSON-RPC. `Clocky` is the high-level run API;
 * `HarnessClient` is the lower-level protocol client. A pure library — it
 * registers nothing on a Cordis context; the runtime process it spawns is a
 * complete harness configured by its own `cordis.yml`.
 *
 * @module @clocky/clocky-sdk-client
 */

export { Clocky, HarnessSession } from './api.ts'
export type { RunOptions } from './api.ts'
export {
  HarnessClient,
  RequestTimeoutError,
  SdkProtocolError,
  TransportClosedError,
} from './client.ts'
export type { NotificationSubscription } from './client.ts'
export { JsonRpcResponseError } from '@clocky/clocky-sdk-protocol'
export type {
  ContentBlock,
  ClockyOptions,
  HarnessClientOptions,
  HarnessNotification,
  NotificationFilter,
  RunResult,
} from './types.ts'
