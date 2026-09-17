/** Native Team direct-delivery snapshot through a real Loader composition. */

import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@clocky/clocky-loader-smoke'

const configPath = fileURLToPath(new URL('./fixtures/native-team-direct-receipt.cordis.yml', import.meta.url))
const binScript = fileURLToPath(new URL('./fixtures/native-team-direct-receipt-driver.ts', import.meta.url))
const tsconfigPath = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))
const expectedOutput = fileURLToPath(new URL('./snapshots/native-team-direct-receipt/output.expected.json', import.meta.url))

interface StoredLog {
  readonly stream: { readonly name: string; readonly tailSequence: number; readonly summary?: unknown }
  readonly entries: readonly { readonly sequence: number; readonly value: Record<string, unknown> }[]
}

/** Read the real JSON backend stream documents after the Loader-owned process has exited. */
async function storedLogs(cwd: string): Promise<StoredLog[]> {
  const root = join(cwd, '.native-team-store', 'logs')
  const files = (await readdir(root)).filter(file => file.endsWith('.json'))
  return await Promise.all(files.map(async file => JSON.parse(await readFile(join(root, file), 'utf8')) as StoredLog))
}

describe('native Team Loader snapshot', () => {
  it('persists one direct-Link delivery and recipient receipt', async () => {
    const result = await runLoaderSmoke({
      label: 'native Team direct receipt snapshot',
      tempDirPrefix: 'native-team-direct-receipt-',
      binScript,
      libBinScript: binScript,
      configPath,
      tsconfigPath,
      inspect: async (cwd) => {
        const logs = await storedLogs(cwd)
        const team = logs.find(log => log.stream.name.startsWith('team/'))
        const channel = logs.find(log => log.stream.name.startsWith('channel/'))
        if (team === undefined || channel === undefined) {
          throw new Error('native Team composition did not persist both a Team journal and a channel WAL')
        }

        expect(team.stream.summary).toMatchObject({ id: team.stream.name.slice('team/'.length), cursor: team.entries.at(-1)?.sequence })
        expect(team.stream.tailSequence).toBe(team.entries.at(-1)?.sequence)
        expect(team.entries.map(entry => entry.value['type'])).toContain('activation/changed')
        const envelope = channel.entries.find(entry => entry.value['type'] === 'channel/envelope')?.value
        const receipt = channel.entries.find(entry => entry.value['type'] === 'channel/receipt')?.value
        expect(envelope).toMatchObject({
          type: 'channel/envelope',
          envelope: { kind: 'message', delivery: 'context', payload: { text: 'Review the durable receipt.' } },
        })
        expect(receipt).toMatchObject({ type: 'channel/receipt' })
        const persistedEnvelope = envelope?.['envelope'] as Record<string, unknown> | undefined
        expect(persistedEnvelope?.['teamId']).toBe(team.stream.name.slice('team/'.length))
        expect(persistedEnvelope?.['channelId']).toBe(channel.stream.name.slice('channel/'.length))
        expect(receipt?.['envelopeId']).toBe(persistedEnvelope?.['id'])
      },
    })

    expect(result.stderr).toBe('')
    expect(result.stdout).toBe(await readFile(expectedOutput, 'utf8'))
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})
