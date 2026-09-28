import { expect, it } from 'vitest'
import { parameterSchemaSpecToJsonSchema, validateJsonSchemaValue } from '@clocky/clocky-tools'
import { simulationOperationSchema, simulationProposalSchema, simulationFulfillmentSchema } from '@clocky/clocky-simulation'
import { stageParameters } from '../src/schema.ts'

it('exposes every domain operation while rejecting injected actor fields in a proposal', () => {
  const exposed = stageParameters.proposals.items.properties.action.oneOf.map(branch => branch.properties.kind.const)
  expect(new Set(exposed)).toEqual(new Set(simulationOperationSchema.options.map(branch => branch.shape.kind.value)))
  const fulfillment = stageParameters.proposals.items.properties.action.oneOf.flatMap(branch =>
    'fulfillment' in branch.properties ? branch.properties.fulfillment.oneOf.map(value => value.properties.kind.const) : [])
  expect(new Set(fulfillment)).toEqual(new Set(simulationFulfillmentSchema.options.map(branch => branch.shape.kind.value)))
  const proposal = { after: [], action: { kind: 'communication/post', recipient: 'buyer', channelId: 'direct', text: 'Hello', deliverAt: '5' } }
  const schema = parameterSchemaSpecToJsonSchema(stageParameters)
  expect(validateJsonSchemaValue(schema, { proposals: [proposal] })).toEqual([])
  expect(simulationProposalSchema.safeParse(proposal).success).toBe(true)
  const impersonation = { ...proposal, action: { ...proposal.action, sender: 'another-entity' } }
  expect(validateJsonSchemaValue(schema, { proposals: [impersonation] }).length).toBeGreaterThan(0)
  expect(simulationProposalSchema.safeParse(impersonation).success).toBe(false)
})

it('exposes participant tasks and task-completion fulfillment without accepting forged ownership', () => {
  const schema = parameterSchemaSpecToJsonSchema(stageParameters)
  const task = { subject: 'Prepare delivery', description: 'Return evidence', blockedBy: [], requiredCapabilities: [], priority: 0,
    readScopes: [], writeScopes: [], workspaceMode: 'shared', reviewPolicy: { kind: 'none' }, budget: {}, maxAttempts: 1 }
  const actions = [
    { kind: 'task/create', task, deliverAt: '0' },
    { kind: 'task/create', task: { ...task, reviewPolicy: { kind: 'participant', reviewerId: 'reviewer' } }, deliverAt: '0' },
    { kind: 'interaction/request', id: 'request', assignee: 'worker', description: 'Prepare delivery',
      replyBy: null, completeBy: null, fulfillment: { kind: 'task-completed' } },
  ]
  for (const action of actions) {
    const proposal = { after: [], action }
    expect(validateJsonSchemaValue(schema, { proposals: [proposal] })).toEqual([])
    expect(simulationProposalSchema.safeParse(proposal).success).toBe(true)
  }
  for (const extra of [{ creatorId: 'foreign' }, { teamId: 'foreign' }, { execution: { kind: 'child-team' } }]) {
    const proposal = { after: [], action: { kind: 'task/create', task: { ...task, ...extra }, deliverAt: '0' } }
    expect(validateJsonSchemaValue(schema, { proposals: [proposal] }).length).toBeGreaterThan(0)
    expect(simulationProposalSchema.safeParse(proposal).success).toBe(false)
  }
})
