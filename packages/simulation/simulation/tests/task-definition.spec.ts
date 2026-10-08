import { expect,it } from 'vitest'
import { simulationTaskSpecSchema } from '../src/task-outbox.ts'

const definition = {
  subject: 'Inspect',description: 'Inspect the accepted operation.',blockedBy: [],requiredCapabilities: [],priority: 0,
  readScopes: [],writeScopes: [],workspaceMode: 'shared',reviewPolicy: { kind: 'none' },budget: {},maxAttempts: 1,
}

it.each(['priority','maxAttempts'])('rejects an unsafe task %s before decision acceptance', (field) => {
  expect(simulationTaskSpecSchema.safeParse({ ...definition,[field]: Number.MAX_SAFE_INTEGER + 1 }).success).toBe(false)
})

it.each(['actor','execution','placement','workflowPlanId'])('refuses caller-selected task %s outside the explicit task specification', (field) => {
  expect(simulationTaskSpecSchema.safeParse({ ...definition,[field]: 'forged' }).success).toBe(false)
})
