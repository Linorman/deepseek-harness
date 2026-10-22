/** Original judge execution proves identity, idempotency, stale-view refusal and source preservation. */
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { expect, it, vi } from 'vitest'
import { z } from 'zod'
import { HarborCase } from '../src/harbor-case.ts'
import { harborRequestSchema, HARBOR_PIN } from '../src/harbor-protocol.ts'
import { HarborNativeDomain } from '../src/harbor-domain.ts'
import { simulationWorldDomainRequestSchema } from '@clocky/clocky-simulation'
import type { SimulationSnapshot } from '@clocky/clocky-simulation'

it('uses an unchanged judge and retains exactly one actor decision across retries', async () => {
  const root = await mkdtemp(resolve('.tmp/harbor-adapter-'))
  const source = resolve('test-cases/harbor-society-365')
  const manifest = await readFile(resolve(source, 'manifest.json'), 'utf8')
  const judge = new HarborCase(source, root, 'native-run', new AbortController().signal)
  try {
    const original = await judge.overview()
    const view = z.object({ viewId: z.string(), actor: z.literal('coop'),
      self: z.object({ cash: z.number().positive() }) }).parse(await judge.view('coop'))
    const command = { kind: 'act' as const, viewId: view.viewId,
      rationale: 'A real fixture decision transfers one credit to verify the original conservation rules.',
      actions: [{ kind: 'transfer' as const, to: 'clinic', resource: 'cash' as const, quantity: 1 }] }
    const first = await judge.execute('original-intent', 'coop', 'team/session-coop', command)
    expect(first.ok).toBe(true)
    expect(await judge.execute('original-intent', 'coop', 'team/session-coop', command)).toEqual(first)
    const changed = await judge.overview()
    expect(changed.revision).toBe(original.revision + 1)
    const rejected = await judge.execute('stale-intent', 'coop', 'team/session-coop', command)
    expect(rejected.ok).toBe(false)
    expect(await judge.overview()).toEqual(changed)
    await expect(judge.execute('original-intent', 'coop', 'different-session', command)).rejects.toThrow('original input')
    const history = (await readFile(resolve(judge.directory, 'output/journal.jsonl'), 'utf8')).trim().split('\n').map(line => z.object({ kind: z.string(), payload: z.looseObject({ teamIdentity: z.string().optional() }) }).parse(JSON.parse(line)))
    expect(history.filter(event => event.kind === 'decision')).toHaveLength(1)
    expect(history[1]?.payload.teamIdentity).toBe('team/session-coop')
    expect(await readFile(resolve(judge.directory, 'manifest.json'), 'utf8')).toBe(manifest)
    expect(await readFile(resolve(source, 'manifest.json'), 'utf8')).toBe(manifest)
    const audit = await judge.execute('audit', 'coordinator', 'team/session-coordinator', { kind: 'audit' })
    expect(audit.receipt.audit).toMatchObject({ kind: 'report', checks: { worldIntegrity: true, horizon: false }, mechanicallyComplete: false })
  } finally { await rm(root, { recursive: true, force: true }) }
})

it('rejects executable paths and empty case actions at the command boundary', () => {
  expect(harborRequestSchema.safeParse({ scopeEntityId: 'harbor', targetEntityId: 'harbor-environment',
    command: { kind: 'advance', day: 7, executable: '/bin/sh' } }).success).toBe(false)
  expect(harborRequestSchema.safeParse({ scopeEntityId: 'harbor', targetEntityId: 'harbor-environment',
    command: { kind: 'act', actor: 'another', viewId: `view-${'0'.repeat(64)}`,
      rationale: 'An unauthorized actor substitution.', actions: [] } }).success).toBe(false)
})

it('refuses a missing original journal instead of resetting a recovered experiment', async () => {
  const root = await mkdtemp(resolve('.tmp/harbor-missing-'))
  try {
    const judge = new HarborCase(resolve('test-cases/harbor-society-365'), root, 'original',
      new AbortController().signal, true)
    await expect(judge.ready()).rejects.toThrow('refusing to create a replacement world')
  } finally { await rm(root, { recursive: true, force: true }) }
})

it('keeps actor and coordinator authority separate and does not disclose another view', () => {
  const own = { actor: 'coop', day: 0, revision: 0, viewId: `view-${'0'.repeat(64)}`, privatePurpose: 'COOP_PRIVATE' }
  const state = { entities: {
    'harbor-environment': { cognition: 'none', profile: { harbor: {
      revision: 0, day: 0, overview: { day: 0 }, prompt: 'Experiment', rules: 'Rules', guide: 'Guide' } } },
    'harbor-view-coop': { profile: { views: { coop: own } } },
    'harbor-view-rival': { profile: { views: { rival: { ...own, actor: 'rival', privatePurpose: 'RIVAL_PRIVATE' } } } },
  }, world: { definition: { organizationEntityId: 'harbor' }, results: {}, intents: {} } } as unknown as SimulationSnapshot
  const domain = new HarborNativeDomain()
  const visible = JSON.stringify(domain.goalContext(state, 'coop' as never))
  expect(visible).toContain('COOP_PRIVATE')
  expect(visible).not.toContain('RIVAL_PRIVATE')
  expect(JSON.stringify(domain.goalContext(state, 'coordinator' as never))).not.toContain('COOP_PRIVATE')
  const request = (command: unknown) => simulationWorldDomainRequestSchema.parse({
    kind: 'world/request', domain: 'harbor', operation: 'execute', version: HARBOR_PIN.version, businessKey: 'fixture',
    expectedTime: null, evidence: [], payload: { scopeEntityId: 'harbor', targetEntityId: 'harbor-environment', command },
  })
  expect(() => domain.admitRequest(state, 'coop' as never, request({ kind: 'advance', day: 7 }))).toThrow('coordinator')
  expect(() => domain.admitRequest(state, 'coop' as never, request({ kind: 'act', actor: 'rival',
    viewId: own.viewId, rationale: 'An attempted substitution of another actor.',
    actions: [{ kind: 'operating', value: false, reason: 'Not my actor' }] }))).toThrow('another Session')
})

it('closes Harbor domain admission and disposes its execution registration on plugin unload', async () => {
  const root = await mkdtemp(resolve('.tmp/harbor-disposal-'))
  const { createContext } = await import('../../simulation-team/tests/harness.ts')
  const { default: Executions } = await import('../src/providers.ts')
  const Harbor = await import('../src/harbor.ts')
  const { ctx } = await createContext(root, 'sqlite')
  try {
    await ctx.plugin(Executions)
    const register = ctx.simulationWorldExecutions.register.bind(ctx.simulationWorldExecutions)
    const disposers: ReturnType<typeof vi.fn>[] = []
    const registration = vi.spyOn(ctx.simulationWorldExecutions, 'register').mockImplementation((entry) => {
      const dispose = vi.fn(register(entry)); disposers.push(dispose); return dispose
    })
    const config = { provider: 'local', sourceDirectory: resolve('test-cases/harbor-society-365'), root }
    const selector = { domain: 'harbor', operation: 'execute', version: Harbor.HARBOR_PIN.version }
    const original = ctx.plugin(Harbor, config)
    await original
    expect(ctx.simulations.domains('local').resolve(selector).domain).toBe('harbor')
    expect(ctx.simulationTeams.worldArchiveProviders().has('clocky.harbor.private-backup/1')).toBe(true)
    await original.dispose()
    expect(ctx.simulationTeams.worldArchiveProviders().has('clocky.harbor.private-backup/1')).toBe(false)
    expect(() => ctx.simulations.domains('local').resolve(selector)).toThrow()
    expect(disposers).toHaveLength(3)
    for (const dispose of disposers) expect(dispose).toHaveBeenCalledTimes(1)
    registration.mockRestore()
  } finally { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) }
})

it('retains legal maximum-length offer identities in generated order and loan references', async () => {
  const root = await mkdtemp(resolve('.tmp/harbor-generated-ids-'))
  try {
    const judge = new HarborCase(resolve('test-cases/harbor-society-365'), root, 'long-identities', new AbortController().signal)
    const offer = 'o'.repeat(100), loan = 'l'.repeat(100)
    const act = async (key: string, actor: string, actions: unknown[]) => {
      const view = z.object({ viewId: z.string() }).parse(await judge.view(actor))
      const input = harborRequestSchema.parse({ scopeEntityId: 'harbor', targetEntityId: 'harbor-environment', command: {
        kind: 'act', viewId: view.viewId, rationale: 'Exercise original maximum-length identifiers without rewriting generated contracts.', actions,
      } })
      const result = await judge.execute(key, actor, `team/${actor}`, input.command)
      expect(result.ok).toBe(true)
    }
    await act('offers', 'coop', [
      { kind: 'offer', id: offer, to: 'clinic', resource: 'food', quantity: 1, unitPrice: 1, leadDays: 0, expiresDay: 3 },
      { kind: 'loan-offer', id: loan, to: 'clinic', principal: 1, repayAmount: 1, dueDay: 3 },
    ])
    await act('accept', 'clinic', [{ kind: 'accept', offerId: offer }, { kind: 'accept-loan', offerId: loan }])
    const audit = await judge.execute('audit', 'coordinator', 'team/coordinator', { kind: 'audit' })
    expect(audit.receipt.audit).toMatchObject({ kind: 'report', openOrders: [{ id: `order-${offer}` }], openLoans: [{ id: `loan-${loan}` }] })
    await act('deliver', 'coop', [{ kind: 'deliver', orderId: `order-${offer}` }])
    await act('repay', 'clinic', [{ kind: 'repay', loanId: `loan-${loan}` }])
  } finally { await rm(root, { recursive: true, force: true }) }
})


it('preserves v1 frozen context schemas while assigning expanded references to a distinct v2 pin', async () => {
  const old = await import('../src/harbor-v1-protocol.ts')
  const current = await import('../src/harbor-protocol.ts')
  // These schema hashes are part of already-consumed Native context proofs, not refreshable fixture output.
  expect(Object.fromEntries((['request', 'plan', 'mutation', 'result'] as const).map(kind =>
    [kind, createHash('sha256').update(JSON.stringify(old.HARBOR_DEFINITION.schemas[kind].toJSONSchema({ io: 'input' }))).digest('hex')]))).toEqual({
    request: 'fc4d3537c22ed0fbaff15a8a8d3adbde824b1651e36db7a9b12bcdb8e072e619',
    plan: 'fc4d3537c22ed0fbaff15a8a8d3adbde824b1651e36db7a9b12bcdb8e072e619',
    mutation: '8621f67f954f42d679378a759f3b3e3417638fd0f98650de33a8e480b27fc74f',
    result: 'ec9f641a5493a5b53458b33fe32b100520cec8b3cc7461eb0d1af9ca57fd9b28',
  })
  const input = { scopeEntityId: 'harbor', targetEntityId: 'harbor-environment', command: { kind: 'act',
    viewId: `view-${'0'.repeat(64)}`, rationale: 'Deliver the original generated order without shortening its identity.',
    actions: [{ kind: 'deliver', orderId: `order-${'o'.repeat(100)}` }] } }
  expect(old.harborRequestSchema.safeParse(input).success).toBe(false)
  expect(current.harborRequestSchema.safeParse(input).success).toBe(true)
  expect(current.HARBOR_PIN.version).toBe('3')
  expect(current.HARBOR_PIN.schemaRef).not.toBe(old.HARBOR_PIN.schemaRef)
  expect(current.HARBOR_PIN.implementationRef).not.toBe(old.HARBOR_PIN.implementationRef)
})


it('requires explicit forwarding consent and never accepts a replacement business payload in v3', async () => {
  const { HARBOR_CURRENT } = await import('../src/harbor-protocol.ts')
  const domain = new HarborNativeDomain(HARBOR_CURRENT)
  const intent = { payload: { scopeEntityId: 'harbor', targetEntityId: 'harbor-environment', command: { kind: 'advance', day: 1 } } }
  const state = {} as SimulationSnapshot
  const apply = (payload: unknown) => { domain.validatePlan(state, intent as never, {
    kind: 'apply', rationale: 'Forward the actor’s already admitted request without changes.', payload: payload as never,
  }) }
  expect(() => { apply({ forwardOriginal: true }) }).not.toThrow()
  expect(() => { apply({ forwardOriginal: false }) }).toThrow()
  expect(() => { apply(intent.payload) }).toThrow()
  expect(() => { apply({ forwardOriginal: true, replacement: intent.payload }) }).toThrow()
})

it('provides schema-checked v3 forwarding examples using only the original current request', async () => {
  const { HARBOR_CONTRACTS } = await import('../src/harbor-protocol.ts')
  const { simulationProposalSchema } = await import('@clocky/clocky-simulation')
  const intent = { id: 'current-intent', payload: { scopeEntityId: 'harbor', targetEntityId: 'harbor-environment',
    command: { kind: 'audit' } }, requesterEntityId: 'coordinator' }
  const request = { id: 'current-request' as import('@clocky/clocky-simulation').WorldRequestId,
    intentId: intent.id, status: 'open', plans: [] }
  const state = { world: { requests: { [request.id]: request } } } as unknown as SimulationSnapshot
  for (const contract of HARBOR_CONTRACTS) {
    const domain = new HarborNativeDomain(contract)
    const context = z.looseObject({ stageExamples: z.looseObject({ proposals: z.array(simulationProposalSchema) }).optional() })
      .parse(domain.planningContext(state, intent as never, 'director' as never))
    if (contract.pin.version !== '3') { expect(context.stageExamples).toBeUndefined(); continue }
    const action = context.stageExamples?.proposals[0]?.action
    expect(action).toMatchObject({ kind: 'world/resolve', requestId: request.id,
      resolution: { kind: 'apply', payload: { forwardOriginal: true } } })
    expect(context.stageExamples?.proposals[0]?.after).toEqual([])
    if (action?.kind !== 'world/resolve' || action.resolution.kind !== 'apply') throw new Error('example missing')
    expect(contract.definition.schemas.plan.parse(action.resolution.payload)).toEqual({ forwardOriginal: true })
    expect(state.world?.requests[request.id]).toEqual(request)
  }
})
