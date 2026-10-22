/** Real Loader-compatible governance flow shared by Native integration tests and runnable examples. */
import assert from 'node:assert/strict'
import { simulationChangeSchema, simulationEntityIdSchema, WORLD_GOVERNANCE_PROPOSE_PIN,
  WORLD_GOVERNANCE_VOTE_PIN, WORLD_GOVERNANCE_DELEGATE_PIN, WORLD_GOVERNANCE_ROUTE_PIN, WORLD_NORM_ENACT_PIN, simTimeSchema, checkpointWorldState } from '@clocky/clocky-simulation'
import { hiringResourceHarness } from './hiring-resource-harness.ts'
import { assertWorldGovernanceProjection } from '../src/world-governance.ts'
import { validateNormRequest } from '../src/world-norms.ts'

const pins = [WORLD_GOVERNANCE_PROPOSE_PIN, WORLD_GOVERNANCE_VOTE_PIN, WORLD_GOVERNANCE_DELEGATE_PIN,
  WORLD_GOVERNANCE_ROUTE_PIN, WORLD_NORM_ENACT_PIN]

/** Run the proxy scenario through real canonical owners and restore its complete history. */
export async function runPostMvpProxy(backend: 'json' | 'sqlite', options: Pick<NonNullable<Parameters<typeof hiringResourceHarness>[2]>, 'loadedContext' | 'evidenceRoot'> = {}) {
  const scopeEntityId = simulationEntityIdSchema.parse('fee-org'), targetEntityId = simulationEntityIdSchema.parse('committee')
  const h = await hiringResourceHarness(backend, 'hire-existing', {
    evidenceRoot: options.evidenceRoot ?? '.tmp/world-post-mvp/a3-proxy', ...options.loadedContext === undefined ? {} : { loadedContext: options.loadedContext }, candidateAssignment: 'fee-vacancy', installedPins: pins,
    extraEntities: [{ id: 'committee', entityKind: 'organization' }],
    extraOperationGrants: ['buyer', 'fee-candidate'].flatMap((person, personIndex) => pins.map((pin, index) => ({
      requesterEntityId: simulationEntityIdSchema.parse(person), domain: pin.domain, operation: pin.operation, version: pin.version,
      scopeEntityId, targetEntityId, relationId: `grant:${person}:${index}` as import('@clocky/clocky-simulation').SimulationRelationId,
      relation: personIndex === 0 && index === 0 ? 'committee-member' : `can-${personIndex === 0 ? 'fee-role' : 'fee-vacancy'}-${index}`,
    }))),
    positionRolePermissions: ['fee-role', 'fee-vacancy'].map(id => ({ positionEntityId: simulationEntityIdSchema.parse(id),
      permissions: pins.map((pin, index) => ({ domain: pin.domain, operation: pin.operation, version: pin.version,
        scopeEntityId, targetEntityId, relation: id === 'fee-role' && index === 0 ? 'committee-member' : `can-${id}-${index}` })) })),
  })
  try {
    await h.run.setPhase('paused', h.run.snapshot().revision)
    for (const person of [h.candidate]) await h.run.change(simulationChangeSchema.parse({ kind: 'relation/create',
      id: `member:${person}`, subject: person, relation: 'committee-member', object: targetEntityId,
      scope: scopeEntityId, validFrom: '0', validUntil: null }), h.run.snapshot().revision)
    await h.start()
    const request = (operation: string, businessKey: string, payload: unknown) => ({ kind: 'world/request',
      domain: 'governance', operation, version: '1', businessKey, expectedTime: null, evidence: [], payload })
    await h.propose(h.requester, 'proposal', request('propose-norm', 'proposal', { committeeId: targetEntityId,
      scopeId: scopeEntityId, body: 'Original institution', target: { kind: 'norm', norm: { id: 'rule', version: '1' } },
      policyRef: 'clocky.governance/1', rule: { kind: 'unanimity' }, quorum: 2, deadline: '10' }), { kind: 'goal' })
    const proposal = Object.values(h.run.snapshot().world!.governance.proposals)[0]!
    const reference = { proposalId: proposal.id, proposalRevision: proposal.revision, bodyHash: proposal.bodyHash }
    await h.propose(h.requester, 'grant', request('delegate-vote', 'grant', {
      ...reference, delegateId: h.candidate, expiresAt: '9', revoked: false }), { kind: 'goal' })
    const grant = h.run.snapshot().world!.governance.delegations![0]!
    await h.connection.ensureResident(h.candidate, { activation: { provider: 'in-process', seed: { kind: 'fresh' },
      agent: { preset: 'simulation', options: { provider: 'company', model: 'scripted' } }, signal: h.lifetime.signal }, evict: [h.director] })
    await h.propose(h.candidate, 'proxy-vote', request('vote', 'proxy-vote', {
      ...reference, choice: 'yes', delegationId: grant.id }), { kind: 'goal' })
    await h.propose(h.requester, 'revoke', request('delegate-vote', 'revoke', {
      ...reference, delegateId: h.candidate, expiresAt: '9', revoked: true }), { kind: 'goal' })
    const saved = h.run.snapshot().world!.governance
    assert.equal(Object.values(saved.votes)[0]!.voter, h.requester)
    assert.equal(saved.delegations?.length, 2)
    assert.equal(checkpointWorldState(h.run.snapshot())?.records.filter(value => value.kind === 'delegation').length, 2)
    assertWorldGovernanceProjection(h.run.snapshot())
    await h.connection.close(); await h.run.close()
    const reopened = await h.ctx.simulations.open({ ...h.selection, mode: 'open' })
    try { assert.deepEqual(reopened.snapshot().world!.governance, saved); assertWorldGovernanceProjection(reopened.snapshot()) }
    finally { await reopened.close() }
    assert.equal(h.requests.length, 0)
    return { recovery: { selection: h.selection, governance: saved, norms: h.run.snapshot().world!.norms },
      modelCalls: h.requests.length,
      grants: saved.delegations.map(value => ({ revoked: value.revoked, principal: value.principal, delegate: value.delegateId })),
      ballots: Object.values(saved.votes).map(value => ({ voter: value.voter, choice: value.choice,
        proxy: value.delegationId !== undefined })),
      restored: true }
  } finally { await h.close() }
}

/** Run the route scenario through real canonical owners and restore its complete history. */
export async function runPostMvpRoute(backend: 'json' | 'sqlite', options: Pick<NonNullable<Parameters<typeof hiringResourceHarness>[2]>, 'loadedContext' | 'evidenceRoot'> = {}) {
  const scopeEntityId = simulationEntityIdSchema.parse('fee-org')
  const committees = ['committee-a', 'committee-b'].map(value => simulationEntityIdSchema.parse(value))
  const h = await hiringResourceHarness(backend, 'hire-existing', {
    evidenceRoot: options.evidenceRoot ?? '.tmp/world-post-mvp/a3-route', ...options.loadedContext === undefined ? {} : { loadedContext: options.loadedContext }, candidateAssignment: 'fee-vacancy', installedPins: pins,
    extraEntities: committees.map(id => ({ id, entityKind: 'organization' as const })),
    positionRolePermissions: [{ positionEntityId: simulationEntityIdSchema.parse('fee-role'), permissions: [{
      domain: 'governance', operation: 'vote', version: '1', scopeEntityId, targetEntityId: committees[0]!, relation: 'committee-member',
    }, { domain: 'governance', operation: 'define-review-route', version: '1', scopeEntityId,
      targetEntityId: committees[1]!, relation: 'route-coordinator' }] }],
    extraOperationGrants: ['buyer', 'fee-candidate'].flatMap((person, index) => pins.map(pin => ({
      requesterEntityId: simulationEntityIdSchema.parse(person), domain: pin.domain, operation: pin.operation, version: pin.version,
      scopeEntityId, targetEntityId: committees[index]!, relationId: `grant:${person}` as import('@clocky/clocky-simulation').SimulationRelationId,
      relation: 'committee-member',
    }))).concat([{ requesterEntityId: simulationEntityIdSchema.parse('buyer'), domain: 'governance',
      operation: 'define-review-route', version: '1', scopeEntityId, targetEntityId: committees[1]!,
      relationId: 'route-coordinator-b' as import('@clocky/clocky-simulation').SimulationRelationId,
      relation: 'route-coordinator' }]),
  })
  try {
    const request = (operation: string, key: string, payload: unknown) => ({ kind: 'world/request', domain: 'governance', operation,
      version: '1', businessKey: key, expectedTime: null, evidence: [], payload })
    const input = (committeeId: string) => ({ committeeId, scopeId: scopeEntityId, body: 'Same approved text',
      target: { kind: 'norm', norm: { id: 'joint-rule', version: '1' } }, policyRef: 'clocky.governance/1',
      rule: { kind: 'unanimity' }, quorum: 1, deadline: '10' })
    for (const [index, actor] of [h.requester, h.candidate].entries()) {
      if (actor === h.candidate) await h.connection.ensureResident(actor, { activation: { provider: 'in-process', seed: { kind: 'fresh' },
        agent: { preset: 'simulation', options: { provider: 'company', model: 'scripted' } }, signal: h.lifetime.signal }, evict: [h.director] })
      await h.propose(actor, `propose-${index}`, request('propose-norm', `proposal-${index}`, input(committees[index]!)), { kind: 'goal' })
    }
    const rootProposals = Object.values(h.run.snapshot().world!.governance.proposals)
    await h.propose(h.requester, 'route-definition', request('define-review-route', 'route-definition', {
      id: 'two-committees', revision: 1, mode: 'ordered', membershipPolicy: 'frozen', bodyHash: rootProposals[0]!.bodyHash,
      deadline: '10', steps: rootProposals.map((proposal, index) => ({ id: `step-${index}`, proposalId: proposal.id,
        proposalRevision: proposal.revision, dependsOn: index === 0 ? [] : ['step-0'] })),
    }), { kind: 'goal' })
    for (const [index, actor] of [h.requester, h.candidate].entries()) {
      const proposal = Object.values(h.run.snapshot().world!.governance.proposals)[index]!
      await h.propose(actor, `vote-${index}`, request('vote', `vote-${index}`, { proposalId: proposal.id,
        proposalRevision: 1, bodyHash: proposal.bodyHash, choice: 'yes' }), { kind: 'goal' })
      await h.run.closeWorldGovernance(proposal.id)
    }
    const { businessFingerprint } = await import('../src/business.ts')
    const governance = h.run.snapshot().world!.governance
    const proposals = Object.values(governance.proposals), resolutions = Object.values(governance.resolutions)
    const material = { id: 'two-committees', revision: 1, definitionHash: governance.routes!['two-committees']!.hash, mode: 'ordered', membershipPolicy: 'frozen',
      bodyHash: proposals[0]!.bodyHash, deadline: '10', steps: resolutions.map((resolution, index) => ({ id: `step-${index}`,
        proposalId: resolution.proposalId, resolutionId: resolution.id, resolutionHash: resolution.hash,
        dependsOn: index === 0 ? [] : ['step-0'] })) }
    const direct = { norm: { id: 'joint-rule', version: '1' }, prior: null,
      proposal: { id: proposals[0]!.id, revision: proposals[0]!.revision, bodyHash: proposals[0]!.bodyHash },
      resolution: { id: resolutions[0]!.id, hash: resolutions[0]!.hash }, scope: scopeEntityId, body: proposals[0]!.body,
      effectiveFrom: '0', effectiveUntil: null, availableAt: '0', audience: { kind: 'public' },
      impact: 'future-admissions', enforcement: { kind: 'advisory' } }
    const { simulationNormEnactRequestSchema } = await import('@clocky/clocky-simulation')
    assert.throws(() => validateNormRequest(h.run.snapshot(), simulationNormEnactRequestSchema.parse(direct), 'norm/enact'),
      /original complete route proof/)
    assert.doesNotThrow(() => validateNormRequest(h.run.snapshot(), simulationNormEnactRequestSchema.parse({ ...direct,
      reviewRoute: { ...material, hash: businessFingerprint(material) } }), 'norm/enact'))
    await h.propose(h.requester, 'combined', request('propose-norm', 'combined', {
      ...input(committees[0]!), reviewRoute: { ...material, hash: businessFingerprint(material) } }), { kind: 'goal' })
    const joint = Object.values(h.run.snapshot().world!.governance.proposals).at(-1)!
    await h.propose(h.requester, 'joint-vote', request('vote', 'joint-vote', { proposalId: joint.id,
      proposalRevision: 1, bodyHash: joint.bodyHash, choice: 'yes' }), { kind: 'goal' })
    const jointResolution = await h.run.closeWorldGovernance(joint.id)
    const enact = { norm: { id: 'joint-rule', version: '1' }, prior: null,
      proposal: { id: joint.id, revision: joint.revision, bodyHash: joint.bodyHash },
      resolution: { id: jointResolution.id, hash: jointResolution.hash }, scope: scopeEntityId, body: joint.body,
      effectiveFrom: '0', effectiveUntil: null, availableAt: '0', audience: { kind: 'public' },
      impact: 'future-admissions', enforcement: { kind: 'advisory' } }
    await h.propose(h.requester, 'enact', request('enact-norm', 'enact', enact), { kind: 'goal' })
    const enactRequest = Object.values(h.run.snapshot().world!.requests).find(value => value.proposal.businessKey === 'enact')!
    await h.connection.ensureResident(h.director, { activation: { provider: 'in-process', seed: { kind: 'resume' },
      agent: { preset: 'simulation', options: { provider: 'company', model: 'scripted' } }, signal: h.lifetime.signal }, evict: [h.candidate] })
    await h.start()
    let wake: import('@clocky/clocky-simulation').SimulationEventId | undefined
    for (let round = 0; round < 64; round++) {
      await h.run.drive({ until: simTimeSchema.parse('0') })
      const state = h.run.snapshot()
      if (wake !== undefined && state.wakes[wake]?.status === 'pending') break
      const pending = Object.values(state.wakes).find(value => value.status === 'pending')
      if (pending !== undefined) {
        if (pending.entityId === h.candidate) {
          await h.connection.ensureResident(h.candidate, { activation: { provider: 'in-process', seed: { kind: 'resume' },
            agent: { preset: 'simulation', options: { provider: 'company', model: 'scripted' } }, signal: h.lifetime.signal }, evict: [h.director] })
          await h.start()
        }
        await h.propose(pending.entityId, `drain-${round}`, undefined, undefined, pending.eventId)
        if (pending.entityId === h.candidate) {
          await h.connection.ensureResident(h.director, { activation: { provider: 'in-process', seed: { kind: 'resume' },
            agent: { preset: 'simulation', options: { provider: 'company', model: 'scripted' } }, signal: h.lifetime.signal }, evict: [h.candidate] })
          await h.start()
        }
        continue
      }
      const ready = Object.values(state.operations).find(value => value.outbox?.ready && value.result === undefined)
      if (ready !== undefined) {
        await h.connection.dispatchOperation(ready.id, Date.now)
        const received = await h.connection.receiveOperation(ready.id)
        if (ready.id === enactRequest.notificationOperationId) wake = received
      }
    }
    if (wake === undefined) throw new Error('Original institution request notification did not reach its director')
    await h.propose(h.director, 'enact-plan', { kind: 'world/resolve', requestId: enactRequest.id, supersedes: null,
      resolution: { kind: 'apply', rationale: 'Publish the exact jointly approved institution', payload: enact } },
    { kind: 'resolve', requestId: enactRequest.id }, wake)
    const acceptedContext = Object.values(h.run.snapshot().decisions).find(value => String(value.id) === 'enact-plan')?.context
    assert.ok(JSON.stringify(acceptedContext).includes('preserve-original'))
    const plan = Object.values(h.run.snapshot().world!.plans).find(value => value.requestId === enactRequest.id)!
    await h.run.commitWorldMutation({ planId: plan.id, payload: enact })
    const published = Object.values(h.run.snapshot().world!.norms.versions).flat()[0]!
    assert.equal(published.origin, 'governance')
    assert.equal(published.bodyHash, joint.bodyHash)
    if (published.origin !== 'governance') throw new Error('Expected actual institution approval')
    assert.equal(published.proposal.id, joint.id); assert.equal(published.resolution.id, jointResolution.id)
    assert.ok(Object.values(h.run.snapshot().scheduledEvents).some(event => event.action.kind === 'norm-boundary'))
    const saved = h.run.snapshot().world!.governance
    assert.equal(Object.values(saved.proposals).at(-1)!.reviewRoute?.steps.length, 2)
    await h.connection.close(); await h.run.close()
    const reopened = await h.ctx.simulations.open({ ...h.selection, mode: 'open' })
    try { assert.deepEqual(reopened.snapshot().world!.governance, saved); assertWorldGovernanceProjection(reopened.snapshot()) }
    finally { await reopened.close() }
    return { recovery: { selection: h.selection, governance: saved, norms: h.run.snapshot().world!.norms },
      route: { mode: material.mode, steps: material.steps.length, membershipPolicy: material.membershipPolicy },
      independentVotes: Object.keys(saved.votes).length, enacted: published.body,
      impactRecorded: true, modelCalls: h.requests.length, restored: true }
  } finally { await h.close() }
}
