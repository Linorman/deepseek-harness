/** Real TeamRun channel admission retains every implementation until WAL cleanup completes. */
import assert from 'node:assert/strict'
import type { Context } from '@clocky/cordis'
import { LlmAdapter } from '@clocky/clocky-llm'
import type { GenerateOptions, LlmResolvedModelInfo, StreamChunk } from '@clocky/clocky-llm'
import { DIRECTED_VIEW_POLICY, directChannelV4Adapter } from '@clocky/clocky-team-channel-direct'
import type { ChannelManifest, TeamId } from '@clocky/clocky-team'
import type {} from '@clocky/clocky-storage-log'
import type {} from '@clocky/clocky-team-run'

const MODEL = 'channel-open-model'
type FailureAt = 'before-append' | 'after-append'

/** Model selection remains available, but admission fails before an Agent can request a model. */
class ChannelOpenModel extends LlmAdapter {
  requests = 0
  override async resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return { provider, id: model, name: model }
  }

  async *stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests += 1
    yield { type: 'finish', reason: { kind: 'error', failure: { code: 'UNEXPECTED_MODEL_REQUEST', message: 'Channel admission must fail before activation.' } } }
  }
}

interface CaseState {
  readonly at: FailureAt
  readonly appendFailure: Error
  readonly closeFailure: Error
  readonly runtimeFailure: Error
  readonly closeEntered: PromiseWithResolvers<undefined>
  readonly closeGate: PromiseWithResolvers<undefined>
  readonly order: string[]
  manifest?: ChannelManifest
  streamName?: string
  appendAttempts: number
  committed: boolean
  closeAttempts: number
  closeCompleted: boolean
  runtimeReleases: number
}

/** The real public source audit must contain no attachment for either failed open. */
async function assertNoAttachment(ctx: Context, teamId: TeamId): Promise<void> {
  let afterCursor = -1
  for (;;) {
    const page = await ctx.teams.readAudit({ teamId, afterCursor, limit: 32 })
    assert(!page.items.some(entry => entry.type === 'channel/attached'))
    if (page.nextCursor === undefined) return
    afterCursor = page.nextCursor
  }
}

function leases(ctx: Context) {
  const { activeAdapterLeases, activeViewPolicyLeases, retiredAdapterImplementations, retiredViewPolicyImplementations }
    = ctx.teams.getImplementationLeaseMetrics()
  return { activeAdapterLeases, activeViewPolicyLeases, retiredAdapterImplementations, retiredViewPolicyImplementations }
}

async function run(ctx: Context, model: ChannelOpenModel): Promise<Record<string, unknown>[]> {
  await ctx.get('loader')?.await()
  const summaries: Record<string, unknown>[] = []
  const log = ctx.storageLog
  const open = log.open.bind(log)
  let current: CaseState | undefined
  const publications: string[] = []
  const stop = ctx.on('channel/changed', (event) => { publications.push(event.record.type) })
  log.open = async (descriptor) => {
    const stream = await open(descriptor)
    if (!descriptor.name.startsWith('channel/')) return stream
    const state = current
    assert(state !== undefined && state.streamName === undefined)
    state.streamName = descriptor.name
    state.order.push('wal-opened')
    const append = stream.append.bind(stream)
    stream.append = async (cursor, values, options) => {
      state.appendAttempts += 1
      assert.equal(state.appendAttempts, 1)
      if (state.at === 'after-append') {
        await append(cursor, values, options)
        state.committed = true
        state.order.push('wal-appended')
      }
      state.order.push('append-error')
      throw state.appendFailure
    }
    const close = stream.close.bind(stream)
    stream.close = async () => {
      state.closeAttempts += 1
      state.order.push('close-entered')
      state.closeEntered.resolve(undefined)
      await state.closeGate.promise
      await close()
      state.closeCompleted = true
      state.order.push('wal-closed')
      throw state.closeFailure
    }
    return stream
  }
  try {
    for (const at of ['before-append', 'after-append'] as const) {
      const state: CaseState = {
        at, appendFailure: Object.assign(new Error('CHANNEL_APPEND_EIO'), { code: 'EIO' }),
        closeFailure: Object.assign(new Error('CHANNEL_CLOSE_EIO'), { code: 'EIO' }),
        runtimeFailure: new Error('ADAPTER_RUNTIME_RELEASE_FAILED'),
        closeEntered: Promise.withResolvers<undefined>(), closeGate: Promise.withResolvers<undefined>(),
        order: [], appendAttempts: 0, committed: false, closeAttempts: 0, closeCompleted: false, runtimeReleases: 0,
      }
      current = state
      const retireAdapter = ctx.teams.registerAdapter({ ...directChannelV4Adapter,
        acquireRuntimeLease(manifest) {
          assert.equal(state.manifest, undefined)
          state.manifest = manifest
          state.order.push('runtime-acquired')
          let released = false
          return { adapter: directChannelV4Adapter, release() {
            if (released) return
            released = true
            assert.equal(state.closeCompleted, true, 'runtime lease must survive until the actual WAL close completes')
            state.runtimeReleases += 1
            state.order.push('runtime-released')
            throw state.runtimeFailure
          } }
        },
      })
      const retirePolicy = ctx.teams.registerViewPolicy(DIRECTED_VIEW_POLICY)
      const creating = ctx.teamRuns.create({ objective: `Reject channel creation ${at}.`, cwd: process.cwd(),
        selection: { provider: MODEL, model: MODEL } })
      const settled = Promise.allSettled([creating])
      try {
        await state.closeEntered.promise
        assert.equal(state.runtimeReleases, 0)
        assert.equal(state.closeCompleted, false)
        retireAdapter()
        retirePolicy()
        assert.deepEqual(leases(ctx), {
          activeAdapterLeases: 1, activeViewPolicyLeases: 1,
          retiredAdapterImplementations: 1, retiredViewPolicyImplementations: 1,
        })
      } finally { state.closeGate.resolve(undefined) }
      const [result] = await settled
      assert(result?.status === 'rejected')
      assert(result.reason instanceof AggregateError)
      const failures: readonly unknown[] = result.reason.errors
      assert.equal(failures.length, 3)
      for (const [index, error] of [state.appendFailure, state.closeFailure, state.runtimeFailure].entries()) {
        assert.equal(failures[index], error)
      }
      assert.equal(new Set(failures).size, 3)
      assert.equal(state.appendAttempts, 1)
      assert.equal(state.closeAttempts, 1)
      assert.equal(state.runtimeReleases, 1)
      assert.deepEqual(leases(ctx), {
        activeAdapterLeases: 0, activeViewPolicyLeases: 0,
        retiredAdapterImplementations: 0, retiredViewPolicyImplementations: 0,
      })
      assert(state.manifest !== undefined && state.streamName !== undefined)
      const team = await ctx.teams.getTeam({ teamId: state.manifest.teamId })
      assert.equal(team.team.phase, 'failed')
      assert.equal(team.team.closure?.kind, 'fail')
      assert.equal(team.team.closure.reason.code, 'TEAM_RUN_CREATION_FAILED')
      assert.equal(team.goal.phase, 'active')
      assert.equal(team.activations.length, 0)
      assert.deepEqual(team.channelIds, [])
      await assertNoAttachment(ctx, state.manifest.teamId)
      assert.deepEqual(publications, [])
      const info = (await log.list()).find(item => item.name === state.streamName)
      if (at === 'before-append') assert.equal(info, undefined)
      else assert.equal(info?.tailSequence, 1 + state.manifest.participants.length)
      assert.deepEqual(state.order, ['runtime-acquired', 'wal-opened',
        ...at === 'after-append' ? ['wal-appended'] : [], 'append-error', 'close-entered', 'wal-closed', 'runtime-released'])
      summaries.push({ failureAt: at, order: state.order,
        errors: failures.map((error) => { assert(error instanceof Error); return error.message }), errorsRetainedOnce: true,
        leasesHeldUntilClose: true, remainingImplementationLeases: 0, channelPublications: 0, teamAttachments: 0,
        wal: state.committed ? 'committed-orphan-retained' : 'empty-wal-removed', team: team.team.phase,
        goal: team.goal.phase, activations: team.activations.length })
    }
    assert.equal(model.requests, 0)
    return summaries
  } finally {
    current?.closeGate.resolve(undefined)
    log.open = open
    stop()
  }
}

/** Test-only Loader identity. */
export const name = 'channel-open-failure-driver'
/** Actual Team admission and routed durability owners. */
export const inject = ['teamRuns', 'teams', 'storageLog', 'llm']
/** Execute two actual channel creation failures. @param ctx - Loader context. */
export function apply(ctx: Context): void {
  const model = new ChannelOpenModel()
  ctx.llm.registerAdapter([MODEL], model)
  const exit = ctx.get('appExit')
  assert(exit !== undefined)
  void run(ctx, model).then((cases) => {
    process.stdout.write(`${JSON.stringify({ scenario: 'channel-open-failure', cases, modelRequests: model.requests }, null, 2)}\n`)
    exit(0)
  }, (error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`)
    exit(1)
  })
}
