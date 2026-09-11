import { describe, expect, it, vi } from 'vitest'
import type { SubprocessHandle } from '@clocky/clocky-subprocess'
import { proveAcpChildTermination } from '../src/termination.ts'

/** Build a tree-scoped subprocess fake with scripted exit observations. */
function child(outcomes: readonly boolean[], reject = false): SubprocessHandle & { readonly terminateSpy: ReturnType<typeof vi.fn> } {
  let index = 0
  const terminateSpy = vi.fn()
  return {
    pid: 1,
    stdin: undefined,
    stdout: undefined,
    stderr: undefined,
    collected: {},
    done: Promise.resolve({ exitCode: 0, signal: null }),
    terminate: terminateSpy,
    waitForExit: async () => {
      if (reject) throw new Error('scripted wait failure')
      return outcomes[index++] ?? false
    },
    terminateSpy,
  }
}

describe('ACP child termination proof', () => {
  it('accepts an observed child-tree exit without signaling it', async () => {
    const handle = child([true])
    await expect(proveAcpChildTermination(handle, 1)).resolves.toBeUndefined()
    expect(handle.terminateSpy).not.toHaveBeenCalled()
  })

  it('escalates once and rejects when the child tree still cannot be proven exited', async () => {
    const recovered = child([false, true])
    await expect(proveAcpChildTermination(recovered, 1)).resolves.toBeUndefined()
    expect(recovered.terminateSpy).toHaveBeenCalledOnce()

    const unconfirmed = child([false, false])
    await expect(proveAcpChildTermination(unconfirmed, 1)).rejects.toThrow('child process tree did not drain')
    expect(unconfirmed.terminateSpy).toHaveBeenCalledOnce()
  })

  it('caps the post-escalation observation timer at Node’s maximum delay', async () => {
    const maximum = 2_147_483_647
    const delays: number[] = []
    vi.stubGlobal('setTimeout', (callback: () => void, delay?: number): ReturnType<typeof setTimeout> => {
      void callback
      if (delay !== undefined) delays.push(delay)
      return {} as ReturnType<typeof setTimeout>
    })
    const unconfirmed = child([false, false])

    try {
      await expect(proveAcpChildTermination(unconfirmed, maximum)).rejects.toThrow('child process tree did not drain')
      expect(delays).toEqual([maximum, maximum])
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('treats a child wait failure as an unproven termination and still performs one escalation', async () => {
    const rejected = child([], true)
    await expect(proveAcpChildTermination(rejected, 1)).rejects.toThrow('child process tree did not drain')
    expect(rejected.terminateSpy).toHaveBeenCalledOnce()
  })
})
