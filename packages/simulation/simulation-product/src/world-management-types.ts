/** Strict human management contracts; drafts contain choices, never actor identity or execution authority. */
import type { z } from 'zod'
import type { simulationProductWorldManagementDraftSchema, simulationProductWorldManagementFieldsInputSchema,
  simulationProductWorldManagementFieldsSchema, simulationProductWorldManagementPreviewSchema,
  simulationProductWorldManagementSubmitInputSchema, simulationProductWorldManagementOutcomeSchema } from './world-management-schema.ts'

/** Exact user choices before resolution to Native-owned business inputs. */
export type SimulationProductWorldManagementDraft = z.infer<typeof simulationProductWorldManagementDraftSchema>
/** Current field choices for one real person and action. */
export type SimulationProductWorldManagementFieldsInput = z.infer<typeof simulationProductWorldManagementFieldsInputSchema>
/** Metadata-only form with no reservation or executable configuration. */
export type SimulationProductWorldManagementFields = z.infer<typeof simulationProductWorldManagementFieldsSchema>
/** Inert actual impacts, obligations and the original Native preview commitment. */
export type SimulationProductWorldManagementPreview = z.infer<typeof simulationProductWorldManagementPreviewSchema>
/** Caller-retained original submission, including the precise confirmed preview. */
export type SimulationProductWorldManagementSubmitInput = z.infer<typeof simulationProductWorldManagementSubmitInputSchema>
/** Original Native business and callback observations; neither implies the other completed. */
export type SimulationProductWorldManagementOutcome = z.infer<typeof simulationProductWorldManagementOutcomeSchema>
