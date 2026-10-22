/** Process-local traps distinguish read-only replay from an explicitly authorized new scheduling interval. */
import assert from 'node:assert/strict'
import { Socket } from 'node:net'
import type { Context } from '@clocky/cordis'
import { OrganizationWorldExecution, ExistingHireWorldExecution, GovernanceWorldExecution, NormWorldExecution,
  ExternalWorldExecution, ExternalActorWorldExecution, ExternalMediatedWorldExecution,
  PersonnelWorldExecution } from '@clocky/clocky-simulation-world'

/**
 * Observe actual model/handler execution and refuse ambient sampling or network access during cold replay.
 * @param ctx - Already-booted real Loader; no synthetic service replaces a durable owner.
 * @returns counters, an explicit production switch and restoration of every patched process-local method.
 */
export function installWorldReplayProbe(ctx: Context) {
  let productionAllowed = false
  const counters = { model: 0, execution: 0, randomSample: 0, fetch: 0, socket: 0 }
  const random = Math.random, fetch = globalThis.fetch, connect = Object.getOwnPropertyDescriptor(Socket.prototype, 'connect')
  assert.ok(connect)
  const prototypes = [OrganizationWorldExecution.prototype, ExistingHireWorldExecution.prototype,
    GovernanceWorldExecution.prototype, NormWorldExecution.prototype, ExternalWorldExecution.prototype,
    ExternalActorWorldExecution.prototype, ExternalMediatedWorldExecution.prototype, PersonnelWorldExecution.prototype]
  const originals = prototypes.map(prototype => prototype.execute)
  // Cordis binds services to consumer contexts; the stream waterfall observes actual child Agent calls too.
  const removeStream = ctx.on('llm/stream', (_options, next) => {
    counters.model++
    assert.equal(productionAllowed, true, 'Cold replay attempted a new model request')
    return next()
  })
  prototypes.forEach((prototype, index) => {
    prototype.execute = async function (...args) {
      counters.execution++
      assert.equal(productionAllowed, true, 'Cold replay attempted a new domain execution')
      return await originals[index]!.apply(this, args)
    }
  })
  Math.random = () => {
    if (productionAllowed) return random()
    counters.randomSample++
    throw new Error('Cold replay attempted ambient random sampling')
  }
  globalThis.fetch = async () => { counters.fetch++; throw new Error('Scripted World attempted real external fetch') }
  Socket.prototype.connect = function () { counters.socket++; throw new Error('Scripted World attempted a real network connection') }
  return {
    snapshot: () => ({ ...counters, productionAllowed }),
    allowExplicitStart: () => { assert.equal(productionAllowed, false); productionAllowed = true },
    dispose: () => {
      removeStream(); Math.random = random; globalThis.fetch = fetch; Object.defineProperty(Socket.prototype, 'connect', connect)
      prototypes.forEach((prototype, index) => { prototype.execute = originals[index]! })
    },
  }
}
