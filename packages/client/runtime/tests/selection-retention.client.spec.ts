/** Old business projections release independently of historical Session routing. */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'

it('collects previous Team state after navigation while retaining Session ownership', async () => {
  const root = fileURLToPath(new URL('../../../../', import.meta.url))
  const fixture = fileURLToPath(new URL('./fixtures/team-selection-retention.client.ts', import.meta.url))
  const result = await promisify(execFile)(process.execPath, ['--expose-gc', '--import', 'tsx/esm', fixture], {
    cwd: root, timeout: 15_000, maxBuffer: 1024 * 1024,
    env: { ...process.env, TSX_DISABLE_CACHE: '1', TSX_TSCONFIG_PATH: resolve(root, 'tsconfig.client.json') },
  })
  expect(result.stdout).toBe('released previous Team state and arrays; historical Session routing resolved on demand\n')
  expect(result.stderr).toBe('')
}, 20_000)
