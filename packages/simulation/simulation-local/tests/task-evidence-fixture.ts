/** Accept and receipt a task through the native outbox with a scripted external target. */
import { teamIdSchema, teamTaskIdSchema } from '@clocky/clocky-team'
import type { SimulationWriterLease } from '@clocky/clocky-simulation'
import type { createBusinessHarness } from './business-harness.ts'

export async function createTaskReceipt(h: Awaited<ReturnType<typeof createBusinessHarness>>,
  lease: SimulationWriterLease, taskId: string, maxAttempts = 2) {
  const decision = await h.submit(lease, `create-${taskId}`, [{ after: [], action: { kind: 'task/create', deliverAt: '0', task: {
    subject: 'Prepare goods', description: 'Fulfill the accepted order', blockedBy: [], requiredCapabilities: [], priority: 0,
    readScopes: [], writeScopes: [], workspaceMode: 'shared', reviewPolicy: { kind: 'none' }, budget: {}, maxAttempts,
  } } }])
  const operationId = decision.operationIds[0]!
  await h.run.drive({ until: h.run.snapshot().time })
  await h.run.dispatchOperation(operationId, { createTask: async value => ({ status: 'applied', taskReceipt: {
    operationId, fingerprint: value.fingerprint, teamId: teamIdSchema.parse('company'), taskId: teamTaskIdSchema.parse(taskId),
  } }) }, () => 100)
  return operationId
}
