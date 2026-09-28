import { describe, expect, it } from 'vitest'
import { simulationTaskReconcileRequestSchema, simulationWindowRequestSchema } from '@clocky/clocky-simulation'
import { contextRequest } from './context-fixture.ts'
import { createBusinessHarness } from './business-harness.ts'

describe.each(['json', 'sqlite'] as const)('%s task evidence', (backend) => {
  it.each(['explicit', 'transfer', 'task-completed'] as const)('keeps task execution separate from %s fulfillment across restart', async (kind) => {
    const h = await createBusinessHarness(backend)
    try {
      const a = await h.actor('a'), b = await h.actor('b')
      await h.account('stock', b.id, '10'); await h.account('received', a.id, '0')
      const request = await h.apply(a.lease, 'request', { kind: 'interaction/request', id: 'order', assignee: b.id,
        description: 'Deliver goods', replyBy: null, completeBy: null,
        fulfillment: kind === 'transfer' ? { kind, from: 'stock', to: 'received', quantity: '1' } : { kind } })
      expect(request.status).toBe('applied')
      expect((await h.apply(b.lease, 'accept', { kind: 'interaction/accept', id: 'order', expectedRevision: 1 })).status).toBe('applied')
      let interaction = Object.values(h.run.snapshot().interactions)[0]!
      for (const [index, phase] of ['running', 'review', 'assigned', 'running', 'completed'].entries()) {
        const evidence = simulationTaskReconcileRequestSchema.parse({ interactionId: interaction.id, expectedRevision: interaction.revision,
          task: { teamId: 'company', taskId: 'task-1', revision: index + 1, phase } })
        interaction = await h.run.reconcileTask(evidence)
        expect(interaction.execution).toBe('task')
        expect(interaction.task?.phase).toBe(phase)
        expect(await h.run.reconcileTask(evidence)).toEqual(interaction)
        expect(h.run.snapshot().commitments[interaction.commitmentId!]!.phase)
          .toBe(kind === 'task-completed' && phase === 'completed' ? 'fulfilled' : 'open')
      }
      const commitment = h.run.snapshot().commitments[interaction.commitmentId!]!
      expect(commitment.taskEvidence?.revision).toBe(kind === 'task-completed' ? 5 : undefined)
      expect(commitment.evidence).toEqual([])
      for (const lease of h.leases) { await lease.revoke(); await lease.release() }
      await h.run.close()
      const restored = await h.provider.open({ ...h.selection, mode: 'open' })
      try {
        expect(restored.snapshot().interactions[interaction.id]).toEqual(interaction)
        expect(restored.snapshot().commitments[commitment.id]).toEqual(commitment)
      } finally { await restored.close() }
    } finally { await h.close() }
  })

  it('rejects changed identities, stale revisions, foreign Teams and changed facts at one task revision', async () => {
    const h = await createBusinessHarness(backend)
    try {
      const a = await h.actor('a'), b = await h.actor('b')
      await h.apply(a.lease, 'request', { kind: 'interaction/request', id: 'order', assignee: b.id,
        description: 'Review work', replyBy: null, completeBy: null, fulfillment: { kind: 'task-completed' } })
      const evidence = simulationTaskReconcileRequestSchema.parse({ interactionId: 'order', expectedRevision: 2,
        task: { teamId: 'company', taskId: 'task-1', revision: 2, phase: 'review' } })
      await expect(h.run.reconcileTask(evidence)).rejects.toThrow(/accepted interaction/)
      await h.apply(b.lease, 'accept', { kind: 'interaction/accept', id: 'order', expectedRevision: 1 })
      await expect(h.run.reconcileTask(simulationTaskReconcileRequestSchema.parse({ ...evidence,
        task: { ...evidence.task, teamId: 'foreign' } }))).rejects.toThrow(/another Team/)
      const linked = await h.run.reconcileTask(evidence)
      await expect(h.run.reconcileTask({ ...evidence, task: { ...evidence.task, phase: 'completed' } })).rejects.toThrow(/changed its evidence/)
      await expect(h.run.reconcileTask({ ...evidence, task: { ...evidence.task, revision: 1 } })).rejects.toThrow(/revision conflict/)
      await expect(h.run.reconcileTask({ ...evidence, task: { ...evidence.task, revision: 3 } })).rejects.toThrow(/revision conflict/)
      await expect(h.run.reconcileTask(simulationTaskReconcileRequestSchema.parse({ ...evidence,
        task: { ...evidence.task, taskId: 'other' } }))).rejects.toThrow(/identity/)
      expect((await h.apply(a.lease, 'cancel', { kind: 'interaction/cancel', id: 'order', expectedRevision: linked.revision,
        reason: 'Withdraw responsibility' })).status).toBe('applied')
      const cancelled = h.run.snapshot().interactions[linked.id]!
      await h.run.reconcileTask({ ...evidence, expectedRevision: cancelled.revision, task: { ...evidence.task, revision: 3, phase: 'completed' } })
      expect(h.run.snapshot().commitments[linked.commitmentId!]!.phase).toBe('cancelled')
      expect(h.run.snapshot().interactions[linked.id]!.task?.phase).toBe('completed')
      await h.run.openWindow(simulationWindowRequestSchema.parse({ id: 'frozen', decisions: [
        { id: 'decision', entityId: a.id, context: contextRequest() },
      ] }), h.run.snapshot().revision)
      await expect(h.run.reconcileTask({ ...evidence, expectedRevision: h.run.snapshot().interactions[linked.id]!.revision,
        task: { ...evidence.task, revision: 4, phase: 'deleted' } })).rejects.toThrow(/closed decision windows/)
    } finally { await h.close() }
  })
})

it.each(['json', 'sqlite'] as const)('%s retains breach evidence when a linked task completes late', async (backend) => {
  const h = await createBusinessHarness(backend)
  try {
    const a = await h.actor('a'), b = await h.actor('b')
    await h.apply(a.lease, 'request-late', { kind: 'interaction/request', id: 'late', assignee: b.id,
      description: 'Deliver before the deadline', replyBy: null, completeBy: '5', fulfillment: { kind: 'task-completed' } })
    await h.apply(b.lease, 'accept-late', { kind: 'interaction/accept', id: 'late', expectedRevision: 1 })
    const evidence = simulationTaskReconcileRequestSchema.parse({ interactionId: 'late', expectedRevision: 2,
      task: { teamId: 'company', taskId: 'late-task', revision: 1, phase: 'running' } })
    const linked = await h.run.reconcileTask(evidence)
    const { foldTaskEvidence } = await import('../src/task-evidence.ts')
    const state = h.run.snapshot()
    expect(foldTaskEvidence(state, { kind: 'task/reconciled', request: evidence })).toBe(state)
    const { simTimeSchema } = await import('@clocky/clocky-simulation')
    await h.run.drive({ until: simTimeSchema.parse('5') })
    expect(h.run.snapshot().commitments[linked.commitmentId!]).toMatchObject({ phase: 'open', breachedAt: '5' })
    await h.run.reconcileTask({ ...evidence, expectedRevision: linked.revision, task: { ...evidence.task, revision: 2, phase: 'completed' } })
    const fulfilled = h.run.snapshot().commitments[linked.commitmentId!]!
    expect(fulfilled).toMatchObject({ phase: 'fulfilled', breachedAt: '5', fulfilledAt: '5', taskEvidence: { revision: 2, phase: 'completed' } })
    for (const lease of h.leases) { await lease.revoke(); await lease.release() }
    await h.run.close()
    const restored = await h.provider.open({ ...h.selection, mode: 'open' })
    try { expect(restored.snapshot().commitments[fulfilled.id]).toEqual(fulfilled) }
    finally { await restored.close() }
  } finally { await h.close() }
})

it.each(['confirmed', 'cancelled'] as const)('refuses a first task link after local execution is %s', async (ending) => {
  const h = await createBusinessHarness('sqlite')
  try {
    const a = await h.actor('a'), b = await h.actor('b')
    await h.apply(a.lease, 'request', { kind: 'interaction/request', id: 'work', assignee: b.id,
      description: 'Local execution', replyBy: null, completeBy: null, fulfillment: { kind: 'explicit' } })
    await h.apply(b.lease, 'accept', { kind: 'interaction/accept', id: 'work', expectedRevision: 1 })
    await h.apply(a.lease, 'finish', ending === 'confirmed' ? { kind: 'interaction/confirm', id: 'work', expectedRevision: 2 }
      : { kind: 'interaction/cancel', id: 'work', expectedRevision: 2, reason: 'Withdraw work' })
    const before = h.run.snapshot()
    await expect(h.run.reconcileTask(simulationTaskReconcileRequestSchema.parse({ interactionId: 'work', expectedRevision: 3,
      task: { teamId: 'company', taskId: 'task', revision: 1, phase: 'completed' } }))).rejects.toThrow(/cannot replace completed or cancelled/)
    expect(h.run.snapshot()).toEqual(before)
  } finally { await h.close() }
})

it('detects lost task/commitment relationships without accepting substituted completion evidence', async () => {
  const h = await createBusinessHarness('sqlite')
  try {
    const a = await h.actor('a'), b = await h.actor('b')
    await h.apply(a.lease, 'request', { kind: 'interaction/request', id: 'work', assignee: b.id,
      description: 'Task execution', replyBy: null, completeBy: null, fulfillment: { kind: 'task-completed' } })
    await h.apply(b.lease, 'accept', { kind: 'interaction/accept', id: 'work', expectedRevision: 1 })
    const evidence = simulationTaskReconcileRequestSchema.parse({ interactionId: 'work', expectedRevision: 2,
      task: { teamId: 'company', taskId: 'task', revision: 1, phase: 'completed' } })
    const linked = await h.run.reconcileTask(evidence)
    const state = h.run.snapshot(), obligation = state.commitments[linked.commitmentId!]!
    const { assertTaskEvidence } = await import('../src/task-evidence.ts')
    const { teamIdSchema, teamTaskIdSchema } = await import('@clocky/clocky-team')
    const { task: _task, ...withoutTask } = linked
    const { commitmentId: _commitment, ...withoutCommitment } = linked
    const { taskEvidence: _evidence, ...withoutEvidence } = obligation
    for (const interaction of [
      { ...linked, execution: 'pending' as const }, withoutTask,
      { ...linked, task: { ...evidence.task, teamId: teamIdSchema.parse('foreign') } },
      { ...linked, reply: 'pending' as const }, withoutCommitment,
    ]) expect(() => { assertTaskEvidence({ ...state, interactions: { [linked.id]: interaction } }) }).toThrow()
    expect(() => { assertTaskEvidence({ ...state, commitments: {} }) }).toThrow(/lost its commitment/)
    for (const taskEvidence of [
      undefined, { ...evidence.task, phase: 'review' as const }, { ...evidence.task, revision: 2 },
      { ...evidence.task, taskId: teamTaskIdSchema.parse('foreign') }, { ...evidence.task, teamId: teamIdSchema.parse('foreign') },
    ]) expect(() => {
      const changed = taskEvidence === undefined ? withoutEvidence : { ...obligation, taskEvidence }
      assertTaskEvidence({ ...state, commitments: { [obligation.id]: changed } })
    }).toThrow()
    expect(() => { assertTaskEvidence({ ...state, commitments: { [obligation.id]: { ...obligation, phase: 'open' } } }) }).toThrow(/completed source/)
    expect(() => { assertTaskEvidence({ ...state, interactions: { [linked.id]: { ...linked, fulfillment: { kind: 'explicit' } } } }) }).toThrow(/completed source/)
  } finally { await h.close() }
})
