/** Real filesystem bounds and content versions for shared workspace observation. @module */
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { snapshotDirectory } from '../src/fingerprint.ts'

const roots: string[] = []
const bounds = { observationMaxEntries: 32, observationMaxHashBytes: 4096, observationMaxFileBytes: 4096, observationTimeoutMs: 5000 }
async function root(): Promise<string> {
  await mkdir(join(process.cwd(), '.tmp'), { recursive: true })
  const path = await mkdtemp(join(process.cwd(), '.tmp/workspace-observation-scan-'))
  roots.push(path)
  return path
}
afterEach(async () => { for (const path of roots.splice(0)) await rm(path, { recursive: true, force: true }) })

describe('bounded shared fingerprint traversal', () => {
  it('hashes actual content and retains hostile-looking file names as ordinary data', async () => {
    const path = await root()
    await writeFile(join(path, '__proto__'), 'first')
    await writeFile(join(path, 'toString'), 'second')
    const before = await snapshotDirectory(path, bounds)
    expect(before.version).toMatchObject({ complete: true, hashedBytes: 11, incompleteReasons: [] })
    expect(Object.keys(before.files)).toEqual(['__proto__', 'toString'])
    expect((await snapshotDirectory(path, bounds)).version.digest).toBe(before.version.digest)
    await writeFile(join(path, 'toString'), 'changed')
    expect((await snapshotDirectory(path, bounds)).version.digest).not.toBe(before.version.digest)
  })

  it('records a symlink without reading the external target', async () => {
    const path = await root()
    const external = await root()
    await writeFile(join(external, 'secret'), 'outside the allocation')
    await symlink(external, join(path, 'external'))
    const scan = await snapshotDirectory(path, bounds)
    expect(scan.files).toEqual({ external: { kind: 'symlink', target: external } })
    expect(scan.version).toMatchObject({ complete: true, hashedBytes: 0 })
  })

  it('distinguishes a partial scan from complete empty content for entry and hash limits', async () => {
    const path = await root()
    await writeFile(join(path, 'a'), 'aaaa')
    await writeFile(join(path, 'b'), 'bbbb')
    const entries = await snapshotDirectory(path, { ...bounds, observationMaxEntries: 1 })
    expect(entries.version).toMatchObject({ complete: false, scannedEntries: 1, knownOmittedEntries: 1 })
    expect(entries.version.incompleteReasons).toContain('entry-limit')
    const bytes = await snapshotDirectory(path, { ...bounds, observationMaxHashBytes: 4 })
    expect(bytes.version).toMatchObject({ complete: false, hashedBytes: 4 })
    expect(bytes.version.incompleteReasons).toContain('hash-byte-limit')
    expect(bytes.version.digest).not.toBe((await snapshotDirectory(path, bounds)).version.digest)
  })

  it('reports a missing root as an incomplete observation and excludes only provider-owned sidecars', async () => {
    const path = await root()
    const state = join(path, 'provider-state')
    await mkdir(state)
    await writeFile(join(state, 'baseline.json'), 'provider data')
    await writeFile(join(path, 'user-file'), 'user data')
    const scan = await snapshotDirectory(path, { ...bounds, observationStateRoot: state })
    expect(Object.keys(scan.files)).toEqual(['user-file'])
    const missing = await snapshotDirectory(join(path, 'missing'), bounds)
    expect(missing.version).toMatchObject({ complete: false, incompleteReasons: ['filesystem-ENOENT'] })
  })
})
