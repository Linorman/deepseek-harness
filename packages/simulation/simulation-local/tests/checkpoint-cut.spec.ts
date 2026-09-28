import { describe, expect, it, vi } from 'vitest'
import { teamTaskIdSchema } from '@clocky/clocky-team'
import { simulationIngressRequestSchema, simulationPhaseManagementRequestSchema, simTimeSchema } from '@clocky/clocky-simulation'
import type { SimulationTaskTransport } from '@clocky/clocky-simulation'
import { createBusinessHarness } from './business-harness.ts'

describe.each(['json', 'sqlite'] as const)('%s checkpoint cut', (backend) => {
  it('seals a paused writer-free state, blocks mutation and releases admission idempotently', async () => {
    const h = await createBusinessHarness(backend)
    try {
      await expect(h.run.acquireCheckpointCut(0)).rejects.toThrow(/positive safe integer/)
      await expect(h.run.acquireCheckpointCut(4)).rejects.toThrow(/paused scheduling/)
      await h.run.setPhase('paused', h.run.snapshot().revision)
      const cut = await h.run.acquireCheckpointCut(4)
      try {
        expect(cut.snapshot).toEqual(h.run.snapshot())
        expect(await h.run.getPersistenceReference(cut.reference.cursor)).toEqual(cut.reference)
        await expect(h.run.acquireCheckpointCut(4)).rejects.toThrow(/already held/)
        await expect(h.run.setPhase('running', cut.snapshot.revision)).rejects.toThrow(/blocks new writes/)
        const { simulationOperationIdSchema } = await import('@clocky/clocky-simulation')
        await expect(h.run.dispatchOperation(simulationOperationIdSchema.parse('blocked'), {
          createTask: async () => ({ status: 'rejected', code: 'UNREACHED' }),
        }, () => 100)).rejects.toThrow(/blocks new dispatch/)
        await expect(h.run.close()).rejects.toThrow(/Release/)
        expect(h.run.snapshot()).toEqual(cut.snapshot)
      } finally { cut.release(); cut.release() }
      const next = await h.run.acquireCheckpointCut(4)
      try {
        cut.release()
        await expect(h.run.setPhase('running', h.run.snapshot().revision)).rejects.toThrow(/blocks new writes/)
      } finally { next.release() }
      await h.run.setPhase('running', h.run.snapshot().revision)
      expect(h.run.snapshot().phase).toBe('running')
    } finally { await h.close() }
  })

  it('drains an admitted target call and writer retirement while rejecting new input', async () => {
    const h = await createBusinessHarness(backend)
    try {
      const actor = await h.actor('a')
      const decision = await h.submit(actor.lease, 'task', [{ after: [], action: { kind: 'task/create', deliverAt: '0', task: {
        subject: 'Task', description: 'Drain target IO', blockedBy: [], requiredCapabilities: [], priority: 0,
        readScopes: [], writeScopes: [], workspaceMode: 'shared', reviewPolicy: { kind: 'none' }, budget: {}, maxAttempts: 1,
      } } }])
      const id = decision.operationIds[0]!
      await h.run.drive({ until: simTimeSchema.parse('0') })
      const entered = Promise.withResolvers<undefined>()
      const release = Promise.withResolvers<undefined>()
      const transport: SimulationTaskTransport = { createTask: async (message) => {
        entered.resolve(undefined)
        await release.promise
        return { status: 'applied', taskReceipt: { operationId: message.operationId, fingerprint: message.fingerprint,
          teamId: message.sender.teamId, taskId: teamTaskIdSchema.parse('drained-task') } }
      } }
      const dispatch = h.run.dispatchOperation(id, transport, () => 100)
      await entered.promise
      await h.run.setPhase('paused', h.run.snapshot().revision)
      const pending = h.run.acquireCheckpointCut(4)
      const ingress = simulationIngressRequestSchema.parse({ id: 'external', entityId: actor.id, source: 'test', text: 'After cut', availableAt: '0' })
      await expect(h.run.ingest(ingress)).rejects.toThrow(/blocks new writes/)
      await actor.lease.revoke(); await actor.lease.release()
      release.resolve(undefined)
      await dispatch
      const cut = await pending
      try {
        expect(cut.snapshot.operations[id]?.result?.status).toBe('applied')
        expect(cut.snapshot.entities[actor.id]?.writer?.phase).toBe('released')
        await expect(actor.lease.revoke()).rejects.toThrow(/blocks new writes/)
      } finally { cut.release() }
      await h.run.ingest(ingress)
      expect(Object.keys(h.run.snapshot().ingresses ?? {})).toHaveLength(1)
    } finally { await h.close() }
  })

  it('cancels acquisition without cancelling a previously admitted storage write', async () => {
    const h = await createBusinessHarness(backend)
    try {
      const stream = (h.run as unknown as { stream: import('@clocky/clocky-storage').LogStream }).stream
      const append = stream.append.bind(stream)
      const entered = Promise.withResolvers<undefined>(), release = Promise.withResolvers<undefined>()
      const held = vi.spyOn(stream, 'append').mockImplementationOnce(async (...args) => {
        entered.resolve(undefined)
        await release.promise
        return await append(...args)
      })
      const pause = h.run.setPhase('paused', h.run.snapshot().revision)
      await entered.promise
      const controller = new AbortController()
      const acquisition = h.run.acquireCheckpointCut(4, controller.signal)
      controller.abort(new Error('Collector cancelled'))
      await expect(acquisition).rejects.toThrow(/Collector cancelled/)
      release.resolve(undefined)
      await pause
      held.mockRestore()
      const cut = await h.run.acquireCheckpointCut(4)
      cut.release()
      expect(h.run.snapshot().phase).toBe('paused')
    } finally { await h.close() }
  })

  it('refuses to seal an interrupted phase-management request', async () => {
    const h = await createBusinessHarness(backend)
    try {
      const stream = (h.run as unknown as { stream: import('@clocky/clocky-storage').LogStream }).stream
      const append = stream.append.bind(stream)
      const fault = vi.spyOn(stream, 'append').mockImplementation(async (cursor, values, options) => {
        if (JSON.stringify(values).includes('management/completed')) throw new Error('Management outcome not written')
        return await append(cursor, values, options)
      })
      const request = simulationPhaseManagementRequestSchema.parse({ id: 'pause', phase: 'paused' })
      await expect(h.run.managePhase(request)).rejects.toThrow(/not written/)
      fault.mockRestore()
      await expect(h.run.acquireCheckpointCut(4)).rejects.toThrow(/unfinished phase-management/)
      await h.run.managePhase(request)
      const cut = await h.run.acquireCheckpointCut(4)
      cut.release()
    } finally { await h.close() }
  })

  it('drops a failed barrier without hiding an unreleased writer', async () => {
    const h = await createBusinessHarness(backend)
    try {
      const actor = await h.actor('a')
      await h.run.setPhase('paused', h.run.snapshot().revision)
      await expect(h.run.acquireCheckpointCut(4)).rejects.toThrow(/retired writers/)
      await actor.lease.revoke(); await actor.lease.release()
      const cut = await h.run.acquireCheckpointCut(4)
      cut.release()
    } finally { await h.close() }
  })
})

it('bounds a changing retirement queue without cancelling accepted cleanup', async () => {
  const h = await createBusinessHarness('sqlite')
  try {
    const actor = await h.actor('a')
    await h.run.setPhase('paused', h.run.snapshot().revision)
    const stream = (h.run as unknown as { stream: import('@clocky/clocky-storage').LogStream }).stream
    const append = stream.append.bind(stream)
    const entered = Promise.withResolvers<undefined>(), release = Promise.withResolvers<undefined>()
    let retirement: Promise<void> | undefined
    const held = vi.spyOn(stream, 'append').mockImplementationOnce(async (...args) => {
      entered.resolve(undefined)
      await release.promise
      const result = await append(...args)
      retirement = actor.lease.release()
      return result
    })
    const revocation = actor.lease.revoke()
    await entered.promise
    const collecting = h.run.acquireCheckpointCut(1)
    const rejected = expect(collecting).rejects.toThrow(/retirement queue did not stabilize/)
    await new Promise<void>(resolve => setImmediate(resolve))
    release.resolve(undefined)
    await revocation; await rejected; await retirement
    held.mockRestore()
    expect(h.run.snapshot().entities[actor.id]?.writer?.phase).toBe('released')
    const cut = await h.run.acquireCheckpointCut(1)
    cut.release()
  } finally { await h.close() }
})
