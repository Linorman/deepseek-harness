/** Provider fragments retain the original judge, journal/state and bridge identities; enclosing owner cuts are separately validated. */
import { expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, unlink, symlink } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import type { SimulationSnapshot } from '@clocky/clocky-simulation'
import { HarborCase, harborHash } from '../src/harbor-case.ts'
import { HARBOR_PIN } from '../src/harbor-protocol.ts'
import { captureHarborBackup, verifyHarborBackup, restoreHarborBackupStaging } from '../src/harbor-backup.ts'

const limits = { maxFiles: 512, maxBytes: 16 * 1024 * 1024, maxFileBytes: 8 * 1024 * 1024 }
async function fixture() {
  await mkdir(resolve('.tmp/w6'), { recursive: true })
  const root = await mkdtemp(resolve('.tmp/w6/harbor-backup-'))
  const judge = new HarborCase(resolve('test-cases/harbor-society-365'), join(root, 'source'), 'backup-original', new AbortController().signal)
  await judge.execute('advance-original', 'coordinator', 'canonical-team/canonical-session', { kind: 'advance', day: 3 })
  await judge.execute('checkpoint-original', 'coordinator', 'canonical-team/canonical-session', { kind: 'checkpoint',
    memory: 'Preserve actual receipts, unresolved orders and independent role information. '.repeat(3) })
  const state = { phase: 'paused', revision: 7, spec: { runId: 'backup-original' },
    world: { definition: { operations: [HARBOR_PIN] } } } as unknown as SimulationSnapshot
  const cut = { runId: state.spec.runId, nativeRevision: state.revision, nativeHash: 'a'.repeat(64),
    ownerReferencesHash: 'b'.repeat(64), pins: [HARBOR_PIN] }
  return { root, judge, state, cut }
}
it('restores exact original case bytes and bridge receipts through the pinned real CLI without changing the source', async () => {
  const h = await fixture()
  try {
    const validate = vi.fn(async () => {})
    const bundle = await captureHarborBackup(h.judge.directory, h.state, h.cut, limits, validate)
    expect(validate).toHaveBeenCalledTimes(3)
    expect(bundle.day).toBe(3)
    expect(bundle.files.some(file => file.path.startsWith('.bridge/') && file.path.endsWith('.result.json'))).toBe(true)
    expect(bundle.files.some(file => file.path.startsWith('output/checkpoints/'))).toBe(true)
    const before = await readFile(join(h.judge.directory, 'output/journal.jsonl'))
    const root = join(h.root, 'isolated-restored')
    const directory = await restoreHarborBackupStaging(bundle, root, limits, new AbortController().signal)
    expect(await readFile(join(directory, 'output/journal.jsonl'))).toEqual(before)
    const restored = new HarborCase(directory, root, h.cut.runId, new AbortController().signal, true)
    expect(await restored.execute('advance-original', 'coordinator', 'canonical-team/canonical-session', { kind: 'advance', day: 3 }))
      .toMatchObject({ ok: true, day: 3 })
    expect(await readFile(join(directory, 'output/journal.jsonl'))).toEqual(before)
    await restored.execute('after-restoration', 'coordinator', 'canonical-team/canonical-session', { kind: 'advance', day: 4 })
    expect((await restored.overview()).day).toBe(4)
    expect((await h.judge.overview()).day).toBe(3)
    expect(await readFile(join(h.judge.directory, 'output/journal.jsonl'))).toEqual(before)
    await expect(restoreHarborBackupStaging(bundle, root, limits, new AbortController().signal)).rejects.toThrow()
    const bytes = Buffer.byteLength(JSON.stringify(bundle))
    expect(verifyHarborBackup(bundle, { ...limits, maxBytes: bytes })).toEqual(bundle)
    expect(() => verifyHarborBackup(bundle, { ...limits, maxBytes: bytes - 1 })).toThrow(/byte allowance/)
  } finally { await rm(h.root, { recursive: true, force: true }) }
})
it('refuses missing originals, changed cut bytes, unsupported paths, source files, versions and filesystem links', async () => {
  const h = await fixture()
  try {
    const bundle = await captureHarborBackup(h.judge.directory, h.state, h.cut, limits, async () => {})
    const reseal = (body: Omit<typeof bundle, 'contentHash'>) => ({ ...body, contentHash: harborHash(JSON.stringify(body)) })
    const { contentHash: _digest, ...body } = bundle
    for (const path of ['output/state.json', 'output/journal.jsonl', 'manifest.json', 'world.mjs'])
      expect(() => verifyHarborBackup(reseal({ ...body, files: body.files.filter(file => file.path !== path) }), limits)).toThrow()
    expect(() => verifyHarborBackup(reseal({ ...body, files: body.files.map((file, index) => index === 0
      ? { ...file, path: '../escape' } : file) }), limits)).toThrow(/unsafe path/)
    expect(() => verifyHarborBackup({ ...bundle, format: 'clocky.harbor.private-backup/0' }, limits)).toThrow()
    expect(() => verifyHarborBackup(reseal({ ...body, cut: { ...body.cut,
      pins: [{ ...HARBOR_PIN, generation: 999 }] } }), limits)).toThrow(/exact protocol pin/)
    expect(() => verifyHarborBackup(bundle, { ...limits, maxFiles: 1 })).toThrow(/file count/)
    const path = join(h.judge.directory, '.bridge', `${'0'.repeat(64)}.memory.txt`)
    await symlink(join(h.judge.directory, 'seed.json'), path)
    await expect(captureHarborBackup(h.judge.directory, h.state, h.cut, limits, async () => {})).rejects.toThrow(/links/)
    await unlink(path)
    await unlink(join(h.judge.directory, 'output/state.json'))
    await expect(captureHarborBackup(h.judge.directory, h.state, h.cut, limits, async () => {})).rejects.toThrow(/rebuilding is forbidden/)
  } finally { await rm(h.root, { recursive: true, force: true }) }
})
