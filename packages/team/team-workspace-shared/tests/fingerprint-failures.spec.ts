/** Failure and incomplete-scan behavior at real filesystem boundaries. */
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { fingerprintDirectoryEntries, snapshotDirectory } from '../src/fingerprint.ts'

const roots: string[] = []
const limits = { observationMaxEntries: 16, observationMaxHashBytes: 1024,
  observationMaxFileBytes: 1024, observationTimeoutMs: 5_000 }

async function root(): Promise<string> {
  await mkdir(join(process.cwd(), '.tmp'), { recursive: true })
  const path = await mkdtemp(join(process.cwd(), '.tmp/workspace-fingerprint-failure-'))
  roots.push(path)
  return path
}

afterEach(async () => {
  for (const path of roots.splice(0)) await rm(path, { recursive: true, force: true })
})

describe('bounded shared fingerprint failure paths', () => {
  it('distinguishes caller cancellation from an expired traversal deadline', async () => {
    const path = await root()
    await writeFile(join(path, 'work.txt'), 'work')
    const controller = new AbortController()
    controller.abort(new Error('caller stopped the scan'))
    const cancelled = await snapshotDirectory(path, limits, controller.signal)
    expect(cancelled.version).toMatchObject({ complete: false, hashedBytes: 0,
      incompleteReasons: ['canceled'] })
    const expired = await snapshotDirectory(path, { ...limits, observationTimeoutMs: 0 })
    expect(expired.version).toMatchObject({ complete: false, hashedBytes: 0,
      incompleteReasons: ['duration-limit'] })
  })

  it('rejects a symlinked root identity before entering another tree', async () => {
    const path = await root()
    const actual = join(path, 'actual')
    await mkdir(actual)
    await writeFile(join(actual, 'private.txt'), 'do not traverse through alias')
    const alias = join(path, 'alias')
    await symlink(actual, alias, 'dir')
    const scan = await snapshotDirectory(alias, limits)
    expect(scan.files).toEqual({})
    expect(scan.version).toMatchObject({ complete: false, scannedEntries: 0,
      incompleteReasons: ['directory-identity-changed'] })
  })

  it('records nested and empty files while bounding one oversized file independently', async () => {
    const path = await root()
    const nested = join(path, 'nested')
    await mkdir(nested)
    await writeFile(join(nested, 'empty'), '')
    await writeFile(join(nested, 'large'), '12345678')
    const scan = await snapshotDirectory(path, { ...limits, observationMaxFileBytes: 4 })
    expect(scan.version).toMatchObject({ complete: false, scannedEntries: 3, hashedBytes: 0,
      knownOmittedEntries: 1, incompleteReasons: ['file-byte-limit'] })
    expect(scan.files['nested/empty']).toMatchObject({ kind: 'file', size: 0 })
    expect(scan.files['nested/empty']).toHaveProperty('contentHash')
    expect(scan.files['nested/large']).toMatchObject({ kind: 'file', size: 8 })
    expect(scan.files['nested/large']).not.toHaveProperty('contentHash')
  })

  it('cancels a real traversal when its deadline fires during directory enumeration', async () => {
    const path = await root()
    for (let index = 0; index < 128; index += 1) {
      await writeFile(join(path, `entry-${String(127 - index).padStart(3, '0')}`), 'one')
    }
    const scan = await snapshotDirectory(path, { ...limits, observationMaxEntries: 256, observationTimeoutMs: 1 })
    expect(scan.version.complete).toBe(false)
    expect(scan.version.incompleteReasons).toContain('duration-limit')
  })

  it.skipIf(process.platform === 'win32')('rejects a nonportable path without reading its content', async () => {
    const path = await root()
    await writeFile(join(path, 'unsafe\\name'), 'secret')
    const scan = await snapshotDirectory(path, limits)
    expect(scan.files).toEqual({})
    expect(scan.version).toMatchObject({ complete: false, knownOmittedEntries: 1,
      incompleteReasons: ['non-portable-path'] })
  })

  it.skipIf(process.platform === 'win32')('classifies a special filesystem entry without opening it as a file', async () => {
    const path = await root()
    execFileSync('mkfifo', [join(path, 'pipe')])
    const scan = await snapshotDirectory(path, limits)
    expect(scan.files['pipe']).toMatchObject({ kind: 'other' })
    expect(scan.files['pipe']).toHaveProperty('type')
    expect(scan.version).toMatchObject({ complete: true, hashedBytes: 0 })
  })

  it('canonicalizes numeric filenames whose object enumeration order differs from lexical order', async () => {
    const path = await root()
    for (const name of ['2', '10', '11']) await writeFile(join(path, name), name)
    const scan = await snapshotDirectory(path, limits)
    expect(scan.version.complete).toBe(true)
    expect(scan.version.digest).toBe(fingerprintDirectoryEntries(scan.files, true))
  })
})
