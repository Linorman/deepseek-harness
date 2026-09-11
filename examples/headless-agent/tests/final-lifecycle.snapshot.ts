/** TTL-final rejection and replacement through the real Loader, TeamRun, Link, and Hub. */

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execa } from 'execa'
import { describe, expect, it } from 'vitest'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, resolveExampleLaunch } from '@clocky/clocky-loader-smoke'
import { SqliteStorageBackend } from '@clocky/clocky-storage-sqlite'

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))
const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')
const configPath = join(fixtures, 'headless-final-lifecycle.cordis.yml')
const driverPath = join(fixtures, 'headless-final-lifecycle-driver.ts')
const expectedOutput = fileURLToPath(new URL('./snapshots/headless-final-lifecycle/output.expected.json', import.meta.url))
const cli = fileURLToPath(new URL('../../../apps/cli/src/bin.ts', import.meta.url))
const tsconfigPath = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))

function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('expected a durable JSON record')
  return value as Record<string, unknown>
}

/** Read complete bounded source streams from the actual SQLite backend after process exit. */
async function storedStreams(cwd: string) {
  const backend = new SqliteStorageBackend({ path: join(cwd, '.clocky', 'team-storage.sqlite') })
  try {
    const streams = (await backend.log.list()).filter(info => info.name.startsWith('team/') || info.name.startsWith('channel/'))
    return await Promise.all(streams.map(async (info) => {
      const stream = await backend.log.open({ name: info.name, version: info.version })
      try {
        const entries = await stream.read(-1, 256)
        const tail = entries.at(-1)?.sequence ?? -1
        expect(await stream.read(tail, 1)).toEqual([])
        return { name: info.name, entries: entries.map(entry => ({ sequence: entry.sequence, value: object(entry.value) })) }
      } finally { await stream.close() }
    }))
  } finally { await backend.close() }
}

/** Verify source facts independently of the driver's normalized stdout. */
async function inspectDurableState(cwd: string, workerCount: number): Promise<void> {
  const streams = await storedStreams(cwd)
  const teams = streams.filter(stream => stream.name.startsWith('team/'))
  const channels = streams.filter(stream => stream.name.startsWith('channel/'))
  expect(teams).toHaveLength(1)
  expect(channels).toHaveLength(1)
  const team = teams[0]!
  const participants = team.entries.filter(entry => entry.value.type === 'participant/changed').map(entry => object(entry.value.participant))
  const workerIds = new Set(participants.filter(participant => participant.role === 'worker').map(participant => participant.id))
  expect(workerIds.size).toBe(workerCount)
  const channel = channels[0]!
  const envelopes = channel.entries.filter(entry => entry.value.type === 'channel/envelope')
    .map(entry => object(entry.value.envelope))
  expect(envelopes.map(envelope => object(envelope.payload).text)).toEqual(['EXPIRED_TEAM_FINAL', 'VALID_REPLACEMENT_TEAM_FINAL'])
  const expired = envelopes[0]!
  const replacement = envelopes[1]!
  expect(expired).toMatchObject({ kind: 'final', delivery: 'turn', ttlMs: 1 })
  const expiry = channel.entries.find(entry => entry.value.type === 'channel/delivery-expired')?.value
  expect(expiry).toMatchObject({ envelopeId: expired.id, envelopeSequence: expired.sequence })
  expect(expiry).not.toHaveProperty('reason')
  expect(Number(expiry?.createdAt)).toBeGreaterThanOrEqual(Number(expired.createdAt) + Number(expired.ttlMs))
  const receipts = channel.entries.filter(entry => entry.value.type === 'channel/receipt')
  expect(receipts).toHaveLength(1)
  expect(receipts[0]?.value).toMatchObject({ envelopeId: replacement.id, cursor: replacement.sequence })
  const closures = team.entries.filter(entry => entry.value.type === 'team/closure')
  const admissions = team.entries.filter(entry => entry.value.type === 'team/final-admitted')
  expect(closures).toHaveLength(1)
  expect(admissions).toHaveLength(1)
  expect(object(closures[0]?.value.closure)).toMatchObject({ kind: 'complete', finalEnvelopeId: replacement.id })
  expect(object(admissions[0]?.value.admission)).toMatchObject({
    sink: 'team-run-result', teamId: team.name.slice('team/'.length), channelId: channel.name.slice('channel/'.length),
    envelopeId: replacement.id, envelopeSequence: replacement.sequence, recipientId: receipts[0]?.value.participantId,
  })
  expect(closures[0]!.sequence).toBeLessThan(admissions[0]!.sequence)
  const phases = team.entries.filter(entry => entry.value.type === 'team/phase')
  expect(phases.map(entry => entry.value.phase)).toEqual(['active', 'quiescing', 'completed'])
  expect(admissions[0]!.sequence).toBeLessThan(phases.at(-1)!.sequence)
  const goals = team.entries.filter(entry => entry.value.type === 'goal/changed').map(entry => object(entry.value.goal))
  expect(goals.at(-1)?.phase).toBe('complete')
  const bindings = team.entries.filter(entry => entry.value.type === 'activation/changed').map(entry => object(entry.value.binding))
  expect(object(bindings.at(-1)?.activation).status).toBe('offline')
}

describe('headless final lifecycle Loader snapshot', () => {
  for (const workerCount of [1, 0]) {
    it(`settles a replacement final through the real Team lifecycle with ${workerCount} worker identities`, async () => {
      const tempRoot = join(repoRoot, '.tmp')
      await mkdir(tempRoot, { recursive: true })
      const cwd = await mkdtemp(join(tempRoot, 'headless-final-lifecycle-'))
      try {
        const fixtureRoot = join(cwd, '.clocky', 'profiles', 'headless', 'snapshot-fixtures')
        await mkdir(fixtureRoot, { recursive: true })
        await writeFile(join(fixtureRoot, 'headless-final-lifecycle-driver.ts'), await readFile(driverPath))
        await writeFile(join(fixtureRoot, 'package.json'), '{"type":"module"}\n')
        const topologyPatch = join(cwd, 'topology.patch.yml')
        await writeFile(topologyPatch, `- id: team-run\n  config:\n    workerCount: ${workerCount}\n    maxWorkerCount: ${workerCount}\n`)
        const launch = resolveExampleLaunch({
          srcBin: cli, configArgs: ['--profile', 'headless', '--patch', configPath, '--patch', topologyPatch], tsconfigPath,
          env: {
            CLOCKY_HOME: join(cwd, '.clocky'), CLOCKY_AGENTS_HOME: join(cwd, '.agents'),
            CLOCKY_SNAPSHOT: 'replay', CLOCKY_TELEMETRY_DISABLED: '1',
            TSX_DISABLE_CACHE: '1',
            NODE_OPTIONS: [process.env.NODE_OPTIONS, '--disable-warning=ExperimentalWarning'].filter(Boolean).join(' '),
          },
        })
        const result = await execa(launch.command, launch.args, {
          cwd, env: launch.env, input: '', timeout: 30_000, killSignal: 'SIGKILL', reject: false, stripFinalNewline: false,
        })
        if (result.timedOut || result.exitCode !== 0) {
          throw new Error(`final lifecycle process failed (${String(result.exitCode)})\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`)
        }
        expect(result.stderr).toBe('')
        await inspectDurableState(cwd, workerCount)
        if (process.env.CLOCKY_SNAPSHOT === 'refresh') {
          await mkdir(dirname(expectedOutput), { recursive: true })
          await writeFile(expectedOutput, result.stdout)
        } else {
          expect(result.stdout).toBe(await readFile(expectedOutput, 'utf8'))
        }
      } finally { await rm(cwd, { recursive: true, force: true }) }
    }, LOADER_SMOKE_TEST_TIMEOUT_MS)
  }
})
