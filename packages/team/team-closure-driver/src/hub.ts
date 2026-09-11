/** Core Team continuation backend for the closure-driver Consumer. @module @clocky/clocky-team-closure-driver/hub */

import { Context, Service } from '@clocky/cordis'
import z from '@clocky/schemastery'
import type { TeamActivationController } from '@clocky/clocky-team-activation-controller'
import type { TeamClosureDriveBackend, TeamClosureDriveRequest } from './types.ts'

/** Hub backend configuration. */
export interface Config {
  /** Registry identity selected by the paired closure-driver Consumer. */
  readonly backend: string
}

/** Schemastery validator for {@link Config}. */
export const Config: z<Config> = z.object({
  backend: z.string().min(1).required(),
})

/** Ready marker injected by the driver so its initial scan cannot outrun backend registration. */
export interface TeamClosureDriverHubReady {
  /** Registered backend identity. */
  readonly backend: string
}

declare module '@clocky/cordis' {
  interface Context {
    /** Hub continuation backend already registered for the paired closure driver. */
    teamClosureDriverHub: TeamClosureDriverHub
  }
}

/** Real Core Team backend that continues only a driver-issued durable recovery scope. */
export class TeamClosureDriverHub extends Service implements TeamClosureDriverHubReady {
  static inject = ['teams', 'teamClosureDrives', 'teamActivations']
  static Config = Config

  /** @param ctx - Context carrying the Team continuation API and driver backend registry.
   * @param config - Deployment-selected backend identity.
   */
  constructor(ctx: Context, config: Config) {
    super(ctx, 'teamClosureDriverHub')
    this.backend = resolveBackend(config.backend)
    const teams = ctx.get('teams')
    const backends = ctx.get('teamClosureDrives')
    const activations: TeamActivationController | undefined = ctx.get('teamActivations')
    if (teams === undefined || backends === undefined || activations === undefined) {
      throw new Error('team-closure-driver-hub requires Team, closure-drive registry, and activation-controller services')
    }
    const registered: TeamClosureDriveBackend = Object.freeze({
      name: this.backend,
      drive: async (request: TeamClosureDriveRequest): Promise<void> => {
        const team = request.state.team
        const continuation = {
          teamId: team.id,
          expectedCursor: team.cursor,
          actor: request.actor,
        }
        if (team.closure !== undefined || team.cancellation !== undefined) {
          await activations.recoverClosure(continuation)
          const current = await teams.getTeam({ teamId: team.id })
          if (current.team.cursor !== team.cursor) return
        }
        await teams.continueTeamClosure(continuation)
      },
    })
    const unregister = backends.registerBackend(registered)
    ctx.effect(() => unregister, 'team-closure-driver-hub: backend')
  }

  /** Registered backend identity paired with the driver configuration. */
  readonly backend: string
}

/** Validate a deployment-selected backend identity before it enters the registry. */
function resolveBackend(backend: string): string {
  if (backend.length === 0 || backend.trim() !== backend) {
    throw new TypeError('team-closure-driver-hub: backend must be non-empty without surrounding whitespace')
  }
  return backend
}

export default TeamClosureDriverHub
