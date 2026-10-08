/** Retained original creation used by journal recovery tests. */
import { simulationCompanyCreationSchema } from '../src/creation-schema.ts'
import { simulationCreationEntrySchema } from '../src/creation-book.ts'
import { simulationProductOriginalCreateInputSchema } from '../src/administration-schema.ts'
import { registration } from './fixtures.ts'
import { companyConfig } from './company-driver-fixture.ts'

export function accepted() {
  const native = registration('allocated')
  const input = simulationProductOriginalCreateInputSchema.parse({ commandId: 'create', templateId: 'company', templateVersion: '1',
    name: 'Company', parameters: { buyerName: 'Buyer', supplierName: 'Supplier', initialStock: '2' } })
  const creation = simulationCompanyCreationSchema.parse({ request: input,
    record: { ...native, name: input.name, spec: { ...native.spec, runId: native.id }, registeredAt: 1 }, driver: companyConfig,
    preparation: { version: '1', ownerName: `simulation-product/${native.id}`, objective: 'One unit', ...input.parameters,
      participant: { provider: 'in-process', preset: 'simulation', model: 'company/scripted' },
      checkpoint: { id: `product-initial/${input.commandId}`, maxDrainRounds: 4, maxAttempts: 3 } } })
  const entry = simulationCreationEntrySchema.parse({ kind: 'command/accepted', command: { kind: 'create', input, creation,
    ownerPrincipalId: native.ownerPrincipalId,
    receipt: { kind: 'create', commandId: input.commandId, runId: native.id, acceptedAt: 1, status: 'accepted' } } })
  if (entry.kind !== 'command/accepted' || entry.command.kind !== 'create') throw new Error('Fixture requires original creation')
  return { ...entry, command: entry.command }
}
