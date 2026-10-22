/** Forced exit before and after the atomic append preserves identity and exact retry semantics. */
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { expect, it } from 'vitest'
import { z } from 'zod'

it.each(['json', 'sqlite'] as const)('recovers local mutation at both process boundaries (%s)', async (backend) => {
  const temp = resolve('.tmp/world-post-mvp/b3c'); await mkdir(temp, { recursive: true })
  const directory = await mkdtemp(join(temp, 'local-process-'))
  try {
    for (const stage of ['before', 'after']) {
      const proof = join(directory, `${stage}.json`)
      const start = (mode: string) => {
        const child = spawn(process.execPath, ['--import', 'tsx/esm',
          'packages/simulation/simulation-local/tests/world-local-object-process.ts', backend, proof, mode], {
          cwd: process.cwd(), env: { ...process.env, TMPDIR: temp, TSX_TSCONFIG_PATH: resolve('tsconfig.base.json') },
          stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
        })
        let output = '', error = ''
        child.stdout!.on('data', (data: Buffer) => { output += data.toString() })
        child.stderr!.on('data', (data: Buffer) => { error += data.toString() })
        return { child, exited: once(child, 'exit'), output: () => output, error: () => error }
      }
      const first = start(stage)
      try {
        await Promise.race([once(first.child, 'message'), first.exited.then(() => { throw new Error(first.error()) })])
      } finally { first.child.kill('SIGKILL'); await first.exited }
      const recovered = start('recover')
      try {
        expect((await recovered.exited)[0], recovered.error()).toBe(73)
        const result = z.strictObject({ first: z.unknown(), repeated: z.unknown(), revision: z.number(),
          repeatedRevision: z.number(), name: z.string(), retainedWriters: z.number() }).parse(JSON.parse(recovered.output()))
        expect(result.first).toEqual(result.repeated)
        expect(result.revision).toBe(result.repeatedRevision)
        expect(result.name).toBe('Renamed object-a')
        expect(result.retainedWriters).toBeGreaterThan(0)
      } finally { recovered.child.kill('SIGKILL'); await recovered.exited }
      const source = z.object({ root: z.string() }).parse(JSON.parse(await readFile(proof, 'utf8')))
      await rm(source.root, { recursive: true, force: true })
    }
  } finally { await rm(directory, { recursive: true, force: true }) }
}, 60000)
