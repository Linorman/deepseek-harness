import { createHash, type Hash } from 'node:crypto'
import { simulationNativeMigrationSchema } from '@clocky/clocky-simulation'
import type { LogEntry } from '@clocky/clocky-storage'
/** Per-owner immutable domain capabilities; journal replay never substitutes the current implementation. */
import { isDeepStrictEqual } from 'node:util'
import { SimulationWorldDomainError } from '@clocky/clocky-simulation'
import type { NativeWorldDomain, SimulationWorldDomainRegistry, SimulationWorldDomainLease,
  SimulationWorldDomainPin, SimulationWorldDefinition } from '@clocky/clocky-simulation'

/** Retains original pure reducers for the complete admitted Native owner lifetime. */
export class NativeWorldRuntime {
  private migration: import('@clocky/clocky-simulation').SimulationNativeMigration | undefined
  private migrationHash: Hash | undefined
  private migrationCursor = -1
  private migrationVerified = false
  private readonly retained = new Map<string, SimulationWorldDomainLease<NativeWorldDomain>>()

  /** @param registry - Explicit installed parser/reducer catalog; there is no global built-in fallback. */
  constructor(private readonly registry: SimulationWorldDomainRegistry<NativeWorldDomain>) {}

  /**
   * Select exact historical context profiles from creation provenance, never from a model action.
   * @param value - Strict migration passport or absent for ordinary journal 102.
   */
  configureMigration(value: unknown): void {
    if (value === undefined) return
    const selected = simulationNativeMigrationSchema.parse(value)
    if (this.migration !== undefined) {
      if (!isDeepStrictEqual(this.migration, selected)) throw new Error('Native migration provenance changed')
      return
    }
    for (const context of selected.contexts) {
      if (this.original(context.pin).contextProfiles?.[context.profile] === undefined)
        throw new SimulationWorldDomainError('SIM_WORLD_IMPLEMENTATION_UNAVAILABLE', 'Original context presenter is unavailable')
    }
    this.migration = selected
    this.migrationHash = createHash('sha256').update('{"name":"simulation","version":101,"entries":[')
  }

  /**
   * Verify the unchanged original prefix while replay advances, restoring the original creation bytes for hashing.
   * @param entry - Actual contiguous journal record; no records are skipped or renumbered.
   */
  observeMigrationEntry(entry: LogEntry): void {
    const migration = this.migration
    if (migration === undefined || entry.sequence > migration.sourceRevision || this.migrationVerified) return
    if (entry.sequence !== this.migrationCursor + 1 || this.migrationHash === undefined)
      throw new Error('Native migration source prefix is incomplete')
    let value = entry.value
    if (entry.sequence === 0) {
      if (typeof value !== 'object' || value === null || Array.isArray(value) || !('migration' in value))
        throw new Error('Native migration has no creation passport')
      const { migration: _passport, ...original } = value
      value = original
    }
    if (entry.sequence > 0) this.migrationHash.update(',')
    this.migrationHash.update(JSON.stringify({ sequence: entry.sequence, value }))
    this.migrationCursor = entry.sequence
    if (entry.sequence === migration.sourceRevision) {
      const digest = this.migrationHash.update(']}').digest('hex')
      if (digest !== migration.sourceHash) throw new Error('Native migration original prefix hash differs')
      this.migrationVerified = true
      this.migrationHash = undefined
    }
  }

  /**
   * Select the physical descriptor retained by an original historical checkpoint.
   * @param revision - Actual historical record sequence.
   * @returns the original descriptor only inside the proven source cut; subsequent records require 102.
   */
  journalVersion(revision: number): 101 | 102 {
    return this.migration !== undefined && revision <= this.migration.sourceRevision ? 101 : 102
  }

  /**
   * Refuse projection publication until the complete declared source prefix has been replayed.
   * @returns only after verification; truncated migrations reject.
   */
  assertMigrationComplete(): void {
    if (this.migration !== undefined && !this.migrationVerified) throw new Error('Native migration original prefix is missing')
  }

  /**
   * Read the exact retained presenter only while replaying the declared original prefix.
   * @param pin - Original business protocol pin; presentation selection never changes execution.
   * @param revision - Prefix at which the original context was prepared.
   * @returns current or exact retained pure model-context methods; unavailable historical profiles reject.
   */
  context(pin: SimulationWorldDomainPin, revision: number): Pick<NativeWorldDomain, 'goalContext' | 'planningContext'> {
    const domain = this.original(pin)
    const selected = this.migration !== undefined && revision <= this.migration.sourceRevision
      ? this.migration.contexts.find(value => isDeepStrictEqual(value.pin, pin)) : undefined
    if (selected === undefined) return domain
    const profile = domain.contextProfiles?.[selected.profile]
    if (profile === undefined) throw new SimulationWorldDomainError('SIM_WORLD_IMPLEMENTATION_UNAVAILABLE', 'Original context presenter is unavailable')
    return profile
  }

  /**
   * Obtain a pure exact-pin parser without capturing any new execution lease.
   * @param pin - Retained frozen-context pin.
   * @param kind - Proposed request or apply-plan payload.
   * @returns original strict parser; missing protocol identities reject.
   */
  payloadSchema(pin: SimulationWorldDomainPin, kind: 'request' | 'plan'): import('zod').z.ZodType {
    return this.registry.payloadSchema(pin, kind)
  }

  /**
   * Require every frozen manifest entry before world bootstrap or replay can proceed.
   * @param definition - Original journal-owned world definition.
   */
  manifest(definition: SimulationWorldDefinition): void {
    for (const pin of definition.operations) this.original(pin)
  }

  /**
   * Read one original pure implementation and hold it until Native owner cleanup.
   * @param pin - Complete original schema/artifact/generation identity.
   * @returns the exact installed implementation; missing or replaced generations reject.
   */
  original(pin: SimulationWorldDomainPin): NativeWorldDomain {
    const key = JSON.stringify([pin.domain, pin.operation, pin.version, pin.schemaRef, pin.implementationRef, pin.generation])
    const retained = this.retained.get(key)
    if (retained !== undefined) return retained.implementation
    const lease = this.registry.acquire(pin)
    this.retained.set(key, lease)
    return lease.implementation
  }

  /**
   * Verify a fresh request still has live admission under the original manifest entry.
   * @param pin - Original operation identity.
   * @returns original pure implementation only while its exact registration accepts new work.
   */
  admitting(pin: SimulationWorldDomainPin): NativeWorldDomain {
    if (!isDeepStrictEqual(this.registry.pin({ domain: pin.domain, operation: pin.operation, version: pin.version }), pin)) {
      throw new SimulationWorldDomainError('SIM_WORLD_IMPLEMENTATION_MISMATCH', 'World admission differs from its original installed manifest')
    }
    return this.original(pin)
  }

  /** Release all pure implementation leases after Native work and its durable owner drain. */
  close(): void {
    for (const lease of this.retained.values()) lease.release()
    this.retained.clear()
  }
}

/**
 * Refuse World operations without an explicitly installed Native parser/reducer catalog.
 * @param runtime - Native owner catalog, absent for runs using only the base simulation capabilities.
 * @returns original owner catalog.
 */
export function requireWorldRuntime(runtime: NativeWorldRuntime | undefined): NativeWorldRuntime {
  if (runtime === undefined) {
    throw new SimulationWorldDomainError('SIM_WORLD_IMPLEMENTATION_UNAVAILABLE', 'World operations require an installed Native domain catalog')
  }
  return runtime
}
