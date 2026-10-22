/** Portable Harbor authoring definition and finite deployment allowances; no business policy is encoded. */
import { scenarioV1CatalogSchema, worldScenarioV1Schema } from '@clocky/clocky-simulation-scenario'
import type { ScenarioV1Catalog, WorldScenarioV1 } from '@clocky/clocky-simulation-scenario'
import { HARBOR_ACTORS, HARBOR_PIN } from './harbor-protocol.ts'

/** Build an explicit optional installation from the Host's actual model metadata.
 * @param base - Installed catalog supplying the existing world-agent runtime route.
 * @returns independent catalog and portable scenario, without creating a run or invoking a model. */
export function createHarborInstallation(base: ScenarioV1Catalog): { catalog: ScenarioV1Catalog; definition: WorldScenarioV1 } {
  const catalog = structuredClone(base)
  catalog.generation = `${base.generation}/harbor-3`
  catalog.policyVersion = 'harbor-policy/3'
  catalog.native = { ...catalog.native, tickUnit: 'day', origin: '0', maxTime: '365',
    budgetInterval: '7', rulesVersion: 'harbor-original/1' }
  catalog.domains = [{ pin: HARBOR_PIN, available: true }]
  const members = ['coordinator', ...HARBOR_ACTORS]
  const names = ['Case router', 'Experiment initiator', ...HARBOR_ACTORS]
  catalog.templates = [{ template: { id: 'harbor-person', version: '1', names,
    skills: ['case-participant'], traits: ['independent'], goals: ['case'],
    description: 'An independent participant in the original Harbor case. Private motives come only from that participant’s actual view.' },
  defaultPersona: { name: 'Case router', skills: ['case-participant'], traits: ['independent'], goals: ['case'] } }]
  const limits = {
    native: { ...catalog.limits.defaults.native, maxEntities: 64, maxResidentActors: 14,
      maxTokensPerInterval: 100_000_000, tokensPerModelRequest: 262144, maxDecisionsPerInterval: 2000, maxMessagesPerInterval: 2000,
      maxQueuedDecisions: 128, maxPendingEvents: 2048, maxPendingInteractions: 128,
      maxKnowledgeBytes: 262144, maxIngressBytes: 262144, decisionTimeoutMs: 600000,
      maxDriveSteps: 64, maxMicrostepsPerTime: 8192 },
    team: { ...catalog.limits.defaults.team, maxParticipants: 64, maxActivations: 4096,
      maxEnvelopeBytes: 262144, maxChannelViewBytes: 262144,
      maxTurnsPerTeam: 100000, maxModelTokensPerTeam: 2_000_000_000, maxWallTimeMsPerTeam: 604_800_000,
      maxPostIdempotencyEntriesPerChannel: 4096, maxPendingDeliveriesPerChannel: 256,
      maxPendingDeliveriesPerParticipant: 256, maxInboxItemsPerParticipant: 256 },
    world: { ...catalog.limits.defaults.world, maxRequests: 10000, maxRequestsPerActorPerInterval: 256,
      maxBirthsPerInterval: 0, maxExternalExpansionsPerInterval: 0, maxBytesPerPlan: 131072 },
  }
  catalog.limits = { defaults: structuredClone(limits), ceilings: structuredClone(limits) }
  const reference = { id: 'world-agent', version: '1' }, template = { id: 'harbor-person', version: '1' }
  const permission = { domain: 'harbor', operation: 'execute', version: HARBOR_PIN.version,
    scopeId: 'harbor', targetId: 'harbor-environment', relation: 'can-execute' }
  const interval = { validFrom: '0', validUntil: null }
  const definition = worldScenarioV1Schema.parse({
    apiVersion: 'clocky.world/v1',
    metadata: { id: 'harbor-society-365', name: '河港社会：365 日原裁判实验',
      description: '通过原始河港裁判运行完整一年，由独立主体决策，保留真实身份、行动、跨期记忆、检查点和最终审计。' },
    runtimeProfiles: { allowed: [reference], generated: reference, templates: [template] },
    domains: [{ domain: 'harbor', operation: 'execute', version: HARBOR_PIN.version }],
    entities: [
      { id: 'harbor', name: '河港实验运行容器', description: '技术运行容器；不代表案例中的雇佣、联盟或组织关系。',
        kind: 'organization', cognition: 'none' },
      { id: 'harbor-environment', name: '原案例环境', description: '原 world.mjs 的公共观察及原指令。', kind: 'object', cognition: 'none' },
      ...HARBOR_ACTORS.map(id => ({ id: `harbor-view-${id}`, name: `${id} 的私有观察`,
        description: '仅向对应主体提供原裁判的当前 view。', kind: 'object', cognition: 'none' })),
      ...['director', ...members].map((id, index) => ({ id, name: names[index], kind: 'person', cognition: 'agent',
        description: id === 'director' ? '仅转交原请求和回执；不替任何主体选择业务行动。'
          : id === 'coordinator' ? '实验发起人，选择推进日期、协调唤醒和撰写跨期记忆；不冒充世界主体。'
            : `独立代表原案例中的 ${id}，仅依据自己的当前观察和利益行动。`,
        role: id === 'director' ? 'director' : 'member', runtimeProfile: reference, template,
        persona: { name: names[index], skills: ['case-participant'], traits: ['independent'], goals: ['case'] } })),
    ],
    organization: { rootId: 'harbor', units: [],
      positions: members.map(id => ({ id: `seat-${id}`, name: `${id} 的技术席位`, description: '案例代表身份；不构成世界内雇佣。',
        unitId: 'harbor', capacity: 1, permissions: [permission] })),
      assignments: members.map(id => ({ id: `assignment-${id}`, personId: id, positionId: `seat-${id}`, ...interval })),
      grants: members.map(id => ({ id: `grant-${id}`, personId: id, ...permission, ...interval })) },
    governance: { committees: [], norms: [] }, facts: [], knowledge: [], resources: [],
    communication: { channels: [] }, externalWorld: { mode: 'simulated-only', identities: [] },
    behavior: { initialGoals: [], calendars: [], directorEvents: [] },
    limits: { native: {}, team: {}, world: {} },
  })
  return { catalog: scenarioV1CatalogSchema.parse(catalog), definition }
}
