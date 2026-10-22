/** Browser-safe metadata and original-source queries for conservative full-history archives. */
import type { z } from 'zod'
import type { simulationProductBackupExportInputSchema, simulationProductBackupExportResultSchema,
  simulationProductRetentionPreviewInputSchema, simulationProductRetentionPlanSchema,
  simulationProductRetentionExecuteInputSchema, simulationProductRetentionReadInputSchema, simulationProductRetentionResultSchema,
  simulationProductRetentionRecordsInputSchema, simulationProductRetentionRecordsResultSchema } from './retention-schema.ts'
/** Pure paused-source selection. */
export type SimulationProductRetentionPreviewInput = z.infer<typeof simulationProductRetentionPreviewInputSchema>
/** Exact source-bound conservative plan. */
export type SimulationProductRetentionPlan = z.infer<typeof simulationProductRetentionPlanSchema>
/** Durable original user command. */
export type SimulationProductRetentionExecuteInput = z.infer<typeof simulationProductRetentionExecuteInputSchema>
/** Original command result lookup. */
export type SimulationProductRetentionReadInput = z.infer<typeof simulationProductRetentionReadInputSchema>
/** Retained command outcome. */
export type SimulationProductRetentionResult = z.infer<typeof simulationProductRetentionResultSchema>
/** Separately authorized original archive record page selection. */
export type SimulationProductRetentionRecordsInput = z.infer<typeof simulationProductRetentionRecordsInputSchema>
/** Bounded original owner record page. */
export type SimulationProductRetentionRecordsResult = z.infer<typeof simulationProductRetentionRecordsResultSchema>

/** Original completed archive selected for private portable export. */
export type SimulationProductBackupExportInput = z.infer<typeof simulationProductBackupExportInputSchema>
/** Exact bounded private bundle bytes and integrity identities. */
export type SimulationProductBackupExportResult = z.infer<typeof simulationProductBackupExportResultSchema>
