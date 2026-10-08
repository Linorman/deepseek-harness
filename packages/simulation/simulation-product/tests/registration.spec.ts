/** The trusted process-local registrar retains exact allocations and bounds its own durable directory. */
import { expect, it, vi } from 'vitest'
import { fixture, registration, call } from './fixtures.ts'

it('serializes original registrations, rejects changed ownership and cannot serialize its writer', async () => {
  const h = await fixture()
  const { fiber, products } = await h.mount()
  const retain = products.creationRegistrar()
  expect(() => JSON.stringify(retain)).toThrow('process-local')
  const record = { ...registration('created'), registeredAt: 123 }
  await Promise.all([retain(record), retain(record)])
  expect((await products.list({}, call())).items).toHaveLength(2)
  await expect(retain({ ...record, registeredAt: 124 })).rejects.toThrow('registration changed')
  await expect(retain({ ...record, ownerPrincipalId: 'other' as never })).rejects.toThrow('registration changed')
  await retain(record)
  expect(h.ctx.storageLog.get('simulation-products')?.tailSequence).toBe(1)
  await fiber.dispose()
  await expect(retain(record)).rejects.toMatchObject({ code: 'SIMULATION_PRODUCT_UNAVAILABLE' })
})

it('retains earlier registrations when capacity or append refuses the next allocation', async () => {
  const h = await fixture('json', { maxRuns: 1 })
  const { products } = await h.mount()
  await expect(products.creationRegistrar()({ ...registration('overflow'), registeredAt: 123 })).rejects.toThrow('capacity')
  expect((await products.list({}, call())).items).toHaveLength(1)
  const another = await fixture()
  const next = await another.mount()
  const retain = next.products.creationRegistrar()
  const stream = another.ctx.storageLog.get('simulation-products')!
  vi.spyOn(stream, 'append').mockRejectedValueOnce(new Error('registration-write-unavailable'))
  const record = { ...registration('created'), registeredAt: 123 }
  await expect(retain(record)).rejects.toThrow('registration-write-unavailable')
  expect((await next.products.list({}, call())).items).toHaveLength(1)
  await retain(record)
  expect((await next.products.list({}, call())).items).toHaveLength(2)
})

it('keeps trusted reader registrars process-local, single-owner and closed after disposal', async () => {
  const h = await fixture()
  const { products, fiber } = await h.mount()
  const retry = products.operationRetryReaderRegistrar()
  const context = products.contextReaderRegistrar()
  const records = products.recordReaderRegistrar()
  expect(() => JSON.stringify(retry)).toThrow('process-local')
  expect(() => JSON.stringify(context)).toThrow('process-local')
  expect(() => JSON.stringify(records)).toThrow('process-local')
  const reader: Parameters<typeof retry>[0] = async (_runId, _operationId, native) => native
  const releaseRetry = retry(reader)
  expect(() => retry(reader)).toThrow('operation retry reader is unavailable')
  releaseRetry()
  const releaseRetryAgain = retry(reader)
  releaseRetry()
  releaseRetryAgain()
  const grant = [{ principalId: 'reader' as never, entityIds: ['actor' as never] }]
  const releaseContext = context(grant)
  releaseContext()
  releaseContext()
  const disclosure = [{ principalId: 'reader' as never }]
  const releaseRecords = records(disclosure)
  releaseRecords()
  releaseRecords()
  await fiber.dispose()
  expect(() => retry(reader)).toThrow('operation retry reader is unavailable')
  expect(() => context(grant)).toThrow('policy registration is closed')
  expect(() => records(disclosure)).toThrow('policy registration is closed')
})
