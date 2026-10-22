/** Keyless runnable Host grants and real durable local test sink, with lost-receipt cold reconciliation. */
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'
import { resolveExampleLaunch } from '@clocky/clocky-loader-smoke'

it.each(['json', 'sqlite'])('%s sandbox keeps the original authorized effect across cold processes', async (backend) => {
  const temp = resolve('.tmp/world-de/sandbox-snapshot')
  await mkdir(temp, { recursive: true })
  const root = await mkdtemp(resolve(temp, `${backend}-`))
  await writeFile(resolve(root, 'principal.json'), JSON.stringify({ version: 1, principalId: 'reader', credentialGeneration: 1,
    credentialDigest: createHash('sha256').update('keyless-fixture-credential').digest('hex') }), { mode: 0o600 })
  const source = resolve('examples/simulation-company/tests/world-real-effect-sandbox-scenario.ts')
  const launch = resolveExampleLaunch({ srcBin: source, libBin: source, tsconfigPath: resolve('tsconfig.base.json'),
    configArgs: [resolve('examples/simulation-company/tests/fixtures/world-real-effect-sandbox/cordis.yml')],
    env: { E_TEST_ROOT: root, E_TEST_BACKEND: backend, TMPDIR: temp } })
  let key: string | undefined
  for (const [index, mode] of ['create', 'recover', 'recover'].entries()) {
    const child = spawn(launch.command, [...launch.args, mode], { env: { ...process.env, ...launch.env }, stdio: ['ignore', 'pipe', 'pipe'] })
    const exited = once(child, 'exit')
    let stdout = '', stderr = ''
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString() })
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString() })
    const timeout = setTimeout(() => child.kill('SIGKILL'), 30000)
    try {
      const [code] = await exited as unknown[]
      await writeFile(resolve(root, `${index}-${mode}.json`), JSON.stringify({ code, stdout, stderr }) + '\n')
      expect(code, stderr).toBe(0)
      const value = JSON.parse(stdout) as { result: { status: string; idempotencyKey: string; source: string }; sinkTail: number }
      expect({ status: value.result.status, source: value.result.source, sinkTail: value.sinkTail }).toEqual({
        status: mode === 'create' ? 'outcome-unknown' : 'confirmed', source: 'real-test', sinkTail: 0 })
      if (key !== undefined) expect(value.result.idempotencyKey).toBe(key)
      key = value.result.idempotencyKey
    } finally { clearTimeout(timeout); child.kill('SIGKILL') }
  }
}, 90000)
