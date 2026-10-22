/** Public page, observation and retained-input allowances; Host capabilities independently govern management. */
import { z } from 'zod'

/** Deployment page request size; the Host independently enforces its own allowance. */
export const Config = z.strictObject({
  maxExportBytes: z.number().int().positive().default(16777216),
  maxExportPages: z.number().int().positive().default(2048),
  pageSize: z.number().int().positive().default(32),
  sourceRefreshMs: z.number().int().positive().max(2147483647).default(2000),
  controlRefreshMs: z.number().int().positive().max(2147483647).default(2000),
  /** Real milliseconds after which a run observation is shown as "last observed"; absent derives from `controlRefreshMs`. */
  staleAfterMs: z.number().int().positive().max(2147483647).optional(),
  watchWaitMs: z.number().int().positive().max(2147483647).default(10000),
  watchRetryMs: z.number().int().positive().max(2147483647).default(2000),
  maxRetainedCommands: z.number().int().positive().default(64),
  commandTimeoutMs: z.number().int().positive().max(2147483647).default(30000),
  maxCommandBytes: z.number().int().positive().default(262144),
  maxInputDrafts: z.number().int().positive().default(16),
  maxDraftBytes: z.number().int().positive().default(65536),
  /** World authoring slot allowance in UTF-8 bytes; matches the Host compiler source ceiling
     * and is measured separately from shared drafts. */
  maxWorldDraftBytes: z.number().int().positive().default(262144),
  /** Concurrent in-memory World authoring slots. */
  maxWorldDrafts: z.number().int().positive().max(16).default(4),
  /** In-memory undo steps per World draft. */
  draftUndoDepth: z.number().int().positive().max(200).default(20),
  /** Default drain budget offered in the stop-target form: settlement steps, tokens and real minutes; users may change them per target. */
  stopDrainMaxSteps: z.number().int().positive().max(1000000).default(32),
  stopDrainMaxTokens: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).default(262144),
  stopDrainMaxWallTimeMs: z.number().int().positive().max(86400000).default(600000),
  /** Wide-screen World inspector width ceiling in CSS pixels. */
  inspectorMaxWidth: z.number().int().min(360).max(960).default(520),
}).refine(value => value.staleAfterMs === undefined || value.staleAfterMs > value.controlRefreshMs * 2,
  { message: 'staleAfterMs must exceed two control refresh intervals', path: ['staleAfterMs'] })
  .default({ maxExportBytes: 16777216, maxExportPages: 2048, pageSize: 32, sourceRefreshMs: 2000,
    controlRefreshMs: 2000, watchWaitMs: 10000, watchRetryMs: 2000,
    maxRetainedCommands: 64, commandTimeoutMs: 30000, maxCommandBytes: 262144,
    maxInputDrafts: 16, maxDraftBytes: 65536, maxWorldDraftBytes: 262144, maxWorldDrafts: 4, draftUndoDepth: 20,
    inspectorMaxWidth: 520, stopDrainMaxSteps: 32, stopDrainMaxTokens: 262144, stopDrainMaxWallTimeMs: 600000 })
/** Validated UI read allowances. */
export type Config = z.input<typeof Config>
