/** Canonical original scenario preparation and finite calendar identities. */
import type { Branded } from '@clocky/clocky-brand'
import type { z } from 'zod'
import type { simulationWorldBootstrapRequestSchema, simulationWorldBootstrapBookSchema,
  simulationWorldInitialDataSchema, simulationWorldCalendarSchema, simulationWorldGoalTargetSchema } from './world-bootstrap.ts'

/** Run-local calendar identity selected in the portable definition. */
export type WorldCalendarId = Branded<'WorldCalendarId'>
/** Original scenario-authorized director declaration identity. */
export type WorldDirectorEventId = Branded<'WorldDirectorEventId'>
/** Exact frozen initial fields; later mutable runtime history cannot substitute their source. */
export type SimulationWorldInitialData = z.infer<typeof simulationWorldInitialDataSchema>
/** Original world bootstrap identity and complete data retained before local initialization. */
export type SimulationWorldBootstrapRequest = z.infer<typeof simulationWorldBootstrapRequestSchema>
/** Retained preparation authority and its sole eventual atomic application marker. */
export type SimulationWorldBootstrapBook = z.infer<typeof simulationWorldBootstrapBookSchema>
/** Finite periodic original goal with no host clock or executable callback. */
export type SimulationWorldCalendar = z.infer<typeof simulationWorldCalendarSchema>
/** A position is resolved at the actual occurrence rather than at compilation. */
export type SimulationWorldGoalTarget = z.infer<typeof simulationWorldGoalTargetSchema>
