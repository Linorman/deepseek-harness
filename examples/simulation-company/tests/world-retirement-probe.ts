/** Runtime termination refusal exercises the real controller, World maintenance and service-unload owners. */
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { z } from 'zod'
import type { Context } from '@clocky/cordis'
import { AgentRuntimeTerminationUnconfirmedError } from '@clocky/clocky-agent-runtime'
import { simulationDecisionIdSchema, simulationEntityIdSchema, simulationWriterEpochSchema } from '@clocky/clocky-simulation'
import type { SimulationRun, SimulationWriterLease } from '@clocky/clocky-simulation'
import SimulationTeams from '@clocky/clocky-simulation-team'

const evidenceSchema = z.strictObject({ entityId: simulationEntityIdSchema, epoch: simulationWriterEpochSchema,
  chargedActors: z.number().int().positive(), phase: z.literal('revoked'), lateCallbacksRejected: z.literal(3),
  unload: z.enum(['not-requested', 'pending', 'failed']) })
const path = () => resolve(process.env.SIMULATION_COMPANY_ROOT!, 'world-retirement-proof.json')

/**
 * Inject one provider-level termination refusal only after a real World hire has entered maintenance.
 * @param ctx - Booted Loader composition, including the actual controller and local provider.
 * @param recovering - Cold processes consume the original proof without installing a new failure.
 * @param hold - Persist the original product proof and wait for the parent to SIGKILL this process.
 */
export function installWorldRetirementProbe(ctx: Context, recovering: boolean, hold: (stage: string) => Promise<void>): void {
  const stage = process.env.WORLD_OWNER_CRASH
  if (recovering || stage !== 'retirement-timeout' && stage !== 'retirement-unload' && stage !== 'retirement-late-callback') return
  let run: SimulationRun | undefined
  const writers = new Map<string, SimulationWriterLease>()
  let refused = false
  const provider = ctx.agentRuntimes.getProvider('in-process')
  assert.ok(provider)
  const activate = provider.activate.bind(provider)
  provider.activate = async (request) => {
    const handle = await activate(request), dispose = handle.dispose.bind(handle)
    handle.dispose = async () => {
      if (Object.values(run?.snapshot().world?.reservations ?? {}).some(value => value.status === 'reserved')) {
        refused = true
        // The actual handle remains live: the caller's elapsed deadline is not a termination receipt.
        await new Promise(done => setTimeout(done, 10))
        throw new AgentRuntimeTerminationUnconfirmedError('World retirement deadline expired without a provider stop receipt')
      }
      await dispose()
    }
    return handle
  }
  const open = ctx.simulations.open.bind(ctx.simulations)
  ctx.simulations.open = async (...args) => {
    const opened = await open(...args)
    run = opened
    const reserve = opened.reserveWriter.bind(opened)
    opened.reserveWriter = async (...input) => {
      const writer = await reserve(...input)
      writers.set(input[0], writer)
      return writer
    }
    return opened
  }
  const attach = ctx.simulationTeams.attach.bind(ctx.simulationTeams)
  ctx.simulationTeams.attach = async (...args) => {
    const connection = await attach(...args), owned = args[0], quiesce = connection.quiesceForMaintenance.bind(connection)
    connection.quiesceForMaintenance = async (...input) => {
      try { return await quiesce(...input) }
      catch (error: unknown) {
        if (!refused) throw error
        const state = owned.snapshot()
        assert.equal(state.maintenance?.[input[0].id]?.status, 'draining')
        assert.equal(state.phase, 'paused')
        const entity = Object.values(state.entities).find(value => value.writer?.phase === 'revoked')
        assert.ok(entity?.writer)
        const writer = writers.get(entity.id)
        assert.ok(writer)
        assert.ok(owned.population().chargedActors > 0)
        assert.equal(Object.keys(state.world!.results).length, 0)
        const id = simulationDecisionIdSchema.parse('retired-world-callback')
        await assert.rejects(Promise.resolve().then(async () => await writer.openDecision(id, state.revision)),
          /admission|maintenance|writer/)
        await assert.rejects(Promise.resolve().then(async () => await writer.submitDecision(id, [])),
          /admission|maintenance|writer/)
        assert.ok(entity.binding)
        const actor = ctx.agents.get(entity.binding.sessionId)
        assert.ok(actor)
        await assert.rejects(ctx.simulationTeams.modelRequest(actor, { kind: 'submit' }, new AbortController().signal),
          /authority|admission|maintenance|writer/)
        assert.equal(owned.snapshot().revision, state.revision)
        let unload: 'not-requested' | 'pending' | 'failed' = 'not-requested'
        if (stage === 'retirement-unload') {
          const runtime = ctx.registry.get(SimulationTeams)
          assert.ok(runtime)
          const [fiber] = runtime.fibers
          assert.ok(fiber)
          unload = 'pending'
          let succeeded = false
          void fiber.dispose().then(() => { succeeded = true }, () => { unload = 'failed' })
          await new Promise(done => setTimeout(done, 20))
          assert.equal(succeeded, false)
          assert.ok(owned.population().chargedActors > 0)
          assert.equal(owned.snapshot().maintenance?.[input[0].id]?.status, 'draining')
        }
        await writeFile(path(), JSON.stringify(evidenceSchema.parse({ entityId: entity.id, epoch: entity.writer.epoch,
          chargedActors: owned.population().chargedActors, phase: entity.writer.phase, lateCallbacksRejected: 3, unload })))
        await hold(stage)
        throw error
      }
    }
    return connection
  }
}

/**
 * Verify that a new-process restore retires the original unconfirmed epoch before any production scheduling.
 * @param run - Original product-held run after explicit authenticated restoration.
 */
export async function verifyWorldRetirementRestored(run: SimulationRun): Promise<void> {
  const evidence = evidenceSchema.parse(JSON.parse(await readFile(path(), 'utf8')))
  const state = run.snapshot(), writer = state.entities[evidence.entityId]?.writer
  assert.equal(state.phase, 'paused')
  assert.equal(writer?.epoch, evidence.epoch)
  assert.equal(writer?.phase, 'released')
  assert.equal(run.population().chargedActors, 0)
}
