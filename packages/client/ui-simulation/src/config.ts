/** Public page, observation and retained-input allowances; Host capabilities independently govern management. */
import { z } from 'zod'

/** Deployment page request size; the Host independently enforces its own allowance. */
export const Config = z.strictObject({
  maxExportBytes: z.number().int().positive().default(16777216),
  maxExportPages: z.number().int().positive().default(2048),
  pageSize: z.number().int().positive().default(32),
  sourceRefreshMs: z.number().int().positive().max(2147483647).default(2000),
  controlRefreshMs: z.number().int().positive().max(2147483647).default(2000),
  watchWaitMs: z.number().int().positive().max(2147483647).default(10000),
  watchRetryMs: z.number().int().positive().max(2147483647).default(2000),
  maxRetainedCommands: z.number().int().positive().default(64),
  maxCommandBytes: z.number().int().positive().default(262144),
  maxInputDrafts: z.number().int().positive().default(16),
  maxDraftBytes: z.number().int().positive().default(65536),
}).default({ maxExportBytes: 16777216, maxExportPages: 2048, pageSize: 32, sourceRefreshMs: 2000,
  controlRefreshMs: 2000, watchWaitMs: 10000, watchRetryMs: 2000,
  maxRetainedCommands: 64, maxCommandBytes: 262144,
  maxInputDrafts: 16, maxDraftBytes: 65536 })
/** Validated UI read allowances. */
export type Config = z.input<typeof Config>
