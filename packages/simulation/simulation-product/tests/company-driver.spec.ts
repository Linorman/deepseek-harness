/** Production control batches separate scheduling, inference, effects, residency and completed retry. */
import { expect, it, vi } from 'vitest'
import { SimulationCompanyDriver, simulationCompanyDriverSchema } from '../src/company-driver.ts'
import { companyFixture, companySettings, companyConfig } from './company-driver-fixture.ts'

it.each(['json', 'sqlite'] as const)('runs real bounded procurement batches and preserves a completed retry (%s)', async (backend) => {
  const h = await companyFixture(backend)
  try {
    const before = h.run.snapshot()
    expect((await h.driver.advance()).reason).toBe('paused')
    expect(h.run.snapshot()).toEqual(before)
    expect(h.requests).toEqual([])
    await h.start()
    let result
    do {
      const pending = h.driver.advance()
      expect(h.driver.advance()).toBe(pending)
      result = await pending
      expect(result.controlSteps).toBeLessThanOrEqual(companyConfig.maxControlSteps)
      expect(['work-limit', 'completed']).toContain(result.reason)
    } while (result.reason !== 'completed')
    const completed = h.run.snapshot()
    expect(completed.resources['stock' as never]?.quantity).toBe('1')
    expect(completed.resources['received' as never]?.quantity).toBe('1')
    const calls = h.requests.length
    expect((await h.driver.advance()).reason).toBe('completed')
    expect(h.requests).toHaveLength(calls)
    expect(h.run.snapshot()).toEqual(completed)
  } finally { await h.close() }
})

it('refuses a changed model route or implementation version before activating an actor', async () => {
  const h = await companyFixture()
  try {
    expect(() => new SimulationCompanyDriver(h.run, h.connection, companySettings,
      { ...companyConfig, model: { provider: 'other', name: 'model' } }, h.lifetime.signal)).toThrow('model route differs')
    vi.spyOn(h.run, 'snapshot').mockReturnValueOnce({ ...h.run.snapshot(), spec: { ...h.run.snapshot().spec, rulesVersion: 'other' } })
    expect(() => new SimulationCompanyDriver(h.run, h.connection, companySettings, companyConfig, h.lifetime.signal))
      .toThrow('rules or policy version')
    expect(h.run.population().chargedActors).toBe(0)
  } finally { await h.close() }
})

it('rejects missing task readers, insufficient report capacity and changed prepared topology before activation', async () => {
  const h = await companyFixture()
  try {
    const tasks = simulationCompanyDriverSchema.parse({ ...companyConfig, tasks: { version: '1', cognition: 'deterministic',
      leaseDurationMs: 60000, maxAttempts: 2, retry: 'scene', review: 'buyer' } })
    expect(() => new SimulationCompanyDriver(h.run, h.connection, companySettings, tasks, h.lifetime.signal))
      .toThrow('canonical task reader')
    const reader = { readTask: h.ctx.teams.getTask.bind(h.ctx.teams) }
    const snapshot = h.run.snapshot()
    vi.spyOn(h.run, 'snapshot').mockReturnValueOnce({ ...snapshot,
      spec: { ...snapshot.spec, maxResidentActors: 1 } })
    expect(() => new SimulationCompanyDriver(h.run, h.connection, companySettings, tasks, h.lifetime.signal, reader))
      .toThrow('two resident actors')
    expect(() => new SimulationCompanyDriver(h.run, h.connection, { ...companySettings,
      topology: { actors: [], channels: [] } }, companyConfig, h.lifetime.signal))
      .toThrow('Workflow topology differs')
    expect(h.run.population().chargedActors).toBe(0)
  } finally { await h.close() }
})

it('does not infer without its initial complete checkpoint or after owner retirement', async () => {
  const h = await companyFixture('json', false)
  try {
    await h.start()
    expect((await h.driver.advance()).reason).toBe('recovery-required')
    expect(h.run.population().chargedActors).toBe(0)
    expect(h.requests).toEqual([])
    h.lifetime.abort(new Error('owner-retired'))
    await expect(h.driver.advance()).rejects.toThrow('owner-retired')
  } finally { await h.close() }
})

it('reuses a live submitted window after its completion response was lost', async () => {
  const h = await companyFixture()
  try {
    const execute = h.connection.executeDecision.bind(h.connection)
    vi.spyOn(h.connection, 'executeDecision').mockImplementationOnce(async (...args) => {
      await execute(...args)
      throw new Error('response-lost')
    })
    await h.start()
    await expect(h.driver.advance()).rejects.toThrow('response-lost')
    expect(h.requests).toHaveLength(3)
    const id = h.run.snapshot().activeWindowId
    expect(id).toBeDefined()
    await h.driver.advance()
    expect(h.requests.filter(value => value.stage === 'request')).toHaveLength(3)
    expect(h.run.snapshot().activeWindowId).toBeUndefined()
    expect(h.run.snapshot().decisions[id as never]?.status).toBe('accepted')
  } finally { await h.close() }
})

it('closes a cancelled live window without accepting its proposals', async () => {
  const h = await companyFixture()
  try {
    vi.spyOn(h.connection, 'executeDecision').mockImplementationOnce(async (entityId, id) => {
      await h.connection.cancelDecision(entityId, id)
      throw new Error('cancelled-before-model')
    })
    await h.start()
    await expect(h.driver.advance()).rejects.toThrow('cancelled-before-model')
    const id = h.run.snapshot().activeWindowId!
    await h.driver.advance()
    expect(h.run.snapshot().decisions[id as never]?.status).toBe('cancelled')
    expect(h.run.snapshot().decisions[id as never]?.operationIds).toEqual([])
  } finally { await h.close() }
})

it('honors a pause accepted while residency is being established', async () => {
  const h = await companyFixture()
  try {
    const resident = h.connection.ensureResident.bind(h.connection)
    vi.spyOn(h.connection, 'ensureResident').mockImplementationOnce(async (...args) => {
      const result = await resident(...args)
      await h.run.setPhase('paused', h.run.snapshot().revision)
      return result
    })
    await h.start()
    expect((await h.driver.advance()).reason).toBe('paused')
    expect(h.requests).toEqual([])
    expect(h.run.population().chargedActors).toBe(1)
  } finally { await h.close() }
})

it.each(['request', 'accept', 'transfer', 'result'])('does not advance a %s stage whose model submitted no required effect', async (stage) => {
  const h = await companyFixture('json', true, {}, (selected, proposals) => selected === stage ? [] : proposals)
  try {
    await h.start()
    let result
    do { result = await h.driver.advance() } while (result.reason === 'work-limit')
    expect(result.reason).toBe('scenario-blocked')
  } finally { await h.close() }
})

it('does not confuse a rejected operation with an applied effect', async () => {
  const h = await companyFixture('json', true, {}, (stage, proposals) => stage === 'request' ? [
    { after: [], action: { kind: 'resource/revoke-grant', id: 'missing-grant', expectedRevision: 1 } },
  ] : proposals)
  try {
    await h.start()
    let result
    do { result = await h.driver.advance() } while (result.reason === 'work-limit')
    expect(result.reason).toBe('scenario-blocked')
    expect(Object.values(h.run.snapshot().operations)[0]?.result?.status).toBe('rejected')
  } finally { await h.close() }
})

it('drains an admitted model batch while scheduling is paused', async () => {
  const h = await companyFixture()
  const gate = Promise.withResolvers<undefined>()
  const started = Promise.withResolvers<undefined>()
  try {
    const stream = h.adapter.stream.bind(h.adapter)
    vi.spyOn(h.adapter, 'stream').mockImplementationOnce(async function* (options) {
      started.resolve(undefined)
      await gate.promise
      yield* stream(options)
    })
    await h.start()
    const work = h.driver.advance()
    await started.promise
    let drained = false
    const draining = h.driver.drain().then(() => { drained = true })
    await Promise.resolve()
    expect(drained).toBe(false)
    await h.run.setPhase('paused', h.run.snapshot().revision)
    gate.resolve(undefined)
    expect((await work).reason).toBe('paused')
    await draining
    expect(drained).toBe(true)
    expect(h.requests).toHaveLength(1)
    expect(Object.values(h.run.snapshot().decisions)[0]?.status).toBe('cancelled')
  } finally { gate.resolve(undefined); await h.close() }
})

it('keeps a submitted proposal while paused and accepts its original window after resume', async () => {
  const h = await companyFixture()
  try {
    const execute = h.connection.executeDecision.bind(h.connection)
    vi.spyOn(h.connection, 'executeDecision').mockImplementationOnce(async (...args) => {
      const result = await execute(...args)
      await h.run.setPhase('paused', h.run.snapshot().revision)
      return result
    })
    await h.start()
    const stopped = await h.driver.advance()
    expect(stopped.reason).toBe('paused')
    expect(stopped.interruption).toBeUndefined()
    expect(h.run.snapshot().decisions[stopped.decisionId!]?.status).toBe('submitted')
    expect(h.requests).toHaveLength(3)
    await h.run.setPhase('running', h.run.snapshot().revision)
    await h.driver.advance()
    expect(h.run.snapshot().decisions[stopped.decisionId!]?.status).toBe('accepted')
    expect(h.requests.filter(value => value.stage === 'request')).toHaveLength(3)
  } finally { await h.close() }
})

it('reports the pause when it is accepted before queued window acceptance', async () => {
  const h = await companyFixture()
  try {
    vi.spyOn(h.run, 'commitWindow').mockImplementationOnce(async () => {
      await h.run.setPhase('paused', h.run.snapshot().revision)
      throw new Error('acceptance-paused')
    })
    await h.start()
    const stopped = await h.driver.advance()
    expect(stopped.reason).toBe('paused')
    expect(h.run.snapshot().decisions[stopped.decisionId!]?.status).toBe('submitted')
  } finally { await h.close() }
})

it('propagates a failed model batch after an independent cancellation instead of inventing completion', async () => {
  const h = await companyFixture()
  try {
    vi.spyOn(h.connection, 'executeDecision').mockImplementationOnce(async (entityId, id) => {
      await h.run.setPhase('paused', h.run.snapshot().revision)
      await h.connection.cancelDecision(entityId, id)
      throw new Error('independent-cancellation')
    })
    await h.start()
    await expect(h.driver.advance()).rejects.toThrow('independent-cancellation')
  } finally { await h.close() }
})

it.each(['capacity', 'recovery-required'] as const)('projects %s residency without opening a model window', async (status) => {
  const h = await companyFixture()
  try {
    vi.spyOn(h.connection, 'ensureResident').mockResolvedValueOnce({ status, entityId: 'buyer' as never })
    await h.start()
    const result = await h.driver.advance()
    expect(result).toMatchObject({ reason: status === 'capacity' ? 'resident-capacity' : 'recovery-required', stage: 'request', entityId: 'buyer' })
    expect(h.requests).toEqual([])
  } finally { await h.close() }
})

it.each(['current', 'future'] as const)('retains %s transport retry facts without claiming business progress', async (scope) => {
  const h = await companyFixture()
  try {
    const original = h.connection.driveResident.bind(h.connection)
    const result = { reason: 'retry' as const, nextAttemptAt: 100, operationId: 'pending-operation' as never,
      steps: 0, rounds: 1, revision: h.run.snapshot().revision }
    if (scope === 'current') vi.spyOn(h.connection, 'driveResident').mockResolvedValueOnce(result)
    else vi.spyOn(h.connection, 'driveResident').mockImplementation(async (...args) => {
      return args[0].until === h.run.snapshot().time ? await original(...args) : result
    })
    await h.start()
    let observed
    do { observed = await h.driver.advance() } while (observed.reason === 'work-limit')
    expect(observed).toMatchObject({ reason: 'retry', nextAttemptAt: 100, operationId: 'pending-operation' })
    expect(observed).not.toHaveProperty('rounds')
  } finally { await h.close() }
})

it.each(['foreign-window', 'multiple-actors', 'foreign-context'] as const)('refuses %s before issuing its model request', async (kind) => {
  const h = await companyFixture()
  try {
    await h.start()
    const ids = kind === 'multiple-actors' ? ['buyer', 'supplier'] : ['buyer']
    for (const id of ids) await h.connection.ensureResident(id as never, { activation: { provider: 'in-process', seed: { kind: 'fresh' },
      agent: { preset: 'simulation', options: { provider: 'company', model: 'scripted' } }, signal: h.lifetime.signal }, evict: [] })
    const context = { personaVersion: kind === 'foreign-context' ? 'other/1' : 'company/1', modelVersion: 'company/scripted',
      sources: [{ kind: 'run-event' as const, runId: h.run.snapshot().spec.runId, sequence: h.run.snapshot().revision }],
      sections: (['identity', 'authority', 'input', 'goals', 'commitments'] as const)
        .map(kind => ({ kind, required: true, blocks: [{ type: 'text' as const, text: 'External preparation' }] })) }
    await h.connection.openWindow({ id: 'external' as never, decisions: ids.map((id, index) => ({
      id: (kind === 'foreign-window' ? `other/${index}` : `company/1/request/${index}`) as never,
      entityId: id as never, context })) })
    expect((await h.driver.advance()).reason).toBe('recovery-required')
    expect(h.requests).toEqual([])
  } finally { await h.close() }
})

it('reuses the claimed recipient wake on a live acceptance response retry', async () => {
  const h = await companyFixture()
  try {
    const execute = h.connection.executeDecision.bind(h.connection)
    let failed = false
    vi.spyOn(h.connection, 'executeDecision').mockImplementation(async (...args) => {
      const result = await execute(...args)
      if (!failed && args[1].startsWith('company/1/accept/')) { failed = true; throw new Error('acceptance-response-lost') }
      return result
    })
    await h.start()
    await expect((async () => { while (true) await h.driver.advance() })()).rejects.toThrow('acceptance-response-lost')
    const id = h.run.snapshot().activeWindowId!
    expect(h.run.snapshot().decisions[id as never]?.wakeId).toBeDefined()
    await h.driver.advance()
    expect(h.run.snapshot().decisions[id as never]?.status).toBe('accepted')
    expect(h.requests.filter(value => value.stage === 'accept')).toHaveLength(3)
  } finally { await h.close() }
})

it('handles current inputs and equal-time scheduled events before finishing procurement', async () => {
  const h = await companyFixture()
  try {
    await h.run.ingest({ id: 'now' as never, entityId: 'buyer' as never, source: 'operator', text: 'INPUT_ZERO', availableAt: '0' as never })
    await h.run.ingest({ id: 'later' as never, entityId: 'buyer' as never, source: 'operator', text: 'INPUT_FIVE', availableAt: '5' as never })
    await h.start()
    let result
    do { result = await h.driver.advance() } while (result.reason === 'work-limit')
    expect(result.reason, JSON.stringify({ stages: h.requests.map(value => value.stage),
      wakes: h.run.snapshot().wakes, operations: Object.values(h.run.snapshot().operations).map(value => ({ action: value.action.kind,
        result: value.result?.status, receipt: value.delivery?.receipt !== undefined })) })).toBe('completed')
    expect(Object.values(h.run.snapshot().decisions).filter(value => value.ingressId !== undefined && value.status === 'accepted')).toHaveLength(2)
  } finally { await h.close() }
})

it('blocks an accepted request lacking its required communication instead of guessing delivery', async () => {
  const h = await companyFixture('json', true, {}, (stage, proposals) => stage === 'request' ? proposals.slice(0, 1) : proposals)
  try {
    await h.start()
    let result
    do { result = await h.driver.advance() } while (result.reason === 'work-limit')
    expect(result.reason).toBe('scenario-blocked')
  } finally { await h.close() }
})

it('does not spin or advance time after all outstanding delivery events were explicitly cancelled', async () => {
  const h = await companyFixture()
  try {
    const driver = new SimulationCompanyDriver(h.run, h.connection, companySettings, { ...companyConfig, maxControlSteps: 1 },
      h.lifetime.signal)
    await h.start()
    await driver.advance()
    const original = h.connection.driveResident.bind(h.connection)
    vi.spyOn(h.connection, 'driveResident').mockImplementationOnce(async (...args) => {
      const result = await original(...args)
      for (const event of Object.values(h.run.snapshot().scheduledEvents)) {
        if (event.status === 'pending') await h.run.cancelEvent(event.id, 'operator-cancelled', h.run.snapshot().revision)
      }
      return result
    })
    expect((await driver.advance()).reason).toBe('scenario-blocked')
    expect(h.run.snapshot().time).toBe('0')
  } finally { await h.close() }
})

it('handles a pause during a retried live window without replacing its submission', async () => {
  const h = await companyFixture()
  try {
    const execute = h.connection.executeDecision.bind(h.connection)
    vi.spyOn(h.connection, 'executeDecision').mockImplementationOnce(async (...args) => {
      await execute(...args); throw new Error('lost-response')
    }).mockImplementationOnce(async (...args) => {
      const result = await execute(...args)
      await h.run.setPhase('paused', h.run.snapshot().revision)
      return result
    })
    await h.start()
    await expect(h.driver.advance()).rejects.toThrow('lost-response')
    expect((await h.driver.advance()).reason).toBe('paused')
    expect(h.requests).toHaveLength(3)
  } finally { await h.close() }
})

it('establishes a due recipient during current-time transport coordination', async () => {
  const h = await companyFixture()
  try {
    const driver = new SimulationCompanyDriver(h.run, h.connection, companySettings, { ...companyConfig, requestDelay: '0' as never },
      h.lifetime.signal)
    await h.start()
    let result
    do { result = await driver.advance() } while (result.reason === 'work-limit')
    expect(result.reason).toBe('completed')
    expect(h.run.snapshot().time).toBe('1')
  } finally { await h.close() }
})

it('sorts earlier and equal-time inputs added after the request was accepted', async () => {
  const h = await companyFixture()
  try {
    const driver = new SimulationCompanyDriver(h.run, h.connection, companySettings, { ...companyConfig, maxControlSteps: 1 },
      h.lifetime.signal)
    await h.start()
    await driver.advance()
    await h.run.ingest({ id: 'earlier' as never, entityId: 'buyer' as never, source: 'operator', text: 'EARLIER', availableAt: '1' as never })
    await h.run.ingest({ id: 'equal' as never, entityId: 'buyer' as never, source: 'operator', text: 'EQUAL', availableAt: '5' as never })
    let result
    do { result = await driver.advance() } while (result.reason === 'work-limit')
    expect(result.reason).toBe('completed')
  } finally { await h.close() }
})

it('requires the versioned one-unit fulfillment policy instead of accepting a different request', async () => {
  const h = await companyFixture('json', true, {}, (stage, proposals) => {
    if (stage !== 'request') return proposals
    return [{ after: [], action: { kind: 'interaction/request', id: 'purchase', assignee: 'supplier', description: 'Two units',
      replyBy: '20', completeBy: '30', fulfillment: { kind: 'transfer', from: 'stock', to: 'received', quantity: '2' } } }, ...proposals.slice(1)]
  })
  try {
    await h.start()
    let result
    do { result = await h.driver.advance() } while (result.reason === 'work-limit')
    expect(result.reason).toBe('scenario-blocked')
  } finally { await h.close() }
})

it('waits for a publication receipt before exposing its recipient decision', async () => {
  const h = await companyFixture()
  try {
    const driver = new SimulationCompanyDriver(h.run, h.connection, companySettings, { ...companyConfig, maxControlSteps: 1 },
      h.lifetime.signal)
    await h.start()
    await driver.advance()
    const native = await h.run.drive({ until: '5' as never })
    expect(native.reason).toBe('dispatch-required')
    await h.connection.dispatchOperation(native.operationId!, Date.now)
    expect(h.run.snapshot().operations[native.operationId!]?.result?.status).toBe('applied')
    expect(h.run.snapshot().operations[native.operationId!]?.delivery).toBeUndefined()
    vi.spyOn(h.connection, 'driveResident').mockResolvedValueOnce({ reason: 'decision-required', rounds: 1,
      steps: 0, revision: h.run.snapshot().revision })
    expect((await driver.advance()).reason).toBe('work-limit')
    expect(h.requests.filter(value => value.stage === 'accept')).toEqual([])
  } finally { await h.close() }
})

it('blocks a required delivery wake consumed by another decision', async () => {
  const h = await companyFixture()
  try {
    await h.start()
    await h.driver.advance()
    const post = Object.values(h.run.snapshot().operations).find(value => value.action.kind === 'communication/post')!
    expect(post.delivery?.receipt).toBeDefined()
    const id = 'outside-driver' as never
    await h.connection.openDecision('supplier' as never, id, post.delivery!.wakeId)
    await h.connection.submitDecision('supplier' as never, id, [])
    expect(h.run.snapshot().wakes[post.delivery!.wakeId]?.status).toBe('completed')
    expect((await h.driver.advance()).reason).toBe('scenario-blocked')
  } finally { await h.close() }
})
