/** Both SDK owners inspect the same retained three-actor report continuation and its recorded required input. */
import { templateJSON } from './sdk-product-template.ts'
const templates = JSON.parse(templateJSON) as Array<{ driver: Record<string, unknown>; spec: Record<string, unknown> }>
templates[0]!.spec.maxTokensPerInterval = 0
templates[0]!.driver.scenario = { kind: 'task-workflow', version: '1',
  topology: { actors: [{ id: 'auditor', name: 'Independent auditor' }], channels: [{ key: 'audit', members: [
    { entityId: 'buyer', role: 'author' }, { entityId: 'auditor', role: 'receiver' },
  ] }] }, steps: [{ id: 'report', sourceEntityId: 'buyer', entityId: 'buyer', recipientEntityId: 'auditor', channelKey: 'audit',
    reviewerEntityId: 'auditor', subject: 'SDK report', description: 'Publish exactly one SDK report', text: 'SDK original report',
    cognition: 'deterministic', leaseDurationMs: 60000, maxAttempts: 3, retry: 'before-effects' }] }
/** Complete trusted template JSON consumed by the actual SDK Loader composition. */
export const executionTemplateJSON = JSON.stringify(templates)
