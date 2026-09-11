/** Observe real provider sidecar removal and fault only canonical Hub confirmation appends. */
import assert from 'node:assert/strict'
import { appendFileSync, existsSync, readFileSync, writeSync } from 'node:fs'
import promises from 'node:fs/promises'
import { syncBuiltinESMExports } from 'node:module'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@clocky/cordis'
import z from '@clocky/schemastery'
import { teamWorkspaceAllocationSnapshotSchema } from '@clocky/clocky-team'
import type { TeamWorkspaceAllocationSnapshot } from '@clocky/clocky-team'
import type {} from '@clocky/clocky-storage-log'

/** Test-controlled Host stage and provider-owned evidence location. */
export interface Config {
  readonly stage: 'crash' | 'recover'
  readonly integrationRoot: string
  readonly tracePath: string
}

/** Validate configuration before the production Hub can start. */
export const Config: z<Config> = z.object({
  stage: z.union(['crash', 'recover'] as const).required(),
  integrationRoot: z.string().required(), tracePath: z.string().required(),
})

/** Actual provider filesystem cleanup observed in this process. */
interface Removal {
  readonly path: string
  readonly existed: boolean
  readonly removed: boolean
}

/** Read-only observations exposed to the scenario driver, never lifecycle authority. */
export interface WorkspaceReleaseProbe {
  activeAllocation: TeamWorkspaceAllocationSnapshot | undefined
  manifestPath: string | undefined
  confirmationAttempts: number
  failedConfirmations: number
  successfulConfirmations: number
  readonly removals: Removal[]
}

declare module '@clocky/cordis' {
  interface Context {
    /** Test observation installed before Team source streams open. */
    workspaceReleaseProbe: WorkspaceReleaseProbe
  }
}

function object(value: unknown): Record<string, unknown> {
  assert(value !== null && typeof value === 'object' && !Array.isArray(value), 'expected a provider JSON object')
  return value as Record<string, unknown>
}

/** Metadata jointly owned by the task lease, activation epoch, Hub, and provider sidecar. */
function identity(allocation: TeamWorkspaceAllocationSnapshot): Record<string, unknown> {
  return {
    id: allocation.id, provider: allocation.provider, mode: allocation.mode,
    teamId: allocation.teamId, taskId: allocation.taskId, attemptId: allocation.attemptId,
    assignedRevision: allocation.assignedRevision, participantId: allocation.participantId,
    activationId: allocation.activationId, sessionId: allocation.sessionId,
  }
}

/** Test-only Loader name. */
export const name = 'workspace-release-probe'
/** The real routed storage facility exists before stream interception. */
export const inject = ['storageLog']

/**
 * Observe filesystem effects while preserving every real operation.
 * @param ctx - Loader context.
 * @param config - Host role and evidence paths.
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  const stateRoot = join(await promises.realpath(config.integrationRoot), '.clocky-team-shared-state')
  const state: WorkspaceReleaseProbe = {
    activeAllocation: undefined, manifestPath: undefined, confirmationAttempts: 0,
    failedConfirmations: 0, successfulConfirmations: 0, removals: [],
  }
  const trace = (value: Record<string, unknown>): void => {
    appendFileSync(config.tracePath, `${JSON.stringify({ stage: config.stage, pid: process.pid, ...value })}\n`)
  }
  const remove = promises.rm.bind(promises)
  const log = ctx.storageLog
  const open = log.open.bind(log)
  const restoreStreams: Array<() => void> = []
  let cleanupCountAtFirstConfirmation: number | undefined
  ctx.effect(() => {
    promises.rm = async (path, options) => {
      const filename = path instanceof URL ? fileURLToPath(path) : String(path)
      if (dirname(filename) !== stateRoot || !basename(filename).startsWith('baseline-')) {
        await remove(path, options)
        return
      }
      const existed = existsSync(filename)
      const metadata = existed ? object(JSON.parse(readFileSync(filename, 'utf8'))).metadata : undefined
      await remove(path, options)
      const removed = existed && !existsSync(filename)
      state.manifestPath = filename
      state.removals.push({ path: filename, existed, removed })
      trace({ type: 'provider-manifest-removal', path: filename, existed, removed, metadata })
    }
    syncBuiltinESMExports()
    log.open = async (descriptor) => {
      const stream = await open(descriptor)
      if (!descriptor.name.startsWith('team/')) return stream
      const append = stream.append.bind(stream)
      stream.append = async (expectedSequence, values) => {
        const changed = values.map(object).find(record => record.type === 'workspace-allocation/changed')
        const allocation = changed === undefined ? undefined : teamWorkspaceAllocationSnapshotSchema.parse(changed.allocation)
        if (allocation?.lifecycle === 'released') {
          state.confirmationAttempts += 1
          assert(state.manifestPath !== undefined, 'provider cleanup must precede confirmation')
          assert.equal(existsSync(state.manifestPath), false)
          if (config.stage === 'crash') {
            assert.equal(state.removals.filter(removal => removal.removed).length, 1)
          } else {
            assert.equal(state.removals.filter(removal => removal.removed).length, 0)
            if (cleanupCountAtFirstConfirmation === undefined) cleanupCountAtFirstConfirmation = state.removals.length
            assert.equal(cleanupCountAtFirstConfirmation, 1)
            assert.equal(state.removals.length, cleanupCountAtFirstConfirmation, 'confirmation retries must not repeat provider cleanup')
          }
          if (state.confirmationAttempts === 1) {
            state.failedConfirmations += 1
            trace({ type: 'confirmation-append-failed', identity: identity(allocation), expectedSequence,
              cleanupCalls: state.removals.length, code: 'EIO' })
            throw Object.assign(new Error('injected released confirmation append failure'), { code: 'EIO' })
          }
          if (config.stage === 'crash') {
            trace({ type: 'confirmation-retry-crash', identity: identity(allocation), expectedSequence,
              cleanupCalls: state.removals.length })
            writeSync(1, `${JSON.stringify({ stage: 'crash', pid: process.pid, stream: descriptor.name,
              allocation: identity(allocation), confirmationAttempts: state.confirmationAttempts,
              failedConfirmations: state.failedConfirmations, providerRemovals: 1 })}\n`)
            process.kill(process.pid, 'SIGKILL')
            await new Promise<never>(() => {})
          }
        }
        const result = await append(expectedSequence, values)
        if (allocation?.lifecycle === 'active') {
          const files = (await promises.readdir(stateRoot)).filter(file => file.startsWith('baseline-') && file.endsWith('.json'))
          assert.equal(files.length, 1)
          const path = join(stateRoot, files[0]!)
          const manifest = object(JSON.parse(await promises.readFile(path, 'utf8')))
          assert.deepEqual(manifest.metadata, identity(allocation))
          state.activeAllocation = allocation
          state.manifestPath = path
          trace({ type: 'provider-manifest-active', identity: identity(allocation), path, manifest })
        }
        if (allocation?.lifecycle === 'released') {
          state.successfulConfirmations += 1
          trace({ type: 'confirmation-append-succeeded', identity: identity(allocation),
            tail: result.tailSequence, cleanupCalls: state.removals.length })
        }
        return result
      }
      restoreStreams.push(() => { stream.append = append })
      return stream
    }
    return () => {
      log.open = open
      for (const restore of restoreStreams) restore()
      promises.rm = remove
      syncBuiltinESMExports()
    }
  }, 'workspace-release: actual filesystem observation and append faults')
  ctx.provide('workspaceReleaseProbe', state)
}
