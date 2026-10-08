import { describe, expect, it, vi } from 'vitest'
import { trackTeamOperation } from '../src/operation-lifecycle.ts'

describe('accepted Team operation lifetime', () => {
  it('retains a duplicate operation once and releases it when the original fulfills', async () => {
    const pending = Promise.withResolvers<boolean>()
    const accepted = new Set<typeof pending.promise>()
    const diagnostic = vi.fn()
    trackTeamOperation(accepted, pending.promise, diagnostic)
    trackTeamOperation(accepted, pending.promise, diagnostic)
    expect([...accepted]).toEqual([pending.promise])
    pending.resolve(true)
    expect(await pending.promise).toBe(true)
    expect(accepted.size).toBe(0)
    expect(diagnostic).not.toHaveBeenCalled()
  })

  it('releases ownership before diagnosis and preserves the caller-visible rejection', async () => {
    const pending = Promise.withResolvers<boolean>()
    const accepted = new Set<typeof pending.promise>()
    const failure = new Error('operation rejected')
    const diagnostic = vi.fn((error: unknown) => {
      expect(accepted.size).toBe(0)
      expect(error).toBe(failure)
    })
    trackTeamOperation(accepted, pending.promise, diagnostic)
    pending.reject(failure)
    await expect(pending.promise).rejects.toBe(failure)
    expect(diagnostic).toHaveBeenCalledExactlyOnceWith(failure)
  })

  it('contains a failed diagnostic without retaining the settled operation', async () => {
    const pending = Promise.withResolvers<boolean>()
    const accepted = new Set<typeof pending.promise>()
    const failure = new Error('operation rejected')
    trackTeamOperation(accepted, pending.promise, () => { throw new Error('diagnostic rejected') })
    pending.reject(failure)
    await expect(pending.promise).rejects.toBe(failure)
    expect(accepted.size).toBe(0)
  })
})
