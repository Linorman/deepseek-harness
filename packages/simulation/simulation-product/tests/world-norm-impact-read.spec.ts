/** Institution preview authority does not inherit other private case or operational disclosures. */
import { expect, it } from 'vitest'
import { simulationGovernanceProposalSchema } from '@clocky/clocky-simulation'
import { marketFixture } from '../../simulation-local/tests/world-hiring-market-fixture.ts'
import { projectWorldDomain } from '../src/world-read-projection.ts'
import type { WorldReadProjectionPolicy } from '../src/world-read-projection.ts'
import { simulationProductRunIdSchema } from '../src/schema-common.ts'
import { simulationProductWorldDomainInputSchema } from '../src/world-read-schema.ts'
it('withholds complete impact when a separate outstanding private case is unreadable', async () => {
  const f = marketFixture()
  try {
    const scope = f.state.world!.definition.organizationEntityId, actor = f.intent.requesterEntityId
    if (actor === null) throw new Error('Fixture requires its original actor')
    const binding = f.state.entities[actor]!.binding!
    const proposal = simulationGovernanceProposalSchema.parse({ id: 'policy', revision: 1, body: 'Readable approved document',
      bodyHash: `sha256:${'a'.repeat(64)}`, committeeId: scope, scopeId: scope,
      target: { kind: 'norm', norm: { id: 'rule', version: '1' } }, policyRef: 'clocky.governance/1',
      rule: { kind: 'unanimity' }, quorum: 1, deadline: '50', proposer: actor, time: '0', sequence: 1,
      source: { decisionId: 'proposal-decision', operationId: 'proposal-operation', epoch: '1', binding,
        contextHash: 'a'.repeat(64), inputId: 'proposal-input' }, electorate: [{ entityId: actor, binding,
        membership: { id: 'membership', revision: 1, validFrom: '0', validUntil: null } }] })
    const state = { ...f.state, world: { ...f.state.world!,
      governance: { proposals: { [proposal.id]: proposal }, votes: {}, resolutions: {} } } }
    const input = simulationProductWorldDomainInputSchema.parse({ runId: 'product', kind: 'proposal', proposalId: proposal.id, section: 'impact' })
    const policy = (cases: boolean, context = true): WorldReadProjectionPolicy => ({
      runId: simulationProductRunIdSchema.parse('product'), at: state.time, limit: 100,
      text: text => ({ text, truncated: false }), context: () => context, case: () => cases, persona: () => false,
      resident: () => false, page: (items, scope) => ({ items, coverage: { loaded: items.length, total: items.length,
        revision: state.revision, scope, complete: true } }) })
    const hidden = projectWorldDomain(state, input, policy(false))
    expect(hidden.value).toMatchObject({ normImpact: { state: 'withheld' }, normImpactInput: { state: 'allowed' } })
    expect(JSON.stringify(hidden)).not.toContain(f.request.id)
    expect(projectWorldDomain(state, input, policy(true)).value).toMatchObject({ normImpact: { state: 'allowed' } })
    expect(projectWorldDomain(state, input, policy(false, false)).value).toMatchObject({
      normImpact: { state: 'withheld' }, normImpactInput: { state: 'withheld' } })
    expect(() => projectWorldDomain(state, { ...input, at: '999' }, policy(true))).toThrow(/current Native prefix/)
  } finally { await f.close() }
})
