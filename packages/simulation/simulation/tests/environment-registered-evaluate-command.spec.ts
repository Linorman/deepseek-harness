/** Exercise actual CLI provenance from a misleading cwd without editing shared implementation files. */
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { environmentRegistrationSchema } from './environment-registered-evaluation.ts'

it('pins executed sources independently of cwd and preserves registered evidence across rejection paths', async () => {
  const root = fileURLToPath(new URL('../../../../', import.meta.url))
  const parent = resolve(root, '.tmp/world-post-mvp/c3-v2/cli-regressions')
  await mkdir(parent, { recursive: true })
  const directory = await mkdtemp(resolve(parent, 'evidence-'))
  const source = 'packages/simulation/simulation/src/world-environment.ts'
  const spoofedSource = resolve(directory, source)
  await mkdir(dirname(spoofedSource), { recursive: true })
  await writeFile(spoofedSource, 'This is not the executed implementation.\n')
  const evidencePath = '.agents/plans/2026-10-16-world-post-mvp/evidence/implementation'
  const spoofedSuite = resolve(directory, evidencePath, 'c3-v2-suite.json')
  await mkdir(dirname(spoofedSuite), { recursive: true })
  await writeFile(spoofedSuite, '{"privateHistory":"CANARY"}\n')
  const command = [
    '--import', resolve(root, 'node_modules/tsx/dist/esm/index.mjs'),
    resolve(root, 'scripts/world-environment-registered-evaluate.ts'),
  ]
  const execute = (mode: string, output = directory) => spawnSync(process.execPath, [...command, mode, output], {
    cwd: directory, env: { ...process.env, TMPDIR: directory }, encoding: 'utf8', timeout: 15000,
  })
  const hash = (body: string) => createHash('sha256').update(body).digest('hex')
  const registrationPath = resolve(directory, 'c3-v2-registration.json'), resultPath = resolve(directory, 'c3-v2-results.json')
  expect(execute('run').stderr).toContain('ENOENT')
  expect(execute('register').status).toBe(0)
  const registered = await readFile(registrationPath, 'utf8')
  const registration = environmentRegistrationSchema.parse(JSON.parse(registered))
  expect(registration.sources[source]).toBe(hash(await readFile(resolve(root, source), 'utf8')))
  expect(registration.sources[source]).not.toBe(hash(await readFile(spoofedSource, 'utf8')))
  expect(execute('register').stderr).toContain('EEXIST')
  expect(await readFile(registrationPath, 'utf8')).toBe(registered)

  await writeFile(registrationPath, JSON.stringify({ ...registration, sources: { ...registration.sources, [source]: '0'.repeat(64) } }))
  expect(execute('run').stderr).toContain('Registered source or suite drift')
  await expect(readFile(resultPath)).rejects.toMatchObject({ code: 'ENOENT' })
  await writeFile(registrationPath, registered)
  expect(execute('run').status).toBe(0)
  const retained = await readFile(resultPath, 'utf8')
  expect(execute('run').stderr).toContain('EEXIST')
  expect(await readFile(resultPath, 'utf8')).toBe(retained)
  expect(execute('verify').status).toBe(0)
  for (const metadata of [
    { startedAt: '2000-01-01T00:00:00.000Z' },
    { completedAt: '2000-01-01T00:00:00.000Z' },
    { elapsedMs: -1 },
    { runtime: { node: '', platform: 'darwin', architecture: 'arm64' } },
    { humanApproved: true },
  ]) {
    await writeFile(resultPath, JSON.stringify({ ...JSON.parse(retained), ...metadata }))
    expect(execute('verify').status, JSON.stringify(metadata)).toBe(1)
  }
  await writeFile(resultPath, retained)
  await writeFile(resultPath, retained.replace('registered-horizon', 'unregistered-stop'))
  expect(execute('verify').stderr).toContain('Retained results differ')
  await writeFile(resultPath, retained)

  await writeFile(registrationPath, JSON.stringify({ ...registration, registeredAt: '2999-01-01T00:00:00.000Z' }))
  expect(execute('run').stderr).toContain('Registration must precede')
  await writeFile(registrationPath, JSON.stringify({ ...registration, privateHistory: 'CANARY' }))
  expect(execute('verify').stderr).toContain('Unrecognized key')
  await writeFile(registrationPath, registered)
  const outside = resolve(root, '..')
  expect(execute('register', outside).stderr).toContain('Evidence output directory must remain inside the project')
  const link = resolve(directory, 'outside-link')
  await symlink(outside, link, process.platform === 'win32' ? 'junction' : 'dir')
  expect(execute('register', link).stderr).toContain('Evidence output directory must remain inside the project')
  expect(await readFile(resultPath, 'utf8')).toBe(retained)
}, 30000)
