/** Independent context and history grants retire with the contributing plugin lifetime. */
import { expect, it, vi } from 'vitest'
import { apply } from '../src/context-readers.ts'

it('registers context, record and case policies and removes only their own grants on disposal', () => {
  const registerContext = vi.fn(() => vi.fn()), registerRecords = vi.fn(() => vi.fn()), registerCases = vi.fn(() => vi.fn())
  const lifetime: Array<() => void> = []
  const ctx = { simulationProducts: { contextReaderRegistrar: () => registerContext,
    recordReaderRegistrar: () => registerRecords, caseReaderRegistrar: () => registerCases },
  effect: (install: () => () => void) => { lifetime.push(install()) } } as never
  const readers = [{ principalId: 'reader', entityIds: ['buyer'] }] as never
  const recordReaders = [{ principalId: 'reader' }] as never
  const caseReaders = [{ principalId: 'reader', content: ['case'] }] as never
  apply(ctx, { readers, recordReaders, caseReaders })
  expect(registerContext).toHaveBeenCalledWith(readers)
  expect(registerRecords).toHaveBeenCalledWith(recordReaders)
  expect(registerCases).toHaveBeenCalledWith(caseReaders)
  lifetime.forEach((dispose) => { dispose() })
  expect(registerContext.mock.results[0]?.value).toHaveBeenCalledOnce()
  expect(registerRecords.mock.results[0]?.value).toHaveBeenCalledOnce()
  expect(registerCases.mock.results[0]?.value).toHaveBeenCalledOnce()
  registerContext.mockClear(); registerRecords.mockClear(); registerCases.mockClear()
  apply(ctx, { readers })
  expect(registerRecords).toHaveBeenCalledWith([])
  expect(registerCases).toHaveBeenCalledWith([])
})
