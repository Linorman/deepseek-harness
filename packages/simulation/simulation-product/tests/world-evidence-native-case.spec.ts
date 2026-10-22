/** Production disclosure projections over explicitly selected real Native/Team roundtrip artifacts. */
import { readFile, mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'
import type { SimulationSnapshot } from '@clocky/clocky-simulation'
import { worldCaseDetail, worldCaseSummary } from '../src/cases.ts'
import { simulationProductWorldCaseInputSchema } from '../src/case-schema.ts'

const selected: unknown = process.env.WORLD_EVIDENCE_CASE_FIXTURES === undefined ? [] : JSON.parse(process.env.WORLD_EVIDENCE_CASE_FIXTURES)
if (!Array.isArray(selected) || selected.some(value => typeof value !== 'string')) throw new Error('Evidence case fixtures must be an explicit JSON path array')
const fixtures = selected as string[]
it.skipIf(fixtures.length === 0)('withholds case bodies while preserving safe evidence metadata from actual Native roundtrips', async () => {
  const root = resolve('.local/world-completion/thread-01a1336a-evidence-native/product-views')
  await mkdir(root, { recursive: true }); const output = await mkdtemp(resolve(root, 'verified-'))
  const reports = []
  for (const path of fixtures) {
    const bytes = await readFile(path), { state } = JSON.parse(bytes.toString()) as { state: SimulationSnapshot }
    const world = state.world!
    const request = Object.values(world.requests)[0]!, question = Object.values(world.evidence.challenges)[0]!
    const revision = Object.values(world.evidence.revisions)[0]!
    expect(question.status).toBe('answered'); expect(request.status).toBe('committed'); expect(revision.revision).toBe(1)
    expect(revision.source.actorId).toBe(request.requesterEntityId)
    const input = simulationProductWorldCaseInputSchema.parse({ runId: 'actual-evidence-view', requestId: request.id, section: 'request' })
    const summary = worldCaseSummary(request, state), text = (value: string) => ({ text: value, truncated: false })
    const withheld = worldCaseDetail(input, summary, state, text, false), allowed = worldCaseDetail(input, summary, state, text, true)
    expect(withheld).toMatchObject({ section: 'request', description: { status: 'withheld' }, evidence: {
      inputRevision: 1, latestChallenge: { id: question.id, status: 'answered', responders: [request.requesterEntityId],
        deadline: question.deadline, maxAttempts: question.maxAttempts, attemptsUsed: 1 },
      latestRevision: { id: revision.id, actorId: request.requesterEntityId, answers: { status: 'withheld' } } } })
    expect(JSON.stringify(withheld)).not.toContain(request.description)
    for (const answer of revision.answers) expect(JSON.stringify(withheld)).not.toContain(answer.text)
    expect(allowed).toMatchObject({ section: 'request', description: { status: 'allowed', text: text(request.description) },
      evidence: { latestRevision: { answers: { status: 'allowed', items: revision.answers.map(answer => ({ field: answer.field, text: text(answer.text) })) } } } })
    for (const view of [withheld, allowed]) expect(JSON.stringify(view)).not.toMatch(/PRIVATE-DIRECTOR-RATIONALE|ORIGINAL-CANDIDATE-CANARY/)
    reports.push({ path: resolve(path), sha256: createHash('sha256').update(bytes).digest('hex'), nativeRevision: state.revision, withheld, allowed })
  }
  await writeFile(resolve(output, 'projections.json'), JSON.stringify(reports, null, 2) + '\n')
})
