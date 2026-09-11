/** Real Loader, worker tool, authenticated Host inbox and durable response across both Team stores. */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execa } from 'execa'
import { describe, expect, it } from 'vitest'
import { resolveExampleLaunch } from '@clocky/clocky-loader-smoke'
const repository = fileURLToPath(new URL('../../../', import.meta.url))
const fixtures = join(import.meta.dirname, 'fixtures')
describe('principal human question through the real Loader', () => {
  for (const backend of ['json', 'sqlite'] as const) {
    it(`answers a real native-worker question on ${backend}`, async () => {
      await mkdir(join(repository, '.tmp'), { recursive: true })
      const root = await mkdtemp(join(repository, '.tmp/human-inbox-loader-'))
      try {
        const work = join(root, 'work')
        const target = join(root, '.clocky/profiles/headless/snapshot-fixtures')
        await mkdir(work)
        await mkdir(target, { recursive: true })
        for (const file of ['human-inbox-question-driver.ts', 'headless-human-question-driver.ts']) {
          await writeFile(join(target, file), await readFile(join(fixtures, file)))
        }
        await writeFile(join(target, 'package.json'), '{"type":"module"}\n')
        const launch = resolveExampleLaunch({ srcBin: join(repository, 'apps/cli/src/bin.ts'),
          configArgs: ['--profile', 'headless', '--patch', join(fixtures, 'human-inbox-question.cordis.yml')],
          tsconfigPath: join(repository, 'tsconfig.json'), env: {
            CLOCKY_HOME: join(root, '.clocky'), CLOCKY_AGENTS_HOME: join(root, '.agents'), CLOCKY_QUESTION_BACKEND: backend,
            CLOCKY_TELEMETRY_DISABLED: '1', CLOCKY_SNAPSHOT: 'replay', TSX_DISABLE_CACHE: '1',
            NODE_OPTIONS: [process.env.NODE_OPTIONS, '--disable-warning=ExperimentalWarning'].filter(Boolean).join(' '),
          } })
        const result = await execa(launch.command, launch.args, { cwd: work, env: launch.env, input: '', timeout: 30000,
          killSignal: 'SIGKILL', reject: false, stripFinalNewline: false })
        expect(result.exitCode, JSON.stringify({ stderr: result.stderr, stdout: result.stdout, timedOut: result.timedOut })).toBe(0)
        expect(result.stderr).toBe('')
        expect(JSON.parse(result.stdout)).toEqual({ scenario: 'principal-human-question', backend, authenticated: true,
          source: 'native-worker', attemptBound: true, questionCalls: 1,
          answer: { kind: 'question', answers: [{ id: 'format', selected: ['Text'] }] },
          modelReceivedAnswer: true, response: 'accepted', retry: 'accepted', action: 'resolved', team: 'cancelled' })
      } finally { await rm(root, { recursive: true, force: true }) }
    }, 40000)
  }
})
