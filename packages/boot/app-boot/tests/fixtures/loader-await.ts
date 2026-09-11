/** Concurrent Loader settlement runs in its own process because a stale readiness check can spin microtasks. */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { Context } from '@clocky/cordis'
import Loader from '@clocky/cordis-plugin-loader'

const ctx = new Context()
await ctx.plugin(Loader)
const entered = Promise.withResolvers<undefined>()
const ready = Promise.withResolvers<undefined>()
const callerEntered = Promise.withResolvers<undefined>()
const callerDone = Promise.withResolvers<undefined>()
let starts = 0
let active = 0
ctx.loader.builtins.provider = {
  async apply() { entered.resolve(undefined); await ready.promise },
}
ctx.loader.builtins.consumer = {
  async apply(scope: Context) {
    starts += 1
    await readFile(import.meta.filename)
    scope.effect(() => { active += 1; return () => { active -= 1 } })
  },
}
ctx.loader.builtins.caller = {
  apply(scope: Context) {
    callerEntered.resolve(undefined)
    void scope.get('loader')!.await().then(() => { callerDone.resolve(undefined) }, callerDone.reject)
  },
}
const loading = ctx.loader.root.update([
  { id: 'provider', name: 'cordis:provider' },
  { id: 'consumer', name: 'cordis:consumer', inject: ['loader'], intercept: { loader: { await: true } } },
  { id: 'caller', name: 'cordis:caller' },
])
await Promise.all([entered.promise, callerEntered.promise])
assert.equal(starts, 0)
const boot = ctx.loader.await()
ready.resolve(undefined)
await Promise.all([loading, boot, callerDone.promise])
assert.equal(starts, 1)
assert.equal(active, 1)
await Promise.all([ctx.loader.await(), ctx.loader.await()])
assert.equal(starts, 1)
const settling = ctx.loader.await()
const restart = ctx.loader.resolve('consumer').fiber!.restart()
await Promise.all([settling, restart, ctx.loader.await()])
assert.equal(starts, 2)
assert.equal(active, 1)
await ctx.fiber.dispose()
assert.equal(active, 0)
process.stdout.write(`${JSON.stringify({ initialStarts: 1, restartStarts: starts, active })}\n`)
