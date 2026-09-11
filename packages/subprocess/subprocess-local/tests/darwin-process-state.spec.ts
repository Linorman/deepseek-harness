import { spawnSync } from 'node:child_process'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { readDarwinProcessState } from '../src/darwin-process-state.ts'
import type { DarwinProcessQuery } from '../src/darwin-process-state.ts'

function nativeReply(
  options: { bytes?: number; pid?: number; status?: number; seconds?: bigint; micros?: bigint } = {},
): DarwinProcessQuery {
  return (_pid, output) => {
    output.writeUInt32LE(options.pid ?? 42, 12)
    output.writeUInt32LE(17, 16)
    output.writeUInt32LE(options.status ?? 2, 4)
    output.writeBigUInt64LE(options.seconds ?? 1_789_000_000n, 120)
    output.writeBigUInt64LE(options.micros ?? 123_456n, 128)
    return options.bytes ?? output.length
  }
}

describe('macOS kernel process identity', () => {
  it('retains microseconds and reports zombies without treating them as executing processes', () => {
    expect(readDarwinProcessState(42, nativeReply())).toEqual({ parentPid: 17, started: '1789000000:123456', active: true })
    expect(readDarwinProcessState(42, nativeReply({ micros: 123_457n }))?.started).toBe('1789000000:123457')
    expect(readDarwinProcessState(42, nativeReply({ status: 5 }))).toEqual({ parentPid: 17, started: '1789000000:123456', active: false })
    expect(readDarwinProcessState(42, nativeReply({ status: 4 }))?.active).toBe(true)
  })

  it.each([
    { bytes: 0 }, { bytes: 135 }, { bytes: 137 }, { pid: 43 }, { seconds: 0n }, { micros: 1_000_000n }, { status: 0 }, { status: 6 },
  ])('does not publish an identity from an incomplete or inconsistent native result #%#', (reply) => {
    expect(readDarwinProcessState(42, nativeReply(reply))).toBeUndefined()
  })

  it.skipIf(process.platform !== 'darwin')('matches the installed macOS SDK ABI and actual libproc creation identity', async () => {
    const parent = join(process.cwd(), '.tmp')
    await mkdir(parent, { recursive: true })
    const root = await mkdtemp(join(parent, 'darwin-process-abi-'))
    try {
      const binary = join(root, 'inspect')
      const source = fileURLToPath(new URL('./fixtures/darwin-process-state.c', import.meta.url))
      const built = spawnSync('xcrun', ['clang', '-Wall', '-Werror', source, '-lproc', '-o', binary], { encoding: 'utf8' })
      expect(built.status, built.stderr).toBe(0)
      const observed = spawnSync(binary, [String(process.pid)], { encoding: 'utf8' })
      expect(observed.status, observed.stderr).toBe(0)
      const reference = JSON.parse(observed.stdout) as { bytes: number; offsets: number[]; parentPid: number; started: string }
      expect(reference).toMatchObject({ bytes: 136, offsets: [4, 12, 16, 120, 128] })
      expect(readDarwinProcessState(process.pid)).toEqual({ parentPid: reference.parentPid, started: reference.started, active: true })
      expect(readDarwinProcessState(process.pid)).toEqual({ parentPid: reference.parentPid, started: reference.started, active: true })
    } finally { await rm(root, { recursive: true, force: true }) }
  })
})
