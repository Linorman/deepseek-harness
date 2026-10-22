/** Branch runtimes are recompiled from complete definitions and retain actual fresh Native identities. */
import { randomUUID } from 'node:crypto'
import { createHash } from 'node:crypto'
import { expect, it } from 'vitest'
import * as Direct from '@clocky/clocky-team-channel-direct'
import { compileWorldScenarioV1, resolvedWorldScenarioV1Schema } from '@clocky/clocky-simulation-scenario'
import { simulationRunSelectionSchema, simulationCheckpointIdSchema, simTimeSchema, simulationChangeSchema, simulationEntityIdSchema } from '@clocky/clocky-simulation'
import { createWorldExperimentBranch } from '../../simulation-team/src/experiments.ts'
import { prepareSimulationWorld } from '@clocky/clocky-simulation-product'
import { sample, deployment } from '../../simulation-scenario/tests/v1-fixtures.ts'
import { simulationTemp } from '../../simulation-local/tests/temp.ts'
import { createContext } from '../../simulation-team/tests/harness.ts'
import { compileWorldExperimentRuntime } from '../src/branch-runtime.ts'
import { SimulationWorldDriver } from '../src/driver.ts'
import SimulationWorldExecutions from '../src/providers.ts'

it.each(['json', 'sqlite'] as const)('recompiles %s branch metadata and starts its actual driver without reissuing initial work', async (backend) => {
  const definition = structuredClone(sample); definition.behavior.initialGoals = []
  const compiled = await compileWorldScenarioV1(definition, deployment)
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics))
  const root = await simulationTemp('branch-runtime'), h = await createContext(root, backend)
  await h.ctx.plugin(SimulationWorldExecutions); await h.ctx.plugin(Direct)
  const run = await h.ctx.simulations.open(simulationRunSelectionSchema.parse({ provider: 'local', mode: 'create',
    spec: { runId: 'branch-runtime-source', ...compiled.resolved.native } }))
  const requestedOwnerName = 'branch-runtime/source'
  await prepareSimulationWorld(h.ctx.simulationTeams, run, { resolved: compiled.resolved, ownerName: requestedOwnerName,
    checkpoint: { id: simulationCheckpointIdSchema.parse('source-cut'), maxDrainRounds: 4, maxAttempts: 3 } })
  const ownerName = run.snapshot().teamReservation!.creation.rules['activationLifecycleOwner']
  if (typeof ownerName !== 'string') throw new Error('Prepared source lost its original lifecycle owner')
  const connection = await h.ctx.simulationTeams.attach(run, run.snapshot().teamReservation!.teamId, ownerName)
  try {
    const limits = { maxEntries: 10000, maxBytes: 16 * 1024 * 1024, pageSize: 4 }
    const cut = await connection.collectCheckpointCandidate(4, 3)
    const body = await cut.exportArchive(limits); cut.release()
    const commandId = randomUUID()
    const branch = await createWorldExperimentBranch(h.ctx, body, { commandId, memoryPolicy: 'public-facts',
      variables: { memoryPolicy: 'public-facts' }, sourceHash: createHash('sha256').update(JSON.stringify(body)).digest('hex'),
      selection: simulationRunSelectionSchema.parse({ provider: 'local', mode: 'create', spec: { ...compiled.resolved.native,
        runId: `branch-${commandId}` } }) }, limits, () => {})
    try {
      const originalMember = Object.values(branch.run.snapshot().entities).find(entity =>
        entity.cognition === 'agent' && entity.participantReservation?.participant.role === 'member')!
      const additional = simulationEntityIdSchema.parse('added-member')
      await branch.run.change(simulationChangeSchema.parse({ kind: 'entity/create', id: additional, entityKind: 'person',
        cognition: 'agent', readiness: 'ready', profile: originalMember.profile }), branch.run.snapshot().revision)
      await branch.connection.ensureParticipant(additional, originalMember.participantReservation!.participant)
      const resolved = await compileWorldExperimentRuntime(compiled.resolved, branch.run.snapshot(), branch.lineage)
      expect(resolved.actors.some(actor => actor.entityId === additional)).toBe(true)
      expect(resolved.definitionHash).not.toBe(compiled.resolved.definitionHash)
      expect(resolvedWorldScenarioV1Schema.safeParse(resolved).success).toBe(true)
      const anchor = { checkpointId: simulationCheckpointIdSchema.parse('branch-cut'),
        ownerName: `simulation/experiment/${commandId}`, maxDrainRounds: 4, maxAttempts: 3 }
      await branch.connection.checkpoint({ id: anchor.checkpointId, implementationVersion: 'world/1',
        maxDrainRounds: anchor.maxDrainRounds, maxAttempts: anchor.maxAttempts })
      const lifetime = new AbortController().signal
      const driver = new SimulationWorldDriver(branch.run, branch.connection, resolved, anchor, lifetime, h.ctx,
        h.ctx.simulationWorldExecutions.handlers({ run: branch.run, connection: branch.connection, resolved, anchor, lifetime }, []))
      try {
        expect(await driver.advance(simTimeSchema.parse('0'))).toMatchObject({ reason: 'paused' })
        await branch.run.setPhase('running', branch.run.snapshot().revision)
        expect(await driver.advance(simTimeSchema.parse('0'))).toMatchObject({ reason: 'idle' })
        expect(Object.keys(branch.run.snapshot().decisions)).toHaveLength(0)
      } finally { await driver.drain() }
    } finally { await branch.connection.close(); await branch.run.close() }
  } finally { await connection.close(); await run.close(); await h.ctx.fiber.dispose() }
})
