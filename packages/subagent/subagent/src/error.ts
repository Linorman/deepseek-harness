/**
 * Typed failures shared by subagent service and provider operations.
 *
 * @module @clocky/clocky-subagent
 */

import { HarnessError } from '@clocky/clocky-llm'

/** Typed failure for the subagent seam. */
export class SubagentError extends HarnessError {
  constructor(message: string, code: string, options?: ErrorOptions) {
    super(message, code, options)
    this.name = 'SubagentError'
  }
}
