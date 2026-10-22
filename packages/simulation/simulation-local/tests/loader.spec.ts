import { simulationTemp } from './temp.ts'
import { fork, spawn } from 'node:child_process'
import { once } from 'node:events'
import { rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveExampleLaunch } from '@clocky/clocky-loader-smoke'

const fixture = resolve('packages/simulation/simulation-local/tests/fixtures/loader.ts')
const config = resolve('examples/headless-agent/tests/fixtures/simulation/simulation-local/cordis.yml')
const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

function launch(backend: string, root: string) {
  return resolveExampleLaunch({
    srcBin: fixture, libBin: fixture, tsconfigPath: resolve('tsconfig.base.json'),
    configArgs: [config],
    env: { SIMULATION_TEST_ROOT: root, SIMULATION_TEST_BACKEND: backend },
  })
}
async function execute(backend: string, root: string, mode: string) {
  const spec = launch(backend, root)
  const child = spawn(spec.command, [...spec.args, mode], { env: { ...process.env, ...spec.env }, stdio: 'pipe' })
  let output = ''
  let error = ''
  child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString() })
  child.stderr.on('data', (chunk: Buffer) => { error += chunk.toString() })
  const [code] = await once(child, 'exit') as [number | null]
  return { code, output, error }
}

describe.each(['json', 'sqlite'])('%s Loader composition', (backend) => {
  it('rebuilds the same run in a fresh process', async () => {
    const root = await simulationTemp('loader')
    roots.push(root)
    const first = await execute(backend, root, 'create')
    expect(first.code, first.error).toBe(0)
    const recovered = await execute(backend, root, 'open')
    expect(recovered.code, recovered.error).toBe(0)
    expect(recovered.output).toBe(first.output)
    expect(JSON.parse(recovered.output)).toMatchInlineSnapshot(`
      {
        "commitments": {},
        "decisions": {},
        "entities": {
          "buyer": {
            "cognition": "agent",
            "id": "buyer",
            "kind": "person",
            "phase": "active",
            "profile": {
              "name": "Purchasing",
            },
            "profileRevision": 1,
            "readiness": "ready",
            "revision": 1,
          },
          "warehouse": {
            "cognition": "none",
            "id": "warehouse",
            "kind": "org",
            "phase": "active",
            "profile": {
              "name": "Warehouse",
            },
            "profileRevision": 1,
            "readiness": "ready",
            "revision": 1,
          },
        },
        "grants": {},
        "interactions": {},
        "nextDecisionSlot": "0",
        "nextEventSlot": "0",
        "operations": {},
        "phase": "running",
        "relations": {
          "employment": {
            "id": "employment",
            "object": "warehouse",
            "relation": "member-of",
            "revision": 1,
            "scope": "warehouse",
            "subject": "buyer",
            "validFrom": "0",
            "validUntil": null,
          },
        },
        "resourceReservations": {},
        "resources": {},
        "revision": 4,
        "scheduledEvents": {},
        "spec": {
          "budgetInterval": "100",
          "decisionTimeoutMs": 60000,
          "maxConflictRetries": 2,
          "maxDecisionsPerInterval": 1000,
          "maxDecisionsPerWindow": 16,
          "maxDispatchWaitRounds": 8,
          "maxDriveSteps": 16,
          "maxEntities": 1000,
          "maxIngressBytes": 65536,
          "maxKnowledgeBytes": 65536,
          "maxKnowledgePerQuery": 32,
          "maxMessagesPerInterval": 1000,
          "maxMicrostepsPerTime": 32,
          "maxOperationsPerDecision": 16,
          "maxPendingEvents": 1000,
          "maxPendingInteractions": 1000,
          "maxQueuedDecisions": 1000,
          "maxResidentActors": 16,
          "maxResourceQuantity": "1000000000000000000000000",
          "maxResourceReservationHistory": 128,
          "maxTime": "100000000000000000000",
          "maxTokensPerInterval": 1000000,
          "origin": "0",
          "outboxMaxAttempts": 3,
          "outboxRetryDelayMs": 10,
          "phaseOrder": [
            "delivery",
            "decision",
            "deadline",
          ],
          "policyVersion": "1",
          "relationRules": [
            {
              "acyclic": true,
              "objectKinds": [
                "org",
              ],
              "relation": "member-of",
              "scopeKinds": [
                "org",
              ],
              "subjectKinds": [
                "person",
              ],
            },
          ],
          "rulesVersion": "1",
          "runId": "supply",
          "tickUnit": "minute",
          "tokensPerModelRequest": 10000,
        },
        "time": "0",
        "wakes": {},
      }
    `)
  }, 20000)

  it('rejects a second process and admits recovery after SIGKILL', async () => {
    const root = await simulationTemp('crash')
    roots.push(root)
    const spec = launch(backend, root)
    const child = fork(fixture, [config, 'create', 'hold'], {
      execArgv: spec.args.slice(0, -2), env: { ...process.env, ...spec.env }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    })
    let stderr = ''
    child.stderr!.on('data', (chunk: Buffer) => { stderr += chunk.toString() })
    const exited = once(child, 'exit')
    try {
      const ready = await Promise.race([once(child, 'message'), exited.then(() => { throw new Error(stderr) })])
      expect(ready[0]).toBe('durable')
      const duplicate = await execute(backend, root, 'open')
      expect(duplicate.code).not.toBe(0)
      expect(duplicate.error).toMatch(/coordinator/)
      child.kill('SIGKILL')
      await exited
      const recovered = await execute(backend, root, 'open')
      expect(recovered.code, recovered.error).toBe(0)
      expect(JSON.parse(recovered.output)).toMatchObject({ revision: 4, phase: 'running' })
    } finally {
      child.kill('SIGKILL')
      await exited
    }
  }, 20000)
})
