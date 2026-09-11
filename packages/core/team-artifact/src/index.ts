/**
 * Provider-independent Team artifact storage service. The Team Hub retains
 * references and provenance; this service owns bytes for files, patches,
 * logs, screenshots, and reports without importing a workspace provider.
 * @module @clocky/clocky-team-artifact
 */

import { Context, Service } from '@clocky/cordis'
import { TeamArtifactError } from './error.ts'
import type {
  TeamArtifactDeleteRequest,
  TeamArtifactCollectRequest,
  TeamArtifactCollectResult,
  TeamArtifactProvider,
  TeamArtifactProviderRef,
  TeamArtifactReadRequest,
  TeamArtifactWriteRequest,
} from './types.ts'
import type { TeamArtifactReference } from '@clocky/clocky-team'

declare module '@clocky/cordis' {
  interface Context {
    teamArtifacts: TeamArtifactStore
  }
}

export { TeamArtifactError } from './error.ts'
export type { TeamArtifactErrorCode } from './error.ts'
export type * from './types.ts'

/** Named artifact-provider registry at `ctx.teamArtifacts`. */
export class TeamArtifactStore extends Service {
  private readonly providers = new Map<string, TeamArtifactProvider>()

  /**
   * @param ctx - Cordis context that owns this registry.
   */
  constructor(ctx: Context) {
    super(ctx, 'teamArtifacts')
  }

  /**
   * Register one artifact provider under a unique name.
   * @param provider - provider that persists and verifies artifact bytes.
   * @returns an effect-scoped disposer.
   */
  registerProvider(provider: TeamArtifactProvider): () => void {
    assertProvider(provider)
    // oxlint-disable-next-line typescript/no-misused-promises -- the generator accepts an effect disposer function.
    return this.ctx.effect(function* (this: TeamArtifactStore) {
      if (this.providers.has(provider.name)) {
        throw new TeamArtifactError(
          `Team artifact provider '${provider.name}' is already registered`,
          'TEAM_ARTIFACT_PROVIDER_DUPLICATE',
        )
      }
      this.providers.set(provider.name, provider)
      yield () => {
        if (this.providers.get(provider.name) === provider) this.providers.delete(provider.name)
      }
    }.bind(this), 'teamArtifacts.registerProvider()')
  }

  /**
   * Resolve one provider by name.
   * @param name - provider identity.
   * @returns provider or undefined.
   */
  getProvider(name: string): TeamArtifactProvider | undefined {
    return this.providers.get(name)
  }

  /**
   * List registered provider identities.
   * @returns detached provider refs.
   */
  listProviders(): TeamArtifactProviderRef[] {
    return [...this.providers.values()].map(provider => ({ name: provider.name }))
  }

  /**
   * Save through one named provider.
   * @param provider - provider name.
   * @param request - write facts.
   * @returns immutable reference.
   */
  async save(provider: string, request: TeamArtifactWriteRequest): Promise<TeamArtifactReference> {
    return await this.resolve(provider).save(request)
  }

  /**
   * Read through one named provider.
   * @param provider - provider name.
   * @param request - read facts.
   * @returns verified bytes.
   */
  async read(provider: string, request: TeamArtifactReadRequest): Promise<Uint8Array> {
    return await this.resolve(provider).read(request)
  }

  /**
   * Delete through one named provider.
   * @param provider - provider name.
   * @param request - delete facts.
   * @returns completion after deletion.
   */
  async delete(provider: string, request: TeamArtifactDeleteRequest): Promise<void> {
    const implementation = this.resolve(provider)
    if (implementation.delete === undefined) {
      throw new TeamArtifactError(
        `Team artifact provider '${provider}' does not support deletion`,
        'TEAM_ARTIFACT_INVALID',
      )
    }
    await implementation.delete(request)
  }

  /**
   * Sweep one bounded provider page after a reachability owner has approved
   * exact object ids for reclamation.
   * @param provider - provider name.
   * @param request - current references, approved ids, cursor, and page bound.
   * @returns provider-owned scan and cleanup observations.
   */
  async collect(provider: string, request: TeamArtifactCollectRequest): Promise<TeamArtifactCollectResult> {
    const implementation = this.resolve(provider)
    if (implementation.collect === undefined) {
      throw new TeamArtifactError(
        `Team artifact provider '${provider}' does not support collection`,
        'TEAM_ARTIFACT_COLLECTION_UNAVAILABLE',
      )
    }
    return await implementation.collect(request)
  }

  private resolve(name: string): TeamArtifactProvider {
    const provider = this.providers.get(name)
    if (provider === undefined) {
      throw new TeamArtifactError(`Team artifact provider '${name}' is not registered`, 'TEAM_ARTIFACT_PROVIDER_NOT_FOUND')
    }
    return provider
  }
}

function assertProvider(provider: TeamArtifactProvider): void {
  if (provider.name.length === 0 || provider.name.trim() !== provider.name) {
    throw new TeamArtifactError('Team artifact provider name must be non-empty without surrounding whitespace', 'TEAM_ARTIFACT_PROVIDER_INVALID')
  }
}

export default TeamArtifactStore
