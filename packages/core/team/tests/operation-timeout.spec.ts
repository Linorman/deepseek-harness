import { afterEach, expect, it, vi } from 'vitest'
import { withTeamOperationTimeout } from '../src/operation-timeout.ts'

afterEach(() => { vi.useRealTimers() })

it('removes the deadline after operation settlement without constructing a timeout failure', async () => {
  vi.useFakeTimers()
  const failure = vi.fn(() => new Error('timeout'))
  await expect(withTeamOperationTimeout(Promise.resolve('settled'), 100, failure)).resolves.toBe('settled')
  expect(vi.getTimerCount()).toBe(0)
  expect(failure).not.toHaveBeenCalled()
})

it('retains the exact provider timeout and leaves the underlying operation owned by its caller', async () => {
  vi.useFakeTimers()
  const operation = Promise.withResolvers<string>()
  const failure = new Error('provider disposal timed out')
  const wait = withTeamOperationTimeout(operation.promise, 100, () => failure)
  const observed = expect(wait).rejects.toBe(failure)
  await vi.advanceTimersByTimeAsync(100)
  await observed
  expect(vi.getTimerCount()).toBe(0)
  operation.resolve('drained later')
  await expect(operation.promise).resolves.toBe('drained later')
})
