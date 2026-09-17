import { mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { Agent } from '@clocky/clocky-agent'
import { resolveExampleLaunch } from '@clocky/clocky-loader-smoke'
import { startSdkRun } from '@clocky/clocky-compat-subagent-clocky-sdk/src/run.ts'
import {
  SDK_SUBAGENT_COMMITTED_OUTPUT,
  SDK_SUBAGENT_TEAM_FINAL,
} from './fixtures/subagent-clocky-sdk-team-snapshot/team-final-llm.ts'

const fixtureDir = new URL('./fixtures/subagent-clocky-sdk-team-snapshot/', import.meta.url)
const configPath = fileURLToPath(new URL('cordis.yml', fixtureDir))
const expectedPath = fileURLToPath(new URL('./snapshots/subagent-clocky-sdk-team/result.expected.json', import.meta.url))
const runtimeBin = fileURLToPath(new URL('../../../packages/examples/jsonrpc-demo/src/bin.ts', import.meta.url))
const tsconfigPath = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))

interface StoredLog {
  readonly stream: { readonly name: string }
  readonly entries: readonly { readonly value: Record<string, unknown> }[]
}

async function storedLogs(root: string): Promise<StoredLog[]> {
  const directory = join(root, 'logs')
  const files = (await readdir(directory)).filter(file => file.endsWith('.json'))
  return await Promise.all(files.map(async file => JSON.parse(await readFile(join(directory, file), 'utf8')) as StoredLog))
}

describe('SDK subagent Team final snapshot', () => {
  it('maps a real child Team final and committed coordinator output into the parent SubagentRun', async () => {
    const tempRoot = join(repoRoot, '.tmp')
    await mkdir(tempRoot, { recursive: true })
    const cwd = await mkdtemp(join(tempRoot, 'subagent-clocky-sdk-team-snapshot-'))
    const sessionRoot = join(cwd, '.sessions')
    const teamStorageRoot = join(cwd, '.team-storage')
    const launch = resolveExampleLaunch({
      srcBin: runtimeBin,
      configArgs: [configPath],
      tsconfigPath,
    })
    const errors: string[] = []
    const run = await startSdkRun({
      label: 'Team final snapshot',
      prompt: [{ type: 'text', text: 'Return the deterministic Team final.' }],
      parent: { id: 'parent', session: { header: { cwd } } } as unknown as Agent,
      signal: new AbortController().signal,
    }, {
      onError: (error) => { errors.push(error.message) },
      command: launch.command,
      args: launch.args,
      cwd,
      provider: 'sdk-subagent-team-snapshot',
      model: 'sdk-subagent-team-snapshot',
      credential: 'sdk-subagent-team-snapshot-credential',
      env: {
        ...Object.fromEntries(Object.entries(launch.env).filter(([, value]) => value !== undefined)),
        CLOCKY_SESSION_ROOT: sessionRoot,
        CLOCKY_TEAM_STORAGE_ROOT: teamStorageRoot,
      },
      shutdownTimeoutMs: 1_000,
      disposeEofGraceMs: 6_000,
      disposeGraceMs: 3_000,
    })
    try {
      const result = await run.result
      await run.dispose()
      expect(`${JSON.stringify(result)}\n`, JSON.stringify(errors)).toBe(await readFile(expectedPath, 'utf8'))

      const channel = (await storedLogs(teamStorageRoot)).find(log => log.stream.name.startsWith('channel/'))
      expect(channel?.entries.filter(entry => entry.value['type'] === 'channel/acknowledged')).toHaveLength(2)
      const final = channel?.entries.find(entry => entry.value['type'] === 'channel/envelope'
        && (entry.value['envelope'] as Record<string, unknown> | undefined)?.['kind'] === 'final')
      expect(final?.value).toMatchObject({
        envelope: { payload: { text: SDK_SUBAGENT_TEAM_FINAL } },
      })
      expect(result.output).toEqual([{ type: 'text', text: SDK_SUBAGENT_COMMITTED_OUTPUT }])
    } finally {
      await run.dispose()
      await rm(cwd, { recursive: true, force: true })
    }
  }, 120_000)
})
