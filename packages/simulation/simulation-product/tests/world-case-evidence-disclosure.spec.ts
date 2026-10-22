/** A real same-case answer must lose its content grant even after projection, before the read's final publication. */
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { expect, it, vi } from 'vitest'
import { simTimeSchema, simulationWorldEvidenceAskSchema } from '@clocky/clocky-simulation'
import { hiringResourceHarness } from '../../simulation-local/tests/hiring-resource-harness.ts'
import Products from '../src/index.ts'
import { simulationProductWorldCaseInspectionSchema } from '../src/case-schema.ts'
import { registration, call } from './fixtures.ts'

const output = '.local/world-completion/u04-auth'

it.each(['json', 'sqlite'] as const)('withholds %s original evidence at the last publication boundary without coupling case and Persona grants', async (backend) => {
  const h = await hiringResourceHarness(backend, 'generate-and-hire', { evidenceRoot: output })
  try {
    const canary = 'PRIVATE-U04-ORIGINAL-EVIDENCE-ANSWER', rationale = 'PRIVATE-U04-FINAL-RATIONALE'
    const asking = await h.plan('original-evidence', 'generate-and-hire', simulationWorldEvidenceAskSchema.parse({
      kind: 'awaiting-evidence', missingFields: ['requirements'], deadline: '10', maxAttempts: 2,
      rationale: 'Original missing requirements',
    }))
    const challenge = Object.values(h.run.snapshot().world!.evidence.challenges)[0]!
    await h.run.drive({ until: simTimeSchema.parse('0') })
    await h.connection.dispatchOperation(challenge.notificationOperationId, Date.now)
    const answerWake = await h.connection.receiveOperation(challenge.notificationOperationId)
    await h.run.drive({ until: simTimeSchema.parse('0') })
    await h.propose(h.requester, 'original-answer', { kind: 'world/evidence', requestId: asking.requestId, challengeId: challenge.id,
      expectedInputRevision: 0, answers: [{ field: 'requirements', text: canary, references: [] }] },
    { kind: 'evidence', challengeId: challenge.id }, answerWake)
    const revision = Object.values(h.run.snapshot().world!.evidence.revisions)[0]!
    await h.run.drive({ until: simTimeSchema.parse('0') })
    await h.connection.dispatchOperation(revision.notificationOperationId, Date.now)
    const planningWake = await h.connection.receiveOperation(revision.notificationOperationId)
    await h.run.drive({ until: simTimeSchema.parse('0') })
    await h.propose(h.director, 'original-followup-plan', { kind: 'world/resolve', requestId: asking.requestId, supersedes: asking.id,
      resolution: { kind: 'apply', rationale, payload: { templateId: 'finite', templateVersion: '1',
        persona: { name: 'New', skills: [], traits: [], goals: [] } } } }, { kind: 'resolve', requestId: asking.requestId }, planningWake)
    const native = h.run.snapshot(), original = native.world!.requests[asking.requestId]!
    expect(revision.source.actorId).toBe(original.requesterEntityId)
    expect(original.plans).toHaveLength(2)
    const registered = { ...registration('evidence-disclosure'), spec: h.selection.spec }
    await h.ctx.plugin(Products, { directoryStream: 'evidence-disclosure-directory', imports: [registered] })
    const products = h.ctx.simulationProducts, principal = call()
    const input = { runId: registered.id, requestId: asking.requestId, section: 'request' } as const
    const grants = (content: readonly ('case' | 'persona')[]) => products.caseReaderRegistrar()([{
      principalId: principal.principal.id, runId: registered.id, requestIds: [asking.requestId], content,
    }])
    const owner = await products.inspectWorldCase(input, principal)
    expect(owner.value).toMatchObject({ section: 'request', description: { status: 'withheld' },
      evidence: { latestRevision: { id: revision.id, answers: { status: 'withheld' } } } })
    expect(JSON.stringify(owner)).not.toContain(canary)
    await expect(products.inspectWorldCase(input, call(new AbortController(), 'outsider')))
      .rejects.toMatchObject({ code: 'SIMULATION_PRODUCT_FORBIDDEN' })
    let revoke = grants(['persona'])
    try {
      const hidden = await products.inspectWorldCase(input, principal)
      expect(JSON.stringify(hidden)).not.toContain(canary)
      const plans = await products.inspectWorldCase({ ...input, section: 'plans' }, principal)
      if (plans.value?.section !== 'plans') throw new Error('Original selected Persona is absent')
      expect(plans.value.items.at(-1)).toMatchObject({ persona: { status: 'allowed' }, rationale: { status: 'withheld' } })
    } finally { revoke() }
    revoke = grants(['case'])
    try {
      const allowed = await products.inspectWorldCase(input, principal)
      expect(allowed.value).toMatchObject({ section: 'request', description: { status: 'allowed' },
        evidence: { latestRevision: { id: revision.id, answers: { status: 'allowed' } } } })
      expect(JSON.stringify(allowed)).toContain(canary)
      const plans = await products.inspectWorldCase({ ...input, section: 'plans' }, principal)
      if (plans.value?.section !== 'plans') throw new Error('Original selected plan is absent')
      expect(plans.value.items.at(-1)).toMatchObject({ persona: { status: 'withheld' }, rationale: { status: 'allowed' } })
      let projected = false
      const parse = simulationProductWorldCaseInspectionSchema.parse.bind(simulationProductWorldCaseInspectionSchema)
      const publication = vi.spyOn(simulationProductWorldCaseInspectionSchema, 'parse').mockImplementationOnce((...args) => {
        const result = parse(...args)
        // Keep the real authorized projection. Revoke in the microtask before admit() resumes its final awaited publication.
        expect(JSON.stringify(result)).toContain(canary)
        projected = true
        queueMicrotask(revoke)
        return result
      })
      let revoked
      try { revoked = await products.inspectWorldCase(input, principal) }
      finally { publication.mockRestore() }
      expect(projected).toBe(true)
      expect(revoked.value).toMatchObject({ section: 'request', description: { status: 'withheld' }, evidence: {
        latestRevision: { id: revision.id, revision: revision.revision, actorId: revision.source.actorId,
          answers: { status: 'withheld' } },
      } })
      expect(JSON.stringify(revoked)).not.toContain(canary)
      expect(h.run.snapshot()).toEqual(native)
      expect(h.requests).toHaveLength(0)
      await mkdir(output, { recursive: true })
      await writeFile(resolve(output, `${backend}-evidence-publication.json`), JSON.stringify({ originalRevision: revision.id,
        snapshotRevision: native.revision, owner, allowed, revoked, projectedBeforeRevocation: projected,
        modelCalls: h.requests.length }, null, 2) + '\n')
    } finally { revoke() }
  } finally { await h.close() }
})
