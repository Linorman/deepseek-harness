/** Explicit financial declarations compile only existing compatible resources and preserve reviewed original terms. */
import { expect, it } from 'vitest'
import { simulationHiringFeePolicySchema } from '@clocky/clocky-simulation/world-authoring'
import { compileWorldScenarioV1 } from '../src/v1-compiler.ts'
import { sample, deployment } from './v1-fixtures.ts'
function fixture() {
  const definition = structuredClone(sample), payer = definition.entities.find(value => value.kind === 'person' && value.cognition === 'agent' && value.role === 'member')!
  const payee = definition.entities.find(value => value.kind === 'person' && value.cognition === 'agent' && value.role === 'director')!
  definition.resources.push({ id: 'fee-cash' as never, owner: payer.id as never, controllers: [payer.id as never], kind: 'money', unit: 'credit', quantity: '10' as never },
    { id: 'fee-payee' as never, owner: payee.id as never, controllers: [payee.id as never], kind: 'money', unit: 'credit', quantity: '0' as never })
  definition.organization.hiringFees = [simulationHiringFeePolicySchema.parse({ id: 'price', version: '1', policyRef: 'clocky.organization.hiring-fee/1',
    operation: 'generate-and-hire', positionEntityId: definition.organization.positions[0]!.id, from: 'fee-cash', to: 'fee-payee',
    unit: 'credit', quantity: '6', grants: [], reservationPeriod: '5' })]
  return definition
}
it('freezes explicit fee terms in the resolved world, including the original charge deadline policy', async () => {
  const definition = fixture(), result = await compileWorldScenarioV1(definition, deployment)
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error('Explicit fee fixture did not compile')
  expect(result.resolved.compilerVersion).toBe('9')
  expect(result.resolved.world.hiringFees).toEqual(definition.organization.hiringFees)
  const changed = structuredClone(definition); changed.organization.hiringFees![0]!.quantity = '7' as never
  const next = await compileWorldScenarioV1(changed, deployment)
  if (!next.ok) throw new Error('Changed explicit fee fixture did not compile')
  expect(next.resolved.definitionHash).not.toBe(result.resolved.definitionHash)
  expect(next.preview.hash).not.toBe(result.preview.hash)
})
it.each(['missing-account', 'unit', 'kind', 'position', 'operation', 'quantity', 'deadline', 'duplicate-policy', 'duplicate-target'] as const)(
  'rejects %s financial declaration during pure preflight', async (variant) => {
    const definition = fixture(), fee = definition.organization.hiringFees![0]!
    if (variant === 'missing-account') fee.from = 'missing-cash' as never
    if (variant === 'unit') definition.resources[0]!.unit = 'usd'
    if (variant === 'kind') definition.resources[0]!.kind = 'inventory'
    if (variant === 'position') fee.positionEntityId = definition.organization.rootId as never
    if (variant === 'operation') fee.operation = 'hire-existing'
    if (variant === 'quantity') fee.quantity = String(BigInt(deployment.native.maxResourceQuantity) + 1n) as never
    if (variant === 'deadline') fee.reservationPeriod = String(BigInt(deployment.native.maxTime) + 1n) as never
    if (variant === 'duplicate-policy') definition.organization.hiringFees!.push({ ...fee })
    if (variant === 'duplicate-target') definition.organization.hiringFees!.push({ ...fee, id: 'different-price' as never })
    const result = await compileWorldScenarioV1(definition, deployment)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('Malformed fee unexpectedly compiled')
    expect(result.diagnostics.some(value => value.path[0] === 'organization' && value.path[1] === 'hiringFees')).toBe(true)
  })
