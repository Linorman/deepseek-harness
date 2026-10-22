/** Pre-index bounded scan/fold strategy with the current parsers/invariants, for a like-for-like performance control. */
import { createHash } from 'node:crypto'
import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import { readJsonLogSnapshot } from '@clocky/clocky-storage-json'
import { readSqliteLogSnapshot } from '@clocky/clocky-storage-sqlite'
import { simulationInspectionSelectionSchema } from '@clocky/clocky-simulation'
import type { SimulationInspectionSelection, SimulationRunObservation, SimulationWorldDomainRegistry, NativeWorldDomain,
  SimulationSnapshot } from '@clocky/clocky-simulation'
import { foldEntry, foldEntries, SIMULATION_JOURNAL_VERSION } from '../src/journal.ts'
import { NativeWorldRuntime } from '../src/world-runtime.ts'
import { observeRunOwner } from '../src/owner.ts'
import { assertMaintenanceProjection } from '../src/maintenance.ts'
import { assertWorldBootstrapProjection } from '../src/world-bootstrap.ts'
import { assertWriterProjection } from '../src/writers.ts'
import { assertBusinessProjection } from '../src/decisions.ts'
import { assertSchedulerProjection } from '../src/scheduler.ts'
import { assertWorldGovernanceProjection } from '../src/world-governance.ts'
import { assertCalendarCommands } from '../src/world-calendar-command.ts'
import { assertGovernanceDeadlineProjection } from '../src/world-governance-deadline.ts'
import { assertNormAnnouncementProjection } from '../src/world-norm-announcement.ts'
import { assertNormProjection } from '../src/world-norms.ts'
import { assertExternalProjection } from '../src/world-external.ts'
import { assertExternalAdjudicationProjection } from '../src/world-external-mediated.ts'
import { assertExternalRepresentativeProjection } from '../src/world-external-actor.ts'
import { assertPersonnelProjection } from '../src/world-personnel.ts'
import { assertWorldExecutionTimeProjection } from '../src/world-execution-time.ts'
import { assertExternalAdjudicatedEventProjection } from '../src/world-external-mediated-event.ts'

/** Run the prior inspection algorithm without charging index construction to the control. */
export async function baselineInspection(root: string, backend: 'json' | 'sqlite', request: SimulationInspectionSelection,
  domains?: SimulationWorldDomainRegistry<NativeWorldDomain>): Promise<SimulationRunObservation | undefined> {
  const selection = simulationInspectionSelectionSchema.parse(request)
  const directory = join(root, createHash('sha256').update(selection.spec.runId).digest('hex'))
  const other = await stat(join(directory, backend === 'json' ? 'journal.sqlite' : 'journal')).catch((cause: unknown) => {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw cause
  })
  if (other !== undefined) throw new Error('Simulation run storage backend does not match')
  const descriptor = { name: 'simulation', version: SIMULATION_JOURNAL_VERSION }
  const limits = { maxEntries: 100000, maxBytes: 16777216 }
  const log = backend === 'json' ? await readJsonLogSnapshot(join(directory, 'journal'), descriptor, limits)
    : await readSqliteLogSnapshot(join(directory, 'journal.sqlite'), descriptor, limits)
  if (log === undefined) return undefined
  const first = log.entries[0]
  if (log.firstSequence !== 0 || first === undefined) throw new Error('Simulation inspection has no complete retained history')
  const runtime = domains === undefined ? undefined : new NativeWorldRuntime(domains)
  let state: SimulationSnapshot
  try {
    const initial = foldEntry(undefined, first, selection.spec, backend, runtime)
    state = foldEntries(initial, log.entries.slice(1), selection.spec, backend, runtime)
    assertMaintenanceProjection(state); assertWorldBootstrapProjection(state); assertWriterProjection(state)
    assertBusinessProjection(state, runtime); assertSchedulerProjection(state, runtime); assertWorldGovernanceProjection(state)
    assertCalendarCommands(state); assertGovernanceDeadlineProjection(state); assertNormAnnouncementProjection(state)
    assertNormProjection(state); assertExternalProjection(state); assertExternalAdjudicationProjection(state)
    assertExternalRepresentativeProjection(state); assertPersonnelProjection(state); assertWorldExecutionTimeProjection(state)
    assertExternalAdjudicatedEventProjection(state)
  } finally { runtime?.close() }
  return { snapshot: state, owner: await observeRunOwner(join(directory, 'owner.sqlite')),
    ...selection.includeRecords === true ? { records: log.entries } : {} }
}
