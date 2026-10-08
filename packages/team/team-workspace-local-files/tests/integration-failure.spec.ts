/** A failed local commit must restore or preserve the target, and report cleanup failures. */
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import * as filesystem from 'node:fs/promises'
import { integrateLocalDirectory } from '../src/integration.ts'
import type { LocalDirectoryIntegrationOptions } from '../src/integration.ts'

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return { ...actual, rename: vi.fn(actual.rename), rm: vi.fn(actual.rm) }
})

const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
const roots: string[] = []
const denied = () => Object.assign(new Error('access denied'), { code: 'EACCES' })

beforeEach(() => {
  vi.mocked(filesystem.rename).mockImplementation(actual.rename)
  vi.mocked(filesystem.rm).mockImplementation(actual.rm)
})
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => actual.rm(root, { recursive: true, force: true })))
})

async function fixture(): Promise<{ root: string; options: LocalDirectoryIntegrationOptions }> {
  const root = await actual.mkdtemp(join(process.cwd(), '.tmp', 'local-integration-failure-'))
  roots.push(root)
  const targetRoot = join(root, 'target')
  await actual.mkdir(targetRoot)
  await actual.writeFile(join(targetRoot, 'value.txt'), 'old')
  return { root, options: {
    request: {
      source: { teamId: 'team', taskId: 'source', attemptId: 'source-attempt', artifacts: [] },
      integrationTaskId: 'integration', integrationAttemptId: 'integration-attempt',
      target: 'target', expectedTarget: 'old', mode: 'integrate', actorId: 'actor',
    } as never,
    artifact: { id: 'patch', kind: 'patch' } as never,
    changeSet: { changes: [{ path: 'value.txt', kind: 'file', data: Buffer.from('new').toString('base64') }] } as never,
    integrationRoot: root,
    targetRoot,
    markerPathname: join(root, 'markers', 'target.json'),
    backupPathname: join(root, 'target.backup'),
    markerParentRoot: root,
    markerDirectory: join(root, 'markers'),
    stagePrefix: '.stage-',
    providerName: 'shared-local',
    label: 'shared',
    version: async (path) => {
      try { return await actual.readFile(join(path, 'value.txt'), 'utf8') }
      catch (error: unknown) {
        if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') return 'missing'
        throw error
      }
    },
    assertDirectory: async (path) => { expect((await actual.stat(path)).isDirectory()).toBe(true) },
  } }
}

it('restores the backup when publishing the staged directory fails', async () => {
  const { root, options } = await fixture()
  vi.mocked(filesystem.rename).mockImplementation(async (source, destination) => {
    if (String(source).startsWith(join(root, '.stage-')) && destination === options.targetRoot) throw denied()
    await actual.rename(source, destination)
  })

  await expect(integrateLocalDirectory(options)).rejects.toMatchObject({ code: 'EACCES' })
  expect(await actual.readFile(join(options.targetRoot, 'value.txt'), 'utf8')).toBe('old')
  await expect(actual.stat(options.backupPathname)).rejects.toMatchObject({ code: 'ENOENT' })
  expect((await actual.readdir(root)).some(name => name.startsWith('.stage-'))).toBe(false)
})

it('does not overwrite a target created while backup restoration is pending', async () => {
  const { options } = await fixture()
  vi.mocked(filesystem.rename).mockImplementation(async (source, destination) => {
    if (String(source).includes('.stage-') && destination === options.targetRoot) {
      await actual.mkdir(options.targetRoot)
      await actual.writeFile(join(options.targetRoot, 'value.txt'), 'concurrent')
      throw denied()
    }
    await actual.rename(source, destination)
  })

  await expect(integrateLocalDirectory(options)).rejects.toMatchObject({ code: 'EACCES' })
  expect(await actual.readFile(join(options.targetRoot, 'value.txt'), 'utf8')).toBe('concurrent')
  expect(await actual.readFile(join(options.backupPathname, 'value.txt'), 'utf8')).toBe('old')
})

it('reports a failed backup restoration alongside the failed publication', async () => {
  const { options } = await fixture()
  vi.mocked(filesystem.rename).mockImplementation(async (source, destination) => {
    if (destination === options.targetRoot) throw denied()
    await actual.rename(source, destination)
  })

  await expect(integrateLocalDirectory(options)).rejects.toThrow(AggregateError)
  await expect(actual.stat(options.targetRoot)).rejects.toMatchObject({ code: 'ENOENT' })
  expect(await actual.readFile(join(options.backupPathname, 'value.txt'), 'utf8')).toBe('old')
})

it('reports a failed stage cleanup after the integration itself is rejected', async () => {
  const { root, options } = await fixture()
  const invalid = { ...options, changeSet: { changes: [{ path: '..', kind: 'delete' }] } as never }
  vi.mocked(filesystem.rm).mockImplementation(async (path, rmOptions) => {
    if (String(path).startsWith(join(root, '.stage-'))) throw denied()
    await actual.rm(path, rmOptions)
  })

  await expect(integrateLocalDirectory(invalid)).rejects.toThrow(AggregateError)
})

it('reports a backup cleanup failure after the new target is committed', async () => {
  const { options } = await fixture()
  let backupRemovals = 0
  vi.mocked(filesystem.rm).mockImplementation(async (path, rmOptions) => {
    if (path === options.backupPathname && ++backupRemovals === 2) throw denied()
    await actual.rm(path, rmOptions)
  })

  await expect(integrateLocalDirectory(options)).rejects.toThrow(AggregateError)
  expect(await actual.readFile(join(options.targetRoot, 'value.txt'), 'utf8')).toBe('new')
  expect(await actual.readFile(join(options.backupPathname, 'value.txt'), 'utf8')).toBe('old')
})
