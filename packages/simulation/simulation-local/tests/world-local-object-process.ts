/** Crash probe around the single authoritative local-mutation append. */
import { readFile, writeFile } from 'node:fs/promises'
import { localObjectFixture } from './world-local-object-fixture.ts'
import { createContext } from '../../simulation-team/tests/harness.ts'
import { simulationRunSelectionSchema, localObjectRenameSchema, worldPlanIdSchema } from '@clocky/clocky-simulation'
const backend = process.argv[2], proofPath = process.argv[3], stage = process.argv[4]
if ((backend !== 'json' && backend !== 'sqlite') || proofPath === undefined) throw new Error('Missing process probe selection')
if (stage === 'recover') {
  const proof: unknown = JSON.parse(await readFile(proofPath, 'utf8'))
  const { z } = await import('zod')
  const selected = z.strictObject({ root: z.string(), selection: simulationRunSelectionSchema,
    planId: worldPlanIdSchema, payload: localObjectRenameSchema }).parse(proof)
  const { ctx } = await createContext(selected.root, backend)
  try {
    const run = await ctx.simulations.open({ ...selected.selection, mode: 'open' })
    const first = await run.commitWorldMutation({ planId: selected.planId, payload: selected.payload })
    const revision = run.snapshot().revision
    const repeated = await run.commitWorldMutation({ planId: selected.planId, payload: selected.payload })
    const result = { first, repeated, revision, repeatedRevision: run.snapshot().revision,
      name: run.snapshot().entities[selected.payload.targetEntityId]!.profile.name,
      retainedWriters: Object.values(run.snapshot().entities).filter(value => value.writer !== undefined && value.writer.phase !== 'released').length }
    // This probe deliberately exits with inherited writer responsibility; it does not pretend to retire a crashed Team.
    await new Promise<void>((resolve) => { process.stdout.write(JSON.stringify(result) + '\n', () => { resolve() }) })
    process.exit(73)
  } finally { await ctx.fiber.dispose() }
} else {
  const h = await localObjectFixture(backend)
  await writeFile(proofPath, JSON.stringify({ root: h.root, selection: h.selection, planId: h.plan.id, payload: h.first.input }) + '\n')
  if (stage === 'after') await h.handler.execute(h.plan)
  process.send?.('durable')
  await new Promise<void>(() => {})
}
