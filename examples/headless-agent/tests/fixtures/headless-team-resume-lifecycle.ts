/** A resumed coordinator stays owned until its activation and cleanup stop. @module */
import assert from 'node:assert/strict'
import type { Context } from '@clocky/cordis'
import { LlmAdapter } from '@clocky/clocky-llm'
import type { GenerateOptions, StreamChunk } from '@clocky/clocky-llm'
import * as TeamRun from '@clocky/clocky-team-run'
import type {} from '@clocky/clocky-team-activation-controller'

class SilentModel extends LlmAdapter {
  calls = 0
  async *stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.calls += 1
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

async function run(ctx: Context, model: SilentModel) {
  await ctx.get('loader')?.await()
  const prior = ctx.get('teamRuns')
  assert(prior !== undefined)
  const original = await prior.create({ objective: 'Recover without starting inference', cwd: process.cwd() })
  const runtime = ctx.registry.get(TeamRun)
  assert(runtime !== undefined)
  assert.equal(runtime.fibers.length, 1)
  for (const fiber of [...runtime.fibers]) await fiber.dispose()
  const stopped = await ctx.teams.getTeam({ teamId: original.teamId })
  assert(stopped.activations.every(binding => binding.activation.status === 'offline'), JSON.stringify(stopped.activations))
  await ctx.plugin(TeamRun, { workerCount: 0, maxWorkerCount: 0 })
  const owner = ctx.get('teamRuns')
  assert(owner !== undefined && owner !== prior)
  const stage = process.env.CLOCKY_RESUME_STAGE
  assert(stage === 'before-activation' || stage === 'after-activation' || stage === 'cleanup-failure')
  const entered = Promise.withResolvers<undefined>()
  const release = Promise.withResolvers<undefined>()
  let cleanup: (() => Promise<void>) | undefined
  const activate = ctx.teamActivations.activate.bind(ctx.teamActivations)
  ctx.teamActivations.activate = async (request) => {
    const lease = stage === 'before-activation' ? undefined : await activate(request)
    if (stage === 'cleanup-failure' && lease !== undefined) {
      const dispose = lease.dispose.bind(lease)
      lease.dispose = async () => { throw new Error('Unconfirmed resumed activation cleanup') }
      cleanup = async () => { lease.dispose = dispose; await dispose() }
    }
    entered.resolve(undefined)
    await release.promise
    return lease ?? await activate(request)
  }
  try {
    const resuming = owner.resume({ teamId: original.teamId, signal: new AbortController().signal })
    const rejected = resuming.then(() => { assert.fail('Resume succeeded during shutdown') }, (error: unknown) => error)
    await Promise.race([entered.promise, resuming.then(() => { throw new Error('Resume bypassed activation') })])
    let closed = false
    const closing = owner.close().then(() => { closed = true }, (error: unknown) => error)
    try {
      await new Promise<void>((resolve) => { setImmediate(resolve) })
      assert.equal(closed, false)
    } finally {
      release.resolve(undefined)
      const resumeError = await rejected
      const closeError = await closing
      if (stage === 'cleanup-failure') {
        assert(resumeError instanceof AggregateError)
        assert(closeError instanceof AggregateError)
        await cleanup?.()
      } else assert.equal(closeError, undefined)
    }
    const state = await ctx.teams.getTeam({ teamId: original.teamId })
    assert.equal(state.activations.length, stage === 'before-activation' ? 1 : 2)
    assert(state.activations.every(binding => binding.activation.status === 'offline' && binding.quiescedAt !== undefined))
    assert(state.activations.every(binding => binding.sessionId === original.coordinatorLease.binding.sessionId))
    assert.equal(ctx.agents.list().length, 0)
    assert.equal(model.calls, 0)
    return { stage, activationCount: state.activations.length, allOffline: true, sameSession: true, modelCalls: model.calls,
      cleanupFailureReported: stage === 'cleanup-failure' }
  } finally { release.resolve(undefined); ctx.teamActivations.activate = activate; await cleanup?.() }
}

/** Loader identity. */
export const name = 'team-resume-lifecycle'
/** TeamRun is read dynamically so replacing that provider does not dispose this driver. */
export const inject = ['teams', 'teamActivations', 'agents', 'llm']
/** Run the real recovery/disposal flow. @param ctx - Loader-owned context. */
export function apply(ctx: Context): void {
  const model = new SilentModel()
  ctx.llm.registerAdapter(['resume-lifecycle'], model)
  const exit = ctx.get('appExit')
  assert(exit !== undefined)
  void run(ctx, model).then((value) => {
    process.stdout.write(`${JSON.stringify(value)}\n`)
    exit(0)
  }, (error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`)
    exit(1)
  })
}
