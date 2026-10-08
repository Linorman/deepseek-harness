/** Source-plane native owners and scoped production tools; Loader subprocesses own complete composition evidence. */
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import Loader from '@clocky/cordis-plugin-loader'
import Include from '@clocky/cordis-plugin-include'
import Presets from '@clocky/clocky-agent-presets'
import * as Direct from '@clocky/clocky-team-channel-direct'
import * as Tools from '@clocky/clocky-tool-simulation'
import * as Role from '@clocky/clocky-tool-simulation/role'
import { createContext } from '../../simulation-team/tests/harness.ts'
import { simulationRunSelectionSchema, simulationPhaseManagementRequestSchema } from '@clocky/clocky-simulation'
import { prepareSimulationCompany, simulationCompanyPreparationSchema } from '../src/company-preparation.ts'
import { SimulationCompanyDriver, simulationCompanyDriverSchema } from '../src/company-driver.ts'
import { companyModel } from './company-model.ts'

export const companySettings = simulationCompanyPreparationSchema.parse({ version: '1', ownerName: 'simulation/company-product',
  objective: 'Deliver one inventory unit', buyerName: 'Buyer', supplierName: 'Supplier', initialStock: '2',
  participant: { provider: 'in-process', preset: 'simulation', model: 'company/scripted' },
  checkpoint: { id: 'initial', maxDrainRounds: 4, maxAttempts: 3 } })
export const companyConfig = simulationCompanyDriverSchema.parse({ version: '1', maxControlSteps: 2,
  model: { provider: 'company', name: 'scripted' }, requestDelay: '5', reportDelay: '1', replyDelay: '20', completeDelay: '30' })

export async function companyFixture(backend: 'json' | 'sqlite' = 'json', prepare = true, overrides: Record<string, unknown> = {},
  alter?: (stage: string, proposals: unknown[]) => unknown[]) {
  await mkdir('.tmp', { recursive: true })
  const root = await mkdtemp(join(process.cwd(), '.tmp', 'company-driver-unit-'))
  const { ctx } = await createContext(root, backend)
  await ctx.plugin(Direct)
  await ctx.plugin(Loader)
  ctx.baseUrl = pathToFileURL(root).href + '/'
  ctx.loader.builtins.include = Include
  ctx.loader.builtins['company-role'] = Role
  const presetRoot = join(root, 'presets')
  await mkdir(join(presetRoot, 'simulation'), { recursive: true })
  await writeFile(join(presetRoot, 'simulation', 'agent.cordis.yml'), '[{"name":"cordis:company-role"}]\n')
  await ctx.plugin(Presets, { default: 'simulation', includeUserRoot: false, roots: [{ path: presetRoot, trust: 'system' }] })
  await ctx.plugin(Tools)
  const selection = simulationRunSelectionSchema.parse({ provider: 'local', mode: 'create', spec: {
    runId: 'company-driver', tickUnit: 'minute', origin: '0', maxTime: '1000', rulesVersion: '1', policyVersion: '1',
    outboxMaxAttempts: 3, outboxRetryDelayMs: 10, maxDriveSteps: 32, maxMicrostepsPerTime: 32,
    phaseOrder: ['delivery', 'decision', 'deadline'], decisionTimeoutMs: 60000, maxConflictRetries: 2, maxIngressBytes: 65536,
    maxEntities: 16, maxResidentActors: 2, maxTokensPerInterval: 1000000, tokensPerModelRequest: 10000, budgetInterval: '100',
    maxDecisionsPerInterval: 100, maxMessagesPerInterval: 100, maxPendingEvents: 100, maxPendingInteractions: 100,
    maxKnowledgeBytes: 65536, maxKnowledgePerQuery: 32, maxQueuedDecisions: 100, maxDispatchWaitRounds: 8,
    maxDecisionsPerWindow: 2, maxOperationsPerDecision: 16, maxResourceQuantity: '10000', relationRules: [], ...overrides,
  } })
  const run = await ctx.simulations.open(selection)
  const prepared = prepare ? await prepareSimulationCompany(ctx.simulationTeams, run, companySettings)
    : await ctx.simulationTeams.ensureTeam(run, { goal: { objective: companySettings.objective, budgets: {} }, budgets: {} },
      companySettings.ownerName)
  const teamId = 'teamId' in prepared ? prepared.teamId : prepared.team.id
  const connection = await ctx.simulationTeams.attach(run, teamId, companySettings.ownerName)
  const requests: Array<{ stage: string; tools: string[]; goal: string }> = []
  const adapter = companyModel(run, requests, alter)
  const modelRegistration = ctx.llm.registerAdapter(['company'], adapter)
  const lifetime = new AbortController()
  const driver = new SimulationCompanyDriver(run, connection, companySettings, companyConfig, lifetime.signal)
  return { ctx, run, connection, driver, lifetime, requests, adapter, selection, modelRegistration,
    async start() { await run.managePhase(simulationPhaseManagementRequestSchema.parse({ id: 'start', phase: 'running' })) },
    async close() {
      await driver.drain(); await run.close(); await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true })
    } }
}
