import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@clocky/cordis'
import Storage from '@clocky/clocky-storage'
import * as StorageJson from '@clocky/clocky-storage-json'
import * as StorageLog from '@clocky/clocky-storage-log'
import * as StorageSqlite from '@clocky/clocky-storage-sqlite'
import { channelIdSchema } from '@clocky/clocky-team'
import type { ChannelOpenInput } from '@clocky/clocky-team'
import { DIRECTED_VIEW_POLICY, directChannelAdapter } from '@clocky/clocky-team-channel-direct'
import { createTestRootTeam, inviteBootstrapParticipant, transitionBootstrapParticipant } from '../../../core/team/tests/bootstrap-topology-authority.ts'
import { openTestChannel } from '../../../core/team/tests/channel-lifecycle-authority.ts'
import TeamHub, { CHANNEL_WAL_FORMAT_VERSION } from '../src/index.ts'

const roots: string[] = []
const contexts = new Set<Context>()

afterEach(async () => {
  for (const ctx of contexts) await ctx.fiber.dispose()
  contexts.clear()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

/** Mount a fresh Hub runtime against an existing or empty backend directory. */
async function mountHub(backend: 'json' | 'sqlite', root: string, release: () => void, acquire: () => void = () => {}) {
  const ctx = new Context()
  contexts.add(ctx)
  await ctx.plugin(Storage)
  if (backend === 'json') await ctx.plugin(StorageJson, { root })
  else await ctx.plugin(StorageSqlite, { path: join(root, 'hub.db') })
  await ctx.plugin(StorageLog, { backend, routes: {} })
  await ctx.plugin(TeamHub, { recoveryPageSize: 1 })
  const retireAdapter = ctx.teams.registerAdapter({ ...directChannelAdapter,
    acquireRuntimeLease() {
      acquire()
      let released = false
      return { adapter: directChannelAdapter, release() {
        if (released) return
        released = true
        release()
      } }
    } })
  const retireView = ctx.teams.registerViewPolicy(DIRECTED_VIEW_POLICY)
  return { ctx, retireAdapter, retireView }
}

/** Compose real storage, Hub and direct protocol leases before opening an authorized channel. */
async function setup(backend: 'json' | 'sqlite', release: () => void) {
  await mkdir(join(process.cwd(), '.tmp'), { recursive: true })
  const root = await mkdtemp(join(process.cwd(), '.tmp', 'channel-open-cleanup-'))
  roots.push(root)
  const { ctx, retireAdapter, retireView } = await mountHub(backend, root, release)
  const created = await createTestRootTeam(ctx, {
    goal: { objective: 'Settle channel opening failures.', budgets: {} }, rules: {}, budgets: {},
  })
  const participants: ChannelOpenInput['participants'][number][] = []
  for (const role of ['sender', 'recipient']) {
    const member = await inviteBootstrapParticipant(ctx, {
      teamId: created.team.id, expectedCursor: (await ctx.teams.getTeam({ teamId: created.team.id })).team.cursor,
      kind: 'local-agent', role, displayName: role, capabilities: [],
    })
    for (const phase of ['provisioning', 'active'] as const) {
      await transitionBootstrapParticipant(ctx, {
        teamId: created.team.id, participantId: member.id,
        expectedCursor: (await ctx.teams.getTeam({ teamId: created.team.id })).team.cursor, phase,
      })
    }
    participants.push({ id: member.id, role })
  }
  const state = await ctx.teams.getTeam({ teamId: created.team.id })
  const input: ChannelOpenInput = { teamId: created.team.id, expectedCursor: state.team.cursor,
    adapter: { type: 'direct', version: 1 }, viewPolicy: { type: 'directed', version: 1 }, participants, limits: {} }
  return { ctx, root, input, state, retireAdapter, retireView }
}

describe('channel creation cleanup', () => {
  for (const backend of ['json', 'sqlite'] as const) {
    it.each(['append', 'revocation'] as const)(`retains admitted implementations until a channel stream closes after %s failure on ${backend}`, async (failureAt) => {
      const runtimeRelease = vi.fn(() => {})
      const harness = await setup(backend, runtimeRelease)
      const closeEntered = Promise.withResolvers<undefined>()
      const closeGate = Promise.withResolvers<undefined>()
      const appendFailure = new Error('channel append EIO')
      const register = harness.ctx.teams.registerSystemChannelLifecycleProofSource.bind(harness.ctx.teams)
      let revoke: (() => void) | undefined
      vi.spyOn(harness.ctx.teams, 'registerSystemChannelLifecycleProofSource').mockImplementation((source) => {
        revoke = register(source)
        return revoke
      })
      const open = harness.ctx.storageLog.open.bind(harness.ctx.storageLog)
      const streamsBefore = await harness.ctx.storageLog.list()
      vi.spyOn(harness.ctx.storageLog, 'open').mockImplementation(async (descriptor) => {
        const stream = await open(descriptor)
        if (descriptor.name.startsWith('channel/')) {
          if (failureAt === 'revocation') revoke?.()
          else vi.spyOn(stream, 'append').mockRejectedValueOnce(appendFailure)
          const close = stream.close.bind(stream)
          vi.spyOn(stream, 'close').mockImplementationOnce(async () => {
            closeEntered.resolve(undefined)
            await closeGate.promise
            await close()
          })
        }
        return stream
      })
      const opening = openTestChannel(harness.ctx, harness.input)
      const result = Promise.allSettled([opening])
      try {
        await closeEntered.promise
        harness.retireAdapter()
        harness.retireView()
        expect(runtimeRelease).not.toHaveBeenCalled()
        expect(harness.ctx.teams.getImplementationLeaseMetrics()).toMatchObject({
          activeAdapterLeases: 1, activeViewPolicyLeases: 1,
          retiredAdapterImplementations: 1, retiredViewPolicyImplementations: 1,
        })
      } finally { closeGate.resolve(undefined) }
      if (failureAt === 'append') expect(await result).toEqual([{ status: 'rejected', reason: appendFailure }])
      else expect(await result).toMatchObject([{ status: 'rejected', reason: { code: 'TEAM_ACTOR_PROOF_INVALID' } }])
      expect(runtimeRelease).toHaveBeenCalledTimes(1)
      expect(harness.ctx.teams.getImplementationLeaseMetrics()).toMatchObject({
        activeAdapterLeases: 0, activeViewPolicyLeases: 0,
        retiredAdapterImplementations: 0, retiredViewPolicyImplementations: 0,
      })
      expect(await harness.ctx.teams.getTeam({ teamId: harness.input.teamId })).toEqual(harness.state)
      expect(await harness.ctx.storageLog.list()).toEqual(streamsBefore)
    })

    it.each([false, true])(`preserves a storage-open failure with runtime cleanup failure=%s on ${backend}`, async (releaseFails) => {
      const releaseFailure = new Error('adapter runtime cleanup failed')
      const runtimeRelease = vi.fn(() => { if (releaseFails) throw releaseFailure })
      const harness = await setup(backend, runtimeRelease)
      const openFailure = new Error('channel open EIO')
      const open = harness.ctx.storageLog.open.bind(harness.ctx.storageLog)
      const streamsBefore = await harness.ctx.storageLog.list()
      vi.spyOn(harness.ctx.storageLog, 'open').mockImplementation(async (descriptor) => {
        if (descriptor.name.startsWith('channel/')) throw openFailure
        return await open(descriptor)
      })
      await expect(openTestChannel(harness.ctx, harness.input)).rejects.toSatisfy((error: unknown) =>
        releaseFails ? error instanceof AggregateError && error.errors.length === 2
          && error.errors[0] === openFailure && error.errors[1] === releaseFailure : error === openFailure,
      )
      expect(runtimeRelease).toHaveBeenCalledTimes(1)
      expect(harness.ctx.teams.getImplementationLeaseMetrics()).toMatchObject({ activeAdapterLeases: 0, activeViewPolicyLeases: 0 })
      expect(await harness.ctx.teams.getTeam({ teamId: harness.input.teamId })).toEqual(harness.state)
      expect(await harness.ctx.storageLog.list()).toEqual(streamsBefore)
    })

    it(`keeps a committed but unattached channel WAL unreachable after an ambiguous append failure on ${backend}`, async () => {
      const runtimeRelease = vi.fn(() => {})
      const harness = await setup(backend, runtimeRelease)
      const appendFailure = new Error('channel append result was lost')
      const openedEvents = vi.fn()
      harness.ctx.on('channel/changed', openedEvents)
      const open = harness.ctx.storageLog.open.bind(harness.ctx.storageLog)
      let orphanName = ''
      vi.spyOn(harness.ctx.storageLog, 'open').mockImplementation(async (descriptor) => {
        const stream = await open(descriptor)
        if (descriptor.name.startsWith('channel/') && orphanName === '') {
          orphanName = descriptor.name
          const append = stream.append.bind(stream)
          vi.spyOn(stream, 'append').mockImplementationOnce(async (...args) => {
            await append(...args)
            throw appendFailure
          })
        }
        return stream
      })
      await expect(openTestChannel(harness.ctx, harness.input)).rejects.toBe(appendFailure)
      expect(runtimeRelease).toHaveBeenCalledTimes(1)
      expect(openedEvents).not.toHaveBeenCalled()
      expect(await harness.ctx.teams.getTeam({ teamId: harness.input.teamId })).toEqual(harness.state)
      expect((await harness.ctx.storageLog.list()).find(stream => stream.name === orphanName)).toMatchObject({ tailSequence: 3 })
      await expect(harness.ctx.teams.getChannel({ channelId: channelIdSchema.parse(orphanName.slice('channel/'.length)) }))
        .rejects.toMatchObject({ code: 'TEAM_CHANNEL_NOT_FOUND' })
      expect(runtimeRelease).toHaveBeenCalledTimes(2)
      expect(harness.ctx.teams.getImplementationLeaseMetrics()).toMatchObject({ activeAdapterLeases: 0, activeViewPolicyLeases: 0 })
    })

    it.each([
      { closeFails: false, releaseFails: true },
      { closeFails: true, releaseFails: false },
      { closeFails: true, releaseFails: true },
    ])(`settles stream and runtime cleanup with close failure=$closeFails / release failure=$releaseFails on ${backend}`, async ({ closeFails, releaseFails }) => {
      const releaseFailure = new Error('adapter runtime cleanup failed')
      const runtimeRelease = vi.fn(() => { if (releaseFails) throw releaseFailure })
      const harness = await setup(backend, runtimeRelease)
      const appendFailure = new Error('channel append EIO')
      const closeFailure = new Error('channel close EIO')
      const closed = vi.fn()
      const open = harness.ctx.storageLog.open.bind(harness.ctx.storageLog)
      const streamsBefore = await harness.ctx.storageLog.list()
      vi.spyOn(harness.ctx.storageLog, 'open').mockImplementation(async (descriptor) => {
        const stream = await open(descriptor)
        if (descriptor.name.startsWith('channel/')) {
          vi.spyOn(stream, 'append').mockRejectedValueOnce(appendFailure)
          const close = stream.close.bind(stream)
          vi.spyOn(stream, 'close').mockImplementationOnce(async () => {
            await close()
            closed()
            if (closeFails) throw closeFailure
          })
        }
        return stream
      })
      await expect(openTestChannel(harness.ctx, harness.input)).rejects.toSatisfy((error: unknown) =>
        error instanceof AggregateError && error.errors.length === 1 + Number(closeFails) + Number(releaseFails)
          && error.errors[0] === appendFailure && (!releaseFails || error.errors.at(-1) === releaseFailure)
          && (!closeFails || error.errors[1] === closeFailure),
      )
      expect(closed).toHaveBeenCalledTimes(1)
      expect(runtimeRelease).toHaveBeenCalledTimes(1)
      expect(harness.ctx.teams.getImplementationLeaseMetrics()).toMatchObject({ activeAdapterLeases: 0, activeViewPolicyLeases: 0 })
      expect(await harness.ctx.teams.getTeam({ teamId: harness.input.teamId })).toEqual(harness.state)
      expect(await harness.ctx.storageLog.list()).toEqual(streamsBefore)
    })
  }
})

/** Commit an attached channel, close its first Hub, and recover through a separately mounted Hub. */
async function coldChannel(backend: 'json' | 'sqlite', release: () => void, acquire?: () => void) {
  const first = await setup(backend, () => {})
  const channel = await openTestChannel(first.ctx, first.input)
  const state = await first.ctx.teams.getTeam({ teamId: first.input.teamId })
  await first.ctx.fiber.dispose()
  contexts.delete(first.ctx)
  const mounted = await mountHub(backend, first.root, release, acquire)
  return { ...mounted, channel, state }
}

describe('channel cold recovery cleanup', () => {
  for (const backend of ['json', 'sqlite'] as const) {
    it(`retains recovered implementations until the failed WAL read closes on ${backend}`, async () => {
      const runtimeRelease = vi.fn(() => {})
      const harness = await coldChannel(backend, runtimeRelease)
      const readFailure = new Error('channel recovery read EIO')
      const closeEntered = Promise.withResolvers<undefined>()
      const closeGate = Promise.withResolvers<undefined>()
      const closeCount = vi.fn()
      const open = harness.ctx.storageLog.open.bind(harness.ctx.storageLog)
      const instrument = vi.spyOn(harness.ctx.storageLog, 'open').mockImplementation(async (descriptor) => {
        const stream = await open(descriptor)
        if (descriptor.name.startsWith('channel/')) {
          const read = stream.read.bind(stream)
          vi.spyOn(stream, 'read').mockImplementation(async (cursor, limit) => {
            if (harness.ctx.teams.getImplementationLeaseMetrics().activeAdapterLeases > 0) throw readFailure
            return await read(cursor, limit)
          })
          const close = stream.close.bind(stream)
          vi.spyOn(stream, 'close').mockImplementationOnce(async () => {
            closeEntered.resolve(undefined)
            await closeGate.promise
            await close()
            closeCount()
          })
        }
        return stream
      })
      const recovering = harness.ctx.teams.getChannel({ channelId: harness.channel.manifest.id })
      const result = Promise.allSettled([recovering])
      try {
        await closeEntered.promise
        harness.retireAdapter()
        harness.retireView()
        expect(runtimeRelease).not.toHaveBeenCalled()
        expect(harness.ctx.teams.getImplementationLeaseMetrics()).toMatchObject({
          activeAdapterLeases: 1, activeViewPolicyLeases: 1,
          retiredAdapterImplementations: 1, retiredViewPolicyImplementations: 1,
        })
      } finally { closeGate.resolve(undefined) }
      expect(await result).toEqual([{ status: 'rejected', reason: readFailure }])
      expect(closeCount).toHaveBeenCalledTimes(1)
      expect(runtimeRelease).toHaveBeenCalledTimes(1)
      instrument.mockRestore()
      expect(await harness.ctx.teams.getTeam({ teamId: harness.state.team.id })).toEqual(harness.state)
      expect(harness.ctx.teams.getImplementationLeaseMetrics()).toMatchObject({ activeAdapterLeases: 0, activeViewPolicyLeases: 0 })
    })

    it.each(['checkpoint', 'anchor', 'initial-wal', 'acquire'] as const)(`closes the recovery stream after early %s failure on ${backend}`, async (failureAt) => {
      const failure = new Error(`recovery ${failureAt} failure`)
      const runtimeRelease = vi.fn(() => {})
      let failing = true
      const harness = await coldChannel(backend, runtimeRelease, () => { if (failureAt === 'acquire' && failing) throw failure })
      if (failureAt === 'initial-wal') {
        const journal = await harness.ctx.storageLog.open({ name: `channel/${harness.channel.manifest.id}`, version: CHANNEL_WAL_FORMAT_VERSION })
        try { await journal.writeCheckpoint({ sequence: journal.tailSequence, value: { kind: 'invalid-channel-checkpoint' } }) }
        finally { await journal.close() }
      }
      const closeCount = vi.fn()
      const open = harness.ctx.storageLog.open.bind(harness.ctx.storageLog)
      const instrument = vi.spyOn(harness.ctx.storageLog, 'open').mockImplementation(async (descriptor) => {
        const stream = await open(descriptor)
        if (descriptor.name.startsWith('channel/')) {
          if (failureAt === 'checkpoint') vi.spyOn(stream, 'readCheckpoint').mockRejectedValueOnce(failure)
          if (failureAt === 'anchor' || failureAt === 'initial-wal') vi.spyOn(stream, 'read').mockRejectedValueOnce(failure)
          const close = stream.close.bind(stream)
          vi.spyOn(stream, 'close').mockImplementationOnce(async () => { await close(); closeCount() })
        }
        return stream
      })
      await expect(harness.ctx.teams.getChannel({ channelId: harness.channel.manifest.id })).rejects.toBe(failure)
      expect(closeCount).toHaveBeenCalledTimes(1)
      expect(runtimeRelease).not.toHaveBeenCalled()
      instrument.mockRestore()
      expect(await harness.ctx.teams.getTeam({ teamId: harness.state.team.id })).toEqual(harness.state)
      expect(harness.ctx.teams.getImplementationLeaseMetrics()).toMatchObject({ activeAdapterLeases: 0, activeViewPolicyLeases: 0 })
      failing = false
      await expect(harness.ctx.teams.getChannel({ channelId: harness.channel.manifest.id })).resolves.toEqual(harness.channel)
    })

    it(`retains the malformed WAL error when recovered runtime cleanup fails on ${backend}`, async () => {
      const releaseFailure = new Error('replayed adapter runtime cleanup failed')
      const runtimeRelease = vi.fn(() => { throw releaseFailure })
      const harness = await coldChannel(backend, runtimeRelease)
      const name = `channel/${harness.channel.manifest.id}`
      const stream = await harness.ctx.storageLog.open({ name, version: CHANNEL_WAL_FORMAT_VERSION })
      try {
        await stream.append(stream.tailSequence, [{ type: 'channel/phase', sequence: 2, createdAt: Date.now(), phase: 'not-a-phase' }])
      } finally { await stream.close() }
      const closeCount = vi.fn()
      const open = harness.ctx.storageLog.open.bind(harness.ctx.storageLog)
      vi.spyOn(harness.ctx.storageLog, 'open').mockImplementation(async (descriptor) => {
        const stream = await open(descriptor)
        if (descriptor.name === name) {
          const close = stream.close.bind(stream)
          vi.spyOn(stream, 'close').mockImplementationOnce(async () => { await close(); closeCount() })
        }
        return stream
      })
      await expect(harness.ctx.teams.getChannel({ channelId: harness.channel.manifest.id })).rejects.toMatchObject({
        errors: [expect.objectContaining({ code: 'TEAM_CHANNEL_WAL_MALFORMED' }), releaseFailure],
      })
      expect(closeCount).toHaveBeenCalledTimes(1)
      expect(runtimeRelease).toHaveBeenCalledTimes(1)
      expect(harness.ctx.teams.getImplementationLeaseMetrics()).toMatchObject({ activeAdapterLeases: 0, activeViewPolicyLeases: 0 })
    })

    it.each([false, true])(`preserves WAL read, runtime cleanup and optional close failure=%s on ${backend}`, async (closeFails) => {
      const releaseFailure = new Error('recovered adapter runtime cleanup failed')
      const runtimeRelease = vi.fn(() => { throw releaseFailure })
      const harness = await coldChannel(backend, runtimeRelease)
      const readFailure = new Error('channel recovery read EIO')
      const closeFailure = new Error('recovered stream close EIO')
      const closeCount = vi.fn()
      const open = harness.ctx.storageLog.open.bind(harness.ctx.storageLog)
      const instrument = vi.spyOn(harness.ctx.storageLog, 'open').mockImplementation(async (descriptor) => {
        const stream = await open(descriptor)
        if (descriptor.name.startsWith('channel/')) {
          const read = stream.read.bind(stream)
          vi.spyOn(stream, 'read').mockImplementation(async (cursor, limit) => {
            if (harness.ctx.teams.getImplementationLeaseMetrics().activeAdapterLeases > 0) throw readFailure
            return await read(cursor, limit)
          })
          const close = stream.close.bind(stream)
          vi.spyOn(stream, 'close').mockImplementationOnce(async () => {
            await close()
            closeCount()
            if (closeFails) throw closeFailure
          })
        }
        return stream
      })
      await expect(harness.ctx.teams.getChannel({ channelId: harness.channel.manifest.id })).rejects.toSatisfy((error: unknown) =>
        error instanceof AggregateError && error.errors.length === (closeFails ? 3 : 2)
          && error.errors[0] === readFailure && error.errors.at(-1) === releaseFailure
          && (!closeFails || error.errors[1] === closeFailure),
      )
      expect(closeCount).toHaveBeenCalledTimes(1)
      expect(runtimeRelease).toHaveBeenCalledTimes(1)
      instrument.mockRestore()
      expect(await harness.ctx.teams.getTeam({ teamId: harness.state.team.id })).toEqual(harness.state)
      expect(harness.ctx.teams.getImplementationLeaseMetrics()).toMatchObject({ activeAdapterLeases: 0, activeViewPolicyLeases: 0 })
    })
  }
})
