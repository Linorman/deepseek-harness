import { describe, expect, it } from 'vitest'
import { CursorActivity, SerialQueue } from '../src/activity.ts'

describe('SerialQueue', () => {
  it('serializes accepted work and permits the next command after a rejection', async () => {
    const queue = new SerialQueue()
    const order: string[] = []
    let releaseFirst: (() => void) | undefined
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve })
    const first = queue.run(async () => {
      order.push('first:start')
      await firstGate
      order.push('first:end')
      return 'first'
    })
    const second = queue.run(async () => {
      order.push('second')
      return 'second'
    })

    await Promise.resolve()
    expect(order).toEqual(['first:start'])
    releaseFirst?.()
    await expect(Promise.all([first, second])).resolves.toEqual(['first', 'second'])
    expect(order).toEqual(['first:start', 'first:end', 'second'])

    const failure = new Error('first command rejected')
    const rejected = queue.run(async () => { throw failure })
    const recovered = queue.run(async () => 'recovered')
    await expect(rejected).rejects.toBe(failure)
    await expect(recovered).resolves.toBe('recovered')
  })
})

describe('CursorActivity', () => {
  it('returns current cursors and closed state without registering a waiter', async () => {
    const activity = new CursorActivity()

    await expect(activity.wait(4, 3, undefined)).resolves.toEqual({ kind: 'changed', cursor: 4 })
    activity.close()
    activity.close()
    await expect(activity.wait(4, 4, undefined)).resolves.toEqual({ kind: 'closed' })
  })

  it('notifies only waiters whose exclusive cursor was passed and closes the remainder', async () => {
    const activity = new CursorActivity()
    const changed = activity.wait(0, 0, undefined)
    const stillWaiting = activity.wait(0, 1, undefined)
    let settled = false
    void stillWaiting.then(() => { settled = true })

    activity.notify(1)
    await expect(changed).resolves.toEqual({ kind: 'changed', cursor: 1 })
    await Promise.resolve()
    expect(settled).toBe(false)

    const cancellable = new AbortController()
    const signalled = activity.wait(0, 0, cancellable.signal)
    activity.notify(1)
    await expect(signalled).resolves.toEqual({ kind: 'changed', cursor: 1 })

    activity.close()
    await expect(stillWaiting).resolves.toEqual({ kind: 'closed' })
  })

  it('removes aborted waits and preserves supplied abort diagnostics', async () => {
    const activity = new CursorActivity()
    const alreadyAborted = new AbortController()
    const supplied = new Error('caller cancelled')
    alreadyAborted.abort(supplied)
    await expect(activity.wait(0, 0, alreadyAborted.signal)).rejects.toBe(supplied)

    const nonErrorAbort = AbortSignal.abort('timeout')
    await expect(activity.wait(0, 0, nonErrorAbort)).rejects.toMatchObject({
      message: 'The operation was aborted',
      cause: 'timeout',
    })

    const missingReason = { aborted: true, reason: undefined } as AbortSignal
    await expect(activity.wait(0, 0, missingReason)).rejects.toThrow('The operation was aborted')

    const later = new AbortController()
    const pending = activity.wait(0, 0, later.signal)
    later.abort(supplied)
    await expect(pending).rejects.toBe(supplied)
    activity.notify(1)
  })

  it('settles a waiter when disposal closes the activity during listener registration', async () => {
    const activity = new CursorActivity()
    const closingSignal = {
      aborted: false,
      reason: undefined,
      addEventListener() { activity.close() },
      removeEventListener() {},
    } as unknown as AbortSignal

    await expect(activity.wait(0, 0, closingSignal)).resolves.toEqual({ kind: 'closed' })
  })
})
