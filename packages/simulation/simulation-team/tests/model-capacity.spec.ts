import { expect, it } from 'vitest'
import { SimulationModelCapacity, SimulationModelCapacityExceeded } from '../src/model-capacity.ts'

it('keeps granted capacity until release and admits queued requests in FIFO order', async () => {
  const capacity = new SimulationModelCapacity(1, 2)
  const signal = new AbortController()
  const first = await capacity.acquire(signal.signal)
  let secondGranted = false
  const second = capacity.acquire().then((release) => { secondGranted = true; return release })
  const third = capacity.acquire()
  signal.abort()
  expect(capacity.snapshot()).toEqual({ active: 1, queued: 2, limit: 1, queueLimit: 2 })
  expect(secondGranted).toBe(false)
  await expect(capacity.acquire()).rejects.toThrow(/queue capacity/)
  await expect(capacity.acquire()).rejects.toMatchObject({ usage: { active: 1, queued: 2, limit: 1, queueLimit: 2 } })
  first()
  first()
  const releaseSecond = await second
  expect(capacity.snapshot()).toMatchObject({ active: 1, queued: 1 })
  releaseSecond()
  const releaseThird = await third
  releaseThird()
  expect(capacity.snapshot()).toMatchObject({ active: 0, queued: 0 })
})

it('preserves a typed zero-queue refusal only while its real permit remains occupied', async () => {
  const capacity = new SimulationModelCapacity(1, 0)
  const release = await capacity.acquire()
  await expect(capacity.acquire()).rejects.toBeInstanceOf(SimulationModelCapacityExceeded)
  await expect(capacity.acquire()).rejects.toMatchObject({ usage: { active: 1, queued: 0, limit: 1, queueLimit: 0 } })
  release()
  const resumed = await capacity.acquire()
  resumed()
})

it('removes an aborted waiter without consuming a permit', async () => {
  const capacity = new SimulationModelCapacity(1, 1)
  const release = await capacity.acquire()
  const signal = new AbortController()
  const pending = capacity.acquire(signal.signal)
  const rejected = expect(pending).rejects.toThrow(/cancelled/)
  signal.abort()
  await rejected
  expect(capacity.snapshot()).toMatchObject({ active: 1, queued: 0 })
  await expect(capacity.acquire(signal.signal)).rejects.toThrow(/cancelled/)
  release()
  const next = await capacity.acquire()
  next()
})

it('closes queued admission without returning active permits early', async () => {
  const capacity = new SimulationModelCapacity(1, 1)
  const release = await capacity.acquire()
  const queued = capacity.acquire()
  const rejected = expect(queued).rejects.toThrow(/closed/)
  capacity.close()
  await rejected
  expect(capacity.snapshot()).toMatchObject({ active: 1, queued: 0 })
  await expect(capacity.acquire()).rejects.toThrow(/closed/)
  release()
  expect(capacity.snapshot()).toMatchObject({ active: 0, queued: 0 })
})

it('skips an aborted queue head when an earlier abort listener releases the occupied permit', async () => {
  const capacity = new SimulationModelCapacity(1, 2)
  const release = await capacity.acquire()
  const controller = new AbortController()
  controller.signal.addEventListener('abort', release, { once: true })
  const waiting = capacity.acquire(controller.signal)
  const rejected = expect(waiting).rejects.toThrow(/cancelled/)
  const following = capacity.acquire()
  controller.abort(new Error('Cancel while capacity opens'))
  await rejected
  const releaseFollowing = await following
  expect(capacity.snapshot()).toMatchObject({ active: 1, queued: 0 })
  releaseFollowing()
  expect(capacity.snapshot()).toMatchObject({ active: 0, queued: 0 })
})

it('does not release a granted permit when an already captured cancellation callback arrives late', async () => {
  const { vi } = await import('vitest')
  const capacity = new SimulationModelCapacity(1, 1)
  const first = await capacity.acquire()
  const controller = new AbortController()
  const subscribe = vi.spyOn(controller.signal, 'addEventListener')
  const waiting = capacity.acquire(controller.signal)
  const callback = subscribe.mock.calls[0]?.[1]
  first()
  const release = await waiting
  if (typeof callback !== 'function') throw new Error('fixture abort callback missing')
  const following = capacity.acquire()
  callback.call(controller.signal, new Event('abort'))
  expect(capacity.snapshot()).toMatchObject({ active: 1, queued: 1 })
  release()
  const releaseFollowing = await following
  releaseFollowing()
  subscribe.mockRestore()
  expect(capacity.snapshot()).toMatchObject({ active: 0, queued: 0 })
})
