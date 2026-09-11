/** Real Loader delivery drains normal closed protocol outboxes to Agents and principal inboxes. */
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@clocky/clocky-loader-smoke'
import { expect, it } from 'vitest'

const fixtures = join(import.meta.dirname, 'fixtures')
const overlay = join(fixtures, 'headless-closed-outbox.cordis.yml')
const repository = fileURLToPath(new URL('../../../', import.meta.url))
it('drains closed consult, discussion, and workflow outboxes through the real Loader', async () => {
  const result = await runLoaderSmoke({ label: 'closed channel outbox', tempDirPrefix: 'closed-outbox-',
    binScript: join(repository, 'apps/cli/src/bin.ts'), configPath: overlay,
    binArgs: ['--profile', 'headless', '--patch', overlay], tsconfigPath: join(repository, 'tsconfig.json'),
    env: { CLOCKY_TELEMETRY_DISABLED: '1', TSX_DISABLE_CACHE: '1',
      NODE_OPTIONS: [process.env.NODE_OPTIONS, '--disable-warning=ExperimentalWarning'].filter(Boolean).join(' ') },
    prepare: async (cwd) => {
      const target = join(cwd, '.clocky/profiles/headless/snapshot-fixtures')
      await mkdir(target, { recursive: true })
      await copyFile(join(fixtures, 'headless-closed-outbox-driver.ts'), join(target, 'headless-closed-outbox-driver.ts'))
      await writeFile(join(target, 'package.json'), '{"type":"module"}\n')
    },
  })
  expect(result.stderr).toBe('')
  expect(JSON.parse(result.stdout)).toEqual(JSON.parse(await readFile(join(import.meta.dirname, 'snapshots/closed-channel-outbox.expected.json'), 'utf8')))
}, LOADER_SMOKE_TEST_TIMEOUT_MS)
