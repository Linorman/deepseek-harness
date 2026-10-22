/** Current fault owners use real IPC barriers/SIGKILL and preserve every original database across two fresh recoveries. */
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, writeFile, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveExampleLaunch } from '@clocky/clocky-loader-smoke'

type Family = 'norm' | 'hire' | 'mediated' | 'rule' | 'actor' | 'personnel' | 'funded' | 'retirement' | 'personnel-cancel'
interface Case { readonly family: Family; readonly stage: string; readonly environment?: Readonly<Record<string, string>> }
const cases: readonly Case[] = [
  ...['vote-before', 'vote-after', 'enact-before', 'enact-after', 'notification-lost'].map(stage => ({ family: 'norm' as const, stage })),
  ...['accepted-before-reserve', 'participant-afterIO'].map(stage => ({ family: 'hire' as const, stage })),
  ...['cleanup-before-append', 'cleanup-after-append'].map(stage => ({ family: 'hire' as const, stage,
    environment: { WORLD_HIRE_CANCEL: 'after-channel', WORLD_HIRE_CLEANUP: 'true' } })),
  ...['request-accepted-after', 'request-notification-lost'].map(stage => ({ family: 'mediated' as const, stage })),
  ...['evaluation-append-before', 'evaluation-append-after'].map(stage => ({ family: 'rule' as const, stage })),
  ...['reserved-after', 'participant-unconfirmed', 'notification-lost', 'cancel-participant-unconfirmed',
    'cancel-before-commit', 'commit-wins-cancel'].map(stage => ({ family: 'actor' as const, stage })),
  ...['before-native-commit', 'commit-wins'].map(stage => ({ family: 'personnel-cancel' as const, stage })),
  { family: 'retirement', stage: 'retired-executor' },
  ...['generate-notification-lost', 'existing-notification-lost'].map(stage => ({ family: 'funded' as const, stage })),
  ...['transfer-commit-before', 'transfer-commit-after', 'depart-accepted-fence-after', 'depart-retirement-unknown',
    'depart-commit-after', 'notification-lost'].map(stage => ({ family: 'personnel' as const, stage })),
]
const configs: Readonly<Record<Family, string>> = { norm: 'world-norm', hire: 'world-protocol', mediated: 'world-external-mediated-fault',
  rule: 'world-external-fault', actor: 'world-external-mediated-actor-fault', personnel: 'world-personnel-crash', funded: 'hiring-resources', retirement: 'world-driver', 'personnel-cancel': 'world-personnel-cancellation' }
const selected = process.env.WORLD_R06_ONLY?.split(',')
if (selected !== undefined) for (const key of selected) if (!cases.some(value => `${value.family}:${value.stage}` === key))
  throw new Error(`Unknown R06 fault selection: ${key}`)
const chosen = selected === undefined ? cases : cases.filter(value => selected.includes(`${value.family}:${value.stage}`))
function environment(input: Case, round: number, root: string): NodeJS.ProcessEnv {
  const recover = String(round !== 0), stage = round === 0 ? input.stage : ''
  switch (input.family) {
    case 'personnel-cancel': return { WORLD_R06_PERSONNEL_CANCEL: 'true', WORLD_PERSONNEL_CANCELLATION_CASE: input.stage,
      WORLD_DRIVER_RECOVER: recover }
    case 'retirement': return { WORLD_R06_RETIRED_EXECUTOR: 'true', WORLD_DRIVER_MAINTENANCE_FAILURE: 'true',
      WORLD_DRIVER_RECOVER: recover }
    case 'funded': return { WORLD_HIRING_MODE: input.stage.startsWith('generate') ? 'generate-and-hire' : 'hire-existing' }
    case 'norm': return { WORLD_NORM_CRASH: input.stage, WORLD_DRIVER_RECOVER: recover }
    case 'hire': return { WORLD_RESOLUTION: 'apply', WORLD_HIRE_CRASH: stage, WORLD_HIRE_RECOVER: recover, ...input.environment }
    case 'mediated': return { WORLD_MEDIATED_FAULT_STAGE: input.stage, WORLD_MEDIATED_FAULT_RECOVER: recover,
      WORLD_MEDIATED_FAULT_ROUND: String(round) }
    case 'rule': return { WORLD_EXTERNAL_FAULT_STAGE: input.stage, WORLD_EXTERNAL_FAULT_RECOVER: recover,
      WORLD_EXTERNAL_FAULT_ROUND: String(round), WORLD_EXTERNAL_FAULT_EVIDENCE: root }
    case 'actor': return { WORLD_MEDIATED_ACTOR_FAULT_STAGE: input.stage, WORLD_MEDIATED_ACTOR_FAULT_RECOVER: recover,
      WORLD_MEDIATED_ACTOR_FAULT_ROUND: String(round) }
    case 'personnel': return { WORLD_PERSONNEL_CRASH_STAGE: input.stage, WORLD_DRIVER_RECOVER: recover,
      WORLD_PERSONNEL_RESTORE_ROUND: String(round), WORLD_PERSONNEL_CRASH_EVIDENCE_ROOT: root }
  }
}
function barrier(input: Case): unknown {
  switch (input.family) {
    case 'norm': case 'hire': case 'personnel': case 'rule': case 'funded': case 'retirement': case 'personnel-cancel': return 'durable'
    case 'mediated': return { event: 'mediated-durable-boundary', stage: input.stage }
    case 'actor': return { event: 'mediated-actor-durable-boundary', stage: input.stage }
  }
}

describe.each(['json', 'sqlite'])('%s current R06 original fault responsibility', (backend) => {
  it.each(chosen.map(value => ({ ...value, label: `${value.family}:${value.stage}` })))('$label retains the original cut and two fresh recoveries', async (input) => {
    const face = process.env.CLOCKY_EXAMPLE_MODE ?? 'src', temp = resolve('.local/world-completion/tmp')
    const evidence = resolve(process.env.WORLD_R06_EVIDENCE_ROOT ?? '.local/world-completion/r06-final/matrix')
    await mkdir(temp, { recursive: true }); await mkdir(evidence, { recursive: true })
    const root = await mkdtemp(resolve(evidence, `${face}-${backend}-${input.family}-${input.stage}-`))
    const source = resolve('examples/simulation-company/tests/world-r06-child.ts')
    const config = resolve(`examples/simulation-company/tests/fixtures/${configs[input.family]}/cordis.yml`)
    const launch = resolveExampleLaunch({ srcBin: source, libBin: source, tsconfigPath: resolve('tsconfig.base.json'), configArgs: [config],
      env: { SIMULATION_COMPANY_ROOT: root, SIMULATION_COMPANY_BACKEND: backend, WORLD_SCENARIO: 'company',
        WORLD_R06_FAMILY: input.family, TMPDIR: temp } })
    const pids: number[] = []
    for (const round of [0, 1, 2]) {
      const child = spawn(launch.command, launch.args, { env: { ...process.env, ...launch.env, ...environment(input, round, root),
        WORLD_R06_ROUND: String(round) }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] })
      const exited = once(child, 'exit').then((values: unknown[]) => values)
      let stdout = '', stderr = '', timedOut = false, failure: string | undefined, reached: unknown
      child.stdout!.on('data', (chunk: Buffer) => { stdout += chunk.toString() })
      child.stderr!.on('data', (chunk: Buffer) => { stderr += chunk.toString() })
      const timeout = setTimeout(() => { timedOut = true; child.kill('SIGKILL') }, round === 0 ? 20000 : 60000)
      try {
        if (round === 0) {
          const message = await Promise.race([once(child, 'message'), exited.then(() => { throw new Error(stderr || 'Original fault barrier was not reached') })])
          reached = message[0]; expect(reached).toEqual(barrier(input)); child.kill('SIGKILL')
        }
        const [code, signal] = await exited
        expect(timedOut).toBe(false)
        if (round === 0) { expect(code).toBe(null); expect(signal).toBe('SIGKILL') }
        else { expect(signal).toBe(null); expect(code, stderr).toBe(0)
          const result: unknown = JSON.parse(stdout)
          expect(result).toMatchObject({ modelCalls: 0 })
          if (input.family === 'norm' || input.family === 'personnel') {
            const cut: unknown = JSON.parse(await readFile(resolve(root, `r06-final-${round}.json`), 'utf8'))
            expect(cut).toMatchObject({ snapshot: { phase: 'paused' } })
          } else expect(result).toMatchObject({ phase: 'paused' }) }
        if (child.pid === undefined) throw new Error('Fault process has no original PID')
        pids.push(child.pid)
      } catch (error) { failure = String(error); throw error }
      finally {
        clearTimeout(timeout); child.kill('SIGKILL'); const [code, signal] = await exited
        await writeFile(resolve(root, `process-${round}.json`), JSON.stringify({ face, backend, family: input.family,
          stage: input.stage, round, root, pid: child.pid, command: launch.command, args: launch.args, exitCode: code, signal,
          timedOut, reached, failure, stdout, stderr }, null, 2) + '\n')
      }
    }
    expect(new Set(pids).size).toBe(3)
    await writeFile(resolve(root, 'complete.json'), JSON.stringify({ face, backend, family: input.family, stage: input.stage, pids }) + '\n')
  })
})
