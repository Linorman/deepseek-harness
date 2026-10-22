/** Observe current package resolution before entering an existing real fault scenario; business owners remain unchanged. */
import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { WORLD_GOVERNANCE_VOTE_PIN } from '@clocky/clocky-simulation'

const scripts = { norm: 'world-norm-crash-scenario.ts', hire: 'world-hire-scenario.ts',
  mediated: 'world-external-mediated-fault-scenario.ts', rule: 'world-external-fault-scenario.ts',
  actor: 'world-external-mediated-actor-fault-scenario.ts', personnel: 'world-personnel-crash-scenario.ts',
  funded: 'world-r06-funded-scenario.ts', retirement: 'world-driver-scenario.ts', 'personnel-cancel': 'world-personnel-cancellation-scenario.ts' } as const
const family = process.env.WORLD_R06_FAMILY
assert.ok(family !== undefined && Object.hasOwn(scripts, family))
const selected = family as keyof typeof scripts, face = process.env.CLOCKY_EXAMPLE_MODE ?? 'src'
const paths = Object.fromEntries(['@clocky/clocky-simulation', '@clocky/clocky-simulation-local', '@clocky/clocky-simulation-world',
  '@clocky/clocky-simulation-team', '@clocky/clocky-simulation-product'].map(name => [name, import.meta.resolve(name)]))
assert.ok(Object.values(paths).every(path => path.includes(face === 'lib' ? '/lib/' : '/src/')))
assert.equal(WORLD_GOVERNANCE_VOTE_PIN.implementationRef, 'clocky.governance.vote/native/5')
assert.equal(WORLD_GOVERNANCE_VOTE_PIN.generation, 4)
if (face === 'lib') {
  assert.deepEqual(process.execArgv, [])
  assert.equal(/--(?:import|loader|require)\b|tsx/.test(process.env.NODE_OPTIONS ?? ''), false)
}
await writeFile(resolve(process.env.SIMULATION_COMPANY_ROOT!, `runtime-${process.env.WORLD_R06_ROUND}.json`), JSON.stringify({
  pid: process.pid, family, face, argv: process.argv, execArgv: process.execArgv, paths, votePin: WORLD_GOVERNANCE_VOTE_PIN,
}, null, 2) + '\n')
await import(new URL(scripts[selected], import.meta.url).href)
