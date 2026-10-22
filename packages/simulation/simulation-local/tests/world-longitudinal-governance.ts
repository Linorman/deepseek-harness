import { LongitudinalMetrics } from './longitudinal-metrics.ts'
/** Real Loader-compatible governance flow shared by Native integration tests and runnable examples. */
import assert from 'node:assert/strict'
import { projectPersonnelCounts, combinePersonnelCounts, simulationEntityIdSchema, WORLD_GOVERNANCE_PROPOSE_PIN,
  WORLD_GOVERNANCE_VOTE_PIN, WORLD_GOVERNANCE_DELEGATE_PIN, WORLD_GOVERNANCE_ROUTE_PIN, WORLD_NORM_ENACT_PIN, simTimeSchema } from '@clocky/clocky-simulation'
import { hiringResourceHarness } from './hiring-resource-harness.ts'
import { assertWorldGovernanceProjection } from '../src/world-governance.ts'

const pins = [WORLD_GOVERNANCE_PROPOSE_PIN, WORLD_GOVERNANCE_VOTE_PIN, WORLD_GOVERNANCE_DELEGATE_PIN,
  WORLD_GOVERNANCE_ROUTE_PIN, WORLD_NORM_ENACT_PIN]

/** Run the route scenario through real canonical owners and restore its complete history. */
export async function runLongitudinalGovernance(backend: 'json' | 'sqlite', options: Pick<NonNullable<Parameters<typeof hiringResourceHarness>[2]>, 'loadedContext' | 'evidenceRoot'> & { rounds: number }) {
  const scopeEntityId = simulationEntityIdSchema.parse('fee-org')
  const committees = ['committee-a', 'committee-b'].map(value => simulationEntityIdSchema.parse(value))
  const h = await hiringResourceHarness(backend, 'hire-existing', {
    knowledgeBytes: 262144, contextBytes: 524288, requestHistory: options.rounds * 8,
    actorRequests: options.rounds * 8, decisionLimit: options.rounds * 64,
    eventLimit: options.rounds * 64, microstepLimit: options.rounds * 128, messageLimit: options.rounds * 32,
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
  const metrics = new LongitudinalMetrics(h.ctx)
  try {
    const samples: {
      round: number
      elapsedMs: number
      proposals: number
      votes: number
      norms: number
      rss: number
      activeActors: number
      people: ReturnType<typeof projectPersonnelCounts>
    }[] = []
    for (let iteration = 0; iteration < options.rounds; iteration++) {
      const started = performance.now()
      const key = (value: string) => `${iteration}:${value}`
      const propose: typeof h.propose = (actor, id, action, world, wake) => h.propose(actor, key(id), action, world, wake)
      const request = (operation: string, key: string, payload: unknown) => ({ kind: 'world/request', domain: 'governance', operation,
        version: '1', businessKey: `${iteration}:${key}`, expectedTime: null, evidence: [], payload })
      const input = (committeeId: string) => ({ committeeId, scopeId: scopeEntityId, body: 'Same approved text',
        target: { kind: 'norm', norm: { id: key('joint-rule'), version: '1' } }, policyRef: 'clocky.governance/1',
        rule: { kind: 'unanimity' }, quorum: 1, deadline: '10' })
      for (const [index, actor] of [h.requester, h.candidate].entries()) {
        if (actor === h.candidate) await h.connection.ensureResident(actor, { activation: { provider: 'in-process', seed: { kind: iteration === 0 ? 'fresh' : 'resume' },
          agent: { preset: 'simulation', options: { provider: 'company', model: 'scripted' } }, signal: h.lifetime.signal }, evict: [h.director] })
        await propose(actor, `propose-${index}`, request('propose-norm', `proposal-${index}`, input(committees[index]!)), { kind: 'goal' })
      }
      const rootProposals = Object.values(h.run.snapshot().world!.governance.proposals).filter(proposal =>
        proposal.target.kind === 'norm' && proposal.target.norm.id === key('joint-rule'))
      await propose(h.requester, 'route-definition', request('define-review-route', 'route-definition', {
        id: key('two-committees'), revision: 1, mode: 'ordered', membershipPolicy: 'frozen', bodyHash: rootProposals[0]!.bodyHash,
        deadline: '10', steps: rootProposals.map((proposal, index) => ({ id: `step-${index}`, proposalId: proposal.id,
          proposalRevision: proposal.revision, dependsOn: index === 0 ? [] : ['step-0'] })),
      }), { kind: 'goal' })
      for (const [index, actor] of [h.requester, h.candidate].entries()) {
        const proposal = rootProposals[index]!
        await propose(actor, `vote-${index}`, request('vote', `vote-${index}`, { proposalId: proposal.id,
          proposalRevision: 1, bodyHash: proposal.bodyHash, choice: 'yes' }), { kind: 'goal' })
        await h.run.closeWorldGovernance(proposal.id)
      }
      const { businessFingerprint } = await import('../src/business.ts')
      const governance = h.run.snapshot().world!.governance
      const proposals = rootProposals, resolutions = Object.values(governance.resolutions).filter(resolution =>
        rootProposals.some(proposal => proposal.id === resolution.proposalId))
      const material = { id: key('two-committees'), revision: 1, definitionHash: governance.routes![key('two-committees')]!.hash, mode: 'ordered', membershipPolicy: 'frozen',
        bodyHash: proposals[0]!.bodyHash, deadline: '10', steps: resolutions.map((resolution, index) => ({ id: `step-${index}`,
          proposalId: resolution.proposalId, resolutionId: resolution.id, resolutionHash: resolution.hash,
          dependsOn: index === 0 ? [] : ['step-0'] })) }
      await propose(h.requester, 'combined', request('propose-norm', 'combined', {
        ...input(committees[0]!), reviewRoute: { ...material, hash: businessFingerprint(material) } }), { kind: 'goal' })
      const joint = Object.values(h.run.snapshot().world!.governance.proposals).at(-1)!
      await propose(h.requester, 'joint-vote', request('vote', 'joint-vote', { proposalId: joint.id,
        proposalRevision: 1, bodyHash: joint.bodyHash, choice: 'yes' }), { kind: 'goal' })
      const jointResolution = await h.run.closeWorldGovernance(joint.id)
      const enact = { norm: { id: key('joint-rule'), version: '1' }, prior: null,
        proposal: { id: joint.id, revision: joint.revision, bodyHash: joint.bodyHash },
        resolution: { id: jointResolution.id, hash: jointResolution.hash }, scope: scopeEntityId, body: joint.body,
        effectiveFrom: '0', effectiveUntil: null, availableAt: '0', audience: { kind: 'public' },
        impact: 'future-admissions', enforcement: { kind: 'advisory' } }
      await propose(h.requester, 'enact', request('enact-norm', 'enact', enact), { kind: 'goal' })
      const enactRequest = Object.values(h.run.snapshot().world!.requests).find(value => value.proposal.businessKey === key('enact'))!
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
          await propose(pending.entityId, `drain-${round}`, undefined, undefined, pending.eventId)
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
      await propose(h.director, 'enact-plan', { kind: 'world/resolve', requestId: enactRequest.id, supersedes: null,
        resolution: { kind: 'apply', rationale: 'Publish the exact jointly approved institution', payload: enact } },
      { kind: 'resolve', requestId: enactRequest.id }, wake)
      const acceptedContext = Object.values(h.run.snapshot().decisions).find(value => String(value.id) === key('enact-plan'))?.context
      assert.ok(JSON.stringify(acceptedContext).includes('preserve-original'))
      const plan = Object.values(h.run.snapshot().world!.plans).find(value => value.requestId === enactRequest.id)!
      await h.run.commitWorldMutation({ planId: plan.id, payload: enact })
      const published = Object.values(h.run.snapshot().world!.norms.versions).flat().at(-1)!
      assert.equal(published.origin, 'governance')
      assert.equal(published.bodyHash, joint.bodyHash)
      if (published.origin !== 'governance') throw new Error('Expected actual institution approval')
      assert.equal(published.proposal.id, joint.id); assert.equal(published.resolution.id, jointResolution.id)
      assert.ok(Object.values(h.run.snapshot().scheduledEvents).some(event => event.action.kind === 'norm-boundary'))
      const state = h.run.snapshot()
      const team = await h.ctx.teams.getTeam({ teamId: state.teamReservation!.teamId })
      const people = combinePersonnelCounts(state, projectPersonnelCounts(state), { kind: 'full', runId: state.spec.runId,
        nativeCursor: state.revision, teamCursor: team.team.cursor, team })
      samples.push({ ...metrics.sample(state), round: iteration + 1, elapsedMs: performance.now() - started,
        proposals: Object.keys(state.world!.governance.proposals).length, votes: Object.keys(state.world!.governance.votes).length,
        norms: Object.values(state.world!.norms.versions).flat().length, rss: process.memoryUsage().rss, people,
        activeActors: Object.values(state.entities).filter(entity => entity.cognition === 'agent'
          && entity.phase === 'active' && entity.readiness === 'ready').length })
      console.error(JSON.stringify({ kind: 'f0-progress', scenario: 'laboratory', ...samples.at(-1) }))
    }
    const saved = h.run.snapshot().world!.governance
    assert.equal(Object.values(saved.proposals).at(-1)!.reviewRoute?.steps.length, 2)
    assert.equal(samples.at(-1)?.norms, options.rounds)
    assert.equal(Object.keys(saved.votes).length, options.rounds * 3)
    await h.connection.close(); await h.run.close()
    const reopened = await h.ctx.simulations.open({ ...h.selection, mode: 'open' })
    try { assert.deepEqual(reopened.snapshot().world!.governance, saved); assertWorldGovernanceProjection(reopened.snapshot()) }
    finally { await reopened.close() }
    return { inputs: { definition: h.run.snapshot().world!.definition, spec: h.run.snapshot().spec,
      teamLimits: h.ctx.teams.getCreationLimits() },
    recovery: { selection: h.selection, governance: saved, norms: h.run.snapshot().world!.norms },
    rounds: options.rounds, samples, independentVotes: Object.keys(saved.votes).length,
    institutions: Object.values(h.run.snapshot().world!.norms.versions).flat().length,
    impactRecorded: true, modelCalls: h.requests.length, restored: true }
  } finally { await h.close() }
}
