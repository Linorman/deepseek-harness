/** Provider release precedes failed Hub confirmation; a new Loader retries confirmation without repeating cleanup. */
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execa } from 'execa'
import { describe, expect, it } from 'vitest'
import { resolveExampleLaunch } from '@clocky/clocky-loader-smoke'
import { JsonStorageBackend } from '@clocky/clocky-storage-json'
import { SqliteStorageBackend } from '@clocky/clocky-storage-sqlite'

const repository = fileURLToPath(new URL('../../../', import.meta.url))
const fixtures = join(import.meta.dirname, 'fixtures')
const configPath = join(fixtures, 'headless-workspace-release-restart.cordis.yml')
const copiedFixtures = ['headless-workspace-release-probe.ts', 'headless-workspace-release-restart-driver.ts']
const ROOT_CONTENT = 'The shared provider must retain this user-owned source file.\n'
type Backend = 'json' | 'sqlite'

function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('expected a durable JSON object')
  return value as Record<string, unknown>
}

/** Keep the original crash lock/WAL untouched until the second Loader opens it. */
async function copyStore(root: string, backend: Backend): Promise<string> {
  const copy = join(root, 'crashed-store')
  const home = join(root, '.clocky')
  await mkdir(join(copy, '.clocky'), { recursive: true })
  if (backend === 'json') {
    await cp(join(home, 'team-storage-json'), join(copy, '.clocky/team-storage-json'), { recursive: true })
  } else {
    for (const file of (await readdir(home)).filter(name => name.startsWith('team-storage.sqlite'))) {
      await cp(join(home, file), join(copy, '.clocky', file))
    }
  }
  return copy
}

/** Inspect complete bounded source journals through their actual storage backend. */
async function streams(root: string, kind: Backend) {
  const backend = kind === 'json' ? new JsonStorageBackend(join(root, '.clocky/team-storage-json'))
    : new SqliteStorageBackend({ path: join(root, '.clocky/team-storage.sqlite') })
  try {
    const infos = (await backend.log.list()).filter(info => info.name.startsWith('team/') || info.name.startsWith('channel/'))
    return await Promise.all(infos.map(async (info) => {
      const stream = await backend.log.open(info)
      try {
        const entries = await stream.read(-1, 256)
        expect(await stream.read(entries.at(-1)?.sequence ?? -1, 1)).toEqual([])
        return { name: info.name, entries: entries.map(entry => ({ sequence: entry.sequence, value: object(entry.value) })) }
      } finally { await stream.close() }
    }))
  } finally { await backend.close() }
}

async function trace(root: string): Promise<Record<string, unknown>[]> {
  return (await readFile(join(root, 'release-trace.jsonl'), 'utf8')).trim().split('\n').map(line => object(JSON.parse(line)))
}

function identity(allocation: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(['id', 'provider', 'mode', 'teamId', 'taskId', 'attemptId', 'assignedRevision',
    'participantId', 'activationId', 'sessionId'].map(key => [key, allocation[key]]))
}

function latestBindings(records: readonly { value: Record<string, unknown> }[]): Record<string, unknown>[] {
  const bindings = new Map<unknown, Record<string, unknown>>()
  for (const record of records) {
    if (record.value.type !== 'activation/changed') continue
    const binding = object(record.value.binding)
    bindings.set(object(binding.activation).id, binding)
  }
  return [...bindings.values()]
}

function launch(root: string, backend: Backend, stage: 'crash' | 'recover', teamId?: string) {
  return resolveExampleLaunch({ srcBin: join(repository, 'apps/cli/src/bin.ts'),
    configArgs: ['--profile', 'headless', '--patch', configPath], tsconfigPath: join(repository, 'tsconfig.json'),
    env: {
      CLOCKY_HOME: join(root, '.clocky'), CLOCKY_AGENTS_HOME: join(root, '.agents'),
      CLOCKY_RELEASE_BACKEND: backend, CLOCKY_RELEASE_STAGE: stage,
      CLOCKY_RELEASE_INTEGRATION_ROOT: join(root, 'integration'), CLOCKY_RELEASE_TRACE_PATH: join(root, 'release-trace.jsonl'),
      ...(teamId === undefined ? {} : { CLOCKY_RELEASE_TEAM_ID: teamId }),
      CLOCKY_TELEMETRY_DISABLED: '1', CLOCKY_SNAPSHOT: 'replay',
      NODE_OPTIONS: [process.env.NODE_OPTIONS, '--disable-warning=ExperimentalWarning'].filter(Boolean).join(' '),
    },
  })
}

describe('shared workspace release across Host loss before confirmation', () => {
  for (const backend of ['json', 'sqlite'] as const) {
    it(`reconciles the exact released provider allocation and retries its confirmation on ${backend}`, async () => {
      await mkdir(join(repository, '.tmp'), { recursive: true })
      const root = await mkdtemp(join(repository, '.tmp/workspace-release-restart-'))
      const work = join(root, 'work')
      try {
        await mkdir(work)
        await mkdir(join(root, 'integration'))
        await writeFile(join(work, 'source.txt'), ROOT_CONTENT)
        const target = join(root, '.clocky/profiles/headless/snapshot-fixtures')
        await mkdir(target, { recursive: true })
        for (const filename of copiedFixtures) await writeFile(join(target, filename), await readFile(join(fixtures, filename)))
        await writeFile(join(target, 'package.json'), '{"type":"module"}\n')
        const first = launch(root, backend, 'crash')
        const killed = await execa(first.command, first.args, { cwd: work, env: first.env, input: '',
          timeout: 30_000, killSignal: 'SIGKILL', reject: false })
        const firstDiagnostic = JSON.stringify({ timedOut: killed.timedOut, exitCode: killed.exitCode,
          signal: killed.signal, stdout: killed.stdout, stderr: killed.stderr })
        expect(killed.timedOut, firstDiagnostic).toBe(false)
        expect(killed.signal, firstDiagnostic).toBe('SIGKILL')
        expect(killed.stderr).toBe('')
        const checkpoint = object(JSON.parse(killed.stdout))
        expect(checkpoint).toMatchObject({ stage: 'crash', confirmationAttempts: 2, failedConfirmations: 1, providerRemovals: 1 })
        const before = await streams(await copyStore(root, backend), backend)
        const teams = before.filter(stream => stream.name.startsWith('team/'))
        expect(teams).toHaveLength(1)
        const team = teams[0]!
        const teamId = team.name.slice('team/'.length)
        expect(checkpoint.stream).toBe(team.name)
        const allocations = team.entries.filter(entry => entry.value.type === 'workspace-allocation/changed')
          .map(entry => object(entry.value.allocation))
        expect(allocations.map(allocation => allocation.lifecycle)).toEqual(['reserved', 'active', 'release-requested'])
        const allocation = allocations.at(-1)!
        expect(identity(allocation)).toEqual(checkpoint.allocation)
        expect(allocation.provider).toBe('shared-local')
        expect(allocation.mode).toBe('shared')
        const task = object(team.entries.filter(entry => entry.value.type === 'task/changed').at(-1)?.value.task)
        expect(task).toMatchObject({ id: allocation.taskId, phase: 'running', attemptCount: 1 })
        expect(object(task.lease)).toMatchObject({ attemptId: allocation.attemptId, assignedRevision: allocation.assignedRevision,
          participantId: allocation.participantId, activationId: allocation.activationId })
        const bindings = latestBindings(team.entries)
        expect(bindings).toHaveLength(2)
        const worker = bindings.find(binding => object(binding.activation).id === allocation.activationId)!
        expect(worker.sessionId).toBe(allocation.sessionId)
        expect(object(worker.activation)).toMatchObject({ participantId: allocation.participantId, status: 'stopping' })
        expect(worker.quiescedAt).toBeUndefined()
        const coordinator = bindings.find(binding => object(binding.activation).id !== allocation.activationId)!
        expect(object(coordinator.activation).status).toBe('offline')
        expect(coordinator.quiescedAt).toBeTypeOf('number')
        const closures = team.entries.filter(entry => entry.value.type === 'team/closure')
        expect(closures).toHaveLength(1)
        expect(object(closures[0]?.value.closure)).toMatchObject({ kind: 'fail', reason: { code: 'RELEASE_FIXTURE_COORDINATOR_FAILURE' } })
        const firstTrace = (await trace(root)).filter(event => event.stage === 'crash')
        expect(firstTrace.map(event => event.type)).toEqual(['provider-manifest-active', 'provider-manifest-removal',
          'confirmation-append-failed', 'provider-manifest-removal', 'confirmation-retry-crash'])
        expect(firstTrace.filter(event => event.type === 'provider-manifest-removal').map(event => event.removed)).toEqual([true, false])
        const active = firstTrace[0]!
        expect(active.identity).toEqual(identity(allocation))
        expect(object(active.manifest).metadata).toEqual(identity(allocation))
        expect(typeof active.path).toBe('string')
        expect(existsSync(String(active.path))).toBe(false)
        expect(await readFile(join(work, 'source.txt'), 'utf8')).toBe(ROOT_CONTENT)

        const second = launch(root, backend, 'recover', teamId)
        const recovered = await execa(second.command, second.args, { cwd: work, env: second.env, input: '',
          timeout: 30_000, killSignal: 'SIGKILL', reject: false })
        const secondDiagnostic = JSON.stringify({ timedOut: recovered.timedOut, exitCode: recovered.exitCode,
          signal: recovered.signal, stdout: recovered.stdout, stderr: recovered.stderr })
        expect(recovered.timedOut, secondDiagnostic).toBe(false)
        expect(recovered.exitCode, secondDiagnostic).toBe(0)
        expect(recovered.stderr).toBe('')
        const output = object(JSON.parse(recovered.stdout))
        expect(output.pid).not.toBe(checkpoint.pid)
        const after = await streams(root, backend)
        expect(after.map(stream => stream.name).sort()).toEqual(before.map(stream => stream.name).sort())
        for (const old of before) {
          expect(after.find(stream => stream.name === old.name)!.entries.slice(0, old.entries.length)).toEqual(old.entries)
        }
        const settled = after.find(stream => stream.name === team.name)!
        const released = settled.entries.filter(entry => entry.value.type === 'workspace-allocation/changed')
          .map(entry => object(entry.value.allocation))
        expect(released.map(value => value.lifecycle)).toEqual(['reserved', 'active', 'release-requested', 'released'])
        expect(identity(released.at(-1)!)).toEqual(identity(allocation))
        expect(released.at(-1)?.revision).toBe(Number(allocation.revision) + 1)
        expect(latestBindings(settled.entries)).toEqual(bindings)
        expect(object(settled.entries.filter(entry => entry.value.type === 'task/changed').at(-1)?.value.task)).toEqual(task)
        expect(settled.entries.filter(entry => entry.value.type === 'team/closure')).toEqual(closures)
        const secondTrace = (await trace(root)).filter(event => event.stage === 'recover')
        expect(secondTrace.map(event => event.type)).toEqual(['provider-manifest-removal', 'confirmation-append-failed', 'confirmation-append-succeeded'])
        expect(secondTrace[0]?.existed).toBe(false)
        expect(secondTrace[0]?.removed).toBe(false)
        expect(secondTrace[1]?.identity).toEqual(identity(allocation))
        expect(secondTrace[2]?.identity).toEqual(identity(allocation))
        expect(secondTrace[1]?.cleanupCalls).toBe(1)
        expect(secondTrace[2]?.cleanupCalls).toBe(1)
        expect(existsSync(String(active.path))).toBe(false)
        expect(await readFile(join(work, 'source.txt'), 'utf8')).toBe(ROOT_CONTENT)
        const { pid: _pid, stage: _stage, ...summary } = output
        const snapshot = `${JSON.stringify({ scenario: 'workspace-release-restart', backend, independentHost: true,
          before: { allocation: 'release-requested', task: 'running', providerManifestCreated: true,
            providerManifestRemoved: true, physicalReleases: 1, failedConfirmations: 1, workerQuiesced: false,
            coordinatorQuiesced: true, sharedRootRetained: true }, recovered: summary }, null, 2)}\n`
        const expected = join(import.meta.dirname, `snapshots/workspace-release-restart/${backend}.expected.json`)
        if (process.env.CLOCKY_SNAPSHOT === 'refresh') {
          await mkdir(dirname(expected), { recursive: true })
          await writeFile(expected, snapshot)
        } else {
          expect(snapshot).toBe(await readFile(expected, 'utf8'))
        }
      } catch (error: unknown) {
        const evidence = join(repository, '.tmp', `failed-${basename(root)}`)
        await cp(root, evidence, { recursive: true })
        throw new Error(`Workspace release failure evidence: ${evidence}`, { cause: error })
      } finally { await rm(root, { recursive: true, force: true }) }
    }, 90_000)
  }
})
