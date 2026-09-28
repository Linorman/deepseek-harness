/** Real Loader recovery stays inside TeamRun disposal on both durable backends. @module */
import { copyFile, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@clocky/clocky-loader-smoke'
import { describe, expect, it } from 'vitest'

const repository = fileURLToPath(new URL('../../../', import.meta.url))
const fixtures = join(import.meta.dirname, 'fixtures')
const overlay = join(fixtures, 'headless-team-resume-lifecycle.cordis.yml')

describe.each(['json', 'sqlite'])('%s coordinator resume disposal', (backend) => {
  it.each(['before-activation', 'after-activation', 'cleanup-failure'])('drains %s without model requests', async (stage) => {
    const result = await runLoaderSmoke({ label: 'coordinator resume disposal', tempDirPrefix: 'headless-resume-disposal-',
      binScript: join(repository, 'apps/cli/src/bin.ts'), configPath: overlay,
      binArgs: ['--profile', 'headless', '--patch', overlay], tsconfigPath: join(repository, 'tsconfig.json'),
      env: { CLOCKY_RESUME_BACKEND: backend, CLOCKY_RESUME_STAGE: stage, CLOCKY_TELEMETRY_DISABLED: '1', TSX_DISABLE_CACHE: '1',
        NODE_OPTIONS: [process.env.NODE_OPTIONS, '--disable-warning=ExperimentalWarning'].filter(Boolean).join(' ') },
      prepare: async (cwd) => {
        const directory = join(cwd, '.clocky/profiles/headless/snapshot-fixtures')
        await mkdir(directory, { recursive: true })
        await copyFile(join(fixtures, 'headless-team-resume-lifecycle.ts'), join(directory, 'headless-team-resume-lifecycle.ts'))
        await writeFile(join(directory, 'package.json'), '{"type":"module"}\n')
      },
    })
    expect(result.stderr).toBe('')
    expect(JSON.parse(result.stdout)).toEqual({ stage, activationCount: stage === 'before-activation' ? 1 : 2,
      allOffline: true, sameSession: true, modelCalls: 0, cleanupFailureReported: stage === 'cleanup-failure' })
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})
