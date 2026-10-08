import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { integrateLocalDirectory } from '../src/integration.ts'

const temporaryRoots: string[] = []
afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

it('does not publish a staged patch when the target changes during preparation', async () => {
  const root = await mkdtemp(join(process.cwd(), '.tmp', 'local-files-integration-'))
  temporaryRoots.push(root)
  const targetRoot = join(root, 'target')
  const markerDirectory = join(root, 'markers')
  const markerPathname = join(markerDirectory, 'target.json')
  let targetReads = 0

  const result = await integrateLocalDirectory({
    request: {
      source: { teamId: 'team', taskId: 'source', attemptId: 'source-attempt', artifacts: [] },
      integrationTaskId: 'integration', integrationAttemptId: 'integration-attempt',
      target: 'target', expectedTarget: 'missing', mode: 'integrate', actorId: 'actor',
    } as never,
    artifact: { id: 'patch', kind: 'patch' } as never,
    changeSet: { changes: [{ path: 'new.txt', kind: 'file', data: Buffer.from('new').toString('base64') }] } as never,
    integrationRoot: root,
    targetRoot,
    markerPathname,
    backupPathname: join(root, 'target.backup'),
    markerParentRoot: root,
    markerDirectory,
    stagePrefix: '.stage-',
    providerName: 'shared-local',
    label: 'shared',
    version: async path => path === targetRoot ? ++targetReads === 1 ? 'missing' : 'changed' : 'staged',
    assertDirectory: async () => { throw new Error('unexpected existing target') },
  })

  expect(result).toMatchObject({ status: 'conflict', target: 'target' })
  expect(targetReads).toBe(2)
  expect((await readdir(root)).some(name => name.startsWith('.stage-'))).toBe(false)
  await expect(readFile(join(targetRoot, 'new.txt'))).rejects.toMatchObject({ code: 'ENOENT' })
  await expect(readFile(markerPathname)).rejects.toMatchObject({ code: 'ENOENT' })
})
