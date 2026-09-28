import { describe, expect, it } from 'vitest'
import type { z } from 'zod'
import * as schemas from '../src/index.ts'

const actor = { teamId: 'team', participantId: 'worker', activationId: 'epoch', sessionId: 'session', provider: 'local' }
const reason = { code: 'unavailable', message: 'Execution unavailable' }
const closure = { teamId: 'team', kind: 'fail', idempotencyKey: 'close', actor: { kind: 'system', name: 'owner' },
  reason, requestedAt: 10 }
const allocation = { id: 'allocation', revision: 1, teamId: 'team', taskId: 'task', attemptId: 'attempt', assignedRevision: 1,
  participantId: 'worker', activationId: 'epoch', sessionId: 'session', provider: 'local', mode: 'shared',
  lifecycle: 'reserved', reservedAt: 10, updatedAt: 10 }
const action = { id: 'action', teamId: 'team', kind: 'approval', phase: 'pending', sessionId: 'session',
  participantId: 'worker', sourceId: 'source', details: {}, createdAt: 10, updatedAt: 20 }
const taskFields = { subject: 'Check evidence', description: 'Inspect retained evidence.', blockedBy: [], requiredCapabilities: [],
  priority: 0, readScopes: [], writeScopes: [], workspaceMode: 'shared', budget: {}, reviewPolicy: { kind: 'none' }, maxAttempts: 1 }
const template = { id: 'template', ...taskFields }
const plan = { version: 1, name: 'Evidence review', tasks: [template],
  bounds: { maxTasks: 1, maxParallelism: 1, maxTotalAttempts: 1 },
  channel: { participantRoles: ['coordinator', 'worker'], graph: { initial: { kind: 'participant', role: 'worker' },
    transitions: [{ condition: { kind: 'always' }, target: { kind: 'terminate' } }], maxTurns: 1 } },
  result: { kind: 'task-results', taskTemplateIds: ['template'] } }
const workflow = { id: 'plan', teamId: 'team', revision: 1, idempotencyKey: 'plan-create', plan, phase: 'ready',
  taskBindings: [{ templateId: 'template', taskId: 'task' }] }
const result = { kind: 'task-results', tasks: [{ templateId: 'template', taskId: 'task', phase: 'completed', result: { summary: 'Reviewed' } }] }

/** Require the intended semantic rejection, without mistaking a malformed fixture for that rejection. */
function rejects(schema: z.ZodType, value: unknown, path: readonly PropertyKey[]) {
  const parsed = schema.safeParse(value)
  expect(parsed.success).toBe(false)
  if (!parsed.success) expect(parsed.error.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'custom', path })]))
}

describe('Durable Team record integrity', () => {
  it('accepts the complete records used by corruption cases', () => {
    schemas.teamClosureSnapshotSchema.parse(closure)
    schemas.teamWorkspaceAllocationSnapshotSchema.parse(allocation)
    schemas.teamHumanActionSnapshotSchema.parse(action)
    schemas.teamWorkflowPlanSnapshotSchema.parse(workflow)
  })

  it.each([
    ['complete without a result', { kind: 'complete' }],
    ['complete with only a channel', { kind: 'complete', finalChannelId: 'channel' }],
    ['failure with a final channel', { finalChannelId: 'channel' }],
    ['failure with a final Envelope', { finalEnvelopeId: 'envelope' }],
  ])('rejects a closure %s', (_name, patch) => {
    rejects(schemas.teamClosureSnapshotSchema, { ...closure, ...patch }, ['finalChannelId'])
  })

  it.each([
    ['unavailable without loss', { lifecycle: 'unavailable' }, 'loss'],
    ['update before reservation', { updatedAt: 9 }, 'updatedAt'],
    ['active without activation time', { lifecycle: 'active' }, 'activatedAt'],
    ['release requested without time', { lifecycle: 'release-requested' }, 'releaseRequestedAt'],
    ['preserved without time', { lifecycle: 'preserved', preservationReason: reason }, 'preservedAt'],
    ['preserved without reason', { lifecycle: 'preserved', preservedAt: 10 }, 'preservedAt'],
    ['released without time', { lifecycle: 'released' }, 'releasedAt'],
    ...['activatedAt', 'releaseRequestedAt', 'preservedAt', 'releasedAt'].map(key => [`${key} before reservation`, { [key]: 9 }, key] as const),
  ] as const)('rejects workspace allocation %s', (_name, patch, path) => {
    rejects(schemas.teamWorkspaceAllocationSnapshotSchema, { ...allocation, ...patch }, [path])
  })

  it.each([
    ['another world', { executionWorld: { kind: 'e2b', id: 'other' } }],
    ['loss before reservation', { observedAt: 9 }],
    ['artifact without provider', { artifacts: [{ id: 'report', kind: 'report', uri: 'report:1', visibility: 'team', sourceAttemptId: 'attempt' }] }],
    ['artifact from another attempt', { artifacts: [{ id: 'report', provider: 'local', kind: 'report', uri: 'report:1', visibility: 'team', sourceAttemptId: 'other' }] }],
  ])('rejects workspace loss with %s', (_name, patch) => {
    const executionWorld = { kind: 'e2b', id: 'sandbox' }
    const loss = { executionWorld, reason: 'sandbox-expired', terminationProven: true, artifacts: [], observedAt: 10 }
    const valid = { ...allocation, lifecycle: 'unavailable', executionWorld, loss }
    schemas.teamWorkspaceAllocationSnapshotSchema.parse(valid)
    rejects(schemas.teamWorkspaceAllocationSnapshotSchema, { ...valid, loss: { ...loss, ...patch } }, ['loss'])
  })

  it('rejects a scan whose completeness and observation time disagree', () => {
    const scan = { digest: `sha256:${'a'.repeat(64)}`, complete: true, startedAt: 10, finishedAt: 20,
      scannedEntries: 1, hashedBytes: 1, knownOmittedEntries: 0, incompleteReasons: [] }
    schemas.teamWorkspaceScanVersionSchema.parse(scan)
    for (const patch of [{ finishedAt: 9 }, { incompleteReasons: ['limit'] }, { knownOmittedEntries: 1 }]) {
      rejects(schemas.teamWorkspaceScanVersionSchema, { ...scan, ...patch }, [])
    }
  })

  it.each(['operations', 'workspaceModes', 'readScopes', 'writeScopes'] as const)('rejects repeated authority %s', (key) => {
    const grant = { operations: ['activate'], workspaceModes: ['shared'], readScopes: ['src'], writeScopes: ['src'], budgets: {} }
    schemas.teamAuthorityGrantSchema.parse(grant)
    rejects(schemas.teamAuthorityGrantSchema, { ...grant, [key]: [...grant[key], ...grant[key]] }, [key])
  })

  it.each([
    ['attempt without task', { attemptId: 'attempt' }, 'attemptId'],
    ['update before creation', { updatedAt: 9 }, 'updatedAt'],
    ['pending outcome', { outcome: {} }, 'outcome'],
    ['resolved without outcome', { phase: 'resolved' }, 'outcome'],
  ] as const)('rejects human action %s', (_name, patch, path) => {
    rejects(schemas.teamHumanActionSnapshotSchema, { ...action, ...patch }, [path])
  })

  it.each([
    ['another kind', { answer: { kind: 'question', answers: [] } }],
    ['acceptance before creation', { acceptedAt: 9 }],
    ['acceptance after update', { acceptedAt: 21 }],
    ['revision before creation', { expectedUpdatedAt: 9 }],
    ['revision after acceptance', { expectedUpdatedAt: 16 }],
  ])('rejects a human response with %s', (_name, patch) => {
    const response = { expectedUpdatedAt: 10, idempotencyKey: 'answer', answer: { kind: 'approval', outcome: 'allowed-once' },
      respondedBy: 'human', acceptedAt: 15 }
    schemas.teamHumanActionSnapshotSchema.parse({ ...action, response })
    rejects(schemas.teamHumanActionSnapshotSchema, { ...action, response: { ...response, ...patch } }, ['response'])
  })

  it.each(['host-human-action-upsert', 'host-human-action-resolve'])('rejects foreign or settled action in %s', (kind) => {
    const scope = { kind, teamId: 'team', expectedCursor: 0, action: { ...action, createdAt: 0, updatedAt: 0 },
      ...kind === 'host-human-action-resolve' ? { phase: 'resolved', outcome: {} } : {} }
    schemas.teamSystemHumanActionScopeSchema.parse(scope)
    rejects(schemas.teamSystemHumanActionScopeSchema, { ...scope, action: { ...scope.action, teamId: 'other' } }, ['action', 'teamId'])
    rejects(schemas.teamSystemHumanActionScopeSchema, {
      ...scope, action: { ...scope.action, phase: 'resolved', outcome: {} },
    }, ['action', 'phase'])
  })

  it.each([
    ['foreign actor', { actor: { ...actor, teamId: 'other' } }, ['actor', 'teamId']],
    ['unknown template', { taskBindings: [{ templateId: 'missing', taskId: 'task' }] }, ['taskBindings', 0, 'templateId']],
    ['repeated template', { taskBindings: [...workflow.taskBindings, { templateId: 'template', taskId: 'other' }] }, ['taskBindings', 1, 'templateId']],
    ['repeated task', { taskBindings: [...workflow.taskBindings, { templateId: 'missing', taskId: 'task' }] }, ['taskBindings', 1, 'taskId']],
    ['incomplete bindings', { taskBindings: [] }, ['taskBindings']],
    ['completed without result', { phase: 'completed' }, ['result']],
    ['ready with result', { result }, ['result']],
    ['failed without reason', { phase: 'failed' }, ['failure']],
    ['failure on ready plan', { failure: reason }, ['failure']],
    ['cancellation on ready plan', { cancellation: reason }, ['cancellation']],
    ['repeated projected task', { phase: 'completed', result: { ...result, tasks: [...result.tasks, ...result.tasks] } }, ['result', 'tasks']],
    ['missing projected task', { phase: 'completed', result: { ...result, tasks: [] } }, ['result', 'tasks']],
  ] as const)('rejects workflow %s', (_name, patch, path) => {
    rejects(schemas.teamWorkflowPlanSnapshotSchema, { ...workflow, ...patch }, path)
  })

  it.each([
    ['completed without result', { phase: 'completed' }, 'result'],
    ['failed without reason', { phase: 'failed' }, 'failure'],
    ['ready with failure', { phase: 'ready', failure: reason }, 'failure'],
    ['ready with result', { phase: 'ready', result }, 'result'],
  ] as const)('rejects workflow phase command and system proof: %s', (_name, patch, path) => {
    const input = { teamId: 'team', planId: 'plan', expectedCursor: 0, expectedRevision: 1, ...patch }
    rejects(schemas.teamWorkflowPlanPhaseInputSchema, input, [path])
    rejects(schemas.teamSystemWorkflowScopeSchema, { ...input, kind: 'team-run-workflow-plan-phase', coordinator: actor }, [path])
  })

  it('rejects cancellation reasons outside the cancelled workflow phase', () => {
    rejects(schemas.teamWorkflowPlanPhaseInputSchema, {
      teamId: 'team', planId: 'plan', expectedCursor: 0, expectedRevision: 1, phase: 'ready', cancellation: reason,
    }, ['cancellation'])
  })

  it('rejects unsorted ranking bounds and capability statistics', () => {
    rejects(schemas.teamTaskRankingPolicySchema, { name: 'outcome-latency', version: 1,
      latencyUpperBoundsMs: [10, 10], costRateUpperBounds: [2, 1], missingCost: 'unknown-last' }, ['latencyUpperBoundsMs'])
    rejects(schemas.teamTaskExecutionStatsSchema, { participantId: 'worker', requiredCapabilities: ['z', 'a'],
      completedAttempts: 1, failedAttempts: 0, totalLatencyMs: 10, latencyBucketCounts: [1] }, ['requiredCapabilities'])
  })

  it.each(['taskId', 'attemptId'])('rejects usage with only %s provenance', (key) => {
    rejects(schemas.teamUsageSampleInputSchema, { id: 'sample', turn: 0, step: 0, [key]: 'task',
      usage: { inputTokens: 1, outputTokens: 1 } }, ['attemptId'])
  })
})

const goal = { teamId: 'team', revision: 1, objective: 'Review', phase: 'active', budgets: {} }
const team = { id: 'team', goal, phase: 'active', depth: 0, maxTeamDepth: 1, cursor: 0, createdAt: 0, updatedAt: 0 }
const task = { ...taskFields, id: 'task', teamId: 'team', revision: 1, execution: { kind: 'participant' }, phase: 'pending',
  createCommand: { creator: actor, idempotencyKey: 'create' }, reviewHistory: [], attemptCount: 0, attemptHistory: [] }
const integration = { sourceTaskId: 'source', sourceAttemptId: 'attempt', provider: 'local', target: 'main', mode: 'integrate' }
const childBinding = { parentTeamId: 'team', parentTaskId: 'task', childTeamId: 'child', delegationId: 'delegation',
  parentServiceId: 'parent-service', coordinatorId: 'child-coordinator', channelId: 'channel' }
const childExecution = { kind: 'child-team', templateId: 'template', templateVersion: 1,
  authorityGrant: { operations: [], workspaceModes: ['shared'], readScopes: [], writeScopes: [], budgets: {} }, budget: {} }
const delegation = { id: 'delegation', phase: 'requested', requestedAt: 0, updatedAt: 0 }
const state = { team, goal, rules: {}, budgets: {}, participants: [], activations: [], tasks: [], workspaceAllocations: [], channelIds: [] }
const inspectionItem = { templateId: 'template', subject: { text: 'Review', truncated: false }, blockedBy: [] }
const inspection = { record: { id: 'plan', teamId: 'team', revision: 1, phase: 'ready', name: 'Review', bounds: plan.bounds },
  teamCursor: 0, startCursor: -1, total: 1, scanned: 1, items: [inspectionItem] }

describe('Team ownership and projection integrity', () => {
  it('accepts the source projections used by corruption cases', () => {
    schemas.teamSnapshotSchema.parse(team)
    schemas.teamTaskSnapshotSchema.parse(task)
    schemas.teamStateSnapshotSchema.parse(state)
    schemas.teamWorkflowInspectionSchema.parse(inspection)
    schemas.teamTaskSnapshotSchema.parse({ ...task, execution: childExecution, delegation })
  })

  it.each([
    ['goal from another Team', { goal: { ...goal, teamId: 'other' } }, ['goal', 'teamId']],
    ['closure from another Team', { closure: { ...closure, teamId: 'other' } }, ['closure', 'teamId']],
    ['cancellation from another Team', { cancellation: { teamId: 'other', idempotencyKey: 'cancel', actor: closure.actor, reason, requestedAt: 10 } }, ['cancellation', 'teamId']],
    ['unstalled Team with a reason', { stallReason: reason }, ['stallReason']],
  ] as const)('rejects %s', (_name, patch, path) => {
    const candidate = structuredClone({ ...team, ...patch })
    rejects(schemas.teamSnapshotSchema, candidate, path)
  })

  it('requires exact parent lineage on a child runtime binding', () => {
    const child = { ...team, id: 'child', goal: { ...goal, teamId: 'child' }, depth: 1,
      parentTeamId: 'team', parentTaskId: 'task', childRun: childBinding }
    schemas.teamSnapshotSchema.parse(child)
    for (const key of ['parentTeamId', 'parentTaskId', 'childTeamId']) {
      rejects(schemas.teamSnapshotSchema, { ...child, childRun: { ...childBinding, [key]: 'other' } }, ['childRun'])
    }
    schemas.teamSystemEnvelopePostScopeSchema.parse({ kind: 'team-delegation-request', binding: childBinding, objective: 'Review' })
  })

  it.each([
    ['self integration', { integration: { ...integration, sourceTaskId: 'task', expectedTarget: 'base' } }, ['integration', 'sourceTaskId']],
    ['missing target revision', { integration }, ['integration', 'expectedTarget']],
    ['workflow integration', { integration: { ...integration, expectedTarget: 'base' }, workflowPlanId: 'plan', workflowTemplateId: 'template' }, ['integration']],
    ['delegation on participant task', { delegation }, ['delegation']],
    ['dependency cancellation on pending task', { blockedBy: ['parent'], blockedByOutcome: { taskId: 'parent', revision: 1, phase: 'failed' } }, ['blockedByOutcome']],
    ['child without delegation', { execution: childExecution }, ['delegation']],
    ['child reserved without lineage', { execution: childExecution, phase: 'running', attemptCount: 1,
      delegation: { ...delegation, phase: 'active', startedAt: 1 } }, ['delegation']],
  ] as const)('rejects task %s', (_name, patch, path) => {
    rejects(schemas.teamTaskSnapshotSchema, { ...task, ...patch }, path)
  })

  it('rejects invalid task creation before it can become a durable task', () => {
    const create = { ...taskFields, teamId: 'team', expectedCursor: 0, createCommand: { idempotencyKey: 'create' } }
    schemas.teamTaskCreateInputSchema.parse(create)
    rejects(schemas.teamTaskCreateInputSchema, { ...create, execution: childExecution, workspaceMode: 'worktree' }, ['execution'])
    rejects(schemas.teamTaskCreateInputSchema, { ...create, workflowPlanId: 'plan' }, ['workflowTemplateId'])
    rejects(schemas.teamTaskCreateInputSchema, { ...create, integration }, ['integration', 'expectedTarget'])
    rejects(schemas.teamTaskCreateInputSchema, { ...create, integration: { ...integration, expectedTarget: 'base' },
      workflowPlanId: 'plan', workflowTemplateId: 'template' }, ['integration'])
  })

  it.each([
    ['goal projection drift', { goal: { ...goal, objective: 'Changed' } }, ['goal']],
    ['duplicate workflow', { workflowPlans: [workflow, workflow] }, ['workflowPlans']],
    ['foreign workflow', { workflowPlans: [{ ...workflow, teamId: 'other' }] }, ['workflowPlans', 0, 'teamId']],
    ['unknown workflow', { tasks: [{ ...task, workflowPlanId: 'missing', workflowTemplateId: 'template' }] }, ['tasks', 0, 'workflowPlanId']],
    ['unknown workflow template', { workflowPlans: [workflow], tasks: [{ ...task, workflowPlanId: 'plan', workflowTemplateId: 'missing' }] }, ['tasks', 0, 'workflowTemplateId']],
    ['foreign allocation', { workspaceAllocations: [{ ...allocation, teamId: 'other' }] }, ['workspaceAllocations', 0, 'teamId']],
    ['duplicate allocation', { workspaceAllocations: [allocation, allocation] }, ['workspaceAllocations', 1, 'id']],
    ['duplicate attempt allocation', { workspaceAllocations: [allocation, { ...allocation, id: 'other' }] }, ['workspaceAllocations', 1, 'attemptId']],
    ['allocation without task', { workspaceAllocations: [allocation] }, ['workspaceAllocations', 0]],
    ['allocation without activation', { workspaceAllocations: [allocation] }, ['workspaceAllocations', 0, 'activationId']],
  ] as const)('rejects Team state %s', (_name, patch, path) => {
    rejects(schemas.teamStateSnapshotSchema, { ...state, ...patch }, path)
  })

  it.each([
    ['unscanned item', { scanned: 0 }],
    ['phantom continuation', { nextCursor: 0 }],
    ['omitted continuation', { total: 2, record: { ...inspection.record, bounds: { ...plan.bounds, maxTasks: 2 } } }],
    ['duplicate template', { total: 2, scanned: 2, items: [inspectionItem, inspectionItem] }],
    ['self dependency', { items: [{ ...inspectionItem, blockedBy: [{ templateId: 'template', subject: inspectionItem.subject }] }] }],
    ['duplicate dependency', { items: [{ ...inspectionItem, blockedBy: [{ templateId: 'prior', subject: inspectionItem.subject }, { templateId: 'prior', subject: inspectionItem.subject }] }] }],
    ['too many tasks', { total: 2, nextCursor: 0 }],
    ['too many results', { record: { ...inspection.record, phase: 'completed', resultTaskCount: 2 } }],
    ['failed without reason', { record: { ...inspection.record, phase: 'failed' } }],
    ['failure outside failed phase', { record: { ...inspection.record, failure: reason } }],
    ['cancellation outside cancelled phase', { record: { ...inspection.record, cancellation: reason } }],
    ['completed without results', { record: { ...inspection.record, phase: 'completed' } }],
    ['ready with results', { record: { ...inspection.record, resultTaskCount: 0 } }],
    ['compiling with results', { record: { ...inspection.record, phase: 'compiling', resultTaskCount: 0 } }],
  ])('rejects workflow inspection with %s', (_name, patch) => {
    rejects(schemas.teamWorkflowInspectionSchema, { ...inspection, ...patch }, [])
  })

  it('accepts a valid workflow inspection continuation and cancelled terminal record', () => {
    schemas.teamWorkflowInspectionSchema.parse({ ...inspection, total: 2, nextCursor: 0,
      record: { ...inspection.record, bounds: { ...plan.bounds, maxTasks: 2 } } })
    schemas.teamWorkflowInspectionSchema.parse({ ...inspection,
      record: { ...inspection.record, phase: 'cancelled', cancellation: reason } })
  })

  it('rejects conflicting integration paths outside a conflict result', () => {
    rejects(schemas.taskAttemptIntegrationResultSchema, { target: 'main', status: 'proposed', conflictPaths: ['src'] }, ['conflictPaths'])
  })

  it.each([{ stream: 'channel' }, { stream: 'team', channelId: 'channel' }])('requires audit channel identity to match $stream', (patch) => {
    rejects(schemas.teamAuditEntrySchema, { teamId: 'team', cursor: 0, type: 'team/created', createdAt: 0, facts: {}, ...patch }, ['channelId'])
  })

  it('requires a stall reason exactly when entering stalled phase', () => {
    rejects(schemas.teamPhaseTransitionInputSchema, { teamId: 'team', expectedCursor: 0, phase: 'stalled' }, ['reason'])
    rejects(schemas.teamPhaseTransitionInputSchema, { teamId: 'team', expectedCursor: 0, phase: 'active', reason }, ['reason'])
  })
})

describe('Team delivery and recovery evidence integrity', () => {
  it.each(['finalChannelId', 'humanId'])('requires both final selection fields when %s is present', (key) => {
    const scope = { kind: 'closure-fail-turn', teamId: 'team', expectedCursor: 0, coordinatorId: 'worker',
      activationId: 'epoch', sessionId: 'session', provider: 'local', turn: 0, reason }
    schemas.teamSystemClosureDriverScopeSchema.parse(scope)
    rejects(schemas.teamSystemClosureDriverScopeSchema, { ...scope, [key]: 'selected' }, ['finalChannelId'])
  })

  it('rejects supervisor generations or hosts that do not identify the recovered activation', () => {
    const binding = { activation: { id: 'epoch', teamId: 'team', participantId: 'worker', status: 'offline' },
      sessionId: 'session', provider: 'local', recovery: { kind: 'sdk-local-cold-replace', version: 1, runtimeProvider: 'local',
        profile: 'local', agent: { provider: 'mock', model: 'mock' }, process: { hostId: 'host', pid: 1, started: 'start' },
        supervisor: { name: 'supervisor', version: 1, hostId: 'host', endpointId: 'endpoint', generation: 'epoch', terminationMode: 'owned-process' } } }
    schemas.activationBindingSnapshotSchema.parse(binding)
    for (const patch of [{ hostId: 'other' }, { generation: 'other' }]) {
      rejects(schemas.activationBindingSnapshotSchema, { ...binding,
        recovery: { ...binding.recovery, supervisor: { ...binding.recovery.supervisor, ...patch } } }, ['recovery', 'supervisor'])
    }
    rejects(schemas.activationBindingSnapshotSchema, { ...binding, quiescedAt: 1, quiescenceSource: 'quiesced',
      quiescedWakeChannelIds: ['wake', 'wake'] }, ['quiescedWakeChannelIds'])
  })

  it.each(['teamId', 'channelId'])('rejects delivery projections from another %s', (key) => {
    const binding = { activation: { id: 'epoch', teamId: 'team', participantId: 'worker', status: 'idle' },
      sessionId: 'session', provider: 'local' }
    const adapter = { type: 'direct', version: 1 }
    const viewPolicy = { type: 'latest', version: 1 }
    const claim = { binding, envelopeId: 'envelope', delivery: 'turn',
      channel: { manifest: { id: 'channel', teamId: 'team', adapter, viewPolicy, limits: {}, participants: [{ id: 'worker', role: 'worker' }] },
        phase: 'active', cursor: 1 },
      view: { teamId: 'team', channelId: 'channel', adapter, viewPolicy, triggeringEnvelopeId: 'envelope',
        sourceEnvelopeIds: ['envelope'], delivery: 'turn', content: [{ type: 'text', text: 'Review' }] } }
    schemas.channelDeliveryClaimSchema.parse(claim)
    rejects(schemas.channelDeliveryClaimSchema, { ...claim, view: { ...claim.view, [key]: 'other' } }, ['view', key])
  })

  it('requires unique source Envelopes in durable summaries and summary commands', () => {
    const summary = { coveredSequenceRange: { from: 0, to: 1 }, sourceFingerprint: `sha256:${'a'.repeat(64)}`,
      sourceEnvelopeIds: ['envelope'], text: 'Summary', policy: { type: 'latest', version: 1 }, idempotencyKey: 'summary' }
    const command = { channelId: 'channel', expectedCursor: 1, ...summary }
    const record = { type: 'channel/summary', sequence: 2, createdAt: 0, ...summary }
    schemas.channelSummarizeInputSchema.parse(command)
    schemas.channelSummaryRecordSchema.parse(record)
    rejects(schemas.channelSummarizeInputSchema, { ...command, sourceEnvelopeIds: ['envelope', 'envelope'] }, ['sourceEnvelopeIds'])
    rejects(schemas.channelSummaryRecordSchema, { ...record, sourceEnvelopeIds: ['envelope', 'envelope'] }, ['sourceEnvelopeIds'])
  })

  it('rejects latency histogram buckets that depart from protocol boundaries', () => {
    const histogram = { count: 0, sumMs: 0,
      buckets: [...schemas.TEAM_LATENCY_BUCKETS_MS, null].map(upperBoundMs => ({ upperBoundMs, count: 0 })) }
    schemas.teamLatencyHistogramSchema.parse(histogram)
    rejects(schemas.teamLatencyHistogramSchema, { ...histogram, buckets: histogram.buckets.map((bucket, index) => (
      index === 0 ? { ...bucket, upperBoundMs: 7 } : bucket
    )) }, ['buckets', 0, 'upperBoundMs'])
  })

  it('rejects publishing private child artifacts and mismatched child admission lineage', () => {
    const receipt = { binding: childBinding, requestEnvelopeId: 'request', requestSequence: 1, responseEnvelopeId: 'response',
      responseSequence: 2, contentFingerprint: `sha256:${'a'.repeat(64)}`, text: 'Complete', artifacts: [],
      parentTaskRevision: 2, parentCursor: 3, admittedAt: 1 }
    schemas.teamDelegationResultAdmissionSchema.parse(receipt)
    rejects(schemas.teamDelegationResultAdmissionSchema, { ...receipt,
      artifacts: [{ id: 'secret', kind: 'report', uri: 'report:1', visibility: 'private' }] }, [])
    rejects(schemas.teamTaskSnapshotSchema, { ...task, execution: childExecution,
      delegation: { ...delegation, result: receipt } }, ['delegation', 'result'])
  })

  it('requires task record inspection counts to match the executor', () => {
    const { attemptHistory: _attemptHistory, reviewHistory: _reviewHistory, ...record } = task
    const inspection = { section: 'record', teamId: 'team', taskId: 'task', revision: 1, teamCursor: 0,
      task: record, history: { attempts: 0, reviews: 0 } }
    schemas.teamTaskInspectionSchema.parse(inspection)
    rejects(schemas.teamTaskInspectionSchema, { ...inspection, history: { attempts: 0, reviews: 1 } }, [])
    schemas.teamTaskInspectionSchema.parse({ ...inspection, task: { ...record, execution: childExecution, delegation } })
    for (const history of [{ attempts: 1, reviews: 0 }, { attempts: 0, reviews: 1 }]) {
      rejects(schemas.teamTaskInspectionSchema, { ...inspection, task: { ...record, execution: childExecution, delegation }, history }, [])
    }
  })
})

describe('Team terminal record integrity', () => {
  it('requires durable stop intent for cancellation after the attempt lease expires', () => {
    const attempt = { id: 'attempt', teamId: 'team', taskId: 'task', ordinal: 1, participantId: 'worker', activationId: 'epoch',
      assignedAt: 0, leaseExpiresAt: 10, settledAt: 10, outcome: { kind: 'cancelled' } }
    const settled = { ...task, revision: 3, phase: 'cancelled', attemptCount: 1, attemptHistory: [attempt] }
    const cancellation = { target: { kind: 'attempt', attemptId: 'attempt', participantId: 'worker', activationId: 'epoch' },
      requestedBy: 'worker', reason: 'Stop requested', requestedRevision: 2, requestedAt: 9 }
    schemas.teamTaskSnapshotSchema.parse({ ...settled, cancellation })
    rejects(schemas.teamTaskSnapshotSchema, settled, ['attemptHistory', 0, 'settledAt'])
    rejects(schemas.teamTaskSnapshotSchema, { ...settled,
      cancellation: { ...cancellation, target: { ...cancellation.target, attemptId: 'other' } } }, ['attemptHistory', 0, 'settledAt'])
  })

  it('retains a terminal child delegation after deleting its task', () => {
    schemas.teamTaskSnapshotSchema.parse({ ...task, phase: 'deleted', execution: childExecution,
      delegation: { ...delegation, phase: 'cancelled' } })
  })

  it('counts the current lease separately from settled history in task inspection', () => {
    const { attemptHistory: _attemptHistory, reviewHistory: _reviewHistory, ...record } = task
    const lease = { attemptId: 'attempt', assignedRevision: 1, ordinal: 1, participantId: 'worker',
      assignedAt: 0, renewedAt: 0, durationMs: 10, expiresAt: 10 }
    const value = { section: 'record', teamId: 'team', taskId: 'task', revision: 2, teamCursor: 1,
      task: { ...record, revision: 2, phase: 'assigned', attemptCount: 1, lease }, history: { attempts: 0, reviews: 0 } }
    schemas.teamTaskInspectionSchema.parse(value)
    rejects(schemas.teamTaskInspectionSchema, { ...value, history: { attempts: 1, reviews: 0 } }, [])
  })

  it('requires the terminal histogram bucket to account for every observed latency', () => {
    rejects(schemas.teamLatencyHistogramSchema, { count: 1, sumMs: 1,
      buckets: [...schemas.TEAM_LATENCY_BUCKETS_MS, null].map(upperBoundMs => ({ upperBoundMs, count: 0 })) }, ['buckets'])
  })
})
