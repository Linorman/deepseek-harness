/** Durable suffix faults use actual executed worlds and fresh Loader processes, never synthetic success snapshots. */
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { cp, readdir, mkdir, mkdtemp, writeFile, link } from 'node:fs/promises'
import { constants } from 'node:fs'
import { resolve, join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { resolveExampleLaunch, resolveExampleMode } from '@clocky/clocky-loader-smoke'

const allFaults = ['none', 'hire-session-missing', 'rep-session-missing', 'hire-session-binding', 'rep-session-binding',
  'hire-participant-missing', 'rep-participant-missing', 'hire-participant-descriptor', 'rep-participant-descriptor',
  'hire-channel-endpoint', 'rep-channel-endpoint', 'hire-channel-missing', 'rep-channel-missing',
  'hire-persona', 'rep-persona', 'receipt-envelope', 'implementation-generation']
const selected = process.env.WORLD_RESTORE_CONTRACT_ONLY?.split(',') ?? allFaults
describe.each(['json', 'sqlite'].flatMap(backend => ['company', 'laboratory'].map(scene => ({ backend, scene }))))(
  '$backend $scene original suffix ownership', ({ backend, scene }) => {
    const face = resolveExampleMode()
    const base = resolve(process.env.WORLD_RESTORE_CONTRACT_EVIDENCE_ROOT ?? '.local/world-completion/r02-canonical-restore/matrix')
    let seed: string
    beforeAll(async () => {
      await mkdir(base, { recursive: true })
      if (process.env.WORLD_RESTORE_CONTRACT_SEEDS !== undefined) {
        const seeds = resolve(process.env.WORLD_RESTORE_CONTRACT_SEEDS)
        const names = (await readdir(seeds)).filter(name => name.startsWith(`${face}-${backend}-${scene}-`))
        expect(names).toHaveLength(1); seed = join(seeds, names[0]!); return
      }
      seed = await mkdtemp(join(base, `${face}-${backend}-${scene}-seed-`))
      const source = resolve('examples/simulation-company/tests/complete-world-scenario.ts')
      const launch = resolveExampleLaunch({ srcBin: source, libBin: source, tsconfigPath: resolve('tsconfig.base.json'),
        configArgs: [resolve('examples/simulation-company/tests/fixtures/complete-world/cordis.yml')], env: {
          SIMULATION_COMPANY_ROOT: seed, SIMULATION_COMPANY_BACKEND: backend, WORLD_SCENARIO: scene,
          WORLD_COMPLETE_ROUND: '0', WORLD_COMPLETE_RECOVER: 'false', TMPDIR: resolve('.local/world-completion/tmp') } })
      const child = spawn(launch.command, launch.args, { env: { ...process.env, ...launch.env }, stdio: ['ignore', 'pipe', 'pipe'] })
      let stdout = '', stderr = ''; child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString() })
      child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString() })
      const exited = once(child, 'exit').then((values: unknown[]) => values), timeout = setTimeout(() => child.kill('SIGKILL'), 120000)
      try {
        const [code, signal] = await exited
        await writeFile(join(seed, 'seed-process.json'), JSON.stringify({ face, backend, scene, seed,
          command: launch.command, args: launch.args, pid: child.pid, code, signal, stdout, stderr }, null, 2))
        expect(signal).toBe(null); expect(code, stderr).toBe(0)
      } finally { clearTimeout(timeout); child.kill('SIGKILL'); await exited }
    }, 130000)
    it.each(selected)('validates %s before restored scheduling admission', async (fault) => {
      const root = await mkdtemp(join(base, `${face}-${backend}-${scene}-${fault}-`))
      for (const name of ['simulation', 'sessions', backend === 'json' ? 'team-json' : 'team.sqlite']) {
        await cp(join(seed, name), join(root, name), { recursive: true, mode: constants.COPYFILE_FICLONE })
      }
      // Immutable baseline files share bytes; faulted media always have independent inodes or copy-on-write blocks.
      for (const name of ['input.json', 'original.json']) await link(join(seed, name), join(root, name))
      const mutation = spawn(process.env.PYTHON ?? 'python3', [resolve('examples/simulation-company/tests/world-restore-contract-mutation.py'), root, backend, fault],
        { stdio: ['ignore', 'pipe', 'pipe'] })
      let mutationError = ''; mutation.stderr.on('data', (chunk: Buffer) => { mutationError += chunk.toString() })
      expect((await once(mutation, 'exit'))[0], mutationError).toBe(0)
      const source = resolve('examples/simulation-company/tests/world-restore-contract-scenario.ts')
      const launch = resolveExampleLaunch({ srcBin: source, libBin: source, tsconfigPath: resolve('tsconfig.base.json'),
        configArgs: [resolve('examples/simulation-company/tests/fixtures/complete-world/cordis.yml')], env: {
          SIMULATION_COMPANY_ROOT: root, SIMULATION_COMPANY_BACKEND: backend, WORLD_SCENARIO: scene,
          WORLD_RESTORE_CONTRACT_FAULT: fault, TMPDIR: resolve('.local/world-completion/tmp') } })
      const child = spawn(launch.command, launch.args, { env: { ...process.env, ...launch.env }, stdio: ['ignore', 'pipe', 'pipe'] })
      const exited = once(child, 'exit').then((values: unknown[]) => values); let stdout = '', stderr = '', timedOut = false
      child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString() })
      child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString() })
      const timeout = setTimeout(() => { timedOut = true; child.kill('SIGKILL') }, 60000)
      try {
        const [code, signal] = await exited
        await writeFile(join(root, 'process.json'), JSON.stringify({ face, backend, scene, fault, seed, root,
          pid: child.pid, command: launch.command, args: launch.args, code, signal, timedOut, stdout, stderr }, null, 2))
        expect(timedOut).toBe(false); expect(signal).toBe(null); expect(code, stderr).toBe(0)
        expect(JSON.parse(stdout)).toMatchObject({ face, backend, fault, refused: fault !== 'none', originalJournalUnchanged: true,
          counters: { model: 0, activation: 0, publication: 0, attachment: fault === 'none' ? 1 : 0 } })
      } finally { clearTimeout(timeout); child.kill('SIGKILL'); await exited }
    }, 90000)
  })
