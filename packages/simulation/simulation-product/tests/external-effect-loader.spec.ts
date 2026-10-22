/** Source launch mode boots opt-in YAML in separate Hosts and reconciles a lost provider receipt without dispatch. */
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { expect, it } from 'vitest'
it.each(['json', 'sqlite'] as const)('%s real Loader restores a user-authorized unknown action from empty process memory', async (backend) => {
  await mkdir('.tmp', { recursive: true }); const root = await mkdtemp(join(process.cwd(), '.tmp', 'effect-loader-'))
  await writeFile(join(root, 'principal.json'), JSON.stringify({ version: 1, principalId: 'reader', credentialGeneration: 1,
    credentialDigest: createHash('sha256').update('keyless-fixture-credential').digest('hex') }), { mode: 0o600 })
  const run = async (mode: string) => {
    const child = spawn(process.execPath, ['--import', 'tsx/esm', resolve('packages/simulation/simulation-product/tests/fixtures/external-effect/loader.ts'),
      resolve('packages/simulation/simulation-product/tests/fixtures/external-effect/cordis.yml'), mode],
    { env: { ...process.env, TSX_TSCONFIG_PATH: resolve('tsconfig.base.json'), E_TEST_ROOT: root, E_TEST_BACKEND: backend }, stdio: 'pipe' })
    let output = '', error = ''
    child.stdout.on('data', (data: Buffer) => { output += data.toString() }); child.stderr.on('data', (data: Buffer) => { error += data.toString() })
    const [code] = await once(child, 'exit') as [number | null, NodeJS.Signals | null]; expect(code, error).toBe(0)
    return JSON.parse(output) as { result: { status: string; idempotencyKey: string }; sinkTail: number }
  }
  try {
    const first = await run('create'); expect(first.result.status).toBe('outcome-unknown'); expect(first.sinkTail).toBe(0)
    const recovered = await run('recover'); expect(recovered.result.status).toBe('confirmed'); expect(recovered.sinkTail).toBe(0)
    expect(recovered.result.idempotencyKey).toBe(first.result.idempotencyKey)
    expect(await run('recover')).toEqual(recovered)
  } finally { await rm(root, { recursive: true, force: true }) }
}, 30000)
