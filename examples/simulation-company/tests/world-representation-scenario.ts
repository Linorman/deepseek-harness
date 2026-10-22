/** Keyless original representation switch and replay through the real Loader. */
import { resolve } from 'node:path'
import { representationScenario } from '../../../packages/simulation/simulation-local/tests/world-representation-scenario.ts'
const backend = process.env.SIMULATION_COMPANY_BACKEND
if (backend !== 'json' && backend !== 'sqlite') throw new Error('Expected explicit simulation backend')
console.log(JSON.stringify(await representationScenario(backend,
  resolve('examples/simulation-company/tests/fixtures/world-post-mvp/cordis.yml'))))
