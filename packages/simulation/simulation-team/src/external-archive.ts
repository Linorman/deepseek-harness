/** Explicit exact-version export ownership for state outside Native, Team and Session logs. */
import type { SimulationSnapshot, SimulationWorldDomainPin } from '@clocky/clocky-simulation'
import type { LogArchive, LogArchiveLimits } from '@clocky/clocky-storage'
import type { JsonValue } from '@clocky/clocky-session'

/** Provider source vector, shared by capture, verification and isolated restore without path configuration in the package. */
export interface WorldExternalArchiveSource {
  readonly snapshot: unknown
  readonly native: LogArchive
  readonly references: unknown
}
/** Installing plugin owns paths, pure payload verification and restore IO; pins never select a compatible substitute. */
export interface WorldExternalArchiveProvider {
  readonly id: string
  readonly pins: readonly SimulationWorldDomainPin[]
  /** Capture original bytes while the caller retains and revalidates the complete sealed owner collection. */
  capture(snapshot: SimulationSnapshot, source: WorldExternalArchiveSource, limits: LogArchiveLimits,
    validate: () => Promise<void>): Promise<JsonValue>
  /** Pure strict parser and complete source-reference verification; no runtime or filesystem access. */
  verify(payload: unknown, source: WorldExternalArchiveSource, limits: LogArchiveLimits): void
  /** Rebind only enclosing Native hashes after a verified offline conversion; original external file bytes stay exact. */
  rebindNativeMigration?(payload: unknown, source: WorldExternalArchiveSource, target: WorldExternalArchiveSource,
    limits: LogArchiveLimits): JsonValue
  /** Count original provider records after verification, contributing to the aggregate archive entry allowance. */
  entryCount(payload: unknown): number
  /** Restore/verify inside this provider's trusted isolated target configuration, before outer publication. */
  restore(payload: unknown, source: WorldExternalArchiveSource, limits: LogArchiveLimits): Promise<void>
}
/** Caller-supplied installed parser registry; its absence refuses custom-owner archives rather than granting coverage. */
export type WorldExternalArchiveProviders = ReadonlyMap<string, WorldExternalArchiveProvider>
