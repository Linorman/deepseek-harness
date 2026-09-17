/** Coordinator tools expose the review lineage produced by real worker/reviewer runs. */
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execa } from 'execa'
import { describe, expect, it } from 'vitest'
import { resolveExampleLaunch } from '@clocky/clocky-loader-smoke'
import { SqliteStorageBackend } from '@clocky/clocky-storage-sqlite'

const repository = fileURLToPath(new URL('../../../', import.meta.url))
const fixtures = join(import.meta.dirname, 'fixtures')

describe('coordinator review facts through the real Loader', () => {
  for (const scenario of [
    { mode: 'none' }, { mode: 'review' }, { mode: 'rework' },
    { mode: 'rework', maxRetriesPerTeam: 1 },
    { mode: 'rework', reassign: true },
    { mode: 'review', fail: true },
    { mode: 'review', fail: true, watch: true },
  ] as const) {
    const { mode } = scenario
    const reassign = 'reassign' in scenario && scenario.reassign
    const fail = 'fail' in scenario && scenario.fail
    const watch = 'watch' in scenario && scenario.watch
    const maxRetriesPerTeam = 'maxRetriesPerTeam' in scenario ? scenario.maxRetriesPerTeam : undefined
    it(`reports the matching attempt decision for ${mode}${reassign ? ' with a replacement worker' : ''}${fail ? ' with a failed reviewer' : ''}${watch ? ' through watch' : ''}${maxRetriesPerTeam === undefined ? '' : ' at the retry limit'}`, async () => {
      await mkdir(join(repository, '.tmp'), { recursive: true })
      const root = await mkdtemp(join(repository, '.tmp/rp-'))
      const work = join(root, 'work')
      try {
        await mkdir(work)
        await writeFile(join(work, 'task.txt'), 'unchanged\n')
        const target = join(root, '.clocky/profiles/headless/snapshot-fixtures')
        await mkdir(target, { recursive: true })
        const driver = 'headless-review-projection-driver.ts'
        await writeFile(join(target, driver), await readFile(join(fixtures, driver)))
        await writeFile(join(target, 'package.json'), '{"type":"module"}\n')
        const budgetPatch = join(target, 'retry-budget.patch.yml')
        if (maxRetriesPerTeam !== undefined) {
          await writeFile(budgetPatch, `- id: team-hub\n  config:\n    maxRetriesPerTeam: ${maxRetriesPerTeam}\n`)
        }
        const poolPatch = join(target, 'pool.patch.yml')
        if (reassign) await writeFile(poolPatch, '- id: team-run\n  config:\n    workerCount: 2\n    workerPreset: minimal\n    reviewerPreset: minimal\n    workerTaskMaxAttempts: 2\n')
        const launch = resolveExampleLaunch({ srcBin: join(repository, 'apps/cli/src/bin.ts'),
          configArgs: ['--profile', 'headless', '--patch', join(fixtures, 'headless-review-projection.cordis.yml'),
            ...maxRetriesPerTeam === undefined ? [] : ['--patch', budgetPatch],
            ...reassign ? ['--patch', poolPatch] : []],
          tsconfigPath: join(repository, 'tsconfig.json'), env: {
            CLOCKY_HOME: join(root, '.clocky'), CLOCKY_AGENTS_HOME: join(root, '.agents'), CLOCKY_REVIEW_MODE: mode,
            CLOCKY_TELEMETRY_DISABLED: '1', TSX_DISABLE_CACHE: '1', CLOCKY_REVIEW_REASSIGN: reassign ? '1' : '0', CLOCKY_REVIEW_FAIL: fail ? '1' : '0', CLOCKY_REVIEW_WAIT_MODE: watch ? 'watch' : 'wait',
            NODE_OPTIONS: [process.env.NODE_OPTIONS, '--disable-warning=ExperimentalWarning'].filter(Boolean).join(' '),
          },
        })
        const result = await execa(launch.command, launch.args, { cwd: work, env: launch.env, input: '',
          timeout: 30_000, killSignal: 'SIGKILL', reject: false, stripFinalNewline: false })
        const diagnostic = JSON.stringify({ timedOut: result.timedOut, exitCode: result.exitCode, signal: result.signal,
          stdout: result.stdout, stderr: result.stderr })
        expect(result.timedOut, diagnostic).toBe(false)
        expect(result.exitCode, diagnostic).toBe(fail ? 1 : 0)
        if (fail) expect(result.stderr).toContain('review cannot progress: Injected reviewer failure')
        else expect(result.stderr).toBe('')
        const backend = new SqliteStorageBackend({ path: join(root, '.clocky/team-storage.sqlite') })
        try {
          const infos = (await backend.log.list()).filter(info => info.name.startsWith('team/'))
          expect(infos).toHaveLength(1)
          const stream = await backend.log.open(infos[0]!)
          try {
            const entries = await stream.read(-1, 256)
            if (maxRetriesPerTeam !== undefined) {
              expect(entries[0]?.value).toMatchObject({ type: 'team/created',
                rules: { teamLimits: { maxRetriesPerTeam } } })
            }
            const tasks = entries.map(entry => entry.value as {
              type: string
              task?: { phase: string; reviewPolicy: { kind: string }; reviewHistory: { nextPhase: string }[] }
            })
              .filter(entry => entry.type === 'task/changed').map(entry => entry.task!)
            if (fail) expect(tasks.at(-1)?.phase).not.toBe('completed')
            else expect(tasks.at(-1)?.phase).toBe('completed')
            expect(tasks[0]?.reviewPolicy.kind).toBe(mode === 'none' ? 'none' : 'participant')
            expect(tasks.at(-1)?.reviewHistory.map(review => review.nextPhase)).toEqual(fail || mode === 'none' ? [] : mode === 'rework' ? ['pending', 'completed'] : ['completed'])
          } finally { await stream.close() }
        } finally { await backend.close() }
        if (fail) { expect(result.stdout).toBe(''); return }
        const expected = join(import.meta.dirname, `snapshots/review-projection/${mode}${reassign ? '-reassigned' : ''}.expected.json`)
        if (process.env.CLOCKY_SNAPSHOT === 'refresh') { await mkdir(dirname(expected), { recursive: true }); await writeFile(expected, result.stdout) }
        else expect(result.stdout).toBe(await readFile(expected, 'utf8'))
      } catch (error: unknown) {
        const evidence = join(repository, '.tmp', `failed-${basename(root)}`)
        await cp(root, evidence, { recursive: true })
        throw new Error(`Review projection failure evidence: ${evidence}`, { cause: error })
      } finally { await rm(root, { recursive: true, force: true }) }
    }, 45_000)
  }
})
