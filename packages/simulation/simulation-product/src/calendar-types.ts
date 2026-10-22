/** Strict calendar administration DTOs shared by Host and both SDK protocols. */
import type { z } from 'zod'
import type { simulationProductCalendarCommandInputSchema, simulationProductCalendarCommandResultSchema,
  simulationProductCalendarCancelSchema, simulationProductCalendarInputSchema, simulationProductCalendarPreviewSchema,
  simulationProductCalendarSubmitSchema, simulationProductCalendarReceiptSchema } from './calendar-schema.ts'
/** Complete original finite replacement request. */
export type SimulationProductCalendarInput = z.infer<typeof simulationProductCalendarInputSchema>
/** Inert exact Native-prefix quote. */
export type SimulationProductCalendarPreview = z.infer<typeof simulationProductCalendarPreviewSchema>
/** Original unchanged quote and command. */
export type SimulationProductCalendarSubmit = z.infer<typeof simulationProductCalendarSubmitSchema>
/** Durable Native acceptance receipt. */
export type SimulationProductCalendarReceipt = z.infer<typeof simulationProductCalendarReceiptSchema>
/** Exact original command lookup or latest-author recovery selector. */
export type SimulationProductCalendarCommandInput = z.infer<typeof simulationProductCalendarCommandInputSchema>
/** Original quote and current Native settlement, or indistinguishable unavailable identity. */
export type SimulationProductCalendarCommandResult = z.infer<typeof simulationProductCalendarCommandResultSchema>
/** Exact original command selected for safe pre-execution cancellation. */
export type SimulationProductCalendarCancel = z.infer<typeof simulationProductCalendarCancelSchema>
