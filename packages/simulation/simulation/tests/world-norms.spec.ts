import { expect, expectTypeOf, it } from 'vitest'
import {
  simulationNormEnactRequestSchema, simulationNormRevokeRequestSchema, simulationNormEnforcementSchema,
  simulationNormReferenceSchema, simulationNormEffectSchema, simulationNormQuerySchema,
  simulationInitialNormSchema, simulationNormVersionSchema, simulationFrozenCommitteePolicySchema,
} from '../src/world-norms.ts'
import type { WorldNormVersion } from '../src/world-norms-types.ts'

const hash = `sha256:${'a'.repeat(64)}`
const input = { norm: { id: 'hiring-rule', version: '1' }, prior: null, proposal: { id: 'proposal', revision: 1, bodyHash: hash },
  resolution: { id: 'resolution', hash }, scope: 'organization', body: 'Hiring needs committee approval.',
  effectiveFrom: '10', effectiveUntil: null, availableAt: '5', audience: { kind: 'public' }, impact: 'future-admissions',
  enforcement: { kind: 'validated', policyRef: 'clocky.organization.hiring-approval/1',
    params: { committeeId: 'committee', positionIds: ['position'], maxHires: 1 } } }

it('requires original governance, predecessor, policy and temporal fields without inferred defaults', () => {
  expect(simulationNormEnactRequestSchema.parse(input)).toEqual(input)
  expectTypeOf(simulationNormReferenceSchema.parse(input.norm).version).toEqualTypeOf<WorldNormVersion>()
  for (const field of ['norm', 'prior', 'proposal', 'resolution', 'body', 'scope', 'enforcement', 'availableAt', 'audience', 'impact']) {
    expect(() => simulationNormEnactRequestSchema.parse(Object.fromEntries(Object.entries(input).filter(([key]) => key !== field))))
      .toThrow()
  }
  for (const field of ['source', 'recordedAt', 'actorId', 'changes', 'script']) {
    expect(() => simulationNormEnactRequestSchema.parse({ ...input, [field]: 'claimed' })).toThrow()
  }
})

it.each([
  { kind: 'validated', policyRef: 'unknown/1', params: input.enforcement.params },
  { ...input.enforcement, params: { ...input.enforcement.params, maxAmount: '10' } },
  { ...input.enforcement, params: { ...input.enforcement.params, maxOneTimeCost: '0' } },
  { ...input.enforcement, params: { ...input.enforcement.params, resourceId: 'account' } },
  { ...input.enforcement, params: { ...input.enforcement.params, code: 'return true' } },
  { ...input.enforcement, params: { ...input.enforcement.params, positionIds: ['position', 'position'] } },
  { ...input.enforcement, params: { ...input.enforcement.params, maxHires: 0 } },
  { ...input.enforcement, params: { ...input.enforcement.params, maxHires: Number.MAX_SAFE_INTEGER + 1 } },
  { kind: 'advisory', policyRef: 'clocky.organization.hiring-approval/1' },
])('rejects unsupported actuation, unowned monetary schemes and unknown parameters: %j', (enforcement) => {
  expect(() => simulationNormEnforcementSchema.parse(enforcement)).toThrow()
})

it('keeps advisory background separate from a validated primitive and revocation separate from deletion', () => {
  expect(simulationNormEnactRequestSchema.parse({ ...input, enforcement: { kind: 'advisory' } }).enforcement).toEqual({ kind: 'advisory' })
  const { enforcement: _enforcement, ...fields } = input
  const revoke = { ...fields, norm: { id: 'hiring-rule', version: '2' }, prior: input.norm }
  expect(simulationNormRevokeRequestSchema.parse(revoke)).toEqual(revoke)
  expect(() => simulationNormRevokeRequestSchema.parse({ ...revoke, prior: null })).toThrow()
  expect(() => simulationNormRevokeRequestSchema.parse({ ...revoke, effectiveUntil: '20' })).toThrow()
  expect(() => simulationNormEffectSchema.parse({ kind: 'norm/delete', id: 'hiring-rule' })).toThrow()
  expect(() => simulationNormEffectSchema.parse({ kind: 'norm/enact', request: input, patch: { path: '/world/norms' } })).toThrow()
})

it.each([
  { ...input, norm: { ...input.norm, version: '01' } }, { ...input, norm: { ...input.norm, version: '0' } },
  { ...input, effectiveUntil: '10' }, { ...input, effectiveUntil: '9' }, { ...input, availableAt: '01' },
  { ...input, resolution: { id: 'resolution', hash: 'not-a-hash' } },
])('rejects noncanonical times, versions and governance hashes: %j', (value) => {
  expect(() => simulationNormEnactRequestSchema.parse(value)).toThrow()
})

it('requires exact bounded reader queries and distinguishes unknown identities from authority bypass', () => {
  const query = { viewer: 'member', cursor: 10, time: '5', limit: 2, ids: ['rule', 'unknown'] }
  expect(simulationNormQuerySchema.parse(query)).toEqual(query)
  expect(() => simulationNormQuerySchema.parse({ ...query, ids: ['rule', 'rule'] })).toThrow()
  expect(() => simulationNormQuerySchema.parse({ ...query, revealHidden: true })).toThrow()
  expect(() => simulationNormQuerySchema.parse({ ...query, limit: 0 })).toThrow()
})

it('distinguishes authored initial institutions from real approved governance without accepting synthetic approval fields', () => {
  const initial = { id: 'hiring-rule', scopeId: input.scope, body: input.body, effectiveFrom: '0', effectiveUntil: null,
    availableAt: '0', audience: input.audience, enforcement: input.enforcement }
  expect(simulationInitialNormSchema.parse(initial)).toEqual(initial)
  for (const field of ['proposal', 'resolution', 'source', 'version', 'recordedAt', 'impact'])
    expect(() => simulationInitialNormSchema.parse({ ...initial, [field]: input.proposal })).toThrow()
  const version = { id: initial.id, version: '1', schemaRef: 'clocky.world-norm/1', origin: 'scenario', subject: 'committee',
    scope: initial.scopeId, body: initial.body, bodyHash: hash, status: 'enacted', enforcement: initial.enforcement,
    supersedes: null, effectiveFrom: '0', effectiveUntil: null, availableAt: '0', audience: initial.audience,
    source: { definitionHash: hash, bootstrapSequence: 2,
      references: [{ kind: 'run-event', runId: 'run', sequence: 2 }] },
    recordedAt: 10, sequence: 3 }
  expect(simulationNormVersionSchema.parse(version)).toEqual(version)
  expect(() => simulationNormVersionSchema.parse({ ...version, proposal: input.proposal })).toThrow()
  expect(() => simulationNormVersionSchema.parse({ ...version, resolution: input.resolution })).toThrow()
  expect(() => simulationNormVersionSchema.parse({ ...version, source: { ...version.source, mutationId: 'fake' } })).toThrow()
  expect(() => simulationNormVersionSchema.parse({ ...version, origin: 'governance' })).toThrow()
})

it('requires complete frozen committee rules and distinct real membership intervals', () => {
  const committee = { id: 'committee', name: 'Committee', description: 'Original voting group.', scopeId: 'organization',
    members: [{ id: 'membership', personId: 'person', validFrom: '0', validUntil: null }], rule: { kind: 'unanimity' }, quorum: 1 }
  expect(simulationFrozenCommitteePolicySchema.parse(committee)).toEqual(committee)
  expect(() => simulationFrozenCommitteePolicySchema.parse({ ...committee, quorum: 2 })).toThrow()
  expect(() => simulationFrozenCommitteePolicySchema.parse({ ...committee, members: [...committee.members, ...committee.members] }))
    .toThrow()
  expect(() => simulationFrozenCommitteePolicySchema.parse({ ...committee, members: [{ ...committee.members[0], validUntil: '0' }] })).toThrow()
  expect(() => simulationFrozenCommitteePolicySchema.parse({ ...committee, rule: { kind: 'absolute-threshold', yes: 2 } })).toThrow()
})

it('allows the same person in nonoverlapping half-open intervals but rejects overlap and unattainable concurrent quorum', () => {
  const first = { id: 'first', personId: 'person', validFrom: '0', validUntil: '5' }
  const later = { id: 'later', personId: 'person', validFrom: '5', validUntil: null }
  const committee = { id: 'committee', name: 'Committee', description: 'Literal intervals.', scopeId: 'organization',
    members: [later, first], rule: { kind: 'unanimity' }, quorum: 1 }
  expect(simulationFrozenCommitteePolicySchema.parse(committee)).toEqual(committee)
  expect(() => simulationFrozenCommitteePolicySchema.parse({ ...committee, members: [first, { ...later, validFrom: '4' }] })).toThrow()
  expect(() => simulationFrozenCommitteePolicySchema.parse({ ...committee, quorum: 2 })).toThrow()
  expect(() => simulationFrozenCommitteePolicySchema.parse({ ...committee, rule: { kind: 'absolute-threshold', yes: 2 } })).toThrow()
})
