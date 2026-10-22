/** Real Loader resolves an original local rename while another canonical context stays open. */
import assert from 'node:assert/strict'
import { boot } from '@clocky/clocky-app-boot'
import { localObjectFixture } from '../../../packages/simulation/simulation-local/tests/world-local-object-fixture.ts'
import { contextRequest } from '../../../packages/simulation/simulation-local/tests/context-fixture.ts'
import { simulationDecisionIdSchema, simulationWindowRequestSchema } from '@clocky/clocky-simulation'

const backend = process.env.SIMULATION_COMPANY_BACKEND
assert.ok(backend === 'json' || backend === 'sqlite')
const root = process.env.SIMULATION_COMPANY_ROOT
assert.ok(root)
const ctx = await boot('world-local-object', process.argv[2]!)
const h = await localObjectFixture(backend, { loadedContext: { ctx, serviceFiber: ctx.fiber },
  evidenceRoot: root })
try {
  const second = await h.request(h.targets[1]!), id = simulationDecisionIdSchema.parse('parallel-original-context')
  const window = await h.run.openWindow(simulationWindowRequestSchema.parse({ id: 'parallel-name-window', decisions: [{
    id, entityId: h.requester, context: { ...contextRequest(), world: { kind: 'request', intentId: second.request.intentId } },
  }] }), h.run.snapshot().revision)
  const original = structuredClone(h.run.snapshot().decisions[id]!.context)
  await h.handler.execute(h.plan)
  const state = h.run.snapshot()
  assert.equal(state.activeWindowId, window.id)
  assert.deepEqual(state.decisions[id]!.context, original)
  const result = Object.values(state.world!.results).find(value => value.requestId === h.first.request.id)!
  console.log(JSON.stringify({ backend, modelCalls: h.requests.length, name: state.entities[h.targets[0]!]!.profile.name,
    windowPreserved: true, contextPreserved: true, maintenanceCount: Object.keys(state.maintenance ?? {}).length, result: result.payload }))
} finally { await h.close() }
