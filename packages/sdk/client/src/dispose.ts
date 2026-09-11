/**
 * Private teardown ladder for the runtime subprocess: stdin EOF (cooperative
 * quiesce), then SIGTERM, then SIGKILL, resolving only after the process has
 * actually exited. The SDK client runs OUTSIDE any harness context, so it
 * cannot ride the `clocky-subprocess` service — this module is the seam's
 * documented exception for SDK-managed transports.
 *
 * @module @clocky/clocky-sdk-client/dispose
 */

import type { ChildProcess } from 'node:child_process'

/**
 * Race the child's exit against a timer. Neither outcome leaves anything
 * behind on the child: the exit listener is removed on timeout and the timer
 * is cleared on exit, so the ladder's tiers never accumulate listeners.
 */
function exitsWithin(child: ChildProcess, ms: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true)
  return new Promise<boolean>((resolve) => {
    const onExit = (): void => {
      clearTimeout(timer)
      resolve(true)
    }
    // `.unref()` so a pending grace timer never keeps the parent's loop alive.
    const timer = setTimeout(() => {
      child.removeListener('exit', onExit)
      resolve(false)
    }, ms).unref()
    child.once('exit', onExit)
  })
}

/** Force-terminate the runtime and reject if no exit edge arrives within the grace. */
function forceTerminateWithin(child: ChildProcess, ms: number): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve()
  return new Promise<void>((resolve, reject) => {
    let accepted = false
    let settled = false
    const cleanup = (): void => {
      clearTimeout(timer)
      child.off('exit', onExit)
      child.off('error', onError)
    }
    const settle = (complete: () => void): void => {
      if (settled) return
      settled = true
      cleanup()
      complete()
    }
    const onExit = (): void => { settle(resolve) }
    const onError = (error: Error): void => { settle(() => { reject(error) }) }
    child.once('exit', onExit)
    child.once('error', onError)
    const timer = setTimeout(() => {
      const disposition = accepted ? 'accepted' : 'refused'
      settle(() => {
        reject(new Error(`runtime process did not exit within ${ms}ms after SIGKILL was ${disposition}`))
      })
    }, ms).unref()
    try {
      accepted = child.kill('SIGKILL')
      if (child.exitCode !== null || child.signalCode !== null) settle(resolve)
    } catch (error: unknown) {
      settle(() => { reject(new Error('SIGKILL failed', { cause: error })) })
    }
  })
}

interface ProcessGroupControl {
  signal(processGroupId: number, signal: 'SIGTERM' | 'SIGKILL'): void
  exists(processGroupId: number): boolean
}

const localProcessGroupControl: ProcessGroupControl = {
  signal: (processGroupId, signal) => { process.kill(-processGroupId, signal) },
  exists: (processGroupId) => {
    try {
      process.kill(-processGroupId, 0)
      return true
    } catch (error: unknown) {
      if (typeof error === 'object' && error !== null && 'code' in error
        && (error as { readonly code?: unknown }).code === 'ESRCH') return false
      throw error
    }
  },
}

/** Wait until a detached POSIX process group no longer has any members. */
async function groupExitsWithin(
  processGroupId: number,
  ms: number,
  control: ProcessGroupControl,
): Promise<boolean> {
  const deadline = Date.now() + ms
  while (control.exists(processGroupId)) {
    if (Date.now() >= deadline) return false
    await new Promise<void>((resolve) => { setTimeout(resolve, Math.min(20, deadline - Date.now())) })
  }
  return true
}

/** Terminate one detached POSIX process group and await complete group absence. */
async function disposeProcessGroup(
  processGroupId: number,
  graceMs: number,
  control: ProcessGroupControl,
): Promise<void> {
  if (!control.exists(processGroupId)) return
  control.signal(processGroupId, 'SIGTERM')
  if (await groupExitsWithin(processGroupId, graceMs, control)) return
  control.signal(processGroupId, 'SIGKILL')
  if (await groupExitsWithin(processGroupId, graceMs, control)) return
  throw new Error(`runtime process group ${processGroupId} did not exit within ${graceMs}ms after SIGKILL`)
}

/**
 * Tear the runtime down to quiescence, resolving only after exit: close stdin
 * and allow cooperative flush, then use the host's graceful and forced
 * termination semantics. POSIX sends `SIGTERM` before `SIGKILL`; Windows
 * skips directly to forced termination because Node maps both signals to
 * `TerminateProcess`.
 * @param child - the runtime child process to tear down.
 * @param graces - the EOF and termination-confirmation windows (ms).
 * @param platform - the host platform, injectable for unit coverage.
 * @param detached - whether the child owns an isolated POSIX process group.
 * @throws When forced termination errors or the child does not report exit
 * within `disposeGraceMs`.
 */
export async function disposeRuntimeProcess(
  child: ChildProcess,
  graces: { disposeEofGraceMs: number; disposeGraceMs: number },
  platform: NodeJS.Platform = process.platform,
  detached = false,
  processGroups: ProcessGroupControl = localProcessGroupControl,
): Promise<void> {
  const processGroupId = detached && platform !== 'win32' ? child.pid : undefined
  if (processGroupId !== undefined && (!Number.isSafeInteger(processGroupId) || processGroupId <= 0)) {
    throw new Error('detached runtime child has no valid process group identity')
  }
  // A detached leader can exit while a descendant still owns the group.
  if (child.exitCode !== null || child.signalCode !== null) {
    if (processGroupId !== undefined) await disposeProcessGroup(processGroupId, graces.disposeGraceMs, processGroups)
    return
  }
  // 1. Close stdin and allow cooperative teardown and durable-state flush.
  child.stdin?.end()
  if (await exitsWithin(child, graces.disposeEofGraceMs)) {
    if (processGroupId === undefined) return
    await disposeProcessGroup(processGroupId, graces.disposeGraceMs, processGroups)
    return
  }
  // 2. POSIX gets a catchable graceful signal; Windows signals all force-terminate.
  if (platform !== 'win32') {
    if (processGroupId === undefined) {
      child.kill('SIGTERM')
      if (await exitsWithin(child, graces.disposeGraceMs)) return
    } else {
      await disposeProcessGroup(processGroupId, graces.disposeGraceMs, processGroups)
      return
    }
  }
  // 3. Force-kill and await a bounded exit edge.
  if (processGroupId !== undefined) return
  await forceTerminateWithin(child, graces.disposeGraceMs)
}
