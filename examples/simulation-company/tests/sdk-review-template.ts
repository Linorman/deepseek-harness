/** SDK review uses the installed procurement scene, bounded deterministic task cognition and buyer review. */
import { templateJSON } from './sdk-product-template.ts'
import { simulationCompanyTemplateSchema } from '../../../packages/simulation/simulation-product/src/creation-schema.ts'

const [base] = JSON.parse(templateJSON) as unknown[]
const template = simulationCompanyTemplateSchema.parse(base)
export const reviewTemplateJSON = JSON.stringify([{ ...template, driver: { ...template.driver,
  tasks: { version: '1', cognition: 'deterministic', leaseDurationMs: 60000, maxAttempts: 3, retry: 'scene', review: 'buyer' } } }])
