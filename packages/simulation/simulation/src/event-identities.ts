/** Primitive scheduler identities shared by event and calendar parsers without loading business schemas. */
import { z } from 'zod'
import type { SimulationEventId } from './identities.ts'
import type { Branded } from '@clocky/clocky-brand'

/** Stable event identity within a run. */
export const simulationEventIdSchema = z.string().min(1).transform(value => value as SimulationEventId)
/** Canonical decimal event counter, independent of storage and decision cursors. */
export const simulationEventSlotSchema = z.string().regex(/^(0|[1-9][0-9]*)$/)
  .transform(value => value as Branded<'SimulationEventSlot'>)
