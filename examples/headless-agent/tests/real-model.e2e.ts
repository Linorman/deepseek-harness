import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { runLoaderSmoke } from '@clocky/clocky-loader-smoke'

const binScript = fileURLToPath(new URL('./fixtures/headless-driver.ts', import.meta.url))
const configPath = fileURLToPath(new URL('../cordis.yml', import.meta.url))
const tsconfigPath = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))
const hasModel = Boolean(process.env.CLOCKY_LOCAL_MODEL_BASE_URL) || Boolean(process.env.DEEPSEEK_API_KEY)

describe.skipIf(!hasModel)('headless-agent with real model', () => {
  it('modifies a temporary workspace and verifies the file outside the agent', async () => {
    let verified = ''
    const { stdout } = await runLoaderSmoke({
      label: 'headless-agent real model',
      tempDirPrefix: 'headless-agent-real-',
      binScript,
      libBinScript: binScript,
      configPath,
      binArgs: [
        configPath,
        'Read task.txt, replace its complete contents with exactly "value=after" followed by a newline, read it again, and report briefly.',
      ],
      tsconfigPath,
      env: {
        ...process.env.CLOCKY_LOCAL_MODEL_BASE_URL === undefined ? {} : {
          CLOCKY_LOCAL_MODEL_BASE_URL: process.env.CLOCKY_LOCAL_MODEL_BASE_URL,
          CLOCKY_LOCAL_MODEL_ID: process.env.CLOCKY_LOCAL_MODEL_ID ?? 'Qwen3.8-27B-AWQ-4bit',
          CLOCKY_LOCAL_MODEL_API_KEY: process.env.CLOCKY_LOCAL_MODEL_API_KEY ?? 'EMPTY',
        },
      },
      processTimeoutMs: 120_000,
      prepare: cwd => writeFile(join(cwd, 'task.txt'), 'value=before\n'),
      inspect: async (cwd) => { verified = await readFile(join(cwd, 'task.txt'), 'utf8') },
    })
    expect(verified).toBe('value=after\n')
    expect(stdout.trim().length).toBeGreaterThan(0)
  }, 135_000)
})
