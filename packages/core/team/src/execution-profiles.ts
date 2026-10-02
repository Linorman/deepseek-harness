/** Public route descriptors are owned by their live deployment registrations. */
import type { Context } from '@clocky/cordis'
import { TeamError } from './error.ts'
import { teamExecutionProfileSchema } from './schema.ts'
import type {
  ParticipantInviteInput, TeamExecutionProfileChoice, TeamExecutionProfileId,
  TeamExecutionProfileRegistration, TeamExecutionProfilesInput, TeamExecutionProfilesPage,
} from './types.ts'

/** One Team runtime owns profile identities and their effect-scoped availability readers. */
export class ExecutionProfiles {
  private readonly entries = new Map<TeamExecutionProfileId, TeamExecutionProfileRegistration>()
  private revision = 0

  /** Register a public descriptor without retaining or exposing execution-root and credential data.
   * @param ctx - Registering plugin context whose disposal removes the profile.
   * @param entry - Public descriptor and a pure availability reader from its execution owner.
   * @returns effect-owned disposer for this exact registration.
   */
  register(ctx: Context, entry: TeamExecutionProfileRegistration): () => void {
    const profile = Object.freeze(teamExecutionProfileSchema.parse(entry.profile))
    const registered = { profile, availability: entry.availability }
    // oxlint-disable-next-line typescript/no-misused-promises -- direct return preserves Cordis disposer identity.
    return ctx.effect(() => {
      if (this.entries.has(profile.id)) throw new TeamError('Execution profile identity is already registered', 'TEAM_INVALID_ARGUMENT')
      this.entries.set(profile.id, registered)
      this.revision++
      return () => {
        this.entries.delete(profile.id)
        this.revision++
      }
    })
  }

  /** Validate a selected profile at the same point as the invitation's authority checks.
   * @param input - Complete invitation, including any selected profile identity.
   */
  assertInvitation(input: ParticipantInviteInput): void {
    if (input.executionProfileId === undefined) return
    const entry = this.entries.get(input.executionProfileId)
    if (entry === undefined || entry.availability().length > 0) {
      throw new TeamError('Selected execution profile is unavailable; refresh deployment choices', 'TEAM_EXECUTION_PROFILE_UNAVAILABLE')
    }
    const profile = entry.profile
    if (input.kind !== profile.kind || input.role !== profile.role || input.provider !== profile.provider
      || input.preset !== profile.preset || input.model !== profile.model || input.authScheme !== undefined) {
      throw new TeamError('Invitation descriptor does not match the selected execution profile', 'TEAM_INVALID_ARGUMENT')
    }
  }

  /** Return one bounded page without using a profile identity as authority.
   * @param input - Authorized Team and selected mechanism.
   * @param maxRows - Resolved provider row allowance.
   * @param maxBytes - Complete JSON response allowance, including selection and continuation.
   * @param reason - A current authorization/lifecycle denial suppresses all profile data.
   * @returns a bounded public page; a changed registration set invalidates continuation.
   */
  page(input: TeamExecutionProfilesInput, maxRows: number, maxBytes: number,
    reason?: TeamExecutionProfilesPage['reason']): TeamExecutionProfilesPage {
    const revision = this.revision
    const cursor = input.cursor
    if (reason === undefined && cursor !== undefined
      && (cursor.teamId !== input.teamId || cursor.kind !== input.kind || cursor.revision !== revision)) {
      throw new TeamError('Execution profile choices changed; refresh the catalog', 'TEAM_EXECUTION_PROFILE_STALE')
    }
    const selectedEntry = input.selectedId === undefined ? undefined : this.entries.get(input.selectedId)
    if (reason === undefined && selectedEntry !== undefined && selectedEntry.profile.kind !== input.kind) {
      throw new TeamError('Selected execution profile belongs to another member kind', 'TEAM_INVALID_ARGUMENT')
    }
    const selected = reason === undefined && selectedEntry !== undefined ? this.choice(selectedEntry) : undefined
    const items: TeamExecutionProfileChoice[] = []
    const page = (offset?: number): TeamExecutionProfilesPage => ({ teamId: input.teamId, kind: input.kind, revision,
      allowed: reason === undefined, ...reason === undefined ? {} : { reason }, items,
      ...selected === undefined ? {} : { selected },
      ...offset === undefined ? {} : { nextCursor: { teamId: input.teamId, kind: input.kind, revision, offset } } })
    const bytes = (value: TeamExecutionProfilesPage) => new TextEncoder().encode(JSON.stringify(value)).byteLength
    if (bytes(page()) > maxBytes) throw new TeamError('Execution profile metadata exceeds response allowance', 'TEAM_CHANNEL_BACKPRESSURE')
    if (reason !== undefined) return page()
    const matching = this.matching(input.kind)
    let position = 0
    let entry = matching.next()
    while (!entry.done && position < (cursor?.offset ?? 0)) { position++; entry = matching.next() }
    let next: number | undefined
    while (!entry.done) {
      const following = matching.next()
      if (items.length === maxRows) { next = position; break }
      items.push(this.choice(entry.value))
      if (bytes(page(following.done ? undefined : position + 1)) > maxBytes) {
        items.pop()
        if (items.length === 0) throw new TeamError('Execution profile row exceeds response allowance', 'TEAM_CHANNEL_BACKPRESSURE')
        next = position; break
      }
      position++
      entry = following
    }
    if (revision !== this.revision) throw new TeamError('Execution profiles changed during observation', 'TEAM_EXECUTION_PROFILE_STALE')
    return page(next)
  }

  /** Traverse descriptors without materializing the deployment catalog. */
  private *matching(kind: TeamExecutionProfilesInput['kind']): Generator<TeamExecutionProfileRegistration> {
    for (const entry of this.entries.values()) if (entry.profile.kind === kind) yield entry
  }

  /** Compute fresh public availability; the descriptor carries no mutable permission cache. */
  private choice(entry: TeamExecutionProfileRegistration): TeamExecutionProfileChoice {
    const reasons = [...entry.availability()]
    return { ...entry.profile, available: reasons.length === 0, reasons }
  }
}
