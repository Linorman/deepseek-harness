/** Typed coordinator evidence refuses altered no-gain hashes and unsafe diagnostic estimates. */
import { resolve } from 'node:path'
import { expect, it } from 'vitest'
import { Clocky, SdkProtocolError } from '../src/index.ts'

const assessment = { type: 'compaction/assessment', seq: 0, time: 0, data: { trigger: 'pressure', reason: 'no-gain',
  generation: 0, pressureTokens: 100, fixedTokens: 20, selectedTokens: 80, retainedTokens: 0, outputReserveTokens: null } }
const end = { type: 'compaction/end', seq: 0, time: 0, data: { compactionId: 'cut', turn: null, error: 'no gain',
  noGain: { fingerprint: 'a'.repeat(64), contextFingerprint: 'b'.repeat(64), prefixFingerprint: 'c'.repeat(64),
    generation: 0, selectedNodes: 1, selectedTokens: 80, summaryTokens: 80 } } }

it.each([
  [assessment, true], [end, true],
  [{ ...assessment, data: { ...assessment.data, pressureTokens: -1 } }, false],
  [{ ...assessment, data: { ...assessment.data, secret: 'extra' } }, false],
  [{ ...assessment, data: { ...assessment.data, pressureTokens: true } }, false],
  [{ ...assessment, ignorable: true }, false],
  [{ ...assessment, surfaceOp: 'append' }, false],
  [{ ...end, data: { ...end.data, error: undefined } }, false],
  [{ ...end, data: { ...end.data, noGain: { ...end.data.noGain, fingerprint: 'not-a-hash' } } }, false],
  [{ ...end, data: { ...end.data, noGain: { ...end.data.noGain, summaryTokens: 79 } } }, false],
  [{ ...end, data: { ...end.data, noGain: { ...end.data.noGain, selectedNodes: 0 } } }, false],
  [{ ...end, data: { ...end.data, noGain: { ...end.data.noGain, secret: 'extra' } } }, false],
] as const)('validates compaction evidence case %#', async (event, accepted) => {
  const api = new Clocky({ credential: 'sdk-client-test-credential', provider: 'provider', model: 'model', launch: {
    command: process.execPath, args: [resolve('packages/sdk/client/tests/fake-runtime.ts')],
    env: { ...process.env as Record<string, string>, FAKE_SESSION_EVENT_JSON: JSON.stringify(event) } } })
  try {
    const work = api.run('Compaction evidence')
    if (accepted) expect((await work).events.some(value => value.type === event.type)).toBe(true)
    else await expect(work).rejects.toBeInstanceOf(SdkProtocolError)
  } finally { await api.close() }
})
