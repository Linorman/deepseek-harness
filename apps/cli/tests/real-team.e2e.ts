import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { runLoaderSmoke } from '@clocky/clocky-loader-smoke'

const binScript = fileURLToPath(new URL('../src/bin.ts', import.meta.url))
const libBinScript = fileURLToPath(new URL('../lib/bin.js', import.meta.url))
const tsconfigPath = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))
const localModelBaseURL = process.env.CLOCKY_LOCAL_MODEL_BASE_URL
const useLocalModel = localModelBaseURL !== undefined && localModelBaseURL.length > 0
const hasModel = useLocalModel || Boolean(process.env.DEEPSEEK_API_KEY)
const localModelPatch = fileURLToPath(new URL('./fixtures/local-openai-compatible-model.cordis.patch.yml', import.meta.url))

describe.skipIf(!hasModel)('headless Team with a real model', () => {
  it('runs a coordinator-to-worker task and waits for the worker before finalizing', async () => {
    let workerProof = ''
    const result = await runLoaderSmoke({
      label: 'headless Team real-model multi-agent run',
      tempDirPrefix: 'headless-team-real-model-',
      binScript,
      libBinScript,
      // `binArgs` selects the profile directly, so the required configPath is not launched.
      configPath: binScript,
      binArgs: [
        '--profile',
        'headless',
        ...(useLocalModel ? ['--patch', localModelPatch] : []),
        [
          'You are the coordinator for a durable Team task.',
          'Do not use bash or filesystem tools yourself.',
          'Call team_task_start exactly once with subject "Create the worker proof".',
          'The task instructions must tell the worker to use the available bash tool to create team-worker-proof.txt in its assigned workspace with exactly TEAM_WORKER_PROOF followed by a newline, then call team_task_report with a completed summary.',
          'After starting the task, call team_task_wait with its task id and wait for completion.',
          'Only after the worker is completed, call team_final on the direct coordinator-to-human channel with text TEAM_REAL_MODEL_FINAL.',
        ].join(' '),
      ],
      tsconfigPath,
      env: {
        CLOCKY_TELEMETRY_DISABLED: '1',
        CLOCKY_PERMISSION_MODE: 'danger-full-access',
        ...(useLocalModel ? {
          CLOCKY_LOCAL_MODEL_BASE_URL: localModelBaseURL,
          CLOCKY_LOCAL_MODEL_ID: process.env.CLOCKY_LOCAL_MODEL_ID ?? 'Qwen3.8-27B-AWQ-4bit',
          CLOCKY_LOCAL_MODEL_API_KEY: process.env.CLOCKY_LOCAL_MODEL_API_KEY ?? 'EMPTY',
        } : {}),
      },
      processTimeoutMs: 240_000,
      inspect: async (cwd) => {
        workerProof = await readFile(join(cwd, 'team-worker-proof.txt'), 'utf8')
      },
    })

    expect(workerProof).toBe('TEAM_WORKER_PROOF\n')
    expect(result.stderr).toBe('')
    expect(result.stdout).toContain('TEAM_REAL_MODEL_FINAL')
  }, 255_000)
})
