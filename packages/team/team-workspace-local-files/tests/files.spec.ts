import { mkdtemp,mkdir,readFile,rm,symlink,writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach,expect,it } from 'vitest'
import { applyChanges,ensureRegularDirectoryPath,materializeLocalChangeSet,portablePath,
  readLocalIntegrationMarker,writeLocalIntegrationMarker } from '../src/index.ts'

const temporaryRoots: string[] = []
afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(async (root) => { await rm(root, { recursive: true, force: true }) }))
})

async function tree(): Promise<{ root: string; outside: string }> {
  const temporary = await mkdtemp(join(process.cwd(), '.tmp', 'local-workspace-files-'))
  temporaryRoots.push(temporary)
  const root = join(temporary, 'stage'), outside = join(temporary, 'outside')
  await Promise.all([mkdir(root),mkdir(outside)])
  return { root,outside }
}

it('does not overwrite an external file through a staged symlink', async () => {
  const { root,outside } = await tree()
  const sentinel = join(outside, 'sentinel')
  await writeFile(sentinel, 'original')
  await symlink(sentinel, join(root, 'victim'))
  await expect(applyChanges(root, [{ path: 'victim',kind: 'file',data: Buffer.from('replacement').toString('base64') }], 'sandbox'))
    .rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
  expect(await readFile(sentinel, 'utf8')).toBe('original')
})

it('does not create integration parents through a symlink ancestor', async () => {
  const { root,outside } = await tree()
  await symlink(outside, join(root, 'ancestor'))
  await expect(ensureRegularDirectoryPath(root, join(root, 'ancestor', 'nested'), 'shared'))
    .rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
  await expect(readFile(join(outside, 'nested'))).rejects.toMatchObject({ code: 'ENOENT' })
})

it('rejects paths outside the target and refuses to delete or replace directories', async () => {
  const { root, outside } = await tree()
  await expect(ensureRegularDirectoryPath(root, outside, 'shared'))
    .rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
  expect(() => portablePath(root, '../outside', 'shared'))
    .toThrow(expect.objectContaining({ code: 'TEAM_INVALID_ARGUMENT' }))
  await mkdir(join(root, 'directory'))
  for (const change of [
    { path: 'directory', kind: 'delete' as const },
    { path: 'directory', kind: 'file' as const, data: '' },
  ]) {
    await expect(applyChanges(root, [change], 'shared'))
      .rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
  }
})

it('rejects malformed recovery markers before publication', async () => {
  const { root } = await tree()
  const markerPath = join(root, 'marker.json')
  await expect(readLocalIntegrationMarker(markerPath, 'shared')).resolves.toBeUndefined()
  await writeFile(markerPath, '{')
  await expect(readLocalIntegrationMarker(markerPath, 'shared'))
    .rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
  await writeFile(markerPath, '{}')
  await expect(readLocalIntegrationMarker(markerPath, 'shared'))
    .rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
  await expect(writeLocalIntegrationMarker(markerPath, {} as never, 'shared'))
    .rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
})

it('bounds both scanner metadata and actual file bytes when materializing a patch', async () => {
  const { root } = await tree()
  await writeFile(join(root, 'changed.txt'), 'larger than claimed')
  const allocation = { root, attemptId: 'attempt' } as never
  const options = { providerName: 'shared-local', maxIntegrationBytes: 8 }
  await expect(materializeLocalChangeSet(allocation, ['changed.txt'], () =>
    ({ kind: 'other', type: 'socket' }), options)).resolves.toBeUndefined()
  await expect(materializeLocalChangeSet(allocation, ['changed.txt'], () =>
    ({ kind: 'file', size: 9, modifiedAt: 0 }), options)).resolves.toBeUndefined()
  await expect(materializeLocalChangeSet(allocation, ['changed.txt'], () =>
    ({ kind: 'file', size: 1, modifiedAt: 0 }), options)).resolves.toBeUndefined()
})
