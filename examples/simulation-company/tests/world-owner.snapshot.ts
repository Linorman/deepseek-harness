/** Product-original World creation and one authenticated owner survive explicit checkpoint/cold restoration. */
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveExampleLaunch } from '@clocky/clocky-loader-smoke'

describe.each(['json', 'sqlite'])('%s World product owner', (backend) => {
  it.each(['company', 'laboratory'].flatMap(scenario => ['', 'request-before-publish', 'request-channel-afterIO',
    'accepted-before-reserve', 'retirement-timeout', 'retirement-unload', 'retirement-late-callback', 'participant-afterIO', 'commit-before',
    'committed-before-notification'].map(crash => ({ scenario, crash }))))(
    'runs $scenario with crash=$crash only after explicit start and cold-restores paused', async ({ scenario, crash }) => {
      const temp = resolve('.local/world-director-mvp/tmp')
      await mkdir(temp, { recursive: true })
      const root = await mkdtemp(resolve(temp, 'world-owner-'))
      const fixture = resolve('examples/simulation-company/tests/world-owner-scenario.ts')
      let config = resolve('examples/simulation-company/tests/fixtures/world-owner/cordis.yml')
      if (crash === 'retirement-unload') {
        const composition = resolve(root, 'composition')
        await mkdir(composition, { recursive: true })
        await symlink(resolve('examples/node_modules'), resolve(composition, 'node_modules'),
          process.platform === 'win32' ? 'junction' : 'dir')
        await writeFile(resolve(composition, 'package.json'), await readFile(resolve('examples/package.json')))
        const base = await readFile(resolve('examples/simulation-company/cordis.yml'))
        await writeFile(resolve(composition, 'base.yml'), base)
        await writeFile(resolve(composition, 'original-base.yml'), base)
        const driver = (await readFile(resolve('examples/simulation-company/tests/fixtures/world-driver/cordis.yml'), 'utf8'))
          .replace('../../../cordis.yml', './base.yml')
          .replace('../../world-driver-model.ts', resolve('examples/simulation-company/tests/world-driver-model.ts'))
        await writeFile(resolve(composition, 'driver.yml'), driver)
        const owner = (await readFile(config, 'utf8')).replace('../world-driver/cordis.yml', './driver.yml')
        config = resolve(composition, 'owner.yml')
        await writeFile(config, owner)
      }
      const launch = resolveExampleLaunch({ srcBin: fixture, libBin: fixture, tsconfigPath: resolve('tsconfig.base.json'),
        configArgs: [config],
        env: { SIMULATION_COMPANY_ROOT: root, SIMULATION_COMPANY_BACKEND: backend, WORLD_SCENARIO: scenario,
          WORLD_OWNER_CRASH: crash, TMPDIR: temp } })
      const execute = async (recover: boolean) => {
        // Loader persists an intentional unload only into the isolated base; a cold process explicitly installs its owner again.
        if (recover && crash === 'retirement-unload') {
          await writeFile(resolve(root, 'composition/base.yml'), await readFile(resolve(root, 'composition/original-base.yml')))
        }
        const child = spawn(launch.command, launch.args, { env: { ...process.env, ...launch.env,
          WORLD_OWNER_RECOVER: String(recover) }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] })
        const exited = once(child, 'exit')
        let output = '', errors = ''
        child.stdout!.on('data', (chunk: Buffer) => { output += chunk.toString() })
        child.stderr!.on('data', (chunk: Buffer) => { errors += chunk.toString() })
        try {
          if (!recover && crash !== '') {
            const message = await Promise.race([once(child, 'message'), exited.then(() => { throw new Error(errors) })])
            expect(message[0]).toBe('durable')
            child.kill('SIGKILL')
            const [, signal] = await exited as unknown[]
            expect(signal).toBe('SIGKILL')
            return
          }
          const [code] = await exited as unknown[]
          expect(code, errors).toBe(0)
          expect(JSON.parse(output)).toEqual({ scenario, originalProduct: true, oneOwner: true, committed: true,
            independentNewcomer: true, phase: 'paused', originalStartRetryKeepsPause: true, restored: recover,
            modelCalls: recover ? crash === '' ? 0 : crash.startsWith('request-') ? 15 : 12 : 18 })
        } finally { child.kill('SIGKILL'); await exited }
      }
      try { await execute(false); await execute(true) }
      finally { await rm(root, { recursive: true, force: true }) }
    },
  )
})
