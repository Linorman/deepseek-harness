/** A killed Loader Host leaves final recovery to a separate Loader and durable source streams. */
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execa } from 'execa'
import { describe, expect, it } from 'vitest'
import { resolveExampleLaunch } from '@clocky/clocky-loader-smoke'
import { JsonStorageBackend } from '@clocky/clocky-storage-json'
import { SqliteStorageBackend } from '@clocky/clocky-storage-sqlite'

const repository = fileURLToPath(new URL('../../../', import.meta.url))
const fixtures = join(import.meta.dirname, 'fixtures')
const driverPath = join(fixtures, 'headless-final-restart-driver.ts')
const configPath = join(fixtures, 'headless-final-restart.cordis.yml')
const cli = join(repository, 'apps/cli/src/bin.ts')

type Backend = 'json' | 'sqlite'
type Window = 'intent' | 'sink' | 'receipt'

function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('expected a durable JSON object')
  return value as Record<string, unknown>
}

/** Copy the stopped Host's medium so inspection cannot reclaim its JSON lock or checkpoint its SQLite WAL. */
async function copyCrashedStore(cwd: string, backend: Backend): Promise<string> {
  const evidence = join(cwd, 'crashed-store')
  const home = join(cwd, '.clocky')
  const target = join(evidence, '.clocky')
  await mkdir(target, { recursive: true })
  if (backend === 'json') {
    await cp(join(home, 'team-storage-json'), join(target, 'team-storage-json'), { recursive: true })
  } else {
    for (const file of (await readdir(home)).filter(name => name.startsWith('team-storage.sqlite'))) {
      await cp(join(home, file), join(target, file))
    }
  }
  return evidence
}

/** Read either the captured crash medium or the database after the recovered Loader has exited. */
async function storedStreams(cwd: string, provider: Backend) {
  const backend = provider === 'json'
    ? new JsonStorageBackend(join(cwd, '.clocky/team-storage-json'))
    : new SqliteStorageBackend({ path: join(cwd, '.clocky/team-storage.sqlite') })
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

function launch(cwd: string, backend: Backend, window: Window, stage: 'crash' | 'recover', teamId?: string) {
  return resolveExampleLaunch({
    srcBin: cli, configArgs: ['--profile', 'headless', '--patch', configPath],
    tsconfigPath: join(repository, 'tsconfig.json'),
    env: {
      CLOCKY_HOME: join(cwd, '.clocky'), CLOCKY_AGENTS_HOME: join(cwd, '.agents'),
      CLOCKY_FINAL_RESTART_BACKEND: backend, CLOCKY_FINAL_RESTART_WINDOW: window, CLOCKY_FINAL_RESTART_STAGE: stage,
      ...(teamId === undefined ? {} : { CLOCKY_FINAL_RESTART_TEAM_ID: teamId }),
      CLOCKY_TELEMETRY_DISABLED: '1', CLOCKY_SNAPSHOT: 'replay',
      NODE_OPTIONS: [process.env.NODE_OPTIONS, '--disable-warning=ExperimentalWarning'].filter(Boolean).join(' '),
    },
  })
}

describe('headless final recovery across killed Loader Hosts', () => {
  for (const backend of ['json', 'sqlite'] as const) {
    for (const window of ['intent', 'sink', 'receipt'] as const) {
      it(`recovers the ${window} window on ${backend} without an old TeamRun handle`, async () => {
        await mkdir(join(repository, '.tmp'), { recursive: true })
        const cwd = await mkdtemp(join(repository, '.tmp/headless-final-restart-'))
        try {
          const target = join(cwd, '.clocky/profiles/headless/snapshot-fixtures')
          await mkdir(target, { recursive: true })
          await writeFile(join(target, 'headless-final-restart-driver.ts'), await readFile(driverPath))
          await writeFile(join(target, 'package.json'), '{"type":"module"}\n')
          const first = launch(cwd, backend, window, 'crash')
          const killed = await execa(first.command, first.args, {
            cwd, env: first.env, input: '', timeout: 30_000, killSignal: 'SIGKILL', reject: false,
          })
          expect(killed.timedOut, killed.stderr).toBe(false)
          expect(killed.signal, killed.stderr).toBe('SIGKILL')
          expect(killed.stderr).toBe('')
          const checkpoint = object(JSON.parse(killed.stdout))
          expect(checkpoint).toMatchObject({ stage: 'crash', window })

          const before = await storedStreams(await copyCrashedStore(cwd, backend), backend)
          const teams = before.filter(stream => stream.name.startsWith('team/'))
          const channels = before.filter(stream => stream.name.startsWith('channel/'))
          expect(teams).toHaveLength(1)
          expect(channels).toHaveLength(1)
          const team = teams[0]!
          const channel = channels[0]!
          const teamId = team.name.slice('team/'.length)
          expect(checkpoint.stream).toBe(window === 'receipt' ? channel.name : team.name)
          expect(checkpoint.tail).toBe((window === 'receipt' ? channel : team).entries.at(-1)?.sequence)
          const closures = team.entries.filter(entry => entry.value.type === 'team/closure')
          expect(closures).toHaveLength(1)
          const closure = object(closures[0]?.value.closure)
          expect(closure).toMatchObject({ kind: 'complete', teamId, finalChannelId: channel.name.slice('channel/'.length) })
          const final = object(channel.entries.find(entry => entry.value.type === 'channel/envelope')?.value.envelope)
          expect(final.id).toBe(closure.finalEnvelopeId)
          const priorBinding = object(team.entries.filter(entry => entry.value.type === 'activation/changed').at(-1)?.value.binding)
          expect(priorBinding.quiescedAt !== undefined).toBe(window !== 'intent')
          expect(priorBinding.recovery).toBeUndefined()
          const initial = {
            teamPhase: team.entries.filter(entry => entry.value.type === 'team/phase').at(-1)?.value.phase,
            goalPhase: object(team.entries.filter(entry => entry.value.type === 'goal/changed').at(-1)?.value.goal).phase,
            sinkAdmissions: team.entries.filter(entry => entry.value.type === 'team/final-admitted').length,
            humanReceipts: channel.entries.filter(entry => entry.value.type === 'channel/receipt').length,
            quiesced: priorBinding.quiescedAt !== undefined,
          }
          expect(initial).toEqual({
            teamPhase: 'quiescing', goalPhase: 'complete', sinkAdmissions: window === 'intent' ? 0 : 1,
            humanReceipts: window === 'receipt' ? 1 : 0, quiesced: window !== 'intent',
          })

          const second = launch(cwd, backend, window, 'recover', teamId)
          const recovered = await execa(second.command, second.args, {
            cwd, env: second.env, input: '', timeout: 30_000, killSignal: 'SIGKILL', reject: false,
          })
          const recoveryDiagnostic = JSON.stringify({
            timedOut: recovered.timedOut, exitCode: recovered.exitCode, signal: recovered.signal,
            stdout: recovered.stdout, stderr: recovered.stderr,
          })
          expect(recovered.timedOut, recoveryDiagnostic).toBe(false)
          expect(recovered.exitCode, recoveryDiagnostic).toBe(0)
          expect(recovered.stderr).toBe('')
          const output = object(JSON.parse(recovered.stdout))
          expect(output.pid).not.toBe(checkpoint.pid)
          expect(output.stage).toBe('recover')
          expect(output.window).toBe(window)
          const coldLaunch = launch(cwd, backend, window, 'recover', teamId)
          const cold = await execa(coldLaunch.command, coldLaunch.args, {
            cwd, env: coldLaunch.env, input: '', timeout: 30_000, killSignal: 'SIGKILL', reject: false,
          })
          expect(cold.exitCode, cold.stderr).toBe(0)
          expect(cold.stderr).toBe('')
          const coldOutput = object(JSON.parse(cold.stdout))
          expect(coldOutput.pid).not.toBe(output.pid)
          expect({ ...coldOutput, pid: output.pid }).toEqual(output)
          const after = await storedStreams(cwd, backend)
          expect(after.map(stream => stream.name).sort()).toEqual(before.map(stream => stream.name).sort())
          for (const original of before) {
            const resumed = after.find(stream => stream.name === original.name)!
            expect(resumed.entries.slice(0, original.entries.length)).toEqual(original.entries)
          }
          const recoveredTeam = after.find(stream => stream.name === team.name)!
          const recoveredChannel = after.find(stream => stream.name === channel.name)!
          expect(recoveredTeam.entries.filter(entry => entry.value.type === 'team/closure')).toEqual(closures)
          const admissions = recoveredTeam.entries.filter(entry => entry.value.type === 'team/final-admitted')
          const receipts = recoveredChannel.entries.filter(entry => entry.value.type === 'channel/receipt')
          expect(admissions).toHaveLength(1)
          expect(receipts).toHaveLength(1)
          expect(object(admissions[0]?.value.admission)).toMatchObject({ envelopeId: final.id, sink: 'team-run-result' })
          expect(receipts[0]?.value).toMatchObject({ envelopeId: final.id })
          expect(recoveredTeam.entries.filter(entry => entry.value.type === 'team/phase').map(entry => entry.value.phase))
            .toEqual(['active', 'quiescing', window === 'intent' ? 'stalled' : 'completed'])
          const binding = object(recoveredTeam.entries.filter(entry => entry.value.type === 'activation/changed').at(-1)?.value.binding)
          expect(binding).toEqual(priorBinding)
          const { pid: _pid, stage: _stage, window: _window, ...summary } = output
          const snapshot = `${JSON.stringify({ scenario: 'headless-final-restart', backend, window, independentHost: true, initial, recovered: summary }, null, 2)}\n`
          const expected = join(import.meta.dirname, `snapshots/headless-final-restart/${backend}-${window}.expected.json`)
          if (process.env.CLOCKY_SNAPSHOT === 'refresh') {
            await mkdir(dirname(expected), { recursive: true })
            await writeFile(expected, snapshot)
          } else {
            expect(snapshot).toBe(await readFile(expected, 'utf8'))
          }
        } finally { await rm(cwd, { recursive: true, force: true }) }
      }, 90_000)
    }
  }
})
