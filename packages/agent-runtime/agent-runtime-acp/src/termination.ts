/** Bounded ACP child-process termination proof. @module @clocky/clocky-agent-runtime-acp/termination */

import type { SubprocessHandle } from '@clocky/clocky-subprocess'

/** Node's largest safe timer delay; larger values overflow into immediate timers. */
const MAX_TIMER_DELAY_MS = 2_147_483_647

/**
 * Prove one ACP child exits, escalating once when its EOF grace expires. The
 * post-escalation observation includes another grace interval because the
 * subprocess provider may perform its own SIGTERM-to-SIGKILL drain.
 * @param child - ACP subprocess handle whose process tree must terminate.
 * @param timeoutMs - Maximum wait for each cooperative and escalated exit.
 * @returns resolution after the child exits, or rejection when termination remains unproven.
 */
export async function proveAcpChildTermination(child: SubprocessHandle, timeoutMs: number): Promise<void> {
  if (await waitForChild(child, timeoutMs)) return
  child.terminate()
  if (await waitForChild(child, Math.min(MAX_TIMER_DELAY_MS, timeoutMs * 2))) return
  throw new Error(`agent-runtime-acp: child process tree did not drain within ${timeoutMs}ms after termination`)
}

/** Wait for a child process to exit inside one bounded ACP disposal grace. */
async function waitForChild(child: SubprocessHandle, timeoutMs: number): Promise<boolean> {
  const controller = new AbortController()
  const timer = setTimeout(() => { controller.abort() }, timeoutMs)
  try {
    return await child.waitForExit(controller.signal)
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}
