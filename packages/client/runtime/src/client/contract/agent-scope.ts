import type { Context } from '@clocky/cordis'
import type { TypertClientRemote, TypertRemoteScopeApi } from '@clocky/clocky-typert-protocol'

/** Client Cordis Context carrying one Agent identity and its scoped Remote namespaces. */
export type AgentContext = Omit<Context, 'remote'> & {
  readonly remote: TypertClientRemote & TypertRemoteScopeApi<'agent'>
}
