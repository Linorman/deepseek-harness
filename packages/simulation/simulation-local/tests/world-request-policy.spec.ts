/** Request policy admission on actual consumed Native prefixes; governance source provenance has its own owner suite. */
import { describe, expect, it } from 'vitest'
import { simulationNormVersionSchema, simulationWorldRequestOperationSchema, simulationProposalSchema,
  WORLD_GENERATE_AND_HIRE_PIN, WORLD_HIRE_EXISTING_PIN, simTimeSchema } from '@clocky/clocky-simulation'
import type { SimulationSnapshot } from '@clocky/clocky-simulation'
import type { NativeWorldRuntime } from '../src/world-runtime.ts'
import type { LogStream } from '@clocky/clocky-storage'
import { expandWorldProposals } from '../src/world.ts'
import { hiringResourceHarness } from './hiring-resource-harness.ts'

describe.each(['json', 'sqlite'] as const)('%s hiring request policy', (backend) => {
  it.each(['generate-and-hire', 'hire-existing'] as const)('rechecks an unaccepted original %s intent against current hard policy', async (mode) => {
    const h = await hiringResourceHarness(backend, mode)
    try {
      const pin = mode === 'hire-existing' ? WORLD_HIRE_EXISTING_PIN : WORLD_GENERATE_AND_HIRE_PIN
      const request = simulationWorldRequestOperationSchema.parse({ kind: 'world/request', domain: pin.domain,
        operation: pin.operation, version: pin.version, businessKey: 'policy-case', expectedTime: null, evidence: [],
        payload: { organizationEntityId: 'fee-org', positionEntityId: 'fee-vacancy',
          description: 'An original explicitly funded hire', ...mode === 'hire-existing' ? { personId: h.candidate } : {} } })
      await h.run.openWorldIntent(h.requester, request)
      const stream = Reflect.get(h.run, 'stream') as LogStream, append = stream.append.bind(stream)
      let before: SimulationSnapshot | undefined
      stream.append = async (expected, values, options) => {
        const current = h.run.snapshot()
        if (Object.keys(current.world!.requests).length === 0 && Object.values(current.decisions).some(value =>
          value.entityId === h.requester && value.status === 'open' && value.consumption !== undefined)) before = current
        return await append(expected, values, options)
      }
      await h.plan('policy-case')
      if (before === undefined) throw new Error('Missing original consumed request prefix')
      const decision = Object.values(before.decisions).find(value => value.entityId === h.requester && value.consumption !== undefined)!
      const runtime = Reflect.get(h.run, 'worldRuntime') as NativeWorldRuntime
      const norm = simulationNormVersionSchema.parse({ origin: 'governance', id: 'private-current-policy', version: '1',
        schemaRef: 'clocky.world-norm/1', subject: 'fee-org', scope: 'fee-org', body: 'PRIVATE-POLICY-CANARY',
        bodyHash: `sha256:${'1'.repeat(64)}`, proposal: { id: 'policy-proposal', revision: 1, bodyHash: `sha256:${'1'.repeat(64)}` },
        resolution: { id: 'policy-resolution', hash: `sha256:${'2'.repeat(64)}` }, status: 'enacted',
        enforcement: { kind: 'validated', policyRef: 'clocky.organization.hiring-approval/1',
          params: { committeeId: 'committee', positionIds: ['fee-role'], maxHires: 1 } }, supersedes: null,
        effectiveFrom: '0', effectiveUntil: null, availableAt: '100', audience: { kind: 'actors', entityIds: [h.director] },
        source: { requestId: 'policy-request', planId: 'policy-plan', mutationId: 'policy-mutation', references: [] }, recordedAt: 0, sequence: 1 })
      const withNorm = (value: typeof norm) => ({ ...before!, world: { ...before!.world!,
        norms: { ...before!.world!.norms, versions: { [value.id]: [value] } } } })
      const proposals = [simulationProposalSchema.parse({ after: [], action: request })]
      expect(() => expandWorldProposals(withNorm(norm), decision, proposals, runtime)).toThrow(/policy/)
      expect(expandWorldProposals(withNorm({ ...norm, effectiveFrom: simTimeSchema.parse('10') }), decision, proposals, runtime)).toHaveLength(2)
      expect(expandWorldProposals(withNorm({ ...norm, enforcement: { kind: 'advisory' } }), decision, proposals, runtime)).toHaveLength(2)
      expect(expandWorldProposals(withNorm({ ...norm, enforcement: { kind: 'validated',
        policyRef: 'clocky.organization.hiring-approval/1', params: { committeeId: norm.subject, positionIds: ['fee-vacancy' as typeof norm.subject], maxHires: 1 } } }),
      decision, proposals, runtime)).toHaveLength(2)
      expect(h.requests).toHaveLength(0)
    } finally { await h.close() }
  })
})
