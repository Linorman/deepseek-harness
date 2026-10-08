/** Filesystem failures must survive the missing-path checks used during local publication. */
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import * as filesystem from 'node:fs/promises'
import { applyChanges, ensureRegularDirectoryPath, materializeArtifacts, pathExists,
  readLocalIntegrationMarker } from '../src/files.ts'

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return { ...actual, lstat: vi.fn(actual.lstat), mkdir: vi.fn(actual.mkdir), readFile: vi.fn(actual.readFile) }
})

const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
const roots: string[] = []
const denied = () => Object.assign(new Error('access denied'), { code: 'EACCES' })
const missing = () => Object.assign(new Error('not found'), { code: 'ENOENT' })

beforeEach(() => {
  vi.mocked(filesystem.lstat).mockImplementation(actual.lstat)
  vi.mocked(filesystem.mkdir).mockImplementation(actual.mkdir)
  vi.mocked(filesystem.readFile).mockImplementation(actual.readFile)
})
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => actual.rm(root, { recursive: true, force: true })))
})

async function root(): Promise<string> {
  const path = await actual.mkdtemp(join(process.cwd(), '.tmp', 'local-files-errors-'))
  roots.push(path)
  return path
}

it('propagates unexpected metadata and marker read failures', async () => {
  const directory = await root()
  const victim = join(directory, 'victim')
  vi.mocked(filesystem.lstat).mockImplementation(async (path) => {
    if (path === victim) throw denied()
    return await actual.lstat(path)
  })
  await expect(applyChanges(directory, [{ path: 'victim', kind: 'delete' }], 'shared'))
    .rejects.toMatchObject({ code: 'EACCES' })
  await expect(pathExists(victim)).rejects.toMatchObject({ code: 'EACCES' })
  await expect(materializeArtifacts({ get: () => undefined } as never,
    { root: directory, teamId: 'team', attemptId: 'attempt' } as never,
    ['..', 'victim'], { providerName: 'shared', maxArtifactBytes: 100 }))
    .rejects.toMatchObject({ code: 'EACCES' })

  vi.mocked(filesystem.readFile).mockImplementation(async (path) => {
    if (path === victim) throw denied()
    return await actual.readFile(path)
  })
  await expect(readLocalIntegrationMarker(victim, 'shared')).rejects.toMatchObject({ code: 'EACCES' })
})

it('propagates parent metadata errors and accepts a concurrent directory creator', async () => {
  const directory = await root()
  const parent = join(directory, 'parent')
  vi.mocked(filesystem.lstat).mockImplementation(async (path) => {
    if (path === parent) throw denied()
    return await actual.lstat(path)
  })
  await expect(ensureRegularDirectoryPath(directory, parent, 'shared'))
    .rejects.toMatchObject({ code: 'EACCES' })

  vi.mocked(filesystem.lstat).mockImplementation(actual.lstat)
  vi.mocked(filesystem.mkdir).mockImplementation(async (path) => {
    if (path === parent) throw denied()
    await actual.mkdir(path)
  })
  await expect(ensureRegularDirectoryPath(directory, parent, 'shared'))
    .rejects.toMatchObject({ code: 'EACCES' })
  vi.mocked(filesystem.mkdir).mockImplementation(actual.mkdir)

  await actual.mkdir(parent)
  let firstRead = true
  vi.mocked(filesystem.lstat).mockImplementation(async (path) => {
    if (path === parent && firstRead) { firstRead = false; throw missing() }
    return await actual.lstat(path)
  })
  await expect(ensureRegularDirectoryPath(directory, parent, 'shared')).resolves.toBeUndefined()
  expect(firstRead).toBe(false)
})
