/** Real Loader composition delegates, receipts, completes, and cancels child Teams through model tools. */
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@clocky/clocky-loader-smoke'
import { describe, expect, it } from 'vitest'

const fixtures = join(import.meta.dirname, 'fixtures')
const overlay = join(fixtures, 'headless-child-delegation.cordis.yml')
const repository = fileURLToPath(new URL('../../../', import.meta.url))

describe('native child Team delegation', () => {
  for (const backend of ['sqlite', 'json']) for (const scenario of ['complete', 'cancel']) {
    it(`runs the real Loader ${scenario} flow with durable parent settlement (${backend})`, async () => {
      const result = await runLoaderSmoke({ label: `child delegation ${scenario}`,
        tempDirPrefix: `headless-child-${scenario}-`, binScript: join(repository, 'apps/cli/src/bin.ts'), configPath: overlay,
        binArgs: ['--profile', 'headless', '--patch', overlay], tsconfigPath: join(repository, 'tsconfig.json'),
        env: { CLOCKY_CHILD_SCENARIO: scenario, CLOCKY_CHILD_RESTART_BACKEND: backend,
          CLOCKY_TELEMETRY_DISABLED: '1', TSX_DISABLE_CACHE: '1',
          NODE_OPTIONS: [process.env.NODE_OPTIONS, '--disable-warning=ExperimentalWarning'].filter(Boolean).join(' ') },
        prepare: async (cwd) => {
          const directory = join(cwd, '.clocky/profiles/headless/snapshot-fixtures')
          await mkdir(directory, { recursive: true })
          await copyFile(join(fixtures, 'headless-child-delegation-driver.ts'), join(directory, 'headless-child-delegation-driver.ts'))
          await writeFile(join(directory, 'package.json'), '{"type":"module"}\n')
        },
      })
      expect(result.stderr).toBe('')
      const actual = `${JSON.stringify(JSON.parse(result.stdout), null, 2)}\n`
      const expected = join(import.meta.dirname, `snapshots/child-delegation-${scenario}.expected.json`)
      if (process.env.CLOCKY_SNAPSHOT === 'refresh') await writeFile(expected, actual)
      else expect(actual).toBe(await readFile(expected, 'utf8'))
    }, LOADER_SMOKE_TEST_TIMEOUT_MS)
  }
})
