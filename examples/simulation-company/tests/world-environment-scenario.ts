/** Keyless runnable environment and experience domain flow through real Loader composition. */
import { runEnvironmentFlow } from '../../../packages/simulation/simulation-local/tests/world-environment-flow.ts'
const backend = process.env.SIMULATION_COMPANY_BACKEND
if (backend !== 'json' && backend !== 'sqlite') throw new Error('Expected explicit simulation backend')
const model = process.env.SIMULATION_ENVIRONMENT_MODEL
if (model !== 'supply-fixed/1' && model !== 'supply-seasonal/1') throw new Error('Expected installed environment model')
console.log(JSON.stringify(await runEnvironmentFlow(backend, model)))
