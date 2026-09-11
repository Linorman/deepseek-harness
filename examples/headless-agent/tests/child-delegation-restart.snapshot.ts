/** Independent Loader crash recovery across durable child-saga windows. */
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execa } from 'execa'
import { describe, expect, it } from 'vitest'
import { resolveExampleLaunch } from '@clocky/clocky-loader-smoke'

const repository = fileURLToPath(new URL('../../../', import.meta.url))
const fixtures = join(import.meta.dirname, 'fixtures')
const overlay = join(fixtures, 'headless-child-delegation.cordis.yml')
const driver = join(fixtures, 'headless-child-delegation-driver.ts')

type CrashAt = 'child-created' | 'child-run-bound' | 'child-cancelled' | 'response' | 'result-admission'
  | 'child-result-admitted' | 'child-receipt' | 'child-closure' | 'child-terminal'
  | 'parent-charge-pending' | 'parent-charge-accepted' | 'parent-charge-settled' | 'parent-settled'
type Backend = 'sqlite' | 'json'
type Scenario = 'complete' | 'cancel'

function launch(
  cwd: string, stage: 'crash' | 'recover', parentTeamId?: string,
  crashAt: CrashAt = 'response', scenario: Scenario = 'complete', backend: Backend = 'sqlite',
) {
  return resolveExampleLaunch({
    srcBin: join(repository, 'apps/cli/src/bin.ts'),
    configArgs: ['--profile', 'headless', '--patch', overlay],
    tsconfigPath: join(repository, 'tsconfig.json'),
    env: {
      CLOCKY_HOME: join(cwd, '.clocky'),
      CLOCKY_AGENTS_HOME: join(cwd, '.agents'),
      CLOCKY_CHILD_SCENARIO: scenario,
      CLOCKY_CHILD_RESTART_BACKEND: backend,
      CLOCKY_CHILD_RESTART_STAGE: stage,
      CLOCKY_CHILD_RESTART_CRASH_AT: crashAt,
      ...(parentTeamId === undefined ? {} : { CLOCKY_CHILD_RESTART_PARENT_ID: parentTeamId }),
      CLOCKY_TELEMETRY_DISABLED: '1',
      NODE_OPTIONS: [process.env.NODE_OPTIONS, '--disable-warning=ExperimentalWarning'].filter(Boolean).join(' '),
    },
  })
}

describe('native child Team delegation across an independent Loader crash', () => {
  for (const backend of ['sqlite', 'json'] as const) for (const crashAt of ['child-created', 'child-run-bound', 'response', 'result-admission',
    'child-result-admitted', 'child-receipt', 'child-closure', 'child-terminal',
    'parent-charge-pending', 'parent-charge-accepted', 'parent-charge-settled', 'parent-settled'] as const) {
    it(`retains the child result after SIGKILL at the ${crashAt} window (${backend})`, async () => {
      const cwd = await mkdtemp(join(repository, `.tmp/headless-child-restart-${backend}-`))
      try {
        const target = join(cwd, '.clocky/profiles/headless/snapshot-fixtures')
        await mkdir(target, { recursive: true })
        await copyFile(driver, join(target, 'headless-child-delegation-driver.ts'))
        await writeFile(join(target, 'package.json'), '{"type":"module"}\n')

        const first = launch(cwd, 'crash', undefined, crashAt, 'complete', backend)
        const killed = await execa(first.command, first.args, {
          cwd, env: first.env, input: '', timeout: 30_000, reject: false,
        })
        expect(killed.timedOut, killed.stderr).toBe(false)
        expect(killed.signal, killed.stderr).toBe('SIGKILL')
        expect(killed.stderr).toBe('')
        const checkpoint = JSON.parse(killed.stdout) as {
          readonly stage: string
          readonly crashAt: CrashAt
          readonly backend: Backend
          readonly parentTeamId: string
        }
        expect(checkpoint.stage).toBe('crash')
        expect(checkpoint.crashAt).toBe(crashAt)
        expect(checkpoint.backend).toBe(backend)
        expect(checkpoint.parentTeamId).toMatch(/^team-/u)

        const second = launch(cwd, 'recover', checkpoint.parentTeamId, crashAt, 'complete', backend)
        const recovered = await execa(second.command, second.args, {
          cwd, env: second.env, input: '', timeout: 30_000, reject: false,
        })
        expect(recovered.timedOut, recovered.stderr).toBe(false)
        expect(recovered.exitCode, JSON.stringify({ stdout: recovered.stdout, stderr: recovered.stderr })).toBe(0)
        expect(recovered.signal).toBeUndefined()
        expect(recovered.stderr).toBe('')
        const output = JSON.parse(recovered.stdout) as Record<string, unknown>
        expect(output).toMatchObject({ stage: 'recover', crashAt, modelRequests: 0 })
        expect(output).toHaveProperty('crossLog.childTeamId')
        if (crashAt === 'child-terminal' || crashAt === 'parent-settled') {
          expect(output).toMatchObject({ parent: 'active', task: 'completed', stallCode: null })
          const repeated = await execa(second.command, second.args, {
            cwd, env: second.env, input: '', timeout: 30_000, reject: false,
          })
          expect(repeated.timedOut, repeated.stderr).toBe(false)
          expect(repeated.exitCode, repeated.stderr).toBe(0)
          expect(repeated.signal).toBeUndefined()
          expect(repeated.stderr).toBe('')
          expect(JSON.parse(repeated.stdout)).toMatchObject({ modelRequests: 0, crossLog: output.crossLog })
        } else {
          expect(output).toMatchObject({ parent: 'stalled', task: 'running' })
          expect(output.stallCode).toEqual(expect.any(String))
        }
        expect(output.child).toEqual(expect.any(String))
        const resultRequired = ['response', 'result-admission', 'child-result-admitted', 'child-receipt', 'child-closure', 'child-terminal', 'parent-settled'].includes(crashAt)
        const resultMayRace = ['parent-charge-pending', 'parent-charge-accepted', 'parent-charge-settled'].includes(crashAt)
        if (resultMayRace) expect(output).toHaveProperty('crossLog.pendingChargeIds.0')
        if (crashAt === 'parent-charge-accepted' || crashAt === 'parent-charge-settled') {
          expect(output).toHaveProperty('crossLog.acceptedChargeIds.0')
        }
        if (crashAt === 'parent-charge-settled') expect(output).toHaveProperty('crossLog.settledChargeIds.0')
        if (resultRequired) expect(output.result).toBe('CHILD_DELEGATION_RESULT')
        else if (resultMayRace) expect([null, 'CHILD_DELEGATION_RESULT']).toContain(output.result)
        else expect(output.result).toBeNull()
      } finally {
        await rm(cwd, { recursive: true, force: true })
      }
    }, 90_000)
  }

  for (const backend of ['sqlite', 'json'] as const) it(`retains cancellation intent after SIGKILL during child cancellation (${backend})`, async () => {
    const cwd = await mkdtemp(join(repository, `.tmp/headless-child-restart-cancel-${backend}-`))
    const crashAt = 'child-cancelled' as const
    try {
      const target = join(cwd, '.clocky/profiles/headless/snapshot-fixtures')
      await mkdir(target, { recursive: true })
      await copyFile(driver, join(target, 'headless-child-delegation-driver.ts'))
      await writeFile(join(target, 'package.json'), '{"type":"module"}\n')

      const first = launch(cwd, 'crash', undefined, crashAt, 'cancel', backend)
      const killed = await execa(first.command, first.args, {
        cwd, env: first.env, input: '', timeout: 30_000, reject: false,
      })
      expect(killed.timedOut, killed.stderr).toBe(false)
      expect(killed.signal, killed.stderr).toBe('SIGKILL')
      expect(killed.stderr).toBe('')
      const checkpoint = JSON.parse(killed.stdout) as { readonly stage: string; readonly backend: Backend; readonly parentTeamId: string }
      expect(checkpoint.stage).toBe('crash')
      expect(checkpoint.backend).toBe(backend)
      expect(checkpoint.parentTeamId).toMatch(/^team-/u)

      const second = launch(cwd, 'recover', checkpoint.parentTeamId, crashAt, 'cancel', backend)
      const recovered = await execa(second.command, second.args, {
        cwd, env: second.env, input: '', timeout: 30_000, reject: false,
      })
      expect(recovered.timedOut, recovered.stderr).toBe(false)
      expect(recovered.exitCode, JSON.stringify({ stdout: recovered.stdout, stderr: recovered.stderr })).toBe(0)
      expect(recovered.signal).toBeUndefined()
      expect(recovered.stderr).toBe('')
      const output = JSON.parse(recovered.stdout) as Record<string, unknown>
      expect(output).toMatchObject({ stage: 'recover', crashAt, parent: 'stalled', modelRequests: 0 })
      expect(output.stallCode).toEqual(expect.any(String))
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  }, 90_000)
})
