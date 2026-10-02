/** Public error categories survive separate bundled constructors and omit unrelated diagnostics. */
import { expect, it } from 'vitest'
import { isSimulationProductError } from '../src/errors.ts'
import { SimulationProductError } from '../src/index.ts'

it.each(['SIMULATION_PRODUCT_FORBIDDEN', 'SIMULATION_PRODUCT_INVALID', 'SIMULATION_PRODUCT_UNAVAILABLE', 'SIMULATION_PRODUCT_STALE'] as const)
('recognizes %s from original and separately bundled Error constructors', (code) => {
  expect(isSimulationProductError(new SimulationProductError('Public refusal', code))).toBe(true)
  class BundledError extends Error { readonly code = code }
  expect(isSimulationProductError(new BundledError('Public refusal'))).toBe(true)
})

it('ignores unknown codes, plain objects and uncategorized Error messages', () => {
  for (const cause of [null, 'diagnostic', { code: 'SIMULATION_PRODUCT_INVALID' }, new Error('private'),
    Object.assign(new Error('private'), { code: 'SIMULATION_PRODUCT_UNKNOWN' })]) {
    expect(isSimulationProductError(cause)).toBe(false)
  }
})
