/** Real failure/cancellation intents recover through a fresh Loader after SIGKILL. */
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
const driverPath = join(fixtures, 'headless-terminal-restart-driver.ts')
const configPath = join(fixtures, 'headless-terminal-restart.cordis.yml')
type Backend = 'json' | 'sqlite'
type Outcome = 'failure' | 'cancellation'
type Window = 'intent' | 'quiesced'

function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('expected a durable JSON object')
  return value as Record<string, unknown>
}

/** Inspect a copy so the new Loader remains the first owner to reclaim the crashed medium. */
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

/** Read bounded complete source streams from the real backend after the owning process exits. */
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

function launch(cwd: string, backend: Backend, outcome: Outcome, window: Window, stage: 'crash' | 'recover', teamId?: string) {
  return resolveExampleLaunch({
    srcBin: join(repository, 'apps/cli/src/bin.ts'),
    configArgs: ['--profile', 'headless', '--patch', configPath], tsconfigPath: join(repository, 'tsconfig.json'),
    env: {
      CLOCKY_HOME: join(cwd, '.clocky'), CLOCKY_AGENTS_HOME: join(cwd, '.agents'),
      CLOCKY_TERMINAL_RESTART_BACKEND: backend, CLOCKY_TERMINAL_RESTART_OUTCOME: outcome,
      CLOCKY_TERMINAL_RESTART_WINDOW: window, CLOCKY_TERMINAL_RESTART_STAGE: stage,
      ...(teamId === undefined ? {} : { CLOCKY_TERMINAL_RESTART_TEAM_ID: teamId }),
      CLOCKY_TELEMETRY_DISABLED: '1', CLOCKY_SNAPSHOT: 'replay',
      NODE_OPTIONS: [process.env.NODE_OPTIONS, '--disable-warning=ExperimentalWarning'].filter(Boolean).join(' '),
    },
  })
}

describe('headless failure and cancellation across killed Loader Hosts', () => {
  for (const backend of ['json', 'sqlite'] as const) {
    for (const outcome of ['failure', 'cancellation'] as const) {
      for (const window of ['intent', 'quiesced'] as const) {
        it(`recovers ${outcome} from ${window} on ${backend} without an old owner`, async () => {
          await mkdir(join(repository, '.tmp'), { recursive: true })
          const cwd = await mkdtemp(join(repository, '.tmp/headless-terminal-restart-'))
          try {
            const target = join(cwd, '.clocky/profiles/headless/snapshot-fixtures')
            await mkdir(target, { recursive: true })
            await writeFile(join(target, 'headless-terminal-restart-driver.ts'), await readFile(driverPath))
            await writeFile(join(target, 'package.json'), '{"type":"module"}\n')
            const first = launch(cwd, backend, outcome, window, 'crash')
            const killed = await execa(first.command, first.args, {
              cwd, env: first.env, input: '', timeout: 30_000, killSignal: 'SIGKILL', reject: false,
            })
            const crashDiagnostic = JSON.stringify({ timedOut: killed.timedOut, exitCode: killed.exitCode,
              signal: killed.signal, stdout: killed.stdout, stderr: killed.stderr })
            expect(killed.timedOut, crashDiagnostic).toBe(false)
            expect(killed.signal, crashDiagnostic).toBe('SIGKILL')
            expect(killed.stderr).toBe('')
            const checkpoint = object(JSON.parse(killed.stdout))
            expect(checkpoint).toMatchObject({ stage: 'crash', outcome, window, modelRequests: outcome === 'failure' ? 1 : 0 })

            const before = await storedStreams(await copyCrashedStore(cwd, backend), backend)
            const teams = before.filter(stream => stream.name.startsWith('team/'))
            const channels = before.filter(stream => stream.name.startsWith('channel/'))
            expect(teams).toHaveLength(1)
            expect(channels).toHaveLength(1)
            const team = teams[0]!
            const channel = channels[0]!
            const teamId = team.name.slice('team/'.length)
            expect(checkpoint.stream).toBe(team.name)
            expect(checkpoint.tail).toBe(team.entries.at(-1)?.sequence)
            const originalClosures = team.entries.filter(entry => entry.value.type === 'team/closure')
            const originalCancellations = team.entries.filter(entry => entry.value.type === 'team/cancellation')
            expect(originalClosures).toHaveLength(outcome === 'failure' ? 1 : 0)
            expect(originalCancellations).toHaveLength(outcome === 'cancellation' ? 1 : 0)
            const intent = object(outcome === 'failure' ? originalClosures[0]?.value.closure : originalCancellations[0]?.value.cancellation)
            expect(intent.actor).toEqual({ kind: 'system', name: outcome === 'failure' ? 'team-closure-driver' : 'team-run' })
            expect(object(intent.reason).code).toBe(outcome === 'failure' ? 'TERMINAL_FIXTURE_FAILURE' : 'USER_CANCELLED')
            const priorBinding = object(team.entries.filter(entry => entry.value.type === 'activation/changed').at(-1)?.value.binding)
            expect(priorBinding.quiescedAt !== undefined).toBe(window === 'quiesced')
            expect(priorBinding.recovery).toBeUndefined()
            const created = object(team.entries.find(entry => entry.value.type === 'team/created')?.value)
            const goal = object(team.entries.filter(entry => entry.value.type === 'goal/changed').at(-1)?.value.goal ?? created.goal)
            expect(goal.phase).toBe('active')
            const humanMessage = object(channel.entries.find(entry => entry.value.type === 'channel/envelope')?.value.envelope)
            expect(humanMessage.payload).toEqual({ content: [{ type: 'text', text: 'UNREAD_HUMAN_MESSAGE_AT_HOST_LOSS' }] })
            const initial = {
              teamPhase: team.entries.filter(entry => entry.value.type === 'team/phase').at(-1)?.value.phase,
              goalPhase: goal.phase, quiesced: priorBinding.quiescedAt !== undefined,
              closureCount: originalClosures.length, cancellationCount: originalCancellations.length,
              expiredHumanMessages: channel.entries.filter(entry => entry.value.type === 'channel/delivery-expired').length,
              coordinatorReceipts: channel.entries.filter(entry => entry.value.type === 'channel/receipt').length,
            }
            expect(initial).toMatchObject({ teamPhase: 'quiescing', quiesced: window === 'quiesced',
              expiredHumanMessages: outcome === 'cancellation' && window === 'quiesced' ? 1 : 0,
              coordinatorReceipts: outcome === 'failure' ? 1 : 0 })

            const second = launch(cwd, backend, outcome, window, 'recover', teamId)
            const recovered = await execa(second.command, second.args, {
              cwd, env: second.env, input: '', timeout: 30_000, killSignal: 'SIGKILL', reject: false,
            })
            const recoveryDiagnostic = JSON.stringify({ timedOut: recovered.timedOut, exitCode: recovered.exitCode,
              signal: recovered.signal, stdout: recovered.stdout, stderr: recovered.stderr })
            expect(recovered.timedOut, recoveryDiagnostic).toBe(false)
            expect(recovered.exitCode, recoveryDiagnostic).toBe(0)
            expect(recovered.stderr).toBe('')
            const output = object(JSON.parse(recovered.stdout))
            expect(output.pid).not.toBe(checkpoint.pid)
            expect(output).toMatchObject({ stage: 'recover', outcome, window, modelRequests: 0 })
            const after = await storedStreams(cwd, backend)
            expect(after.map(stream => stream.name).sort()).toEqual(before.map(stream => stream.name).sort())
            for (const original of before) {
              const resumed = after.find(stream => stream.name === original.name)!
              expect(resumed.entries.slice(0, original.entries.length)).toEqual(original.entries)
            }
            const recoveredTeam = after.find(stream => stream.name === team.name)!
            const recoveredChannel = after.find(stream => stream.name === channel.name)!
            const completedClosures = recoveredTeam.entries.filter(entry => entry.value.type === 'team/closure')
            if (outcome === 'cancellation' && window === 'quiesced') {
              expect(completedClosures).toHaveLength(1)
              const closure = object(completedClosures[0]?.value.closure)
              expect(closure).toMatchObject({ kind: 'cancel', idempotencyKey: intent.idempotencyKey,
                actor: intent.actor, reason: intent.reason })
              expect(Number(closure.requestedAt)).toBeGreaterThanOrEqual(Number(intent.requestedAt))
            } else {
              expect(completedClosures).toEqual(originalClosures)
            }
            expect(recoveredTeam.entries.filter(entry => entry.value.type === 'team/cancellation')).toEqual(originalCancellations)
            expect(recoveredTeam.entries.filter(entry => entry.value.type === 'team/final-admitted')).toHaveLength(0)
            const binding = object(recoveredTeam.entries.filter(entry => entry.value.type === 'activation/changed').at(-1)?.value.binding)
            expect(binding).toEqual(priorBinding)
            expect(recoveredTeam.entries.filter(entry => entry.value.type === 'team/phase').map(entry => entry.value.phase))
              .toEqual(['active', 'quiescing', window === 'intent' ? 'stalled' : outcome === 'failure' ? 'failed' : 'cancelled'])
            const expired = recoveredChannel.entries.filter(entry => entry.value.type === 'channel/delivery-expired')
            expect(expired).toHaveLength(1)
            expect(expired[0]?.value).toMatchObject({ envelopeId: humanMessage.id, reason: outcome === 'failure' ? 'closure' : 'cancellation' })
            expect(recoveredChannel.entries.filter(entry => entry.value.type === 'channel/receipt')).toHaveLength(outcome === 'failure' ? 1 : 0)
            const { pid: _pid, stage: _stage, outcome: _outcome, window: _window, ...summary } = output
            const snapshot = `${JSON.stringify({ scenario: 'headless-terminal-restart', backend, outcome, window,
              independentHost: true, initial, recovered: summary }, null, 2)}\n`
            const expected = join(import.meta.dirname, `snapshots/headless-terminal-restart/${backend}-${outcome}-${window}.expected.json`)
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
  }
})
