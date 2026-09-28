/** A fresh Loader must refuse altered checkpoint evidence without repairing or publishing effects. */
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, readdir, readFile, writeFile, rm } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveExampleLaunch } from '@clocky/clocky-loader-smoke'

async function sessionFiles(directory: string): Promise<string[]> {
  const result: string[] = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) result.push(...await sessionFiles(path))
    else if (entry.isFile() && entry.name.endsWith('.jsonl')) result.push(path)
  }
  return result.sort()
}

describe.each(['json', 'sqlite'])('%s cold checkpoint refusal', (backend) => {
  it('refuses a changed Session header, preserves bytes, then recovers after exact repair', async () => {
    await mkdir(resolve('.tmp'), { recursive: true })
    const root = await mkdtemp(resolve('.tmp/checkpoint-corruption-'))
    const fixture = resolve('examples/simulation-company/tests/checkpoint-restore-scenario.ts')
    const launch = resolveExampleLaunch({ srcBin: fixture, libBin: fixture, tsconfigPath: resolve('tsconfig.base.json'),
      configArgs: [resolve('examples/simulation-company/cordis.yml')],
      env: { SIMULATION_COMPANY_ROOT: root, SIMULATION_COMPANY_BACKEND: backend, RESTORE_WINDOW_CASE: 'false' } })
    try {
      const original = spawn(launch.command, launch.args, { env: { ...process.env, ...launch.env,
        RESTORE_MODE: 'create', RESTORE_CRASH: 'checkpoint-published' }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] })
      const exited = once(original, 'exit')
      let error = ''
      original.stderr!.on('data', (chunk: Buffer) => { error += chunk.toString() })
      try {
        const [ready] = await Promise.race([once(original, 'message'), exited.then(() => { throw new Error(error) })]) as unknown[]
        expect(ready).toBe('durable')
      } finally { original.kill('SIGKILL'); await exited }
      const path = (await sessionFiles(join(root, 'sessions')))[0]!
      const bytes = await readFile(path, 'utf8')
      const lines = bytes.trimEnd().split('\n')
      const header = JSON.parse(lines[0]!) as { createdAt: number }
      header.createdAt += 1
      lines[0] = JSON.stringify(header)
      const damaged = `${lines.join('\n')}\n`
      await writeFile(path, damaged)
      const recover = async () => {
        const child = spawn(launch.command, launch.args, { env: { ...process.env, ...launch.env,
          RESTORE_MODE: 'restore', RESTORE_CRASH: '' }, stdio: 'pipe' })
        const done = once(child, 'exit')
        let output = '', error = ''
        child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString() })
        child.stderr.on('data', (chunk: Buffer) => { error += chunk.toString() })
        try { return { code: (await done as unknown[])[0], output, error } }
        finally { child.kill('SIGKILL'); await done }
      }
      const refused = await recover()
      expect(refused.code).not.toBe(0)
      expect(refused.error).toContain('Checkpoint Session prefix does not match its manifest')
      expect(await readFile(path, 'utf8')).toBe(damaged)
      await writeFile(path, bytes)
      const repaired = await recover()
      expect(repaired.code, repaired.error).toBe(0)
      expect(JSON.parse(repaired.output)).toMatchObject({ modelCalls: 0, publications: 0,
        operation: { status: 'pending', receipt: false }, continued: { status: 'applied', newPublications: 1 } })
    } finally { await rm(root, { recursive: true, force: true }) }
  })
})
