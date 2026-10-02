/** Installed topology is validated before creation and remains immutable through third-party review and cold recovery. */
import { afterEach, expect, it, vi } from 'vitest'
import { simulationCompanyDriverSchema } from '../src/company-driver.ts'
import { simulationCompanyTemplateSchema } from '../src/creation-schema.ts'
import { simulationCreationEntrySchema } from '../src/creation-book.ts'
import { simulationProductIngressInputSchema } from '../src/maintenance-schema.ts'
import { resolveCreation } from '../src/creation-preflight.ts'
import type { Config } from '../src/administration.ts'
import { ownerFixture } from './company-owner-fixture.ts'
import { companyConfig } from './company-driver-fixture.ts'
import { call } from './fixtures.ts'

afterEach(() => { vi.restoreAllMocks() })

const driver = simulationCompanyDriverSchema.parse({ ...companyConfig, scenario: { kind: 'task-workflow', version: '1',
  topology: { actors: [{ id: 'reviewer', name: 'Independent reviewer' }], channels: [{ key: 'audit', members: [
    { entityId: 'buyer', role: 'author' }, { entityId: 'reviewer', role: 'reviewer' },
  ] }] }, steps: [
    { id: 'audit-report', sourceEntityId: 'buyer', entityId: 'buyer', recipientEntityId: 'reviewer', channelKey: 'audit',
      reviewerEntityId: 'reviewer', subject: 'Audit report', description: 'Publish the installed audit report', text: 'Audit ready',
      cognition: 'deterministic', leaseDurationMs: 60000, maxAttempts: 2, retry: 'before-effects' },
    { id: 'supplier-report', sourceEntityId: 'buyer', entityId: 'supplier', recipientEntityId: 'buyer', channelKey: 'purchase',
      subject: 'Supplier report', description: 'Publish the installed supplier report', text: 'Supplier ready',
      cognition: 'deterministic', leaseDurationMs: 60000, maxAttempts: 1, retry: 'never' },
  ] } })

it.each(['json', 'sqlite'] as const)('retains a third reviewer and exact channel routes through checkpoint and changed deployment (%s)', async (backend) => {
  const options: { templates?: Config['templates'] } = {}
  const h = await ownerFixture(backend, options, driver)
  try {
    const runId = await h.create(), service = h.ctx.simulationAdministration
    const initial = h.owned().snapshot().checkpoints?.[`product-initial/${h.input.commandId}` as never]
    expect(initial?.status).toBe('completed')
    if (initial?.status === 'completed') {
      expect(initial.manifest.sessions).toHaveLength(3); expect(initial.manifest.channels).toHaveLength(2)
    }
    expect((await service.control({ runId }, call())).administration?.ingress.targets.map(value => value.id))
      .toEqual(['buyer', 'supplier', 'reviewer'])
    await service.manage({ runId, managementId: 'start-topology' as never, phase: 'running' }, call())
    const pending = await vi.waitFor(async () => {
      const item = (await service.listTaskReviews({ runId }, call())).items.find(value => value.action.allowed)
      if (item === undefined) throw new Error('Independent review is pending')
      return item
    }, { timeout: 5000, interval: 5 })
    expect(pending.reviewerEntityId).toBe('reviewer')
    expect(pending.evidence?.report.delivery).toBe('persisted')
    expect(h.requests).toEqual([])
    const cut = { runId, commandId: 'three-actor-cut' as never }
    await service.checkpoint(cut, call()); await h.finished(cut.commandId)
    const snapshot = h.owned().snapshot(), resources = snapshot.resources
    const checkpointId = `product-checkpoint/${cut.commandId}` as never
    const manifest = snapshot.checkpoints?.[checkpointId]
    if (manifest?.status !== 'completed') throw new Error('Topology checkpoint did not complete')
    expect(manifest.manifest.sessions).toHaveLength(3); expect(manifest.manifest.channels).toHaveLength(2)
    const stored = simulationCreationEntrySchema.parse((await h.ctx.storageLog.get('owner-commands')!.read(-1, 1))[0]?.value)
    if (stored.kind !== 'command/accepted' || stored.command.kind !== 'create') throw new Error('Original creation was not retained')
    const creation = stored.command.creation, { runId: _nativeRunId, ...spec } = creation.record.spec
    expect(creation.preparation.topology).toEqual(driver.scenario?.topology)
    const edited = simulationCompanyDriverSchema.parse({ ...driver, scenario: { ...driver.scenario,
      topology: { ...driver.scenario?.topology, actors: [{ id: 'reviewer', name: 'Changed deployment reviewer' }] } } })
    options.templates = [simulationCompanyTemplateSchema.parse({ id: h.input.templateId, version: '1', name: 'Changed template',
      provider: 'local', spec, preset: creation.preparation.participant.preset, objective: creation.preparation.objective,
      driver: edited, checkpoint: { maxDrainRounds: 4, maxAttempts: 3 } })]
    await h.fiber.dispose(); await h.mount()
    const cold = h.ctx.simulationAdministration
    const restore = { runId, commandId: 'restore-topology' as never, checkpointId }
    await cold.restore(restore, call()); expect((await h.finished(restore.commandId)).status).toBe('completed')
    expect(h.owned().snapshot().resources).toEqual(resources)
    expect((await cold.control({ runId }, call())).administration?.ingress.targets.at(-1)?.name.text).toBe('Independent reviewer')
    const item = (await cold.listTaskReviews({ runId }, call())).items.find(value => value.action.allowed)
    if (item === undefined) throw new Error('Cold independent review is unavailable')
    const review = { runId, commandId: 'approve-third-reviewer' as never, operationId: item.operationId,
      attemptId: item.attemptId, expectedRevision: item.taskRevision, nextPhase: 'completed' as const, reason: 'Independent approval' }
    await cold.resolveTaskReview(review, call()); expect((await h.finished(review.commandId)).status).toBe('completed')
    expect(h.owned().snapshot().phase).toBe('paused'); expect(h.requests).toEqual([])
    const input = simulationProductIngressInputSchema.parse({ runId, ingressId: 'third-input', entityId: 'reviewer',
      text: 'Authorized review notice', availableAt: '0' })
    expect((await cold.ingress(input, call())).entityId).toBe('reviewer')
    await cold.manage({ runId, managementId: 'resume-topology' as never, phase: 'running' }, call())
    await vi.waitFor(async () => { expect((await cold.control({ runId }, call())).stop).toBe('completed') }, { timeout: 5000, interval: 5 })
    expect(h.owned().snapshot().resources).toEqual(resources)
    expect(Object.values(h.owned().snapshot().operations).filter(value => value.action.kind === 'task/create')).toHaveLength(2)
    expect(h.requests).toEqual([])
  } finally { await h.close() }
})

it('rejects missing actors, wrong channel membership, duplicate identities, grants and self-review before creation', async () => {
  const h = await ownerFixture('json', {}, driver)
  try {
    const scenario = driver.scenario
    if (scenario === undefined) throw new Error('Topology fixture needs its installed workflow')
    const first = scenario.steps[0]
    if (first === undefined) throw new Error('Topology fixture has no report')
    for (const step of [{ ...first, sourceEntityId: 'missing' }, { ...first, entityId: 'supplier' },
      { ...first, channelKey: 'purchase' }, { ...first, reviewerEntityId: first.entityId }]) {
      expect(simulationCompanyDriverSchema.safeParse({ ...driver, scenario: { ...scenario, steps: [step] } }).success).toBe(false)
    }
    for (const topology of [
      { ...scenario.topology, actors: [{ id: 'buyer', name: 'Duplicate actor' }] },
      { ...scenario.topology, actors: [{ id: 'reviewer', name: 'Reviewer', capabilities: ['shell'] }] },
      { ...scenario.topology, channels: [{ key: 'audit', members: [{ entityId: 'buyer', role: 'author' },
        { entityId: 'missing', role: 'receiver' }] }] },
    ]) expect(simulationCompanyDriverSchema.safeParse({ ...driver, scenario: { ...scenario, topology } }).success).toBe(false)
    const { runId: _runId, ...spec } = h.selection.spec
    const template = simulationCompanyTemplateSchema.parse({ id: 'company', version: '1', name: 'Topology', provider: 'local',
      spec, driver, preset: 'simulation', objective: 'Report', checkpoint: { maxDrainRounds: 4, maxAttempts: 3 },
      editableLimits: ['maxEntities'] })
    expect(simulationCompanyTemplateSchema.safeParse({ ...template, spec: { ...spec, maxEntities: 2 } }).success).toBe(false)
    const resolved = resolveCreation(template, { ...h.input, limits: { maxEntities: 2 } }, text => ({ text, truncated: false }))
    expect(resolved.issues).toMatchObject([{ field: 'limits.maxEntities', code: 'invalid' }])
    expect(h.ctx.storageLog.get('owner-commands')!.tailSequence).toBe(-1)
    expect(h.requests).toEqual([])
  } finally { await h.close() }
})
