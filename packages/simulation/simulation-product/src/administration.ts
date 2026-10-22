import { requiredCompanyContext } from './required-company-context.ts'
import { simulationRunControlObservationSchema } from '@clocky/clocky-simulation/run-control-observation'
import { observeSimulationRunControl } from '@clocky/clocky-simulation/run-control-observation'
import { SimulationProductReadError, simulationProductReadFailure, simulationProductReadLimit } from './failure.ts'
import { simulationProductRunControlInputSchema, simulationProductRunControlResultSchema } from './run-control-schema.ts'
import { tokenDiagnostics } from './token-diagnostics.ts'
import { createWorldExperimentBranch, preflightWorldExperimentBranch, queryWorldCausalIndex, compareWorldExperiments } from '@clocky/clocky-simulation-team'
import { compileWorldExperimentRuntime } from '@clocky/clocky-simulation-world'
import { ProductExperimentStore, productWorldBranchBackupCreation } from './experiment-store.ts'
import type { SimulationWorldBranchCreation } from './experiment-store.ts'
import { simulationProductWorldBranchInputSchema, simulationProductWorldBranchReadInputSchema,
  simulationProductWorldCausalInputSchema, simulationProductWorldCausalResultSchema,
  simulationProductWorldCompareInputSchema, simulationProductWorldCompareResultSchema } from './experiment-schema.ts'
import type { SimulationProductExperimentSource, SimulationProductWorldBranchInput, SimulationProductWorldBranchReadInput,
  SimulationProductWorldBranchResult, SimulationProductWorldCausalInput, SimulationProductWorldCausalResult,
  SimulationProductWorldCompareInput, SimulationProductWorldCompareResult } from './experiment-types.ts'
import { z as zod } from 'zod'
import { simulationCreationEntrySchema } from './creation-book.ts'
import { productWorldBackupCreation, productWorldBackupDescriptor } from './backup-import.ts'
import { createWorldBackup, verifyWorldBackup } from '@clocky/clocky-simulation-team'
import type { WorldBackupBundle } from '@clocky/clocky-simulation-team'
import type { SimulationProductBackupExportInput, SimulationProductBackupExportResult } from './retention-types.ts'
import { simulationProductBackupExportInputSchema } from './retention-schema.ts'
import { ProductRetention } from './retention.ts'
import { simulationProductRetentionPreviewInputSchema, simulationProductRetentionExecuteInputSchema,
  simulationProductRetentionReadInputSchema, simulationProductRetentionRecordsInputSchema } from './retention-schema.ts'
import type { SimulationProductRetentionPreviewInput, SimulationProductRetentionPlan, SimulationProductRetentionExecuteInput,
  SimulationProductRetentionReadInput, SimulationProductRetentionResult, SimulationProductRetentionRecordsInput,
  SimulationProductRetentionRecordsResult } from './retention-types.ts'
import { simulationProductGenerationReadSchema, simulationProductGenerationRequestSchema,
  simulationProductGenerationTransitionSchema, simulationProductGenerationResultSchema,
  simulationProductGenerationPersonaDraftSchema } from './generation-schema.ts'
import type { SimulationProductGenerationRead, SimulationProductGenerationRequest, SimulationProductGenerationTransition,
  SimulationProductGenerationResult, SimulationProductGenerationPersonaDraft } from './generation-types.ts'
import { simulationGenerationJobSchema, simulationWorldPersonaSchema, hiringMarket, generationRecordAt } from '@clocky/clocky-simulation'
import { projectCalendarCommand } from './calendar-command.ts'
import { simulationProductCalendarCommandInputSchema, simulationProductCalendarCancelSchema } from './calendar-schema.ts'
import type { SimulationProductCalendarCommandInput, SimulationProductCalendarCommandResult, SimulationProductCalendarCancel } from './calendar-types.ts'
import type { SimulationProductCalendarInput, SimulationProductCalendarPreview,
  SimulationProductCalendarSubmit, SimulationProductCalendarReceipt } from './calendar-types.ts'
import { simulationProductCalendarInputSchema, simulationProductCalendarPreviewSchema, simulationProductCalendarSubmitSchema, simulationProductCalendarReceiptSchema } from './calendar-schema.ts'
import type { SimulationProductTasksInput, SimulationProductTasksPage, SimulationProductTaskCancelInput, SimulationProductTaskControl } from './task-control-types.ts'
import { simulationProductTasksInputSchema, simulationProductTasksPageSchema, simulationProductTaskCancelInputSchema } from './task-control-schema.ts'
import { simulationProductRunStatusesInputSchema, simulationProductRunStatusesPageSchema } from './schema.ts'
import type { SimulationProductRunStatusesInput, SimulationProductRunStatusesPage } from './types.ts'
import { observeModelPool } from './model-pool.ts'
import { DirectoryCursorCodec } from './cursor.ts'
import { scenarioReviewSummary, scenarioHasReview } from './scenario-review.ts'
import { registerTaskScenarioPolicies } from './task-scenario-policies.ts'
import { simulationProductTaskReviewListInputSchema, simulationProductTaskReviewPageSchema, simulationProductTaskReviewResolveInputSchema } from './review-schema.ts'
import type { SimulationProductTaskReviewListInput, SimulationProductTaskReviewPage, SimulationProductTaskReviewResolveInput } from './review-types.ts'
import { simulationProductOperationRetryInputSchema } from './operation-retry-schema.ts'
import type { SimulationProductOperationRetryInput, SimulationProductOperationRetryCapability } from './operation-retry-types.ts'
/** Opt-in persistent product creation owner; accepted preparation is independent of an HTTP wait. */
import { Context, Service } from '@clocky/cordis'
import z from '@clocky/schemastery'
import { z as wire } from 'zod'
import { createHash, randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import type {} from '@clocky/clocky-agent-presets'
import type {} from '@clocky/clocky-llm'
import { isInProcessAgentRuntimeProvider } from '@clocky/clocky-agent-runtime-in-process'
import type { AuthenticatedProductCall } from '@clocky/clocky-product-principal'
import type { LogStream } from '@clocky/clocky-storage'
import { simulationRunIdSchema, simulationCheckpointIdSchema, simulationIngressRequestSchema } from '@clocky/clocky-simulation'
import { SimulationWorldError } from '@clocky/clocky-simulation'
import { checkpointDiagnostic, SimulationCheckpointError } from '@clocky/clocky-simulation'
import type { SimulationRun, SimulationSnapshot, SimulationManagementOperation, SimulationIngress } from '@clocky/clocky-simulation'
import { SimulationProductError } from './index.ts'
import { scenarioCatalogSchema, scenarioV1CatalogSchema, worldScenarioV1Schema, compileWorldScenario } from '@clocky/clocky-simulation-scenario'
import type { ScenarioCatalog, ScenarioCompilation, ScenarioV1Catalog, ScenarioV1Compilation, WorldScenarioV1 } from '@clocky/clocky-simulation-scenario'
import { preflightSimulationWorld } from './world-preflight.ts'
import { resolveWorldModel } from './world-model.ts'
import type { WorldModelSelection } from './world-model.ts'
import { prepareSimulationWorld } from './world-preparation.ts'
import { simulationWorldCreationSchema, simulationWorldPreparationSchema } from './world-creation.ts'
import { simulationProductWorldCreateInputSchema, simulationProductWorldPreflightInputSchema,
  simulationProductWorldExportResultSchema } from './world-schema.ts'
import type { SimulationProductWorldCreateInput, SimulationProductWorldPreflightInput,
  SimulationProductWorldPreflightResult, SimulationProductWorldExportResult } from './world-types.ts'
import { worldPreflightPreview } from './world-preview.ts'
import { worldPreflightCapabilities } from './world-capabilities.ts'
import type {} from './index.ts'
import { prepareSimulationCompany, simulationCompanyPreparationSchema } from './company-preparation.ts'
import { simulationInstalledCompanyTemplateSchema } from './creation-schema.ts'
import { currentTemplateModel, resolveTemplateModel, templateProviderAvailable } from './template-model.ts'
import { resolveCreation } from './creation-preflight.ts'
import { resolveScenarioTopology } from './scenario-topology.ts'
import { maintenanceControl, maintenanceControlFromObservation } from './maintenance-control.ts'
import type { SimulationRunObservation, SimulationOwnerObservation } from '@clocky/clocky-simulation'
import { managementAt } from './management-read.ts'
import { simulationProductCheckpointInputSchema, simulationProductRestoreInputSchema, simulationProductIngressInputSchema,
  simulationProductIngressQuerySchema, simulationProductIngressReceiptSchema, simulationProductIngressResultSchema } from './maintenance-schema.ts'
import type { SimulationProductCheckpointInput, SimulationProductRestoreInput, SimulationProductIngressInput, SimulationProductIngressQuery,
  SimulationProductIngressReceipt, SimulationProductIngressResult } from './maintenance-types.ts'
import { SimulationCompanyOwner } from './company-owner.ts'
import { SimulationWorldOwner } from './world-owner.ts'
import { registerCompanyTaskPolicies } from './company-task-policies.ts'
import type { SimulationCompanyPreparation } from './company-preparation.ts'
import { simulationProductManageInputSchema, simulationProductControlInputSchema, simulationProductManagementInputSchema,
  simulationProductControlSchema, simulationProductManageResultSchema, simulationProductManagementResultSchema } from './control-schema.ts'
import type { SimulationProductManageInput, SimulationProductControlInput, SimulationProductManagementInput, SimulationProductControl,
  SimulationProductManageResult, SimulationProductManagementResult, SimulationProductManagementReceipt } from './control-types.ts'
import { SimulationCreationStore } from './creation-store.ts'
import type { SimulationCompanyTemplate, SimulationInstalledCompanyTemplate,
  SimulationCreationCommand, SimulationCompanyCreation, SimulationCreationBook, SimulationCreation as OriginalSimulationCreation } from './creation-types.ts'
import { simulationProductRunIdSchema } from './schema-common.ts'
import { simulationProductCreateInputSchema, simulationProductPrepareInputSchema, simulationProductRequestInputSchema,
  simulationProductCatalogSchema, simulationProductRequestReceiptSchema, simulationProductRequestResultSchema,
  simulationProductPreflightInputSchema, simulationProductPreflightResultSchema,
  simulationProductRequestsInputSchema, simulationProductRequestsPageSchema, simulationProductRetryRequestInputSchema } from './administration-schema.ts'
import type { SimulationProductCommandId, SimulationProductCreateInput, SimulationProductPrepareInput, SimulationProductRequestInput,
  SimulationProductCatalog,
  SimulationProductRequestReceipt, SimulationProductRequestResult, SimulationProductPreflightInput, SimulationProductPreflightResult,
  SimulationProductPreflightIssue, SimulationProductConfiguration, SimulationProductRequestsInput, SimulationProductRequestsPage,
  SimulationProductRetryRequestInput } from './administration-types.ts'
import type { SimulationProductRecord } from './registration-types.ts'
import { simulationProductWorldCaseCancelInputSchema } from './case-cancel-schema.ts'
import type { SimulationProductWorldCaseCancelInput } from './case-cancel-types.ts'
import { worldCaseCancelPreview } from './case-cancel-preview.ts'
import type { WorldManagementFundingDelegation } from './world-management-authority.ts'
import { observeWorldManagementAuthority, worldManagementFingerprint, worldManagementSettlement } from './world-management-authority.ts'
import { worldManagementFields, resolveWorldManagementDraft } from './world-management-resolution.ts'
import { simulationProductWorldManagementFieldsInputSchema, simulationProductWorldManagementFieldsSchema,
  simulationProductWorldManagementDraftSchema, simulationProductWorldManagementPreviewSchema,
  simulationProductWorldManagementSubmitInputSchema, simulationProductWorldManagementOutcomeSchema } from './world-management-schema.ts'
import type { SimulationProductWorldManagementFieldsInput, SimulationProductWorldManagementFields,
  SimulationProductWorldManagementDraft, SimulationProductWorldManagementPreview,
  SimulationProductWorldManagementSubmitInput, SimulationProductWorldManagementOutcome } from './world-management-types.ts'
import { simulationWorldManagementSubmitRequestSchema, worldManagementCommandIdSchema,
  inspectWorldManagement } from '@clocky/clocky-simulation/world-management'
import { simulationEntityIdSchema } from '@clocky/clocky-simulation'
import { worldReadObligationSchema } from './world-read-schema.ts'
import { projectWorldDomain } from './world-read-projection.ts'

/** Trusted templates and independent accepted-work/journal allowances. */
export interface Config {
  readonly journalStream: string
  readonly templates: SimulationInstalledCompanyTemplate[]
  /** Opt-in World allowlist, explicit Native provider and initial checkpoint policy. */
  readonly world?: {
    readonly catalog: ScenarioCatalog | ScenarioV1Catalog
    /** Resolve every profile from the Agent default before preview and acceptance; retained runs keep their original routes. */
    readonly model?: WorldModelSelection | undefined
    /** Explicitly publish these authored definitions to authenticated catalog readers; never populate from private run exports. */
    readonly authoringTemplates?: readonly {
      readonly id: string
      readonly version: string
      readonly name: string
      readonly definition: WorldScenarioV1
    }[] | undefined
    readonly provider: string
    readonly checkpoint: { readonly maxDrainRounds: number; readonly maxAttempts: number }
    /** Explicit authenticated-owner delegation to an actual Native funds controller; absent means no funds delegation. */
    readonly managementFundingDelegations?: readonly WorldManagementFundingDelegation[] | undefined
  } | undefined
  readonly maxCommands?: number
  readonly maxTemplates?: number
  readonly maxPendingRequests?: number
  readonly maxPendingPreparations?: number
  readonly maxHeldRuns?: number
  readonly recoveryPageSize?: number
  readonly maxBytes?: number
  readonly maxEntryBytes?: number
  /** Maximum complete owner records in one retention archive. */
  readonly maxRetentionEntries?: number
  /** Maximum complete retained archive-command bytes, independent of ordinary administration entries. */
  readonly maxRetentionBytes?: number
  readonly maxTextBytes?: number
  /** Real milliseconds between bounded productive driver batches. */
  readonly driverIntervalMs?: number
  /** Minimum real delay between blocked-capacity or technical-retry observations. */
  readonly driverRetryMs?: number
  /** Maximum retained native phase-management identities per product run; exact retries remain readable. */
  readonly maxManagementRequestsPerRun?: number
  /** Maximum retained original inputs per owned run; exact retries and reads remain available. */
  readonly maxIngressRequestsPerRun?: number
  /** Maximum canonical review summaries in one complete response. */
  readonly maxReviewPageSize?: number
  /** Maximum original administration receipts in one authorized run history page. */
  readonly maxRequestPageSize?: number
}
/** Resolve deployment-varying bounds before opening the administration journal. */
const worldInstallationSchema = wire.strictObject({
  provider: wire.string().min(1).refine(value => value.trim() === value, 'World provider must be trimmed'),
  catalog: wire.union([scenarioV1CatalogSchema, scenarioCatalogSchema]),
  model: wire.strictObject({ source: wire.literal('agent-default') }).optional(),
  authoringTemplates: wire.array(wire.strictObject({ id: wire.string().trim().min(1), version: wire.string().trim().min(1),
    name: wire.string().trim().min(1), definition: worldScenarioV1Schema })).refine(values =>
    new Set(values.map(value => value.id)).size === values.length, 'World authoring template identities must be distinct').optional(),
  checkpoint: wire.strictObject({ maxDrainRounds: wire.number().int().positive(), maxAttempts: wire.number().int().positive() }),
  managementFundingDelegations: wire.array(wire.strictObject({
    principalId: wire.string().min(1).transform(value => value as import('@clocky/clocky-product-principal').ProductPrincipalId),
    controllerEntityId: simulationEntityIdSchema,
  })).max(1024).refine(values => new Set(values.map(value => value.principalId)).size === values.length,
    'Each principal has at most one explicit management funding controller').optional(),
})

/** Resolve deployment-varying bounds before opening the administration journal. */
export const Config: z<Config> = z.object({ journalStream: z.string().required(), templates: z.array(z.any()).required(),
  world: z.any(),
  maxCommands: z.number().min(1).step(1).default(10000), maxTemplates: z.number().min(1).step(1).default(32),
  maxPendingRequests: z.number().min(1).step(1).default(32), maxPendingPreparations: z.number().min(1).step(1).default(16),
  maxHeldRuns: z.number().min(1).step(1).default(16), recoveryPageSize: z.number().min(1).step(1).default(64),
  maxBytes: z.number().min(1).step(1).default(1048576), maxEntryBytes: z.number().min(1).step(1).default(1048576),
  maxRetentionEntries: z.number().min(1).step(1).default(100000), maxRetentionBytes: z.number().min(1).step(1).default(16777216),
  maxTextBytes: z.number().min(1).step(1).default(512),
  driverIntervalMs: z.number().min(1).max(2147483647).step(1).default(50),
  driverRetryMs: z.number().min(1).max(2147483647).step(1).default(1000),
  maxManagementRequestsPerRun: z.number().min(1).step(1).default(10000),
  maxIngressRequestsPerRun: z.number().min(1).step(1).default(10000), maxReviewPageSize: z.number().min(1).step(1).default(32),
  maxRequestPageSize: z.number().min(1).step(1).default(32) })

type SimulationCreation = OriginalSimulationCreation | SimulationWorldBranchCreation

interface LiveRun { run: SimulationRun; owner?: SimulationCompanyOwner | SimulationWorldOwner }

/** One administration journal and one Host handle per original product creation; startup never resumes models. */
export class SimulationAdministration extends Service<Config> {
  static inject = ['storageLog', 'simulationProducts', 'simulations', 'simulationTeams', 'teams', 'llm', 'agentPresets', 'agentRuntimes']
  static Config = Config
  private readonly options: Required<Config>
  private readonly templates = new Map<string, SimulationInstalledCompanyTemplate>()
  private readonly reviewCursors = new DirectoryCursorCodec()
  private readonly requestCursors = new DirectoryCursorCodec()
  private readonly taskCursors = new DirectoryCursorCodec()
  private readonly jobs = new Map<string, Promise<void>>()
  private readonly cancellationJobs = new Map<string, Promise<void>>()
  private retentionOwner: ProductRetention | undefined
  private experimentOwner: ProductExperimentStore | undefined
  private readonly held = new Map<string, LiveRun>()
  private readonly reads = new Set<Promise<unknown>>()
  private readonly register: (record: SimulationProductRecord) => Promise<void>
  private readonly ready: Promise<void>
  private stream: LogStream | undefined
  private book: SimulationCreationStore | undefined
  private closing = false
  private readonly workLifetime = new AbortController()

  /** @param ctx - Native owners and read directory. @param config - Explicit opt-in installed company templates. */
  constructor(ctx: Context, config: Config) {
    super(ctx, 'simulationAdministration')
    const installedWorld = config.world === undefined ? undefined : worldInstallationSchema.parse(config.world)
    this.options = { journalStream: config.journalStream, templates: config.templates, world: installedWorld,
      maxCommands: config.maxCommands ?? 10000,
      maxTemplates: config.maxTemplates ?? 32, maxPendingRequests: config.maxPendingRequests ?? 32,
      maxPendingPreparations: config.maxPendingPreparations ?? 16, maxHeldRuns: config.maxHeldRuns ?? 16,
      recoveryPageSize: config.recoveryPageSize ?? 64, maxBytes: config.maxBytes ?? 1048576,
      maxEntryBytes: config.maxEntryBytes ?? 1048576, maxRetentionEntries: config.maxRetentionEntries ?? 100000,
      maxRetentionBytes: config.maxRetentionBytes ?? 16777216, maxTextBytes: config.maxTextBytes ?? 512,
      driverIntervalMs: config.driverIntervalMs ?? 50, driverRetryMs: config.driverRetryMs ?? 1000,
      maxManagementRequestsPerRun: config.maxManagementRequestsPerRun ?? 10000,
      maxIngressRequestsPerRun: config.maxIngressRequestsPerRun ?? 10000, maxReviewPageSize: config.maxReviewPageSize ?? 32,
      maxRequestPageSize: config.maxRequestPageSize ?? 32 }
    if (config.journalStream.trim().length === 0) throw invalid('Simulation administration stream must have a name')
    for (const [key, value] of Object.entries(this.options)) {
      if (key === 'journalStream' || key === 'templates' || key === 'world') continue
      if (!Number.isSafeInteger(value) || Number(value) < 1) throw invalid('Simulation administration allowance is invalid')
    }
    if (this.options.driverIntervalMs > 2147483647 || this.options.driverRetryMs > 2147483647) {
      throw invalid('Simulation scheduling delay exceeds the Node timer range')
    }
    for (const value of config.templates) {
      const template = simulationInstalledCompanyTemplateSchema.parse(value)
      if (this.templates.has(template.id)) throw invalid('Simulation template identity is repeated')
      this.templates.set(template.id, template)
    }
    if (this.templates.size > this.options.maxTemplates) throw invalid('Simulation template capacity exceeded')
    if (installedWorld !== undefined) {
      const world = installedWorld
      if (world.catalog.templates.length + (world.authoringTemplates?.length ?? 0) + this.templates.size > this.options.maxTemplates)
        throw invalid('Simulation template capacity exceeded')
      if (ctx.get('teams') === undefined) throw invalid('World creation requires its actual Team owner')
    }
    const registerRetryReader = ctx.simulationProducts.operationRetryReaderRegistrar()
    ctx.effect(() => registerRetryReader((runId, operationId, native, call) =>
      this.operationRetryCapability(runId, operationId, native, call)))
    const registerCaseControls = ctx.simulationProducts.worldCaseControlReaderRegistrar()
    ctx.effect(() => registerCaseControls((runId, requestId, native, call, snapshotRevision) =>
      this.worldCaseCancelCapability(runId, requestId, native, call, snapshotRevision)))
    const registerManagement = ctx.simulationProducts.worldManagementReaderRegistrar()
    ctx.effect(() => registerManagement((runId, state, personId, call) => {
      this.authorize(call)
      const creation = this.book?.snapshot().creations.get(runId), live = this.held.get(runId)
      if (creation?.kind !== 'world' || creation.record.ownerPrincipalId !== call.principal.id || state.world === undefined) return []
      const reason = this.closing ? 'retiring' : !(live?.owner instanceof SimulationWorldOwner) ? 'recovery-required'
        : this.jobs.has(runId) || this.cancellationJobs.has(runId) || this.worldControlPending(runId) ? 'management-in-progress'
          : live.run.snapshot().revision !== state.revision ? 'stale' : undefined
      const assigned = Object.values(state.relations).some(value => value.relation === 'assignment' && value.subject === personId
        && value.scope === state.world?.definition.organizationEntityId && BigInt(value.validFrom) <= BigInt(state.time)
        && (value.validUntil === null || BigInt(value.validUntil) > BigInt(state.time)))
      const kinds = assigned ? ['transfer', 'depart'] as const : ['hire-existing'] as const
      return kinds.filter(action => state.world?.definition.operations.some(pin => pin.domain === 'organization'
        && pin.operation === action && pin.version === '1')).map(action => ({ action, allowed: reason === undefined,
        ...reason === undefined ? {} : { reason } }))
    }))
    this.register = ctx.simulationProducts.creationRegistrar()
    this.ready = this.load()
    void this.ready.catch((_cause: unknown) => { /* Calls and teardown observe this same initialization failure. */ })
    ctx.effect(() => async () => {
      this.closing = true
      this.workLifetime.abort(new Error('Simulation administration is retiring'))
      await Promise.allSettled([this.ready, ...this.reads, ...this.jobs.values(), ...this.cancellationJobs.values(),
        ...[...this.held.values()].flatMap(value => value.owner === undefined ? [] : [value.owner.close()])])
      const results = await Promise.allSettled([...this.held.values()].map(async (value) => {
        await value.owner?.close(); await value.run.close()
      }))
      const failures = results.filter(value => value.status === 'rejected').map(value => value.reason as unknown)
      if (failures.length !== 0) throw new AggregateError(failures, 'Simulation administration retains unconfirmed run ownership')
      await this.experimentOwner?.close()
      await this.retentionOwner?.close()
      await this.book?.drain()
      await this.stream?.close()
    })
  }
  /** Recover discovery and original request facts without opening native runs or requesting models. */
  protected async [Service.init](): Promise<void> { await this.ready }
  private async load(): Promise<void> {
    for (const template of this.templates.values()) {
      this.ctx.simulations.resolveInspection({ provider: template.provider,
        spec: { ...template.spec, runId: simulationRunIdSchema.parse(`template/${template.id}`) } })
      const preset = await this.ctx.agentPresets.resolve(template.preset)
      if (preset.broken !== undefined) throw invalid('Simulation template preset cannot compose an actor')
    }
    const experimentStream = await this.ctx.storageLog.open({ name: `${this.options.journalStream}/experiments`, version: 1 })
    this.experimentOwner = new ProductExperimentStore(experimentStream, { maxCommands: this.options.maxCommands,
      maxBytes: this.options.maxRetentionBytes, pageSize: this.options.recoveryPageSize })
    await this.experimentOwner.load()
    this.stream = await this.ctx.storageLog.open({ name: this.options.journalStream, version: 4 })
    this.book = new SimulationCreationStore(this.stream, this.options, this.experimentOwner.creations())
    await this.book.load()
    if ([...this.templates.values()].some(value => (value.driver.tasks !== undefined || value.driver.scenario !== undefined))
      || [...this.book.snapshot().creations.values()].some(value =>
        value.kind === 'company' && (value.driver.tasks !== undefined || value.driver.scenario !== undefined))) {
      if (this.ctx.get('teams') === undefined) throw invalid('Company task execution requires a canonical Team reader')
      this.ctx.effect(() => registerCompanyTaskPolicies(this.ctx.simulationTeams))
      this.ctx.effect(() => registerTaskScenarioPolicies(this.ctx.simulationTeams))
    }
    for (const creation of this.book.snapshot().creations.values()) await this.register(creation.record)
  }

  /**
   * Read the complete bounded installed company catalog and explicitly published World authoring templates under current authentication.
   * @param call - Transport-authenticated principal and wait lifetime.
   * @returns company version/route/limit metadata and opt-in authored World definitions; never resolves a native execution handle.
   */
  catalog(call: AuthenticatedProductCall): Promise<SimulationProductCatalog> {
    return this.admit(call, async () => {
      const value = { items: await Promise.all([...this.templates.values()].map(async template => ({
        id: template.id, version: template.version,
        kind: template.driver.scenario === undefined ? 'company-procurement' as const : 'task-workflow' as const, name: this.text(template.name),
        tickUnit: this.text(template.spec.tickUnit),
        readiness: await resolveTemplateModel(this.ctx, template, call.signal),
        review: template.driver.scenario?.steps.some(step => step.reviewerEntityId !== undefined) ? 'participant' as const : template.driver.tasks?.review ?? 'none' as const,
        execution: template.driver.tasks === undefined && template.driver.scenario === undefined ? 'cognition-only' as const : 'automatic-tasks' as const,
        cognition: template.driver.scenario === undefined ? template.driver.tasks?.cognition ?? 'model' as const : 'deterministic' as const,
        maxStock: template.spec.maxResourceQuantity,
        configuration: { ...this.configuration(template.spec), editable: template.editableLimits ?? [] } }))),
      ...this.options.world?.authoringTemplates === undefined ? {}
        : { worldTemplates: structuredClone(this.options.world.authoringTemplates) } }
      this.bytes(value); return simulationProductCatalogSchema.parse(value)
    })
  }
  /**
   * Validate permitted creation settings and current deployment/capacity without durable acceptance.
   * @param request - Template, names, stock and explicitly allowlisted immutable allowances.
   * @param call - Current authenticated principal and read lifetime.
   * @returns bounded field issues or exact defaults; readiness reserves no run, writer, actor or model permit.
   */
  preflight(request: SimulationProductPreflightInput, call: AuthenticatedProductCall): Promise<SimulationProductPreflightResult> {
    return this.admit(call, async () => {
      this.bytes(request)
      const parsed = simulationProductPreflightInputSchema.safeParse(request)
      const issues: SimulationProductPreflightIssue[] = []
      const issue = (field: string, code: SimulationProductPreflightIssue['code'], message: string) => issues.push({ field, code, message: this.text(message) })
      if (!parsed.success) {
        for (const value of parsed.error.issues.slice(0, 32)) issue(value.path.join('.').slice(0, 256) || 'configuration', 'invalid', 'Invalid or unsupported creation field')
        return this.preflightValue({ status: 'invalid', issues, readiness: { status: 'unavailable', reason: 'template-unavailable' } })
      }
      const template = this.templates.get(parsed.data.templateId)
      if (template === undefined) {
        issue('templateId', 'unavailable', 'Simulation template is unavailable')
        return this.preflightValue({ status: 'invalid', issues, readiness: { status: 'unavailable', reason: 'template-unavailable' } })
      }
      let contextWindow: number | undefined
      const readiness = await resolveTemplateModel(this.ctx, template, call.signal, (value) => { contextWindow = value })
      if (readiness.status !== 'ready') issue('model', 'unavailable', readiness.status === 'needs-model'
        ? 'Configure a default model before creating this simulation' : `Simulation model is unavailable: ${readiness.reason}`)
      const resolved = resolveCreation(template, parsed.data, value => this.text(value))
      issues.push(...resolved.issues)
      if (readiness.status === 'ready') {
        const refusal = this.modelRequestCapacity(resolved.spec.tokensPerModelRequest, contextWindow,
          resolveScenarioTopology({ ...parsed.data.parameters, topology: template.driver.scenario?.topology }).actors
            .map(actor => requiredCompanyContext(actor.id, template.driver.scenario !== undefined)))
        if (refusal !== undefined) issue(refusal.dimension === 'context-bytes' ? 'context' : 'tokensPerModelRequest',
          'capacity-unavailable', refusal.message)
      }
      try { this.capacity(this.store().snapshot()) }
      catch { issue('capacity', 'capacity-unavailable', 'Simulation creation capacity is currently occupied') }
      if (readiness.status === 'ready' && !this.executionAvailable({ ...template,
        driver: { ...template.driver, model: readiness.model } })) {
        issue('templateId', 'unavailable', 'Simulation template execution provider is unavailable')
      }
      try {
        const preset = await this.ctx.agentPresets.resolve(template.preset)
        if (preset.broken !== undefined) issue('templateId', 'unavailable', 'Simulation template preset cannot compose an actor')
      }
      catch { issue('templateId', 'unavailable', 'Simulation template preset is unavailable') }
      try { this.ctx.simulations.resolveInspection({ provider: template.provider,
        spec: { ...resolved.spec, runId: simulationRunIdSchema.parse('preflight-validation') } }) }
      catch { issue('templateId', 'unavailable', 'Simulation template storage provider is unavailable') }
      return this.preflightValue(issues.length === 0 && readiness.status === 'ready'
        ? { status: 'ready', configuration: this.configuration(resolved.spec), readiness }
        : { status: 'invalid', issues, readiness })
    })
  }
  private preflightValue(value: SimulationProductPreflightResult): SimulationProductPreflightResult {
    this.bytes(value); return simulationProductPreflightResultSchema.parse(value)
  }
  private executionAvailable(template: SimulationCompanyTemplate): boolean {
    const provider = this.ctx.agentRuntimes.getProvider('in-process')
    return provider !== undefined && isInProcessAgentRuntimeProvider(provider)
      && this.ctx.llm.listProviders().some(value => value.id === template.driver.model.provider)
  }
  /**
   * Inspect an authorized portable World definition against actual deployment metadata, without durable acceptance.
   * @param request - Definition only; provider, model routes and implementation configuration stay Host-selected.
   * @param call - Authenticated read lifetime.
   * @returns frozen compilation or field diagnostics with no identity, command, Session or inference allocation.
   */
  preflightWorld(request: SimulationProductWorldPreflightInput, call: AuthenticatedProductCall):
  Promise<SimulationProductWorldPreflightResult> {
    return this.admit(call, async () => {
      this.bytes(request)
      const input = simulationProductWorldPreflightInputSchema.parse(request), world = this.options.world
      if (world === undefined) throw unavailable('World scenario creation is not installed')
      const compiled = await preflightSimulationWorld(this.ctx, input.definition, world.catalog, call.signal,
        world.provider, input.templateManifest, world.model)
      const preview = worldPreflightPreview(compiled)
      const result = preview.status === 'ready' && compiled.ok
        ? { ...preview, capabilities: await worldPreflightCapabilities(this.ctx, compiled.resolved, world.provider, call.signal) }
        : preview
      this.bytes(result)
      return result
    })
  }

  /**
   * Retain one original World creation and its frozen preview resolution before allocating Native/Team identities.
   * @param request - Caller command, portable definition and exact reviewed preview; no execution starts here.
   * @param call - Authenticated owner; accepted preparation survives a disconnected waiter.
   * @returns immutable original command receipt. Changed payloads or previews reject; exact retries retain their original resolution.
   */
  createWorld(request: SimulationProductWorldCreateInput, call: AuthenticatedProductCall): Promise<SimulationProductRequestReceipt> {
    return this.admit(call, async () => {
      this.bytes(request)
      const input = simulationProductWorldCreateInputSchema.parse(request)
      let compiled: ScenarioCompilation | ScenarioV1Compilation | undefined
      const world = this.options.world
      if (!this.store().snapshot().commands.has(input.commandId)) {
        if (world === undefined) throw unavailable('World scenario creation is not installed')
        compiled = await preflightSimulationWorld(this.ctx, input.definition, world.catalog, call.signal,
          world.provider, input.templateManifest, world.model)
      }
      const command = await this.store().accept((state) => {
        this.authorize(call)
        if (this.closing) throw unavailable('World creation owner is retiring')
        const prior = state.commands.get(input.commandId)
        if (prior !== undefined) { this.same(prior, 'world-create', input, call); return { command: prior, existing: true } }
        this.capacity(state)
        if (compiled === undefined || world === undefined) throw unavailable('World scenario creation is not installed')
        if (!compiled.ok || compiled.preview.hash !== input.preflight.hash
          || compiled.preview.catalogGeneration !== input.preflight.catalogGeneration) throw preflightChanged()
        const currentModel = resolveWorldModel(this.ctx, world.catalog, world.model)
        if ('error' in currentModel || currentModel.catalog.generation !== compiled.resolved.catalogGeneration) throw preflightChanged()
        const team = this.ctx.get('teams')
        if (team === undefined) throw unavailable('World Team creation owner is unavailable')
        const actual = team.getCreationLimits()
        for (const key of Object.keys(actual) as (keyof typeof actual)[]) {
          const resolved = Math.min(input.definition.limits?.team?.[key] ?? world.catalog.limits.defaults.team[key],
            world.catalog.limits.ceilings.team[key], actual[key])
          if (resolved !== compiled.resolved.limits.team[key]) throw preflightChanged()
        }
        for (const actor of [...compiled.resolved.actors.map(value => value.runtime), compiled.resolved.generatedActorRuntime]) {
          const runtime = this.ctx.agentRuntimes.getProvider(actor.provider)
          if (!this.ctx.llm.listProviders().some(value => value.id === actor.model.provider)
            || runtime === undefined || !isInProcessAgentRuntimeProvider(runtime)) throw preflightChanged()
        }
        if (compiled.resolved.apiVersion === 'clocky.world/v1') {
          const registry = this.ctx.simulations.domains(world.provider)
          for (const pin of compiled.resolved.world.operations) {
            let current: typeof pin | undefined
            try { current = registry.pin({ domain: pin.domain, operation: pin.operation, version: pin.version }) }
            catch { /* A closed domain cannot accept a new frozen creation; the original preview must be refreshed. */ }
            if (!isDeepStrictEqual(current, pin)) throw preflightChanged()
          }
        }
        const runId = simulationProductRunIdSchema.parse(randomUUID()), acceptedAt = Date.now()
        const creation = simulationWorldCreationSchema.parse({ request: input,
          record: { id: runId, name: input.name, provider: world.provider, ownerPrincipalId: call.principal.id, registeredAt: acceptedAt,
            spec: { ...compiled.resolved.native, runId: simulationRunIdSchema.parse(runId) } },
          preparation: { resolved: compiled.resolved, ownerName: `simulation-product/${runId}`,
            checkpoint: { ...world.checkpoint, id: `product-initial/${input.commandId}` } } })
        this.ctx.simulations.resolveInspection({ provider: creation.record.provider, spec: creation.record.spec })
        const command: SimulationCreationCommand = { kind: 'world-create', input, creation, ownerPrincipalId: call.principal.id,
          receipt: { kind: 'world-create', commandId: input.commandId, runId, acceptedAt, status: 'accepted' } }
        this.receipt(command)
        return { existing: false, command }
      })
      this.launch(command)
      return this.receipt(command)
    })
  }

  /**
   * Reconcile an unstarted World from its original accepted artifact, never from current templates.
   * @param request - Owned run and original or new explicit preparation command.
   * @param call - Authenticated owner; original failed checkpoints are not silently substituted.
   * @returns durable receipt for this preparation attempt. A new command after an initial checkpoint failure collects
   * a distinct checkpoint with the original policy, without changing the original creation or canonical identities.
   */
  prepareWorld(request: SimulationProductPrepareInput, call: AuthenticatedProductCall): Promise<SimulationProductRequestReceipt> {
    return this.admit(call, async () => {
      const input = simulationProductPrepareInputSchema.parse(request); this.bytes(input)
      const command = await this.store().accept((state) => {
        this.authorize(call)
        const prior = state.commands.get(input.commandId)
        if (prior !== undefined) { this.same(prior, 'world-prepare', input, call); return { command: prior, existing: true } }
        const creation = this.ownedCreation(input.runId, call)
        if (creation.kind !== 'world') throw invalid('World preparation requires its original World creation')
        this.capacity(state, input.runId)
        const command: SimulationCreationCommand = { kind: 'world-prepare', input, ownerPrincipalId: call.principal.id,
          receipt: { kind: 'world-prepare', commandId: input.commandId, runId: input.runId, acceptedAt: Date.now(), status: 'accepted' } }
        this.receipt(command)
        return { existing: false, command }
      })
      this.launch(command)
      return this.receipt(command)
    })
  }

  /**
   * Export only the original portable definition for a new run, without reading runtime or Session history.
   * @param request - Original product run identity; it must have an owned World creation.
   * @param call - Current authenticated owner of that original definition.
   * @returns detached portable input; generated people, requests, plans, credentials and Host paths are excluded.
   */
  exportWorldDefinition(request: SimulationProductControlInput, call: AuthenticatedProductCall):
  Promise<SimulationProductWorldExportResult> {
    return this.admit(call, () => {
      const input = simulationProductControlInputSchema.parse(request); this.bytes(input)
      const creation = this.ownedCreation(input.runId, call)
      if (creation.kind !== 'world') throw invalid('Portable World export requires its original World creation')
      const result = simulationProductWorldExportResultSchema.parse({ runId: input.runId,
        definition: creation.request.definition })
      this.bytes(result)
      return result
    })
  }
  private modelRequestCapacity(tokensPerRequest: number, contextWindow?: number,
    contexts: readonly import('@clocky/clocky-simulation').SimulationContextRequest['sections'][] = []):
  { readonly dimension: 'context-bytes' | 'request-limit' | 'context-window'; readonly message: string } | undefined {
    for (const context of contexts.length === 0 ? [undefined] : contexts) {
      const capacity = this.ctx.simulationTeams.requestCapacity({ tokensPerRequest,
        ...contextWindow === undefined ? {} : { contextWindow },
        ...context === undefined ? {} : { knownRequiredContext: context } })
      if (capacity.status === 'impossible') return { dimension: capacity.dimension,
        message: `The ${capacity.dimension} allowance ${capacity.limit} cannot fit `
          + `the known required minimum ${capacity.minimumRequired} ${capacity.dimension === 'context-bytes' ? 'bytes' : 'tokens'}. `
          + 'Additional request context and future consumption remain unknown.' }
    }
    return undefined
  }

  private configuration(spec: Omit<import('@clocky/clocky-simulation').SimulationRunSpec, 'runId'>): SimulationProductConfiguration {
    return { limits: { maxEntities: spec.maxEntities, maxResidentActors: spec.maxResidentActors,
      tokensPerModelRequest: spec.tokensPerModelRequest, maxTokensPerInterval: spec.maxTokensPerInterval, maxTime: spec.maxTime },
    budgetInterval: spec.budgetInterval, tickUnit: this.text(spec.tickUnit), rulesVersion: this.text(spec.rulesVersion),
    policyVersion: this.text(spec.policyVersion), sharedModelLimit: this.ctx.simulationTeams.modelUsage().limit }
  }
  /**
   * Persist one original allocation and launch bounded preparation after durable acceptance.
   * @param request - Caller-retained command and permitted template parameters.
   * @param call - Current authenticated owner; carrier cancellation never cancels accepted preparation.
   * @returns stable run/command receipt; exact retries return its historical state and changed payloads reject.
   */
  create(request: SimulationProductCreateInput, call: AuthenticatedProductCall): Promise<SimulationProductRequestReceipt> {
    return this.admit(call, async () => {
      const input = simulationProductCreateInputSchema.parse(request); this.bytes(input)
      let readyTemplate: SimulationCompanyTemplate | undefined
      // Original retries preserve their deployment resolution even when today's preset changes or disappears.
      if (!this.store().snapshot().commands.has(input.commandId)) {
        const template = this.templates.get(input.templateId)
        if (template !== undefined) {
          let preset
          try { preset = await this.ctx.agentPresets.resolve(template.preset) }
          catch { throw unavailable('Simulation template preset is unavailable') }
          if (preset.broken !== undefined) throw unavailable('Simulation template preset cannot compose an actor')
          let contextWindow: number | undefined
          const readiness = await resolveTemplateModel(this.ctx, template, call.signal, (value) => { contextWindow = value })
          if (readiness.status !== 'ready') throw unavailable(`Simulation model is not ready: ${readiness.reason}`)
          if (!isDeepStrictEqual(input.expectedModel, readiness.model)) throw modelChanged()
          const resolved = resolveCreation(template, input, value => this.text(value))
          const refusal = this.modelRequestCapacity(resolved.spec.tokensPerModelRequest, contextWindow,
            resolveScenarioTopology({ ...input.parameters, topology: template.driver.scenario?.topology }).actors
              .map(actor => requiredCompanyContext(actor.id, template.driver.scenario !== undefined)))
          if (refusal !== undefined) throw invalid(refusal.message)
          readyTemplate = { ...template, driver: { ...template.driver, model: readiness.model } }
        }
      }
      const command = await this.store().accept((state) => {
        this.authorize(call)
        const prior = state.commands.get(input.commandId)
        if (prior !== undefined) { this.same(prior, 'create', input, call); return { command: prior, existing: true } }
        this.capacity(state)
        const installed = this.templates.get(input.templateId)
        const template = readyTemplate
        if (installed === undefined || template === undefined) throw unavailable('Simulation template is unavailable')
        const current = currentTemplateModel(this.ctx, installed)
        if (current.status !== 'ready' || !templateProviderAvailable(this.ctx, current.model)) {
          throw unavailable('Simulation template model provider is unavailable')
        }
        if (!isDeepStrictEqual(current.model, input.expectedModel)) throw modelChanged()
        const resolved = resolveCreation(template, input, value => this.text(value))
        const issue = resolved.issues[0]
        if (issue !== undefined) throw invalid(`${issue.field}: ${issue.message.text}`)
        if (!this.executionAvailable(template)) throw unavailable('Simulation template execution provider is unavailable')
        const runId = simulationProductRunIdSchema.parse(randomUUID())
        const acceptedAt = Date.now()
        const { expectedModel: _expectedModel, ...original } = input
        const creation: SimulationCompanyCreation = { request: original,
          record: { id: runId, name: input.name, provider: template.provider, ownerPrincipalId: call.principal.id, registeredAt: acceptedAt,
            spec: { ...resolved.spec, runId: simulationRunIdSchema.parse(runId) } },
          preparation: simulationCompanyPreparationSchema.parse({ version: '1', ownerName: `simulation-product/${runId}`, objective: template.objective, ...input.parameters,
            ...template.driver.scenario?.topology === undefined ? {} : { topology: template.driver.scenario.topology },
            participant: { provider: 'in-process', preset: template.preset, model: `${template.driver.model.provider}/${template.driver.model.name}` },
            checkpoint: { ...template.checkpoint, id: simulationCheckpointIdSchema.parse(`product-initial/${input.commandId}`) } }),
          driver: template.driver }
        this.ctx.simulations.resolveInspection({ provider: creation.record.provider, spec: creation.record.spec })
        const command: SimulationCreationCommand = { kind: 'create', input: original, creation, ownerPrincipalId: call.principal.id,
          receipt: { kind: 'create', commandId: input.commandId, runId, acceptedAt, status: 'accepted' } }
        this.receipt(command)
        return { existing: false, command }
      })
      this.launch(command)
      return this.receipt(command)
    })
  }
  /**
   * Register a distinct explicit preparation attempt on the original owned creation.
   * @param request - Original run and new or exact-retried preparation identity.
   * @param call - Authenticated owning principal; known/private absence has one refusal.
   * @returns immutable preparation attempt receipt; original failed attempts remain failed.
   */
  prepare(request: SimulationProductPrepareInput, call: AuthenticatedProductCall): Promise<SimulationProductRequestReceipt> {
    return this.admit(call, async () => {
      const input = simulationProductPrepareInputSchema.parse(request); this.bytes(input)
      const command = await this.store().accept((state) => {
        this.authorize(call)
        const prior = state.commands.get(input.commandId)
        if (prior !== undefined) { this.same(prior, 'prepare', input, call); return { command: prior, existing: true } }
        const creation = state.creations.get(input.runId)
        if (creation === undefined || creation.record.ownerPrincipalId !== call.principal.id) throw forbidden()
        if (creation.kind !== 'company') throw invalid('Company preparation requires its original company creation')
        this.capacity(state, input.runId)
        const command: SimulationCreationCommand = { kind: 'prepare', input, ownerPrincipalId: call.principal.id,
          receipt: { kind: 'prepare', commandId: input.commandId, runId: input.runId, acceptedAt: Date.now(), status: 'accepted' } }
        this.receipt(command)
        return { existing: false, command }
      })
      this.launch(command); return this.receipt(command)
    })
  }
  /**
   * Query the exact original accepted or terminal request without running reconciliation.
   * @param request - Original command identity.
   * @param call - Current authenticated principal.
   * @returns original fact or non-authoritative not-found; no outcome is inferred from a disconnected waiter.
   */
  request(request: SimulationProductRequestInput, call: AuthenticatedProductCall): Promise<SimulationProductRequestResult> {
    return this.admit(call, async () => {
      const input = simulationProductRequestInputSchema.parse(request); this.bytes(input)
      const command = this.store().snapshot().commands.get(input.commandId)
      const value = command?.ownerPrincipalId !== call.principal.id ? { status: 'not-found' as const, commandId: input.commandId }
        : { status: 'found' as const, request: this.receipt(command), ...command.kind === 'review' ? { review: command.input } : {},
          ...command.kind === 'retry-operation' ? { retryOperation: command.input } : {},
          ...command.kind === 'cancel-world-case' ? { worldCancellation: command.input } : {},
          ...command.kind === 'world-management' ? { worldManagement: command.input,
            worldManagementOutcome: await this.worldManagementOutcome(command, call) } : {},
          ...command.kind === 'cancel-task' ? { cancellation: command.input } : {} }
      this.bytes(value); return simulationProductRequestResultSchema.parse(value)
    })
  }

  /**
   * Discover original receipts after reconnecting or reauthenticating without opening a native owner.
   * @param request - Owned run, bounded page and optional exact journal revision.
   * @param call - Current authenticated principal; continuations bind this credential and service lifetime.
   * @returns receipt-only page ordered by acceptance time and command identity; journal changes retire continuations.
   */
  listRequests(request: SimulationProductRequestsInput, call: AuthenticatedProductCall): Promise<SimulationProductRequestsPage> {
    return this.admit(call, () => {
      const input = simulationProductRequestsInputSchema.parse(request); this.bytes(input)
      this.ownedCreation(input.runId, call)
      const limit = input.limit ?? this.options.maxRequestPageSize
      if (limit > this.options.maxRequestPageSize) throw invalid('Simulation request page exceeds its row allowance')
      const commands = [...this.store().snapshot().commands.values()].filter(command =>
        command.receipt.runId === input.runId && command.ownerPrincipalId === call.principal.id)
      const revision = commands.reduce((count, command) => count + (command.receipt.status === 'accepted' ? 1 : 2), 0)
      if (input.expectedRevision !== undefined && input.expectedRevision !== revision) throw stale()
      // The command store is keyed by unique commandId, so a timestamp tie always compares distinct identities.
      commands.sort((left, right) => left.receipt.acceptedAt - right.receipt.acceptedAt
        || (left.receipt.commandId < right.receipt.commandId ? -1 : 1))
      const query = { scope: JSON.stringify(['requests', input.runId]), revision, search: '', limit }
      let offset = 0
      if (input.cursor !== undefined) {
        try { offset = this.requestCursors.decode(input.cursor, call, query) }
        catch { throw stale() }
      }
      const items = commands.slice(offset, offset + limit).map(command => this.receipt(command))
      const next = offset + items.length
      const value = { runId: input.runId, snapshotRevision: revision, items, total: commands.length,
        ...next < commands.length ? { nextCursor: this.requestCursors.encode(call, { ...query, offset: next }) } : {} }
      this.bytes(value); return simulationProductRequestsPageSchema.parse(value)
    })
  }

  /**
   * Resume only the selected original retained semantics after an explicit user retry.
   * @param request - Exact owned run and original durable command identity; unknown selections refuse without allocation.
   * @param call - Current authenticated run owner; the original operation rechecks authority and native admission.
   * @returns original receipt unchanged when terminal; accepted commands use their existing public operation.
   * Cold accepted review/retry-operation commands require explicit owner restoration first. Disconnected waiters do
   * not cancel accepted preparation or maintenance; authentication-sensitive review/retry mutations keep their rules.
   */
  async retryRequest(request: SimulationProductRetryRequestInput,
    call: AuthenticatedProductCall): Promise<SimulationProductRequestReceipt> {
    const command = await this.admit(call, () => {
      const input = simulationProductRetryRequestInputSchema.parse(request); this.bytes(input)
      this.ownedCreation(input.runId, call)
      const original = this.store().snapshot().commands.get(input.commandId)
      if (original === undefined || original.receipt.runId !== input.runId
        || original.ownerPrincipalId !== call.principal.id) throw forbidden()
      return original
    })
    if (command.receipt.status !== 'accepted') return this.receipt(command)
    switch (command.kind) {
      case 'create': return this.create({ ...command.input, expectedModel: command.creation.driver.model }, call)
      case 'prepare': return this.prepare(command.input, call)
      case 'world-create': return this.createWorld(command.input, call)
      case 'world-prepare': return this.prepareWorld(command.input, call)
      case 'checkpoint': return this.checkpoint(command.input, call)
      case 'restore': return this.restore(command.input, call)
      case 'review': return this.resolveTaskReview(command.input, call)
      case 'cancel-task': return this.cancelTask(command.input, call)
      case 'cancel-world-case': return this.cancelWorldCase(command.input, call)
      case 'world-management': return this.submitWorldManagement(command.input, call)
      case 'retry-operation': return this.retryOperation(command.input, call)
      /* v8 ignore next -- retained commands are validated by the closed durable parser. */
      default: return assertNever(command)
    }
  }

  /**
   * Retain a full checkpoint request before closing scheduling admission and collecting native owners.
   * @param request - Original product run and caller-retained command; collector policy is server-derived.
   * @param call - Current authenticated owning principal; its retirement only ends the waiter.
   * @returns durable operation receipt; query the same command to distinguish accepted from terminal outcome.
   */
  checkpoint(request: SimulationProductCheckpointInput, call: AuthenticatedProductCall): Promise<SimulationProductRequestReceipt> {
    return this.admit(call, () => this.maintenance({ kind: 'checkpoint', input: simulationProductCheckpointInputSchema.parse(request) }, call))
  }

  /**
   * Explicitly validate a full checkpoint and the current suffix, retire old writers and acquire a paused product owner.
   * @param request - Original run, command and completed checkpoint; implementation/policy versions are server-derived.
   * @param call - Current authenticated owner; a lost waiter does not cancel accepted recovery.
   * @returns original durable recovery receipt; a new command revalidates history even after prior recovery success.
   */
  restore(request: SimulationProductRestoreInput, call: AuthenticatedProductCall): Promise<SimulationProductRequestReceipt> {
    return this.admit(call, () => this.maintenance({ kind: 'restore', input: simulationProductRestoreInputSchema.parse(request) }, call))
  }

  private async maintenance(request: { kind: 'checkpoint'; input: SimulationProductCheckpointInput }
    | { kind: 'restore'; input: SimulationProductRestoreInput }, call: AuthenticatedProductCall): Promise<SimulationProductRequestReceipt> {
    this.bytes(request.input)
    const command = await this.store().accept((state) => {
      this.authorize(call)
      const prior = state.commands.get(request.input.commandId)
      if (prior !== undefined) { this.same(prior, request.kind, request.input, call); return { command: prior, existing: true } }
      this.creation(request.input.runId, call)
      this.capacity(state, request.input.runId, request.kind === 'restore')
      if (request.kind === 'checkpoint' && this.held.get(request.input.runId)?.owner === undefined) {
        throw unavailable('Simulation checkpoint requires a prepared live owner')
      }
      const checkpointId = request.kind === 'restore' ? request.input.checkpointId
        : simulationCheckpointIdSchema.parse(`product-checkpoint/${request.input.commandId}`)
      const receipt: SimulationProductRequestReceipt = { kind: request.kind, commandId: request.input.commandId,
        runId: request.input.runId, checkpointId, acceptedAt: Date.now(), status: 'accepted' }
      this.bytes(receipt)
      const command: SimulationCreationCommand = request.kind === 'restore'
        ? { kind: 'restore', input: request.input, ownerPrincipalId: call.principal.id, receipt }
        : { kind: 'checkpoint', input: request.input, ownerPrincipalId: call.principal.id, receipt }
      return { command, existing: false }
    })
    this.launch(command)
    return this.receipt(command)
  }

  /** Read exact private portable bytes from a completed original, with independent disclosure authority.
   * @param request - Original run and retention command; retries preserve these identities.
   * @param call - Current authenticated owner and private-record grant.
   * @returns bounded immutable bundle; no live owner, model or scheduling operation is opened.
   */
  backupExport(request: SimulationProductBackupExportInput, call: AuthenticatedProductCall): Promise<SimulationProductBackupExportResult> {
    return this.admit(call, async () => {
      const input = simulationProductBackupExportInputSchema.parse(request); this.bytes(input)
      const authorize = () => {
        this.authorize(call); this.creation(input.runId, call)
        if (!this.ctx.simulationProducts.recordBodyAllowed(input.runId, call)) throw forbidden()
      }
      const body = await this.retention().source(input, call.principal.id, authorize)
      const ancestors: import('./types.ts').SimulationProductRunId[] = []
      let next = body.provenance?.[0]
      while (next !== undefined) {
        const ancestor = zod.object({ snapshot: zod.object({ spec: zod.object({ runId: simulationProductRunIdSchema }) }),
          provenance: zod.array(zod.json()).max(1).optional() }).parse(next)
        ancestors.push(ancestor.snapshot.spec.runId); next = ancestor.provenance?.[0]
      }
      const authorizeClosure = () => {
        authorize()
        if (ancestors.length && !this.ctx.simulationProducts.provenanceBodyAllowed(input.runId, call)) {
          for (const parentId of ancestors) if (!this.ctx.simulationProducts.recordBodyAllowed(parentId, call)) throw forbidden()
        }
      }
      authorizeClosure()
      const result = await this.retention().backupExport(input, call.principal.id, authorizeClosure)
      const creation = this.creation(input.runId, call)
      if (creation.kind === 'world-branch') {
        const frames = await this.experiments().exportOriginal(creation.input.commandId, call.principal.id, authorizeClosure)
        const limits = { maxEntries: this.options.maxRetentionEntries, maxBytes: this.options.maxRetentionBytes,
          pageSize: this.options.recoveryPageSize }
        const original = verifyWorldBackup(result.bundle, limits, this.ctx.simulationTeams.worldArchiveProviders())
        const portable = createWorldBackup(original.body, limits, zod.json().parse({ family: 'world-branch', entries: frames }),
          this.ctx.simulationTeams.worldArchiveProviders())
        productWorldBranchBackupCreation(portable)
        const bundle = JSON.stringify(portable), enriched = { ...result, bundle, bundleHash: createHash('sha256').update(bundle).digest('hex') }
        authorizeClosure(); this.bytes(enriched); return enriched
      }
      if (creation.kind !== 'world') throw invalid('Product full backup requires an original World creation')
      const originalId = creation.request.commandId
      const entries: unknown[] = []
      const source = this.stream
      if (source === undefined) throw unavailable('Product creation journal is unavailable')
      let after = -1
      const tail = source.tailSequence
      while (after < tail) {
        const page = await source.read(after, this.options.recoveryPageSize)
        if (!page.length) throw unavailable('Product source creation history is incomplete')
        for (const entry of page) {
          if (entry.sequence > tail) break
          const value = simulationCreationEntrySchema.parse(entry.value)
          if (value.kind === 'command/accepted' ? value.command.receipt.commandId === originalId : value.commandId === originalId)
            entries.push(zod.json().parse(entry.value))
          after = entry.sequence
        }
      }
      authorizeClosure()
      const limits = { maxEntries: this.options.maxRetentionEntries, maxBytes: this.options.maxRetentionBytes,
        pageSize: this.options.recoveryPageSize }
      const original = verifyWorldBackup(result.bundle, limits, this.ctx.simulationTeams.worldArchiveProviders())
      const portable = createWorldBackup(original.body, limits, zod.array(zod.json()).parse(entries),
        this.ctx.simulationTeams.worldArchiveProviders())
      productWorldBackupCreation(portable)
      const bundle = JSON.stringify(portable)
      const enriched = { ...result, bundle, bundleHash: createHash('sha256').update(bundle).digest('hex') }
      authorizeClosure(); this.bytes(enriched); return enriched
    })
  }

  /**
   * Register original Product creation frames after isolated target owners validate a paused import anchor.
   * This Host-only operation preserves the source principal and rejects live or colliding targets.
   * @param bundle - Verified private backup with original creation provenance.
   * @param checkpointId - Target checkpoint produced after owner replay and explicit cwd mapping.
   * @param call - Current original authenticated principal; imports never transfer authority.
   * @returns registration completion without acquiring an execution owner or starting inference.
   */
  importPausedBackup(bundle: WorldBackupBundle, checkpointId: string, call: AuthenticatedProductCall): Promise<void> {
    return this.admit(call, async () => {
      const limits = { maxEntries: this.options.maxRetentionEntries, maxBytes: this.options.maxRetentionBytes,
        pageSize: this.options.recoveryPageSize }
      const checked = verifyWorldBackup(JSON.stringify(bundle), limits, this.ctx.simulationTeams.worldArchiveProviders())
      const creation = productWorldBackupDescriptor(checked)
      const branchFamily = 'kind' in creation
      if (creation.record.ownerPrincipalId !== call.principal.id) throw forbidden()
      if (this.held.has(creation.record.id)) throw unavailable('Product backup target has a live execution owner')
      const observed = await this.ctx.simulations.inspect(this.ctx.simulations.resolveInspection({
        provider: creation.record.provider, spec: creation.record.spec, includeRecords: true }))
      this.authorize(call)
      const anchor = observed?.snapshot.checkpoints?.[simulationCheckpointIdSchema.parse(checkpointId)]
      if (observed?.snapshot.phase !== 'paused' || observed.owner !== 'unowned' || anchor?.status !== 'completed'
        || anchor.manifest.implementationVersion !== 'world/1'
        || !isDeepStrictEqual(observed.records?.slice(0, checked.body.native.entries.length), checked.body.native.entries))
        throw invalid('Product import requires validated original Native history and a paused compatible target checkpoint')
      if (branchFamily) {
        const envelope = zod.strictObject({ family: zod.literal('world-branch'), entries: zod.array(zod.json()).length(2) }).parse(checked.productJournal)
        const imported = await this.experiments().importOriginal(envelope.entries, call.principal.id, () =>{  this.authorize(call) })
        await this.store().addBranch(imported); this.authorize(call); await this.register(imported.record); return
      }
      const prior = this.store().snapshot().creations.get(creation.record.id)
      if (prior !== undefined) {
        const { kind: _kind, ...retained } = prior
        if (prior.kind !== 'world' || !isDeepStrictEqual(retained, creation)) throw invalid('Product import identity already exists')
      } else {
        await this.store().importOriginal(zod.array(zod.json()).parse(checked.productJournal))
      }
      this.authorize(call)
      await this.register(creation.record)
    })
  }

  private experiments(): ProductExperimentStore {
    if (!this.experimentOwner) throw unavailable('Product experiment journal is unavailable')
    return this.experimentOwner
  }
  private experimentAuthorize(source: SimulationProductExperimentSource, call: AuthenticatedProductCall): () => void {
    return () => {
      this.authorize(call); this.creation(source.runId, call)
      if (!this.ctx.simulationProducts.recordBodyAllowed(source.runId, call)) throw forbidden()
    }
  }
  private experimentSource(source: SimulationProductExperimentSource, call: AuthenticatedProductCall) {
    return this.retention().source({ runId: source.runId, commandId: source.archiveCommandId }, call.principal.id,
      this.experimentAuthorize(source, call))
  }
  /** Retain one explicit original branch command and prepare a paused writable simulation with fresh canonical identities.
   * @param request - Immutable source archive, UUID and memory intervention.
   * @param call - Authenticated owner with independent whole-record source disclosure.
   * @returns original paused branch receipt; retries preserve all original identities and never auto-start.
   */
  branchWorld(request: SimulationProductWorldBranchInput, call: AuthenticatedProductCall): Promise<SimulationProductWorldBranchResult> {
    return this.admit(call, async () => {
      const input = simulationProductWorldBranchInputSchema.parse(request); this.bytes(input)
      const authorize = this.experimentAuthorize(input.source, call)
      const result = await this.experiments().execute(input, call.principal.id, () =>{  this.authorize(call) }, authorize, async () => {
        const parent = this.creation(input.source.runId, call)
        if (parent.kind === 'company') throw invalid('Experiment branches require an original World source')
        const body = await this.experimentSource(input.source, call)
        const targetId = simulationProductRunIdSchema.parse(`world-branch-${input.commandId}`)
        const record = { id: targetId, name: input.name, provider: parent.record.provider,
          spec: { ...parent.record.spec, runId: simulationRunIdSchema.parse(targetId) },
          ownerPrincipalId: call.principal.id, registeredAt: Date.now() }
        const sourceHash = createHash('sha256').update(JSON.stringify(body)).digest('hex')
        let legacyCatalog: zod.infer<typeof scenarioCatalogSchema> | undefined
        if (parent.preparation.resolved.apiVersion === 'clocky.world/v0') {
          const installed = this.options.world?.catalog
          if (installed === undefined) throw unavailable('Legacy branch requires its matching original compiler catalog')
          legacyCatalog = scenarioCatalogSchema.parse({ generation: installed.generation, policyVersion: installed.policyVersion,
            native: installed.native, runtimeProfiles: installed.runtimeProfiles, templates: installed.templates,
            limits: installed.limits })
          const actual = this.ctx.teams.getCreationLimits()
          for (const key of Object.keys(actual) as (keyof typeof actual)[])
            legacyCatalog.limits.ceilings.team[key] = Math.min(legacyCatalog.limits.ceilings.team[key], actual[key])
          const reconstructed = await compileWorldScenario(parent.preparation.resolved.definition, legacyCatalog)
          authorize()
          if (!reconstructed.ok || !isDeepStrictEqual(reconstructed.resolved, parent.preparation.resolved))
            throw unavailable('Legacy branch catalog no longer reproduces the original compiler semantics')
        }
        try {
          await preflightWorldExperimentBranch(this.ctx, body, { commandId: input.commandId, memoryPolicy: input.memoryPolicy,
            variables: { memoryPolicy: input.memoryPolicy }, sourceHash,
            selection: { provider: record.provider, spec: record.spec, mode: 'create' } },
          { maxEntries: this.options.maxRetentionEntries, maxBytes: this.options.maxRetentionBytes,
            pageSize: this.options.recoveryPageSize }, authorize)
        } catch (cause) {
          if (cause instanceof SimulationProductError) throw cause
          throw invalid('Branch source requires a supported paused cut without unresolved duties, unsupported seed owners or conflicting target identities')
        }
        return { record, sourceHash, parentPreparation: simulationWorldPreparationSchema.parse(parent.preparation),
          ...legacyCatalog === undefined ? {} : { legacyCatalog } }
      }, async (original) => {
        authorize()
        const existing = this.held.get(original.record.id)
        if (existing) { await existing.owner?.close(); await existing.run.close(); this.held.delete(original.record.id) }
        if (this.held.size >= this.options.maxHeldRuns) throw unavailable('Product held-run capacity is occupied')
        const body = await this.experimentSource(input.source, call)
        const branch = await createWorldExperimentBranch(this.ctx, body, { commandId: input.commandId,
          memoryPolicy: input.memoryPolicy, variables: { memoryPolicy: input.memoryPolicy }, sourceHash: original.sourceHash,
          selection: { provider: original.record.provider, spec: original.record.spec, mode: 'create' } },
        { maxEntries: this.options.maxRetentionEntries, maxBytes: this.options.maxRetentionBytes,
          pageSize: this.options.recoveryPageSize }, authorize)
        this.held.set(original.record.id, { run: branch.run })
        let connectionClosed = false
        try {
          const resolved = await compileWorldExperimentRuntime(original.parentPreparation.resolved, branch.run.snapshot(), branch.lineage,
            original.legacyCatalog)
          authorize()
          const preparation = { resolved, ownerName: `simulation/experiment/${input.commandId}`,
            checkpoint: { ...original.parentPreparation.checkpoint, id: simulationCheckpointIdSchema.parse(`product-branch/${input.commandId}`) } }
          const checkpoint = await branch.connection.checkpoint({ ...preparation.checkpoint, implementationVersion: 'world/1' }, call.signal)
          if (checkpoint.status !== 'completed') throw unavailable('Branch initial checkpoint is incomplete')
          await branch.connection.close(); connectionClosed = true
          const creation: SimulationWorldBranchCreation = { kind: 'world-branch', record: original.record, input,
            sourceHash: original.sourceHash, preparation }
          this.held.set(original.record.id, { run: branch.run, owner: this.worldOwner(branch.run, creation, preparation) })
          return preparation
        } catch (cause) {
          if (!connectionClosed) await branch.connection.close()
          await branch.run.close(); this.held.delete(original.record.id); throw cause
        }
      }, async (creation) => { await this.store().addBranch(creation); await this.register(creation.record) })
      this.bytes(result); return result
    })
  }
  /** Read retained branch responsibility without opening any owner or Session.
   * @param request - Original command UUID.
   * @param call - Current authenticated principal.
   * @returns original paused metadata, or indistinguishable missing/foreign absence.
   */
  readWorldBranch(request: SimulationProductWorldBranchReadInput, call: AuthenticatedProductCall):
  Promise<SimulationProductWorldBranchResult> {
    return this.admit(call, () => {
      const input = simulationProductWorldBranchReadInputSchema.parse(request); this.bytes(input)
      const result = this.experiments().read(input.commandId, call.principal.id); this.bytes(result); return result
    })
  }
  /** Traverse actual immutable Native event references under independent source-read authority.
   * @param request - Exact retained cut and complete traversal bounds.
   * @param call - Current source owner and whole-record reader.
   * @returns bounded references with the original source selection; no model fills missing edges.
   */
  queryWorldCausal(request: SimulationProductWorldCausalInput, call: AuthenticatedProductCall):
  Promise<SimulationProductWorldCausalResult> {
    return this.admit(call, async () => {
      const input = simulationProductWorldCausalInputSchema.parse(request); this.bytes(input)
      const body = await this.experimentSource(input.source, call), authorize = this.experimentAuthorize(input.source, call)
      const { source, ...query } = input
      let value: ReturnType<typeof queryWorldCausalIndex>
      try { value = queryWorldCausalIndex(body, query, { maxEntries: this.options.maxRetentionEntries,
        maxBytes: this.options.maxRetentionBytes, pageSize: this.options.recoveryPageSize }, () => { authorize(); return true }) }
      catch (cause) {
        if (cause instanceof SimulationProductError) throw cause
        throw invalid('Causal traversal cannot satisfy the requested source and complete response bounds')
      }
      authorize(); const result = simulationProductWorldCausalResultSchema.parse({ source, ...value })
      if (Buffer.byteLength(JSON.stringify(result)) > input.maxBytes) throw invalid('Complete causal response exceeds requested byte bound')
      this.bytes(result); return result
    })
  }
  /** Compare two exact authorized archived observations with the same actual parent provenance.
   * @param request - Original left and right retention cuts.
   * @param call - Current owner with independent whole-record grants for both.
   * @returns bounded observed differences, budgets and explicit unknown quality/cost; no scheduling occurs.
   */
  compareWorlds(request: SimulationProductWorldCompareInput, call: AuthenticatedProductCall): Promise<SimulationProductWorldCompareResult> {
    return this.admit(call, async () => {
      const input = simulationProductWorldCompareInputSchema.parse(request); this.bytes(input)
      const left = await this.experimentSource(input.left, call), right = await this.experimentSource(input.right, call)
      const authorize = () => { this.experimentAuthorize(input.left, call)(); this.experimentAuthorize(input.right, call)() }
      let value: ReturnType<typeof compareWorldExperiments>
      try { value = compareWorldExperiments(left, right, { maxEntries: this.options.maxRetentionEntries,
        maxBytes: this.options.maxRetentionBytes, pageSize: this.options.recoveryPageSize }, authorize) }
      catch (cause) {
        if (cause instanceof SimulationProductError) throw cause
        throw invalid('Comparison requires compatible observations of the same parent cut within the configured bounds')
      }
      const result = simulationProductWorldCompareResultSchema.parse({ ...value, observations: input }); this.bytes(result); return result
    })
  }

  private retention(): ProductRetention {
    return this.retentionOwner ??= new ProductRetention(this.ctx, `${this.options.journalStream}/retention`, {
      maxEntries: this.options.maxRetentionEntries, maxBytes: this.options.maxRetentionBytes, pageSize: this.options.recoveryPageSize,
      maxCommands: this.options.maxCommands, maxResponseBytes: this.options.maxBytes,
    })
  }
  private captureRetention(runId: import('./types.ts').SimulationProductRunId, call: AuthenticatedProductCall) {
    const authorize = () => {
      this.authorize(call)
      const creation = this.creation(runId, call)
      if (creation.kind === 'company' || this.preparing(runId) || this.worldControlPending(runId)) throw unavailable('Retention requires a settled World owner')
    }
    authorize()
    const owner = this.held.get(runId)?.owner
    if (!(owner instanceof SimulationWorldOwner)) throw unavailable('Retention requires an explicitly prepared or recovered World owner')
    return owner.captureRetention({ maxEntries: this.options.maxRetentionEntries, maxBytes: this.options.maxRetentionBytes,
      pageSize: this.options.recoveryPageSize }, authorize).catch((error: unknown) => {
      if (error !== null && typeof error === 'object' && 'code' in error && error.code === 'SIMULATION_ARCHIVE_UNSUPPORTED')
        throw unavailable('Retention does not cover this source domain, runtime or external owner; an explicit export contract is required')
      throw error
    })
  }
  /** Preview an explicitly checkpointed paused source without changing scheduling or invoking a model.
   * @param request - Original product run to inspect.
   * @param call - Current authenticated owner and request lifetime.
   * @returns exact source-bound plan or a quiescence failure without retiring actors.
   */
  retentionPreview(request: SimulationProductRetentionPreviewInput,
    call: AuthenticatedProductCall): Promise<SimulationProductRetentionPlan> {
    return this.admit(call, async () => {
      const input = simulationProductRetentionPreviewInputSchema.parse(request); this.bytes(input)
      const body = await this.captureRetention(input.runId, call)
      const plan = this.retention().preview(input.runId, body); this.bytes(plan); return plan
    })
  }
  /** Retain the exact user-selected archive and publish its original location; identical command retries never recollect.
   * @param request - Original command, source revision and preview hash.
   * @param call - Current authenticated owning principal.
   * @returns durable original acceptance or completed archive metadata.
   */
  retentionExecute(request: SimulationProductRetentionExecuteInput,
    call: AuthenticatedProductCall): Promise<SimulationProductRetentionResult> {
    return this.admit(call, async () => {
      const input = simulationProductRetentionExecuteInputSchema.parse(request); this.bytes(input)
      const authorize = () => { this.authorize(call); this.creation(input.runId, call) }
      authorize()
      const result = await this.retention().execute(input, call.principal.id, authorize, () => this.captureRetention(input.runId, call))
      this.bytes(result); return result
    })
  }
  /** Read original acceptance/completion after interruption, without opening or resuming a simulation.
   * @param request - Original run and command identity.
   * @param call - Current authenticated owning principal.
   * @returns bounded durable status or authorized absence.
   */
  retentionRead(request: SimulationProductRetentionReadInput,
    call: AuthenticatedProductCall): Promise<SimulationProductRetentionResult> {
    return this.admit(call, async () => {
      const input = simulationProductRetentionReadInputSchema.parse(request); this.bytes(input)
      const authorize = () => { this.authorize(call); this.creation(input.runId, call) }
      authorize(); const result = await this.retention().read(input, call.principal.id, authorize); this.bytes(result); return result
    })
  }
  /** Read bounded archived originals only with the separate whole-record disclosure grant.
   * @param request - Original owner, sequence and finite page bound.
   * @param call - Current principal with an independent whole-record grant.
   * @returns exact original records within the complete response byte limit.
   */
  retentionRecords(request: SimulationProductRetentionRecordsInput,
    call: AuthenticatedProductCall): Promise<SimulationProductRetentionRecordsResult> {
    return this.admit(call, async () => {
      const input = simulationProductRetentionRecordsInputSchema.parse(request); this.bytes(input)
      const authorize = () => {
        this.authorize(call); this.creation(input.runId, call)
        if (!this.ctx.simulationProducts.recordBodyAllowed(input.runId, call)) throw forbidden()
      }
      authorize(); const result = await this.retention().records(input, call.principal.id, authorize); this.bytes(result); return result
    })
  }

  /**
   * Register one attributed input without adding world authority or changing the scheduling phase.
   * @param request - Exact original input identity, allowed entity, text and canonical earliest time.
   * @param call - Current authenticated owner; attribution comes from this principal, not browser fields.
   * @returns original assignment and independently observed consumption; identical retries do not inject twice.
   */
  ingress(request: SimulationProductIngressInput, call: AuthenticatedProductCall): Promise<SimulationProductIngressReceipt> {
    return this.admit(call, async () => {
      const input = simulationProductIngressInputSchema.parse(request); this.bytes(input)
      const creation = this.creation(input.runId, call)
      const observation = await this.observation(creation, call)
      const state = observation?.snapshot
      const native = simulationIngressRequestSchema.parse({ id: input.ingressId, entityId: input.entityId,
        text: input.text, availableAt: input.availableAt, source: `product-principal/${call.principal.id}` })
      const records = state?.ingresses ?? {}
      const prior = Object.hasOwn(records, input.ingressId) ? records[input.ingressId] : undefined
      if (prior !== undefined) {
        if (!isDeepStrictEqual(prior.request, native)) throw invalid('Simulation input identity has another original payload')
        const result = this.ingressReceipt(input.runId, prior, state)
        this.bytes(result); return simulationProductIngressReceiptSchema.parse(result)
      }
      const owner = this.held.get(input.runId)?.owner
      if (owner === undefined) throw unavailable('Simulation input requires a prepared or explicitly recovered owner')
      if (this.preparing(input.runId)) throw unavailable('Simulation native maintenance is in progress')
      if (creation.kind !== 'company' && this.worldControlPending(input.runId))
        throw unavailable('World management is in progress')
      const received = await owner.ingest(native, () => {
        this.authorize(call); this.creation(input.runId, call)
        if (this.preparing(input.runId)) throw unavailable('Simulation native maintenance is in progress')
        if (creation.kind !== 'company' && this.worldControlPending(input.runId))
          throw unavailable('World management is in progress')
        const target = this.held.get(input.runId)?.run.snapshot().entities[input.entityId]
        const allowed = creation.kind !== 'company'
          ? target?.cognition === 'agent' && target.phase === 'active' && target.readiness === 'ready' && target.kind !== 'generation-assistant'
          : resolveScenarioTopology(creation.preparation).actors.some(value => value.id === input.entityId)
        if (!allowed) {
          throw invalid('Simulation input target is not allowed by this scenario')
        }
        if (BigInt(input.availableAt) > BigInt(creation.record.spec.maxTime)) throw invalid('Simulation input exceeds the scenario time horizon')
        this.bytes(native)
        if (Buffer.byteLength(JSON.stringify(native)) > creation.record.spec.maxIngressBytes) {
          throw invalid('Simulation input exceeds native complete-byte allowance')
        }
      })
      const result = this.ingressReceipt(input.runId, received, this.held.get(input.runId)?.run.snapshot())
      this.bytes(result); return simulationProductIngressReceiptSchema.parse(result)
    })
  }

  /**
   * Read one original assignment and its recorded decision consumption without starting or attaching a run.
   * @param request - Exact original run/input identity.
   * @param call - Current authenticated owner checked around provider IO.
   * @returns original metadata or non-authoritative absence; text and principal details are omitted.
   */
  ingressRequest(request: SimulationProductIngressQuery, call: AuthenticatedProductCall): Promise<SimulationProductIngressResult> {
    return this.admit(call, async () => {
      const input = simulationProductIngressQuerySchema.parse(request); this.bytes(input)
      const state = (await this.observation(this.creation(input.runId, call), call))?.snapshot
      const records = state?.ingresses ?? {}
      const found = Object.hasOwn(records, input.ingressId) ? records[input.ingressId] : undefined
      const result = { runId: input.runId, ingressId: input.ingressId,
        ...found === undefined ? { status: 'not-found' as const } : { status: 'found' as const, receipt: this.ingressReceipt(input.runId, found, state) } }
      this.bytes(result); return simulationProductIngressResultSchema.parse(result)
    })
  }

  private ingressReceipt(runId: import('./types.ts').SimulationProductRunId, input: SimulationIngress,
    state: SimulationSnapshot | undefined): SimulationProductIngressReceipt {
    const wake = state?.wakes[input.eventId]
    const event = state?.scheduledEvents[input.eventId]
    const status = wake?.status === 'completed' ? 'consumed' : wake?.status === 'claimed' ? 'claimed'
      : wake?.status === 'cancelled' || event?.status === 'cancelled' ? 'cancelled' : 'pending'
    return { runId, ingressId: input.request.id, entityId: input.request.entityId, eventId: input.eventId,
      availableAt: input.request.availableAt, assignedAt: input.key.time, sequence: input.sequence, status,
      ...wake?.decisionId === undefined ? {} : { decisionId: wake.decisionId } }
  }

  /**
   * Inspect current scheduling ownership and preconditions without attaching or driving actors.
   * @param request - Original registered product run.
   * @param call - Current authenticated owning principal.
   * @returns separate durable phase, driver and in-flight work; a cold run remains recovery-required.
   */
  control(request: SimulationProductControlInput, call: AuthenticatedProductCall): Promise<SimulationProductControl> {
    return this.admit(call, async () => {
      const input = simulationProductControlInputSchema.parse(request); this.bytes(input)
      const creation = this.creation(input.runId, call)
      const held = this.held.get(input.runId)
      if (held !== undefined) {
        const result = this.controlValue(creation, undefined, 'this-provider', held.run.controlObservation())
        this.bytes(result); return simulationProductControlSchema.parse(result)
      }
      try {
        const observation = await this.observation(creation, call)
        const result = this.controlValue(creation, observation?.snapshot, observation?.owner)
        this.bytes(result); return simulationProductControlSchema.parse(result)
      } catch (cause: unknown) {
        this.authorize(call); this.creation(input.runId, call)
        if (!(cause instanceof SimulationProductReadError)) throw cause
        const result = { ...this.controlValue(creation, undefined, 'unavailable'),
          historyRead: { status: 'unavailable' as const, reason: cause.reason, ...cause.limit === undefined ? {} : { limit: cause.limit } } }
        this.bytes(result); return simulationProductControlSchema.parse(result)
      }
    })
  }

  /**
   * Enrich one bounded authorized Native status batch with independent current company scheduling metadata.
   * @param request - Exact registered run identities; native reads authorize the entire batch before provider IO.
   * @param call - Current authenticated reader; absent company administration never denies permitted directory metadata.
   * @returns bounded native facts, trusted original scenario version and real shared permits, without acquiring any owner.
   */
  runStatuses(request: SimulationProductRunStatusesInput, call: AuthenticatedProductCall): Promise<SimulationProductRunStatusesPage> {
    return this.admit(call, async () => {
      const input = simulationProductRunStatusesInputSchema.parse(request); this.bytes(input)
      const page = await this.ctx.simulationProducts.runStatuses(input, call)
      this.authorize(call)
      if (this.closing) throw unavailable('Simulation scheduling metadata is retiring')
      const book = this.store().snapshot()
      const items = page.items.map((item) => {
        const creation = book.creations.get(item.run.id) ?? this.experimentOwner?.creation(item.run.id)
        if (creation === undefined || creation.record.ownerPrincipalId !== call.principal.id) {
          return { ...item, operational: { status: 'unavailable' as const, observedAt: Date.now(),
            scenario: { status: 'unavailable' as const } } }
        }
        const observed = this.held.get(item.run.id)?.owner?.observe()
        return { ...item, operational: { status: 'observed' as const, observedAt: Date.now(),
          scenario: this.versions(creation).scenario, owner: this.held.has(item.run.id) ? 'held' as const : 'not-held' as const,
          driver: observed?.driver ?? 'idle' as const, inFlight: observed?.inFlight ?? this.jobs.has(item.run.id),
          ...observed?.stopTarget === undefined ? {} : { stopTarget: observed.stopTarget },
          driverSource: observed?.driverSource ?? { status: 'owner-unavailable' as const, observedAt: Date.now() },
          ...observed?.failure === undefined ? {} : { failure: observed.failure },
          ...observed?.stop === undefined ? {} : { stop: observed.stop },
          ...observed?.nextAttemptAt === undefined ? {} : { nextAttemptAt: observed.nextAttemptAt } } }
      })
      const result = { ...page, items, modelPool: observeModelPool(() => this.ctx.simulationTeams.modelUsage()) }
      this.bytes(result); return simulationProductRunStatusesPageSchema.parse(result)
    })
  }

  /**
   * Install, tighten or explicitly clear a persistent stopping boundary without starting inference.
   * @param request - Complete original command and target; clear explicitly carries null.
   * @param call - Current authenticated owner, rechecked at the Native write position and before publication.
   * @returns original idempotent receipt and a separate current control observation.
   */
  updateRunControl(request: import('./control-types.ts').SimulationProductRunControlInput, call: AuthenticatedProductCall):
  Promise<import('./control-types.ts').SimulationProductRunControlResult> {
    return this.admit(call, async () => {
      const input = simulationProductRunControlInputSchema.parse(request); this.bytes(input)
      const creation = this.creation(input.runId, call)
      const held = this.held.get(input.runId)
      const authorize = () => {
        this.authorize(call); this.creation(input.runId, call)
        if (held?.owner !== undefined && input.target !== null && held.run.runControlCommandObservation(input.commandId) === undefined) {
          const control = this.controlValue(creation, undefined, 'this-provider', held.run.controlObservation())
          const maximum = Number.MAX_SAFE_INTEGER
          const cut = { nativeRevision: maximum, nativeTime: '9'.repeat(256), clockRevision: maximum, clockValue: '9'.repeat(256),
            recordedAt: maximum, tokenBaseline: maximum, operationCount: maximum, requestCount: maximum, decisionCount: maximum,
            tokenReservationCount: maximum }
          const stopTarget = simulationRunControlObservationSchema.parse({ revision: maximum, commandId: input.commandId,
            target: input.target, nativeBoundary: '9'.repeat(256), activation: 'effective', state: 'draining',
            reason: 'native-boundary-reached', cut, steps: maximum, tokens: maximum, checkpointId: 'c'.repeat(128),
            checkpointAttemptCount: maximum, checkpoint: 'external-state-required' })
          this.bytes({ runId: input.runId, receipt: { commandId: input.commandId, revision: maximum,
            activation: 'effective', targetId: input.target.targetId }, control: { ...control, revision: maximum, observedAt: maximum, stopTarget } })
        }
      }
      let receipt
      let state
      let small
      if (held?.owner === undefined) {
        state = (await this.observation(creation, call))?.snapshot
        const prior = state?.runControl?.commands[input.commandId]
        if (prior === undefined) throw unavailable('Stop control requires completed preparation or explicit recovery')
        if (!isDeepStrictEqual(prior.command, { commandId: input.commandId, target: input.target }))
          throw invalid('Stop control command identity has another original target')
        receipt = prior.receipt
      } else {
        receipt = await held.owner.updateRunControl(input, authorize)
        small = held.run.controlObservation()
      }
      authorize()
      const result = { runId: input.runId, receipt,
        control: this.controlValue(creation, state, held === undefined ? undefined : 'this-provider', small) }
      this.bytes(result); return simulationProductRunControlResultSchema.parse(result)
    })
  }

  /**
   * Persist scheduling intent and drive the owned company through bounded background batches.
   * @param request - Exact caller-retained management identity and target phase; no proxy-only CAS is accepted.
   * @param call - Current authenticated owner; retiring the carrier ends only its wait, not admitted scheduling.
   * @returns original redacted management result and separate current observation; terminal retry never undoes later pause.
   */
  manage(request: SimulationProductManageInput, call: AuthenticatedProductCall): Promise<SimulationProductManageResult> {
    return this.admit(call, async () => {
      const input = simulationProductManageInputSchema.parse(request); this.bytes(input)
      const creation = this.creation(input.runId, call)
      const held = this.held.get(input.runId)
      const observation = held === undefined ? await this.observation(creation, call) : undefined
      const state = observation?.snapshot
      const managementId = input.managementId as unknown as import('@clocky/clocky-simulation').SimulationManagementId
      const prior = held?.run.managementObservation(managementId) ?? managementAt(state, managementId)
      if (prior !== undefined && (prior.request.phase !== input.phase || !isDeepStrictEqual(prior.request.tokenRecovery, input.tokenRecovery))) throw invalid('Simulation management identity has another original phase')
      const owner = this.held.get(input.runId)?.owner
      let operation
      if (prior !== undefined && prior.status !== 'in-progress') operation = prior
      else {
        if (owner === undefined) throw unavailable('Simulation scheduling requires completed preparation or explicit recovery')
        const authorize = () => {
          this.authorize(call); this.creation(input.runId, call)
          if (this.preparing(input.runId, input.phase === 'paused')) throw unavailable('Simulation preparation is still in progress')
          if (creation.kind !== 'company' && input.phase === 'running' && this.worldControlPending(input.runId))
            throw unavailable('World management or cancellation retains its original responsibility')
          // Numeric widths are bounded by the native safe-integer protocol, independent of concurrent model appends.
          const control = this.controlValue(creation, undefined, held === undefined ? undefined : 'this-provider', held?.run.controlObservation())
          this.bytes({ runId: input.runId, operation: { managementId: input.managementId, phase: input.phase,
            status: 'failed', startedSequence: Number.MAX_SAFE_INTEGER, finishedSequence: Number.MAX_SAFE_INTEGER,
            failure: 'details-withheld' }, control: { ...control, revision: Number.MAX_SAFE_INTEGER, observedAt: Number.MAX_SAFE_INTEGER,
            modelPool: { status: 'observed', clock: 'real', observedAt: Number.MAX_SAFE_INTEGER,
              active: Number.MAX_SAFE_INTEGER, queued: Number.MAX_SAFE_INTEGER,
              limit: Number.MAX_SAFE_INTEGER, queueLimit: Number.MAX_SAFE_INTEGER },
            stop: 'residency-recovery-required', nextAttemptAt: Number.MAX_SAFE_INTEGER } })
        }
        operation = await owner.manage(input, authorize)
      }
      const result = { runId: input.runId, operation: this.managementReceipt(operation),
        control: this.controlValue(creation, state, held === undefined ? observation?.owner : 'this-provider', held?.run.controlObservation()) }
      this.bytes(result); return simulationProductManageResultSchema.parse(result)
    })
  }

  /**
   * Query a durable original scheduling result through read-only history when its execution owner is absent.
   * @param request - Original product run and management identity.
   * @param call - Current authenticated owner, checked before and after provider IO.
   * @returns historical redacted result or non-authoritative absence; never opens a run or resumes models.
   */
  managementRequest(request: SimulationProductManagementInput, call: AuthenticatedProductCall): Promise<SimulationProductManagementResult> {
    return this.admit(call, async () => {
      const input = simulationProductManagementInputSchema.parse(request); this.bytes(input)
      const state = (await this.observation(this.creation(input.runId, call), call))?.snapshot
      const operation = managementAt(state, input.managementId as unknown as import('@clocky/clocky-simulation').SimulationManagementId)
      const result = { runId: input.runId, managementId: input.managementId,
        ...operation === undefined ? { status: 'not-found' as const } : { status: 'found' as const, operation: this.managementReceipt(operation) } }
      this.bytes(result); return simulationProductManagementResultSchema.parse(result)
    })
  }

  /**
   * Read current run-owned task controls without exposing task bodies, opening execution or starting inference.
   * @param request - Exact owned run, canonical observation fence and bounded continuation.
   * @param call - Current authenticated owner; every canonical read rechecks ownership before publication.
   * @returns one bounded task-source window; its cursor binds both world and canonical task revisions.
   */
  listTasks(request: SimulationProductTasksInput, call: AuthenticatedProductCall): Promise<SimulationProductTasksPage> {
    return this.admit(call, async () => {
      const input = simulationProductTasksInputSchema.parse(request); this.bytes(input)
      const creation = this.companyCreation(input.runId, call)
      const state = (await this.observation(creation, call))?.snapshot
      if (state === undefined) throw unavailable('Simulation task history is not materialized')
      if (input.expectedRevision !== undefined && state.revision !== input.expectedRevision) throw stale()
      const limit = input.limit ?? this.options.maxReviewPageSize
      if (limit > this.options.maxReviewPageSize) throw invalid('Simulation task page exceeds deployment allowance')
      const teams = this.ctx.get('teams')
      if (teams === undefined) throw unavailable('Simulation task controls have no canonical Team reader')
      const items: SimulationProductTaskControl[] = []
      for (const operation of Object.values(state.operations)) {
        const receipt = operation.outbox?.taskReceipt
        if (operation.action.kind !== 'task/create' || receipt === undefined) continue
        let task
        try { task = await teams.getTask({ teamId: receipt.teamId, taskId: receipt.taskId }) }
        catch { this.authorize(call); this.companyCreation(input.runId, call); throw unavailable('Canonical Simulation task metadata is unavailable') }
        this.authorize(call); this.companyCreation(input.runId, call)
        const source = task.createCommand.creator
        if (task.teamId !== receipt.teamId || task.id !== receipt.taskId
          || !('kind' in source) || source.runId !== state.spec.runId
          || source.operationId !== operation.id) throw unavailable('Canonical task has another Simulation source')
        const reason = ['completed', 'failed', 'cancelled', 'deleted'].includes(task.phase) ? 'terminal' as const
          : task.cancellation !== undefined ? 'cancellation-pending' as const
            : this.preparing(input.runId) ? 'maintenance-in-progress' as const
              : this.held.get(input.runId)?.owner === undefined ? 'recovery-required' as const : 'ready' as const
        items.push({ operationId: operation.id, teamId: task.teamId, taskId: task.id, taskRevision: task.revision,
          phase: task.phase, attemptCount: task.attemptCount, maxAttempts: task.maxAttempts,
          expectedAttemptId: task.lease?.attemptId ?? null,
          ...task.cancellation === undefined ? {} : { cancellation: { requestedAt: task.cancellation.requestedAt,
            target: task.cancellation.target.kind } }, cancel: { allowed: reason === 'ready', reason } })
      }
      const selection = { scope: JSON.stringify(['task-controls', input.runId]), revision: state.revision,
        search: createHash('sha256').update(JSON.stringify(items)).digest('hex'), limit }
      let offset = 0
      if (input.cursor !== undefined) {
        try { offset = this.taskCursors.decode(input.cursor, call, selection) }
        catch { throw stale() }
      }
      const rows = items.slice(offset, offset + limit)
      const value = () => ({ runId: input.runId, snapshotRevision: state.revision, observedAt: Date.now(), total: items.length,
        items: rows, ...offset + rows.length < items.length ? { nextCursor: this.taskCursors.encode(call,
          { ...selection, offset: offset + rows.length }) } : {} })
      while (Buffer.byteLength(JSON.stringify(value())) > this.options.maxBytes && rows.length > 1) rows.pop()
      const result = value(); this.bytes(result)
      return simulationProductTasksPageSchema.parse(result)
    })
  }

  /**
   * Persist one original scoped cancellation before canonical task IO; accepted work outlives its transport waiter.
   * @param request - Original command and exact source/task revision/attempt selection, with authored reason.
   * @param call - Current run owner; native authority is minted from the retained accepted source.
   * @returns original request receipt; completion confirms cancellation/cleanup, never general Team write access.
   */
  cancelTask(request: SimulationProductTaskCancelInput, call: AuthenticatedProductCall): Promise<SimulationProductRequestReceipt> {
    return this.admit(call, async () => {
      const input = simulationProductTaskCancelInputSchema.parse(request); this.bytes(input)
      const command = await this.store().accept((state) => {
        this.authorize(call)
        const prior = state.commands.get(input.commandId)
        if (prior !== undefined) { this.same(prior, 'cancel-task', input, call); return { command: prior, existing: true } }
        this.companyCreation(input.runId, call)
        if (this.held.get(input.runId)?.owner === undefined) throw unavailable('Simulation cancellation requires explicit owner restore')
        this.capacity(state, input.runId)
        const command: SimulationCreationCommand = { kind: 'cancel-task', input, ownerPrincipalId: call.principal.id,
          receipt: { kind: 'cancel-task', runId: input.runId, commandId: input.commandId, acceptedAt: Date.now(), status: 'accepted' } }
        this.receipt(command)
        this.bytes({ status: 'found', request: { ...command.receipt, status: 'failed', failure: 'cancel-task-failed' }, cancellation: input })
        return { command, existing: false }
      })
      /* v8 ignore next -- A prior command must pass same(kind), and a new command is constructed as cancel-task. */
      if (command.kind !== 'cancel-task') throw invalid('Simulation cancellation command has another operation kind')
      if (command.receipt.status === 'accepted' && !this.jobs.has(input.runId)) {
        const owner = this.held.get(input.runId)?.owner
        if (owner === undefined) throw unavailable('Simulation cancellation requires explicit owner restore')
        if (!(owner instanceof SimulationCompanyOwner)) throw unavailable('Simulation task cancellation requires its company owner')
        let terminal = false
        const work = owner.cancelTask(command.input, () => { this.authorize(call); this.companyCreation(input.runId, call)
          if (this.closing) throw unavailable('Simulation cancellation owner is retiring')
        }, async () => { terminal = true; await this.store().finish(input.commandId) }).catch(async (cause: unknown) => {
          if (!terminal && cause instanceof SimulationProductError) await this.store().finish(input.commandId, 'cancel-task-failed')
          else throw cause
        })
        this.trackRunJob(input.runId, work)
        /* Unknown cleanup or terminal publication retains its accepted original. */
      }
      return this.receipt(command)
    })
  }

  /** Retain accepted background work until settlement; unknown failures keep the original command receipt. */
  private trackRunJob(runId: string, operation: Promise<void>): void {
    const work = operation.finally(() => { if (this.jobs.get(runId) === work) this.jobs.delete(runId) })
    this.jobs.set(runId, work)
    void work.catch((_cause: unknown) => { /* The receipt owner retains an unknown accepted outcome after a lost response. */ })
  }

  /** Retain one independently bounded original cancellation while its user provider is still running. */
  private trackWorldCancellation(runId: string, operation: Promise<void>): void {
    const work = operation.finally(() => { if (this.cancellationJobs.get(runId) === work) this.cancellationJobs.delete(runId) })
    this.cancellationJobs.set(runId, work)
    void work.catch((_cause: unknown) => { /* Native cleanup remains accepted until the original cancellation is reconciled. */ })
  }

  /** Match only the exact accepted management command that owns this Native user case. */
  private managesWorldCase(command: SimulationCreationCommand, runId: string,
    requestId: import('@clocky/clocky-simulation/world-types').WorldRequestId): boolean {
    if (command.kind !== 'world-management' || command.receipt.runId !== runId) return false
    const state = this.held.get(runId)?.run.snapshot(), original = state?.world?.requests[requestId]
    return original?.operationId === null && original.source.commandId === command.native.commandId
      && original.source.principalId === command.ownerPrincipalId
  }

  /**
   * Project current original-owner cancellation admission without allocating execution or trusting a public hint.
   * @param runId - Authorized registered World run.
   * @param requestId - Original run-local case identity.
   * @param native - Read producer's terminal or recovery observation.
   * @param call - Current authenticated lease, rechecked by the read producer after this operation.
   * @param snapshotRevision - Exact prefix used by the read producer; newer held state cannot replace its quote.
   * @returns bounded advisory eligibility; cancellation independently rechecks its selected case and durable capacity.
   */
  private worldCaseCancelCapability(runId: import('./types.ts').SimulationProductRunId,
    requestId: import('@clocky/clocky-simulation/world-types').WorldRequestId,
    native: import('./case-types.ts').SimulationProductWorldCaseCancelCapability,
    call: AuthenticatedProductCall, snapshotRevision: number): Promise<import('./case-types.ts').SimulationProductWorldCaseCancelCapability> {
    return this.admit(call, () => {
      if (native.reason === 'terminal' || native.reason === 'in-progress') return native
      if (this.closing) return { allowed: false, reason: 'retiring' }
      const book = this.store().snapshot(), creation = book.creations.get(runId), live = this.held.get(runId)
      if (creation?.kind !== 'world' || creation.record.ownerPrincipalId !== call.principal.id
        || !(live?.owner instanceof SimulationWorldOwner)) return { allowed: false, reason: 'recovery-required' }
      const state = live.run.snapshot()
      if (state.revision !== snapshotRevision) return { allowed: false, reason: 'stale' }
      const original = state.world?.requests[requestId]
      if (original === undefined) return { allowed: false, reason: 'recovery-required' }
      if (original.status === 'cancel-requested') return { allowed: false, reason: 'in-progress' }
      if (original.status !== 'open' && original.status !== 'awaiting-evidence') return { allowed: false, reason: 'terminal' }
      if (live.owner.observe().driver === 'retiring') return { allowed: false, reason: 'retiring' }
      const pending = [...book.commands.values()].filter(value => value.receipt.status === 'accepted')
      const management = pending.some(value => this.managesWorldCase(value, runId, requestId))
      if (this.cancellationJobs.has(runId) || this.jobs.has(runId) && !management
        || pending.some(value => value.receipt.runId === runId && !this.managesWorldCase(value, runId, requestId)))
        return { allowed: false, reason: 'in-progress' }
      if (book.commands.size >= this.options.maxCommands || pending.length >= this.options.maxPendingPreparations) {
        return { allowed: false, reason: 'capacity' }
      }
      const preview = worldCaseCancelPreview(state, requestId)
      if (preview === undefined) return { allowed: false, reason: 'recovery-required' }
      this.bytes(preview)
      return { allowed: true, reason: 'ready', preview }
    })
  }

  /**
   * Inspect real current personnel choices without opening a run or reserving business work.
   * @param request - Owned run, exact person and one installed management family.
   * @param call - Current authenticated owner and read lifetime.
   * @returns bounded fields with exact Native/person revisions; recovery absence is explicit.
   */
  worldManagementFields(request: SimulationProductWorldManagementFieldsInput,
    call: AuthenticatedProductCall): Promise<SimulationProductWorldManagementFields> {
    return this.admit(call, async () => {
      const input = simulationProductWorldManagementFieldsInputSchema.parse(request); this.bytes(input)
      const context = await this.worldManagementState(input.runId, call)
      const value = worldManagementFields(context.state, input, this.worldManagementResolution(context.state))
      const owner = this.held.get(input.runId)?.owner
      const result = owner instanceof SimulationWorldOwner ? value
        : { ...value, status: 'unavailable' as const, reason: 'recovery-required' }
      this.bytes(result); return simulationProductWorldManagementFieldsSchema.parse(result)
    })
  }

  /** Validate a complete paused schedule replacement using the already held original Native owner.
   * @param request - Exact owned run and replacement command.
   * @param call - Current authenticated principal; no caller identity comes from request JSON.
   * @returns inert quote bound to the actual Native revision and original payload.
   */
  previewWorldCalendar(request: SimulationProductCalendarInput, call: AuthenticatedProductCall):
  Promise<SimulationProductCalendarPreview> {
    return this.admit(call, async () => {
      const input = simulationProductCalendarInputSchema.parse(request); this.bytes(input)
      await this.worldManagementState(input.runId, call)
      const owner = this.held.get(input.runId)?.owner
      if (!(owner instanceof SimulationWorldOwner)) throw unavailable('Calendar preview requires explicit original-owner restore')
      const preview = owner.previewCalendar(input.request)
      this.authorize(call); this.creation(input.runId, call)
      const previewHash = `sha256:${createHash('sha256').update(JSON.stringify({ input, revision: preview.revision })).digest('hex')}`
      return simulationProductCalendarPreviewSchema.parse({ input, ...preview, previewHash })
    })
  }

  /** Recover an original private calendar quote without restoring or acquiring a writer.
   * @param request - Owned run and optional exact command identity.
   * @param call - Current authenticated author.
   * @returns original pending/applied/cancelled outcome, or null for unavailable identities.
   */
  readWorldCalendarCommand(request: SimulationProductCalendarCommandInput, call: AuthenticatedProductCall):
  Promise<SimulationProductCalendarCommandResult> {
    return this.admit(call, async () => {
      const input = simulationProductCalendarCommandInputSchema.parse(request); this.bytes(input)
      const context = await this.worldManagementState(input.runId, call)
      this.authorize(call); this.creation(input.runId, call)
      return projectCalendarCommand(context.state, input.runId, call.principal.id, input.commandId)
    })
  }

  /** Retain one original user quote before any request can execute its effect.
   * @param request - Complete original quote and command identity.
   * @param call - Authenticated original author.
   * @returns durable original quote; retention alone never reschedules a calendar.
   */
  retainWorldCalendar(request: SimulationProductCalendarSubmit, call: AuthenticatedProductCall):
  Promise<SimulationProductCalendarCommandResult> {
    return this.admit(call, async () => {
      const input = simulationProductCalendarSubmitSchema.parse(request); this.bytes(input)
      await this.worldManagementState(input.input.runId, call)
      const owner = this.held.get(input.input.runId)?.owner
      if (!(owner instanceof SimulationWorldOwner)) throw unavailable('Calendar retention requires explicit original-owner restore')
      const expectedHash = `sha256:${createHash('sha256').update(JSON.stringify({ input: input.input, revision: input.revision })).digest('hex')}`
      if (expectedHash !== input.previewHash) throw new SimulationProductError('Calendar quote changed before retention', 'SIMULATION_PRODUCT_MANAGEMENT_PREVIEW_CHANGED')
      this.authorize(call); this.creation(input.input.runId, call)
      const retained = await owner.retainCalendar(input.input.request, input.revision, input.previewHash, call.principal.id)
      const observed = await this.worldManagementState(input.input.runId, call)
      return projectCalendarCommand(observed.state, input.input.runId, call.principal.id, retained.request.commandId)
    })
  }

  /** Withdraw an original retained intent while preserving a raced accepted effect.
   * @param request - Exact original command identity.
   * @param call - Actual authenticated author.
   * @returns the authoritative cancellation or application outcome.
   */
  cancelWorldCalendar(request: SimulationProductCalendarCancel, call: AuthenticatedProductCall):
  Promise<SimulationProductCalendarCommandResult> {
    return this.admit(call, async () => {
      const input = simulationProductCalendarCancelSchema.parse(request); this.bytes(input)
      await this.worldManagementState(input.runId, call)
      const owner = this.held.get(input.runId)?.owner
      if (!(owner instanceof SimulationWorldOwner)) throw unavailable('Calendar cancellation requires explicit original-owner restore')
      this.authorize(call); this.creation(input.runId, call)
      const state = await owner.cancelCalendar(input.commandId, call.principal.id)
      return projectCalendarCommand(state, input.runId, call.principal.id, input.commandId)
    })
  }

  /** Commit the unchanged quote with Native command deduplication; retries survive a lost transport reply.
   * @param request - Complete original quote and command identity.
   * @param call - Current authenticated owner retained as Native provenance.
   * @returns original acceptance sequence and rule revision; stale or changed input rejects before append.
   */
  submitWorldCalendar(request: SimulationProductCalendarSubmit, call: AuthenticatedProductCall):
  Promise<SimulationProductCalendarReceipt> {
    return this.admit(call, async () => {
      const input = simulationProductCalendarSubmitSchema.parse(request); this.bytes(input)
      const context = await this.worldManagementState(input.input.runId, call)
      const command = context.state.worldBootstrap?.calendarCommands
        ?.find(value => value.request.commandId === input.input.request.commandId)
      if (command === undefined || command.principalId !== call.principal.id || command.quoteRevision !== input.revision
        || command.quoteHash !== input.previewHash || command.cancelledAt !== undefined
        || !isDeepStrictEqual(command.request, input.input.request))
        throw invalid('Calendar execution requires the exact original retained author command')
      const owner = this.held.get(input.input.runId)?.owner
      if (!(owner instanceof SimulationWorldOwner)) throw unavailable('Calendar update requires explicit original-owner restore')
      const expectedHash = `sha256:${createHash('sha256').update(JSON.stringify({ input: input.input, revision: input.revision })).digest('hex')}`
      if (expectedHash !== input.previewHash)
        throw new SimulationProductError('Calendar preview changed before acceptance', 'SIMULATION_PRODUCT_MANAGEMENT_PREVIEW_CHANGED')
      this.authorize(call); this.creation(input.input.runId, call)
      const state = await owner.reviseCalendar(input.input.request, input.revision, call.principal.id)
      const retained = state.worldBootstrap?.calendarRevisions?.find(value => value.request.commandId === input.input.request.commandId)
      if (retained === undefined) throw unavailable('Calendar acceptance receipt is unavailable')
      return simulationProductCalendarReceiptSchema.parse({ runId: input.input.runId, commandId: retained.request.commandId,
        revision: retained.sequence, ruleRevision: retained.revision, sequence: retained.sequence })
    })
  }

  /**
   * Preview actual identities, fees and obligations under a current canonical source fence, with no reservation or inference.
   * @param request - Complete original form choices and the displayed person's revision.
   * @param call - Actual authenticated owner; authority is checked again at Native's read boundary.
   * @returns inert impact and original Native commitment; waiting duties do not masquerade as impossible admission.
   */
  previewWorldManagement(request: SimulationProductWorldManagementDraft,
    call: AuthenticatedProductCall): Promise<SimulationProductWorldManagementPreview> {
    return this.admit(call, async () => {
      const input = simulationProductWorldManagementDraftSchema.parse(request); this.bytes(input)
      const context = await this.worldManagementState(input.runId, call)
      const action = resolveWorldManagementDraft(context.state, input, this.worldManagementResolution(context.state))
      const source = await this.worldManagementSource(context, action, call)
      try {
        const native = await this.ctx.simulations.previewWorldManagement(context.selection,
          { action, expectedRevision: source.state.revision }, source.authority)
        this.authorize(call); this.creation(input.runId, call)
        if (native === undefined) throw unavailable('World management Native preview is unavailable')
        const projected = source.report === undefined ? { value: { obligations: [] }, coverage: {
          scope: 'hiring-market/review', loaded: 0, total: 0, complete: true, revision: source.state.revision, at: source.state.time } }
          : projectWorldDomain(source.state, { kind: 'person', runId: input.runId, personId: input.targetId,
            section: 'obligations' }, { runId: input.runId, at: source.state.time, limit: source.report.items.length + 1,
            personnel: source.report, text: value => this.text(value), context: () => false, case: () => false,
            persona: () => false, resident: () => false, page: (items, scope, incomplete = false) => ({ items,
              coverage: { scope, loaded: items.length, revision: source.state.revision, at: source.state.time,
                complete: !incomplete, ...incomplete ? { reason: typeof incomplete === 'string' ? incomplete : 'native-only' as const }
                  : { total: items.length } } }) })
        const obligations = wire.object({ obligations: wire.array(worldReadObligationSchema) }).parse(projected.value).obligations
        const value = { apiVersion: 'clocky.world-management/v1' as const, input, runId: input.runId,
          revision: input.expectedRevision, snapshotRevision: native.snapshotRevision, previewHash: native.previewHash,
          sourceFingerprint: native.sourceFingerprint, admission: native.admission, blockers: native.blockers,
          settlementRequirements: worldManagementSettlement(action, source.report, native),
          impact: native.impact, hiringFee: native.hiringFee,
          impacts: [this.text('Management executes without inference and keeps scheduling paused.')], obligations, coverage: projected.coverage }
        this.bytes(value); return simulationProductWorldManagementPreviewSchema.parse(value)
      } finally { source.dispose() }
    })
  }

  /**
   * Retain one immutable authenticated command before Native acceptance, then execute only its original direct plan.
   * @param request - Original form, command identity and the exact confirmed Native preview hash/revision.
   * @param call - Actual authenticated owner; caller/Decision/sender fields are never accepted from the payload.
   * @returns original receipt; callback uncertainty stays accepted and exact retry cannot change the case or create an owner.
   */
  submitWorldManagement(request: SimulationProductWorldManagementSubmitInput,
    call: AuthenticatedProductCall): Promise<SimulationProductRequestReceipt> {
    return this.admit(call, async () => {
      const input = simulationProductWorldManagementSubmitInputSchema.parse(request); this.bytes(input)
      let source: Awaited<ReturnType<SimulationAdministration['worldManagementSource']>> | undefined
      try {
        const previous = this.store().snapshot().commands.get(input.commandId)
        if (previous !== undefined) this.same(previous, 'world-management', input, call)
        if (previous !== undefined && previous.receipt.status !== 'accepted') return this.receipt(previous)
        if (previous !== undefined && this.jobs.has(input.runId)) return this.receipt(previous)
        const context = await this.worldManagementState(input.runId, call)
        const owner = this.held.get(input.runId)?.owner
        if (!(owner instanceof SimulationWorldOwner)) throw unavailable('World management requires explicit original-owner restore')
        const native = previous?.kind === 'world-management' ? previous.native : simulationWorldManagementSubmitRequestSchema.parse({
          commandId: worldManagementCommandIdSchema.parse(input.commandId),
          action: resolveWorldManagementDraft(context.state, input.draft, this.worldManagementResolution(context.state)),
          expectedRevision: input.previewRevision, previewHash: input.previewHash })
        const retained = inspectWorldManagement(context.state, native.commandId, call.principal.id)
        if (retained === undefined) {
          source = await this.worldManagementSource(context, native.action, call)
          let checked
          try { checked = await this.ctx.simulations.previewWorldManagement(context.selection,
            { action: native.action, expectedRevision: native.expectedRevision }, source.authority) }
          catch (cause: unknown) {
            if (cause instanceof SimulationWorldError && (cause.code === 'SIM_WORLD_CONFLICT' || cause.code === 'SIM_WORLD_AUTHORITY'))
              throw new SimulationProductError('World management preview changed before command acceptance',
                'SIMULATION_PRODUCT_MANAGEMENT_PREVIEW_CHANGED')
            throw cause
          }
          this.authorize(call)
          if (checked?.previewHash !== native.previewHash || checked.admission !== 'allowed')
            throw new SimulationProductError('World management preview changed before command acceptance',
              'SIMULATION_PRODUCT_MANAGEMENT_PREVIEW_CHANGED')
        }
        const command = await this.store().accept((state) => {
          this.authorize(call); this.creation(input.runId, call)
          const prior = state.commands.get(input.commandId)
          if (prior !== undefined) { this.same(prior, 'world-management', input, call); return { command: prior, existing: true } }
          this.capacity(state, input.runId)
          if (this.jobs.has(input.runId)) throw unavailable('World management has another admitted run operation')
          const command: SimulationCreationCommand = { kind: 'world-management', input, native,
            ownerPrincipalId: call.principal.id, receipt: { kind: 'world-management', commandId: input.commandId,
              runId: input.runId, acceptedAt: Date.now(), status: 'accepted' } }
          this.bytes({ status: 'found', request: { ...command.receipt, status: 'failed', failure: 'world-management-failed' },
            worldManagement: input })
          return { command, existing: false }
        })
        if (command.kind !== 'world-management') throw invalid('Original World management command has another kind')
        if (command.receipt.status === 'accepted' && !this.jobs.has(input.runId) && !this.cancellationJobs.has(input.runId)) {
          const authority = source?.authority ?? this.worldManagementRetainedAuthority(command, context.creation, call)
          const scope = source
          const operation = owner.manageWorld(command.native, authority, () => {
            this.authorize(call); this.creation(input.runId, call)
            if (this.closing) throw unavailable('World management owner is retiring')
          }, async () => { await this.store().finish(input.commandId) })
          source = undefined
          const work = operation.completion.catch(async (cause: unknown) => {
            // A typed admission refusal and an absent original prove that Native did not accept this command.
            const original = inspectWorldManagement(this.held.get(input.runId)?.run.snapshot() ?? context.state,
              command.native.commandId, command.ownerPrincipalId)
            if (original === undefined && (cause instanceof SimulationWorldError || cause instanceof SimulationProductError))
              await this.store().finish(input.commandId, 'world-management-failed')
            else throw cause
          }).finally(() => { scope?.dispose() })
          this.trackRunJob(input.runId, work)
          try { await operation.admission }
          catch (_admissionFailure: unknown) {
            // Admission did not confirm: only the completion owner can classify absence or retain an unknown original.
            try { await work }
            catch (_unconfirmedAdmission: unknown) {
              /* An unconfirmed admission retains its durable original; failed admission never starts provider work. */
            }
          }
        }
        return this.receipt(this.store().snapshot().commands.get(input.commandId) ?? command)
      } catch (cause: unknown) {
        const accepted = this.store().snapshot().commands.get(input.commandId)
        if (accepted !== undefined) { this.same(accepted, 'world-management', input, call); return this.receipt(accepted) }
        throw cause
      } finally { source?.dispose() }
    })
  }

  /**
   * Prepare a dedicated helper and retain explicit user-authored input under the original scenario runtime.
   * @param request - Strict user input; claimed source references other than user-authored reject.
   * @param call - Actual authenticated run owner, rechecked through canonical preparation.
   * @returns original accepted job without invoking a model.
   */
  generationRequest(request: SimulationProductGenerationRequest, call: AuthenticatedProductCall):
  Promise<SimulationProductGenerationResult> {
    return this.admit(call, async () => {
      const input = simulationProductGenerationRequestSchema.parse(request); this.bytes(input)
      const context = await this.worldManagementState(input.runId, call)
      const owner = this.held.get(input.runId)?.owner
      if (!(owner instanceof SimulationWorldOwner)) throw unavailable('Generation requires explicit original-owner restore')
      const prior = generationRecordAt(context.state, input.job.id)
      const prefix = this.generationSource(call)
      const job = simulationGenerationJobSchema.parse({ ...input.job, inputs: input.job.inputs.map((value, index) => ({ ...value,
        source: prior?.job.inputs[index]?.source ?? `${prefix}${call.credentialGeneration}` })) })
      const authorize = this.generationAuthority(input.runId, call)
      authorize(job)
      if (job.budget.maxTokens > context.state.spec.tokensPerModelRequest || job.budget.maxOutputBytes > this.options.maxTextBytes)
        throw invalid('Generation request exceeds the deployed per-call allowance')
      const retained = await owner.requestGeneration(job, authorize)
      this.authorize(call); this.creation(input.runId, call)
      return this.generationResult(input.runId, retained)
    })
  }

  /**
   * Read an original private result without opening execution or invoking a model.
   * @param request - Owned run and exact job identity.
   * @param call - Current authenticated owner; unrelated Native generation sources remain private.
   * @returns retained original or null in this observed prefix.
   */
  generationRead(request: SimulationProductGenerationRead, call: AuthenticatedProductCall): Promise<SimulationProductGenerationResult> {
    return this.admit(call, async () => {
      const input = simulationProductGenerationReadSchema.parse(request); this.bytes(input)
      const context = await this.worldManagementState(input.runId, call)
      const job = generationRecordAt(context.state, input.jobId)
      if (job !== undefined) this.generationAuthority(input.runId, call)(job.job)
      return this.generationResult(input.runId, job ?? null)
    })
  }

  /**
   * Explicitly execute one accepted helper through the canonical Session and shared model pool.
   * @param request - Original job, never replacement model input or an implicit retry request.
   * @param call - Current human owner; cancellation preserves accepted provider responsibility.
   * @returns original validated output or rejects with its retained unknown state available to reads.
   */
  generationExecute(request: SimulationProductGenerationRead, call: AuthenticatedProductCall): Promise<SimulationProductGenerationResult> {
    return this.admit(call, async () => {
      const input = simulationProductGenerationReadSchema.parse(request); this.bytes(input)
      await this.worldManagementState(input.runId, call)
      const owner = this.held.get(input.runId)?.owner
      if (!(owner instanceof SimulationWorldOwner)) throw unavailable('Generation execution requires explicit original-owner restore')
      const job = await owner.executeGeneration(input.jobId, this.generationAuthority(input.runId, call), call.signal)
      this.authorize(call); this.creation(input.runId, call)
      return this.generationResult(input.runId, job)
    })
  }

  /**
   * Validate, cancel or link a retained result; provider output and start transitions are never client-selectable.
   * @param request - Strict finite review transition.
   * @param call - Current actual run owner and disclosure authority.
   * @returns original durable disposition without inference.
   */
  generationTransition(request: SimulationProductGenerationTransition, call: AuthenticatedProductCall):
  Promise<SimulationProductGenerationResult> {
    return this.admit(call, async () => {
      const input = simulationProductGenerationTransitionSchema.parse(request); this.bytes(input)
      await this.worldManagementState(input.runId, call)
      const held = this.held.get(input.runId)
      if (!(held?.owner instanceof SimulationWorldOwner)) throw unavailable('Generation review requires explicit original-owner restore')
      const job = await held.run.transitionGeneration(input.change, this.generationAuthority(input.runId, call))
      return this.generationResult(input.runId, job)
    })
  }

  /**
   * Submit a validated generated Persona through the existing A2 draft owner, then link the exact committed draft.
   * @param request - Explicit finite-template review placement; no acceptance or hiring is implied.
   * @param call - Actual human owner; the original management policy still authorizes the draft.
   * @returns incorporated source after the A2 draft commits, or retained original responsibility on interruption.
   */
  generationPersonaDraft(request: SimulationProductGenerationPersonaDraft, call: AuthenticatedProductCall):
  Promise<SimulationProductGenerationResult> {
    return this.admit(call, async () => {
      const input = simulationProductGenerationPersonaDraftSchema.parse(request); this.bytes(input)
      const context = await this.worldManagementState(input.runId, call)
      const job = generationRecordAt(context.state, input.jobId)
      if (job === undefined || job.job.purpose !== 'persona' || job.content === undefined
        || job.status !== 'validated' && job.status !== 'incorporated') throw unavailable('Persona generation has no validated original output')
      this.generationAuthority(input.runId, call)(job.job)
      const world = context.state.world
      if (world === undefined) throw unavailable('Generation lost its original world scope')
      const persona = simulationWorldPersonaSchema.parse(JSON.parse(job.content))
      const body = { templateId: input.templateId, templateVersion: input.templateVersion, persona }
      const existing = hiringMarket(context.state).drafts.get(input.draftId)
      if (existing !== undefined && (!isDeepStrictEqual(existing.body, body) || existing.positionEntityId !== input.positionEntityId
        || existing.validUntil !== input.validUntil))
        throw invalid('Persona draft identity already contains another original body or position')
      if (job.status === 'incorporated') {
        if (existing === undefined || job.incorporatedReference !== input.draftId || existing.revision !== job.incorporatedRevision
          || existing.bodyHash !== job.incorporatedBodyHash) throw invalid('Persona incorporation cannot change its original draft revision')
        return this.generationResult(input.runId, job)
      }
      if (existing === undefined) {
        const draft = simulationProductWorldManagementDraftSchema.parse({ runId: input.runId, action: 'hiring-market',
          targetId: input.positionEntityId, expectedRevision: context.state.revision, values: { command: JSON.stringify({
            kind: 'draft', id: input.draftId, generationJobId: input.jobId, expectedRevision: 0, organizationEntityId: world.definition.organizationEntityId,
            positionEntityId: input.positionEntityId, validUntil: input.validUntil, body }) } })
        const commandId = `generation-persona:${createHash('sha256').update(JSON.stringify([input.runId, input.jobId, input.draftId])).digest('hex')}`
        const previous = this.store().snapshot().commands.get(commandId)
        if (previous !== undefined && previous.kind !== 'world-management') throw invalid('Persona draft command identity has another owner')
        let submission: SimulationProductWorldManagementSubmitInput
        if (previous?.kind === 'world-management') submission = previous.input
        else {
          const preview = await this.previewWorldManagement(draft, call)
          submission = simulationProductWorldManagementSubmitInputSchema.parse({ runId: input.runId, commandId,
            draft, previewRevision: preview.revision, previewHash: preview.previewHash })
        }
        await this.submitWorldManagement(submission, call)
        await this.jobs.get(input.runId)
      }
      return await this.generationTransition({ runId: input.runId, change: { kind: 'incorporate', id: input.jobId, reference: input.draftId } }, call)
    })
  }

  private generationSource(call: AuthenticatedProductCall): string {
    return `authenticated-user:${createHash('sha256').update(call.principal.id).digest('hex')}:`
  }

  private generationAuthority(runId: import('./types.ts').SimulationProductRunId, call: AuthenticatedProductCall) {
    return (job: import('@clocky/clocky-simulation').SimulationGenerationJob): void => {
      this.authorize(call)
      const creation = this.creation(runId, call)
      if (creation.kind !== 'world') throw invalid('Generation requires an original World creation')
      const world = creation.preparation.resolved.world, runtime = creation.preparation.resolved.generatedActorRuntime
      if (job.planner !== undefined
        && this.ctx.get('simulationProducts')?.caseReadable(runId, job.planner.requestId, call, 'case') !== true) throw forbidden()
      const expectedAudience = job.purpose === 'domain-plan' ? [world.directorEntityId] : [world.organizationEntityId]
      if (job.scope !== world.organizationEntityId || !isDeepStrictEqual(job.audience, expectedAudience)
        || job.inputs.some(input => !input.source.startsWith(this.generationSource(call))
          || !isDeepStrictEqual(input.audience, expectedAudience))
        || job.policyVersion !== world.policyVersion || job.promptVersion !== 'clocky.product-generation/1'
        || (job.model.provider !== runtime.model.provider || job.model.name !== runtime.model.name
          || job.model.version !== runtime.model.version || !runtime.model.available)) throw forbidden()
    }
  }

  private generationResult(runId: import('./types.ts').SimulationProductRunId,
    job: import('@clocky/clocky-simulation').SimulationGenerationRecord | null): SimulationProductGenerationResult {
    const result = { apiVersion: 'clocky.generation/v1' as const, runId, job }
    this.bytes(result)
    return simulationProductGenerationResultSchema.parse(result)
  }

  private async worldManagementState(runId: import('./types.ts').SimulationProductRunId, call: AuthenticatedProductCall) {
    const creation = this.creation(runId, call)
    if (creation.kind !== 'world') throw invalid('Personnel management requires an original World creation')
    const selection = this.ctx.simulations.resolveInspection({ provider: creation.record.provider, spec: creation.record.spec })
    const state = this.held.get(runId)?.run.snapshot() ?? (await this.ctx.simulations.inspect(selection))?.snapshot
    this.authorize(call); this.creation(runId, call)
    if (state?.world === undefined) throw unavailable('World management Native history is unavailable')
    return { creation, selection, state }
  }
  private worldManagementResolution(state: SimulationSnapshot) {
    return { maxReasonBytes: Math.min(this.options.maxTextBytes, 65536), name: (id: string) => {
      const name = Object.hasOwn(state.entities, id) ? state.entities[simulationEntityIdSchema.parse(id)]?.profile['name'] : undefined
      return this.text(typeof name === 'string' ? name : id).text
    } }
  }
  private worldManagementSource(context: Awaited<ReturnType<SimulationAdministration['worldManagementState']>>,
    action: import('@clocky/clocky-simulation/world-management-types').SimulationWorldManagementAction,
    call: AuthenticatedProductCall) {
    const held = this.held.get(context.creation.record.id)
    return observeWorldManagementAuthority(this.ctx, context.selection, context.state, action, call, {
      ownerPrincipalId: context.creation.record.ownerPrincipalId,
      fundingDelegations: this.options.world?.managementFundingDelegations ?? [], maxBytes: this.options.maxBytes,
      authorize: () => { this.authorize(call); this.creation(context.creation.record.id, call)
        if (this.closing) throw unavailable('World management authority is retiring') },
      ...held === undefined ? {} : { snapshot: () => held.run.snapshot() },
    })
  }
  private worldManagementRetainedAuthority(command: Extract<SimulationCreationCommand, { kind: 'world-management' }>,
    creation: Pick<import('./world-creation.ts').SimulationWorldCreation, 'record' | 'preparation'>, call: AuthenticatedProductCall):
  import('@clocky/clocky-simulation/world-management-types').SimulationWorldManagementAuthority {
    const policyRef = 'clocky.world-owner-management/1'
    const policyGeneration = worldManagementFingerprint({ policyRef, owner: creation.record.ownerPrincipalId,
      fundingDelegations: this.options.world?.managementFundingDelegations ?? [] })
    return { resolve: () => {
      try { this.authorize(call) }
      catch { return undefined /* Current admission refuses; original observations and recovery keep their own authenticated paths. */ }
      if (this.closing || call.signal.aborted || call.principal.id !== command.ownerPrincipalId) return undefined
      return { source: { kind: 'authenticated-user', principalId: call.principal.id, credentialGeneration: call.credentialGeneration,
        policyRef, policyGeneration }, actionHash: worldManagementFingerprint(command.native.action),
      sourceFingerprint: worldManagementFingerprint(['retained-original', command.input.commandId]), sourceComplete: false, funding: null }
    } }
  }
  private async worldManagementOutcome(command: Extract<SimulationCreationCommand, { kind: 'world-management' }>,
    call: AuthenticatedProductCall): Promise<SimulationProductWorldManagementOutcome | undefined> {
    const context = await this.worldManagementState(command.input.runId, call)
    const native = inspectWorldManagement(context.state, command.native.commandId, command.ownerPrincipalId)
    if (native === undefined) return undefined
    const result = native.result
    const value = { commandId: command.input.commandId, runId: command.input.runId, acceptedSequence: native.acceptedSequence,
      intentId: native.intentId, requestId: native.requestId, planId: native.planId,
      ...native.execution === undefined ? {} : { execution: native.execution }, ...result === undefined ? {} : {
        result: { id: result.id, status: result.outcome.kind, time: result.time, sequence: result.sequence } } }
    this.bytes(value); return simulationProductWorldManagementOutcomeSchema.parse(value)
  }

  /**
   * Retain one original World cancellation before competing with hiring at Native's linearization point.
   * @param request - Owned original run, caller-retained command and run-local case identity.
   * @param call - Current authenticated owner; terminal retries remain readable after later world changes.
   * @returns original receipt; unknown cleanup remains accepted and explicit retry uses the exact retained selector.
   */
  cancelWorldCase(request: SimulationProductWorldCaseCancelInput,
    call: AuthenticatedProductCall): Promise<SimulationProductRequestReceipt> {
    return this.admit(call, async () => {
      const input = simulationProductWorldCaseCancelInputSchema.parse(request); this.bytes(input)
      const command = await this.store().accept((state) => {
        this.authorize(call)
        const prior = state.commands.get(input.commandId)
        if (prior !== undefined) { this.same(prior, 'cancel-world-case', input, call); return { command: prior, existing: true } }
        const creation = this.creation(input.runId, call)
        if (creation.kind !== 'world') throw invalid('World cancellation requires an original World creation')
        const live = this.held.get(input.runId)
        if (!(live?.owner instanceof SimulationWorldOwner)) throw unavailable('World cancellation requires explicit owner restore')
        this.checkWorldCaseCancelPreview(live.run.snapshot(), input)
        this.capacity(state, input.runId, false, input.requestId)
        const command: SimulationCreationCommand = { kind: 'cancel-world-case', input, ownerPrincipalId: call.principal.id,
          receipt: { kind: 'cancel-world-case', runId: input.runId, commandId: input.commandId,
            acceptedAt: Date.now(), status: 'accepted' } }
        this.receipt(command)
        this.bytes({ status: 'found', request: { ...command.receipt, status: 'failed', failure: 'cancel-world-case-failed' }, worldCancellation: input })
        return { command, existing: false }
      })
      /* v8 ignore next -- same(kind) and the new command constructor fix this discriminant. */
      if (command.kind !== 'cancel-world-case') throw invalid('World cancellation command has another operation kind')
      if (command.receipt.status === 'accepted' && !this.cancellationJobs.has(input.runId)) {
        const owner = this.held.get(input.runId)?.owner
        if (!(owner instanceof SimulationWorldOwner)) throw unavailable('World cancellation requires explicit owner restore')
        let terminal = false
        const operation = owner.cancelCase(command.input, () => {
          this.authorize(call); this.creation(input.runId, call)
          if (this.closing) throw unavailable('World cancellation owner is retiring')
          const current = this.held.get(input.runId)?.run.snapshot()
          if (current === undefined) throw unavailable('World cancellation lost its original Native owner')
          const id = JSON.stringify(['product-world-cancel', input.runId, input.commandId])
          if (!Object.hasOwn(current.world?.cancellations ?? {}, id)) this.checkWorldCaseCancelPreview(current, command.input)
        }, async () => {
          await this.finishCancelledWorldManagement(input.runId, input.requestId)
          terminal = true; await this.store().finish(input.commandId)
        })
        const work = operation.completion.catch(async (cause: unknown) => {
          if (!terminal && cause instanceof SimulationProductError
            && !Object.hasOwn(this.held.get(input.runId)?.run.snapshot().world?.cancellations ?? {},
              JSON.stringify(['product-world-cancel', input.runId, input.commandId])))
            await this.store().finish(input.commandId, 'cancel-world-case-failed')
          else throw cause
        })
        this.trackWorldCancellation(input.runId, work)
        try { await operation.admission }
        catch (_unconfirmedAdmission: unknown) {
          try { await work }
          catch (_unconfirmedCleanup: unknown) { /* The accepted original remains queryable after an ambiguous Native acknowledgement. */ }
        }
      }
      return this.receipt(this.store().snapshot().commands.get(input.commandId) ?? command)
    })
  }

  /** Original provider IO has drained before this callback; the cancellation job prevents a concurrent original replay. */
  private async finishCancelledWorldManagement(runId: string,
    requestId: import('@clocky/clocky-simulation/world-types').WorldRequestId): Promise<void> {
    const state = this.held.get(runId)?.run.snapshot()
    if (state === undefined || state.world?.requests[requestId]?.status !== 'cancelled') return
    for (const command of this.store().snapshot().commands.values()) {
      if (command.receipt.status !== 'accepted' || !this.managesWorldCase(command, runId, requestId) || command.kind !== 'world-management') continue
      const original = inspectWorldManagement(state, command.native.commandId, command.ownerPrincipalId)
      if (original?.result?.outcome.kind !== 'cancelled' || original.execution?.phase === 'armed'
        || original.execution?.phase === 'outcome-unknown') continue
      await this.store().finish(command.receipt.commandId)
    }
  }

  /** Reject a changed fresh quote before either Product acceptance or Native's queued append. */
  private checkWorldCaseCancelPreview(state: SimulationSnapshot, input: SimulationProductWorldCaseCancelInput): void {
    const preview = worldCaseCancelPreview(state, input.requestId)
    if (preview === undefined || preview.snapshotRevision !== input.previewRevision || preview.previewHash !== input.previewHash
      || (preview.impact.requestStatus !== 'open' && preview.impact.requestStatus !== 'awaiting-evidence'))
      throw new SimulationProductError('World cancellation preview changed before Native acceptance',
        'SIMULATION_PRODUCT_MANAGEMENT_PREVIEW_CHANGED')
  }

  /**
   * Observe bounded canonical task review metadata without opening a run, attaching actors or invoking models.
   * @param request - Owned run, exact world revision and bounded continuation.
   * @param call - Current authenticated product owner; revoked reads reject after canonical IO.
   * @returns only run-owned latest attempt metadata and current non-authorizing action hints.
   */
  listTaskReviews(request: SimulationProductTaskReviewListInput, call: AuthenticatedProductCall): Promise<SimulationProductTaskReviewPage> {
    return this.admit(call, async () => {
      const input = simulationProductTaskReviewListInputSchema.parse(request); this.bytes(input)
      const creation = this.companyCreation(input.runId, call)
      const state = (await this.observation(creation, call))?.snapshot
      if (state === undefined) throw unavailable('Simulation review history is not materialized')
      if (input.expectedRevision !== undefined && state.revision !== input.expectedRevision) throw stale()
      const limit = input.limit ?? this.options.maxReviewPageSize
      if (limit > this.options.maxReviewPageSize) throw invalid('Simulation review page exceeds deployment allowance')
      const latest = new Map<string, import('@clocky/clocky-simulation').SimulationTaskExecution>()
      for (const execution of Object.values(state.taskExecutions ?? {})) {
        const prior = latest.get(execution.request.operationId)
        /* v8 ignore else -- Native fold inserts each attempt key at reservation time; later entries have later sequences. */
        if (prior === undefined || prior.reservedSequence < execution.reservedSequence) latest.set(execution.request.operationId, execution)
      }
      const teams = this.ctx.get('teams')
      if (teams === undefined && latest.size !== 0) throw unavailable('Simulation review has no canonical Team reader')
      const items: import('./review-types.ts').SimulationProductTaskReviewSummary[] = []
      for (const execution of latest.values()) {
        /* v8 ignore next -- A nonempty latest map already rejects an absent Team reader above. */
        if (teams === undefined) throw unavailable('Simulation review has no canonical Team reader')
        let task
        try { task = await teams.getTask({ teamId: execution.request.teamId, taskId: execution.request.taskId }) }
        catch {
          this.authorize(call); this.companyCreation(input.runId, call)
          throw unavailable('Simulation canonical task review metadata is unavailable')
        }
        this.authorize(call); this.companyCreation(input.runId, call)
        const item = scenarioReviewSummary(state, execution, task, creation.driver)
        const reason = !scenarioHasReview(creation.driver) ? 'review-disabled' as const
          : this.preparing(input.runId) ? 'maintenance-in-progress' as const
            : this.held.get(input.runId)?.owner === undefined ? 'recovery-required' as const : item.action.reason
        items.push({ ...item, action: { allowed: reason === 'ready', reason } })
      }
      const query = { scope: JSON.stringify(['task-review', input.runId]), revision: state.revision,
        search: createHash('sha256').update(JSON.stringify(items)).digest('hex'), limit }
      let start = 0
      if (input.cursor !== undefined) {
        try { start = this.reviewCursors.decode(input.cursor, call, query) }
        catch { throw stale() } // Canonical revision or authority changes require a fresh first page.
      }
      const pageItems = items.slice(start, start + limit)
      const base = { runId: input.runId, snapshotRevision: state.revision, observedAt: Date.now(), total: items.length }
      const page = () => ({ ...base, items: pageItems, ...start + pageItems.length < items.length
        ? { nextCursor: this.reviewCursors.encode(call, { ...query, offset: start + pageItems.length }) } : {} })
      while (Buffer.byteLength(JSON.stringify(page())) > this.options.maxBytes && pageItems.length > 1) pageItems.pop()
      const result = page(); this.bytes(result); return simulationProductTaskReviewPageSchema.parse(result)
    })
  }

  /**
   * Persist a scene-scoped original review before canonical mutation; browser fields never grant Team authority.
   * @param request - Exact task creation, completed attempt, observed task revision and immutable outcome/reason.
   * @param call - Current authenticated run owner, rechecked at the serialized write position.
   * @returns original accepted or terminal request receipt; cold writes require explicit restore, cold reads stay inert.
   */
  resolveTaskReview(request: SimulationProductTaskReviewResolveInput,
    call: AuthenticatedProductCall): Promise<SimulationProductRequestReceipt> {
    return this.admit(call, async () => {
      const input = simulationProductTaskReviewResolveInputSchema.parse(request); this.bytes(input)
      const command = await this.store().accept((state) => {
        this.authorize(call)
        const prior = state.commands.get(input.commandId)
        if (prior !== undefined) { this.same(prior, 'review', input, call); return { command: prior, existing: true } }
        const creation = this.companyCreation(input.runId, call)
        if (!scenarioHasReview(creation.driver)) throw unavailable('This company scenario does not permit administrative review')
        if (this.held.get(input.runId)?.owner === undefined) throw unavailable('Simulation review requires explicit restore of its owner')
        this.capacity(state, input.runId)
        const command: SimulationCreationCommand = { kind: 'review', input, ownerPrincipalId: call.principal.id,
          receipt: { kind: 'review', runId: input.runId, commandId: input.commandId, acceptedAt: Date.now(), status: 'accepted' } }
        this.receipt(command)
        this.bytes({ status: 'found', request: { ...command.receipt, status: 'failed', failure: 'review-failed' }, review: input })
        return { command, existing: false }
      })
      /* v8 ignore next -- A prior command must pass same(kind), and a new command is constructed as review. */
      if (command.kind !== 'review') throw invalid('Simulation review command has another operation kind')
      if (command.receipt.status === 'accepted' && !this.jobs.has(input.runId)) {
        const owner = this.held.get(input.runId)?.owner
        if (owner === undefined) throw unavailable('Simulation review requires explicit restore of its owner')
        if (!(owner instanceof SimulationCompanyOwner)) throw unavailable('Simulation task review requires its company owner')
        let terminalPublication = false
        const work = owner.review(command.input, () => { this.authorize(call); this.companyCreation(input.runId, call)
          if (this.closing) throw unavailable('Simulation review owner is retiring')
        }, async () => { terminalPublication = true; await this.store().finish(input.commandId) }).catch(async (cause: unknown) => {
          // A lost canonical/terminal response is unknown; only a proven admission refusal becomes a failure.
          if (!terminalPublication && cause instanceof SimulationProductError) await this.store().finish(input.commandId, 'review-failed')
          else throw cause
        })
        this.trackRunJob(input.runId, work)
        /* A failed terminal append leaves the accepted outcome unknown. */
      }
      return this.receipt(command)
    })
  }

  /**
   * Retain one exact retry permission before native IO; unknown accepted outcomes keep their original identity.
   * @param request - Original command, accepted external operation, positive attempt-count fence and reason.
   * @param call - Current authenticated run owner; queued native mutation rechecks this lease.
   * @returns original accepted or terminal receipt. Cold accepted requests require explicit owner restore and this same retry.
   */
  retryOperation(request: SimulationProductOperationRetryInput, call: AuthenticatedProductCall): Promise<SimulationProductRequestReceipt> {
    return this.admit(call, async () => {
      const input = simulationProductOperationRetryInputSchema.parse(request); this.bytes(input)
      const command = await this.store().accept((state) => {
        this.authorize(call)
        const prior = state.commands.get(input.commandId)
        if (prior !== undefined) { this.same(prior, 'retry-operation', input, call); return { command: prior, existing: true } }
        this.creation(input.runId, call)
        const owner = this.held.get(input.runId)?.owner
        if (owner === undefined) throw unavailable('Simulation retry requires explicit restore of its owner')
        const capability = owner.retryCapability(input.operationId)
        if (!capability.allowed || capability.expectedAttemptCount !== input.expectedAttemptCount) {
          throw invalid('Simulation retry target changed; refresh its original unknown attempt')
        }
        this.capacity(state, input.runId)
        const command: SimulationCreationCommand = { kind: 'retry-operation', input, ownerPrincipalId: call.principal.id,
          receipt: { kind: 'retry-operation', runId: input.runId, commandId: input.commandId, acceptedAt: Date.now(), status: 'accepted' } }
        this.receipt(command)
        this.bytes({ status: 'found', request: { ...command.receipt, status: 'failed', failure: 'retry-operation-failed' }, retryOperation: input })
        return { command, existing: false }
      })
      /* v8 ignore next -- A prior command must pass same(kind), and a new command is constructed as retry-operation. */
      if (command.kind !== 'retry-operation') throw invalid('Simulation retry command has another operation kind')
      if (command.receipt.status === 'accepted' && !this.jobs.has(input.runId)) {
        const owner = this.held.get(input.runId)?.owner
        if (owner === undefined) throw unavailable('Simulation retry requires explicit restore of its owner')
        let terminalPublication = false
        const work = owner.retryOperation(command.input, command.receipt.acceptedAt, () => {
          this.authorize(call); this.creation(input.runId, call)
          if (this.closing) throw unavailable('Simulation retry owner is retiring')
        }, async () => { terminalPublication = true; await this.store().finish(input.commandId) }).catch(async (cause: unknown) => {
          if (!terminalPublication && cause instanceof SimulationProductError) await this.store().finish(input.commandId, 'retry-operation-failed')
          else throw cause
        })
        this.trackRunJob(input.runId, work)
        /* Lost native or terminal responses leave the accepted original outcome unknown. */
      }
      return this.receipt(command)
    })
  }

  /**
   * Combine a native read fence with current original-product ownership and admission capacity, without opening a run.
   * @param runId - Authorized product directory identity.
   * @param operationId - Exact native operation selected by the read producer.
   * @param native - Read-only native count and bound; this observation never authorizes mutation.
   * @param call - Current authenticated read lifetime.
   * @returns explicit ready or denial; imported or cold histories require an original owner restore.
   */
  private operationRetryCapability(runId: import('./types.ts').SimulationProductRunId,
    operationId: import('@clocky/clocky-simulation').SimulationOperationId,
    native: SimulationProductOperationRetryCapability, call: AuthenticatedProductCall): Promise<SimulationProductOperationRetryCapability> {
    return this.admit(call, () => {
      if (native.reason !== 'ready' && native.reason !== 'recovery-required') return native
      const state = this.store().snapshot(), creation = state.creations.get(runId)
      const owner = this.held.get(runId)?.owner
      if (creation?.record.ownerPrincipalId !== call.principal.id || owner === undefined) {
        return { ...native, allowed: false, reason: 'recovery-required' }
      }
      if (this.jobs.has(runId) || [...state.commands.values()].some(value => value.receipt.runId === runId && value.receipt.status === 'accepted')) {
        return { ...native, allowed: false, reason: 'request-in-progress' }
      }
      if (state.commands.size >= this.options.maxCommands
        || [...state.commands.values()].filter(value => value.receipt.status === 'accepted').length >= this.options.maxPendingPreparations) {
        return { ...native, allowed: false, reason: 'capacity-unavailable' }
      }
      const actual = owner.retryCapability(operationId)
      return actual.expectedAttemptCount !== native.expectedAttemptCount
        ? { ...native, allowed: false, reason: 'request-in-progress' } : { ...native, allowed: actual.allowed, reason: actual.reason }
    })
  }

  private owner(run: SimulationRun, creation: SimulationCompanyCreation, settings: SimulationCompanyPreparation): SimulationCompanyOwner {
    return new SimulationCompanyOwner(run, this.ctx.simulationTeams, creation, settings, {
      modelUsage: () => this.ctx.simulationTeams.modelUsage(),
      sharedModelLimit: () => this.ctx.simulationTeams.modelUsage().limit,
      readTask: async (request) => {
        const teams = this.ctx.get('teams')
        if (teams === undefined) throw unavailable('Company task execution has no canonical Team reader')
        return await teams.getTask(request)
      },
      intervalMs: this.options.driverIntervalMs, retryMs: this.options.driverRetryMs,
      maxManagementRequests: this.options.maxManagementRequestsPerRun, maxIngressRequests: this.options.maxIngressRequestsPerRun,
      executionAvailable: () => {
        const provider = this.ctx.agentRuntimes.getProvider(settings.participant.provider)
        return provider !== undefined && isInProcessAgentRuntimeProvider(provider)
          && this.ctx.llm.listProviders().some(value => value.id === creation.driver.model.provider)
      } })
  }
  private model(creation: SimulationCreation): { provider: string; name: string } {
    if (creation.kind === 'company') return creation.driver.model
    const resolved = creation.preparation.resolved
    const director = resolved.actors.find(actor => actor.entityId === resolved.world.directorEntityId)
    if (director === undefined) throw unavailable('World original director runtime is absent')
    return { provider: director.runtime.model.provider, name: director.runtime.model.name }
  }
  private worldOwner(run: SimulationRun, creation: Pick<import('./world-creation.ts').SimulationWorldCreation, 'record' | 'preparation'>,
    preparation: import('./world-preparation.ts').SimulationWorldPreparation): SimulationWorldOwner {
    const ownerName = run.snapshot().teamReservation?.creation.rules['activationLifecycleOwner']
    if (typeof ownerName !== 'string') throw unavailable('World canonical owner is absent')
    const resolved = creation.preparation.resolved
    return new SimulationWorldOwner(run, this.ctx.simulationTeams, creation, { ...preparation, ownerName }, {
      executionScope: this.ctx,
      intervalMs: this.options.driverIntervalMs, retryMs: this.options.driverRetryMs,
      maxManagementRequests: this.options.maxManagementRequestsPerRun, maxIngressRequests: this.options.maxIngressRequestsPerRun,
      modelUsage: () => this.ctx.simulationTeams.modelUsage(), sharedModelLimit: () => this.ctx.simulationTeams.modelUsage().limit,
      executionAvailable: (state) => {
        const providers = this.ctx.get('simulationWorldExecutions')
        if (providers === undefined
          || !providers.controlAvailable(state.executionPins, this.ctx.simulations.domains(creation.record.provider))) return false
        return [...resolved.actors.map(actor => actor.runtime), resolved.generatedActorRuntime].every((runtime) => {
          const provider = this.ctx.agentRuntimes.getProvider(runtime.provider)
          return provider !== undefined && isInProcessAgentRuntimeProvider(provider)
            && this.ctx.llm.listProviders().some(value => value.id === runtime.model.provider)
        })
      },
    })
  }
  private ownedCreation(id: string, call: AuthenticatedProductCall): SimulationCreation {
    const value = this.store().snapshot().creations.get(id) ?? this.experimentOwner?.creation(id)
    if (value === undefined || value.record.ownerPrincipalId !== call.principal.id) throw forbidden()
    return value
  }
  private creation(id: string, call: AuthenticatedProductCall): SimulationCreation { return this.ownedCreation(id, call) }
  private companyCreation(id: string, call: AuthenticatedProductCall): SimulationCompanyCreation {
    const value = this.ownedCreation(id, call)
    if (value.kind !== 'company') throw unavailable('World runs do not admit company task controls')
    return value
  }
  /** Retained user/cancellation originals remain real management responsibility after their active callback stops. */
  private worldControlPending(id: string): boolean {
    return [...this.store().snapshot().commands.values()].some(value => value.receipt.runId === id
      && value.receipt.status === 'accepted' && (value.kind === 'world-management' || value.kind === 'cancel-world-case'))
  }
  private preparing(id: string, allowWorldCancellation = false): boolean {
    return [...this.store().snapshot().commands.values()].some(value => value.receipt.runId === id && value.receipt.status === 'accepted'
      && value.kind !== 'world-management'
      && (!allowWorldCancellation || value.kind !== 'cancel-world-case')
      && (value.kind !== 'review' && value.kind !== 'retry-operation' && value.kind !== 'cancel-task' && value.kind !== 'cancel-world-case' || this.jobs.has(id) || this.held.get(id)?.owner !== undefined))
  }
  private async observation(creation: SimulationCreation | SimulationCompanyCreation,
    call: AuthenticatedProductCall): Promise<SimulationRunObservation | undefined> {
    const held = this.held.get(creation.record.id)
    if (held !== undefined) return { snapshot: held.run.snapshot(), owner: 'this-provider' }
    let observation
    try { observation = await this.ctx.simulations.inspect(this.ctx.simulations.resolveInspection({
      provider: creation.record.provider, spec: creation.record.spec })) }
    catch (cause: unknown) {
      this.authorize(call); this.creation(creation.record.id, call)
      throw new SimulationProductReadError(simulationProductReadFailure(cause), simulationProductReadLimit(cause))
    }
    this.authorize(call); this.creation(creation.record.id, call)
    return observation
  }
  private controlValue(creation: SimulationCreation, state: SimulationSnapshot | undefined,
    nativeOwner?: SimulationOwnerObservation, small?: import('@clocky/clocky-simulation').SimulationControlObservation): SimulationProductControl {
    const versions = this.versions(creation)
    const observed = this.held.get(creation.record.id)?.owner?.observe()
    const book = this.store().snapshot()
    const pending = [...book.commands.values()].filter(value => value.receipt.status === 'accepted')
    const worldResponsibility = creation.kind !== 'company' && pending.some(value => value.receipt.runId === creation.record.id
      && (value.kind === 'world-management' || value.kind === 'cancel-world-case'))
    const accepted = pending.some(value => value.receipt.runId === creation.record.id
      && !(creation.kind !== 'company' && (value.kind === 'world-management' || value.kind === 'cancel-world-case'))
      && (value.kind !== 'review' && value.kind !== 'retry-operation' && value.kind !== 'cancel-task' && value.kind !== 'cancel-world-case' || this.jobs.has(creation.record.id) || this.held.get(creation.record.id)?.owner !== undefined))
    const retained = new Set([...this.held.keys(), ...pending.map(value => value.receipt.runId)])
    const facts = {
      nativeOwner: nativeOwner ?? (this.held.has(creation.record.id) ? 'this-provider' : 'unowned'),
      held: observed !== undefined, unstarted: observed?.unstarted ?? true,
      driver: observed?.driver === 'retiring' || observed?.driver === 'checkpointing' ? observed.driver : 'other',
      pending: accepted, management: worldResponsibility,
      managementActive: worldResponsibility && (this.jobs.has(creation.record.id) || this.cancellationJobs.has(creation.record.id)),
      capacity: book.commands.size < this.options.maxCommands
        && pending.length < this.options.maxPendingPreparations
        && (retained.has(creation.record.id) || retained.size < this.options.maxHeldRuns),
      ingressLimit: this.options.maxIngressRequestsPerRun,
    } satisfies import('./maintenance-control.ts').MaintenanceControlFacts
    const administration = small === undefined ? maintenanceControl(creation, state, facts, value => this.text(value))
      : maintenanceControlFromObservation(creation, small, facts, value => this.text(value))
    if (observed !== undefined) {
      const { unstarted: _unstarted, ...current } = observed
      return { ...current, administration, versions, ...accepted ? {
        actions: { start: { allowed: false, reason: 'preparation-in-progress' }, pause: { allowed: false, reason: 'preparation-in-progress' } },
      } : worldResponsibility && current.actions.start.allowed ? {
        actions: { ...current.actions, start: { allowed: false, reason: 'management-in-progress' } },
      } : {} }
    }
    const reason = accepted ? 'preparation-in-progress' as const : 'recovery-required' as const
    return { ...state === undefined || creation.kind === 'company' ? {} : tokenDiagnostics(state, false, false), versions, modelPool: observeModelPool(() => this.ctx.simulationTeams.modelUsage()),
      runId: creation.record.id, administration, budget: { model: this.model(creation),
        tokensPerRequest: creation.record.spec.tokensPerModelRequest, tokensPerInterval: creation.record.spec.maxTokensPerInterval,
        interval: creation.record.spec.budgetInterval, residentActors: creation.record.spec.maxResidentActors,
        sharedModelLimit: this.ctx.simulationTeams.modelUsage().limit }, owner: this.held.has(creation.record.id) ? 'held' : 'not-held',
      ...state?.runControl === undefined ? {} : { stopTarget: observeSimulationRunControl(state.runControl.current) },
      driverSource: { status: 'owner-unavailable', observedAt: Date.now() },
      driver: 'idle', inFlight: false, observedAt: Date.now(),
      ...Object.values(state?.world?.executions ?? {}).some(value => value.phase === 'armed' || value.phase === 'outcome-unknown')
        || Object.values(state?.operations ?? {}).some(value => value.status === 'outcome-unknown')
        ? { stop: 'outcome-unknown' as const } : {},
      ...state === undefined ? {} : { phase: state.phase, revision: state.revision },
      actions: { start: { allowed: false, reason }, pause: { allowed: false, reason } } }
  }
  private versions(creation: SimulationCreation | SimulationCompanyCreation): import('./control-types.ts').SimulationProductVersionSummary {
    if ('kind' in creation && creation.kind !== 'company') return { rulesVersion: this.text(creation.record.spec.rulesVersion),
      policyVersion: this.text(creation.record.spec.policyVersion), tickUnit: this.text(creation.record.spec.tickUnit),
      scenario: { status: 'observed', templateId: this.text(`${creation.preparation.resolved.apiVersion}/${creation.preparation.resolved.definition.metadata.id}`),
        version: '1', driverVersion: '1', execution: 'cognition-only' } }
    return { rulesVersion: this.text(creation.record.spec.rulesVersion), policyVersion: this.text(creation.record.spec.policyVersion),
      tickUnit: this.text(creation.record.spec.tickUnit), scenario: { status: 'observed',
        templateId: this.text(creation.request.templateId), version: creation.request.templateVersion,
        driverVersion: creation.driver.version,
        execution: creation.driver.tasks === undefined && creation.driver.scenario === undefined ? 'cognition-only' : 'automatic-tasks' } }
  }
  private managementReceipt(operation: SimulationManagementOperation): SimulationProductManagementReceipt {
    return { managementId: operation.request.id as unknown as import('./control-types.ts').SimulationProductManagementId,
      phase: operation.request.phase, status: operation.status, startedSequence: operation.startedSequence,
      ...operation.status === 'in-progress' ? {} : { finishedSequence: operation.finishedSequence },
      ...operation.status === 'failed' ? { failure: 'details-withheld' as const } : {} }
  }

  private capacity(state: SimulationCreationBook, target?: string, restoring = false,
    worldCancellationRequestId?: import('@clocky/clocky-simulation/world-types').WorldRequestId): void {
    if (state.commands.size >= this.options.maxCommands) throw unavailable('Simulation retained request capacity is occupied')
    const pending = [...state.commands.values()].filter(value => value.receipt.status === 'accepted')
    const originalManagement = target !== undefined && worldCancellationRequestId !== undefined
      && pending.some(value => this.managesWorldCase(value, target, worldCancellationRequestId))
    if (target !== undefined && (this.cancellationJobs.has(target) || this.jobs.has(target) && !originalManagement
      || pending.some(value => value.receipt.runId === target
        && !(worldCancellationRequestId !== undefined && this.managesWorldCase(value, target, worldCancellationRequestId))
        && (!restoring || value.kind !== 'review' && value.kind !== 'retry-operation' && value.kind !== 'cancel-task'
          && value.kind !== 'cancel-world-case' && value.kind !== 'world-management')))) {
      throw unavailable('Simulation run already has an admitted operation in progress')
    }
    const retained = new Set([...this.held.keys(), ...pending.map(value => value.receipt.runId)])
    if (pending.length >= this.options.maxPendingPreparations
      || retained.size >= this.options.maxHeldRuns && (target === undefined || !retained.has(target))) {
      throw unavailable('Simulation preparation or owned-run capacity is occupied')
    }
  }
  private launch(command: SimulationCreationCommand): void {
    /* v8 ignore next -- Only create, prepare and maintenance call launch; scoped mutations run elsewhere. */
    if (command.kind === 'review' || command.kind === 'retry-operation' || command.kind === 'cancel-task'
      || command.kind === 'world-management' || command.kind === 'cancel-world-case') return // Accepted mutations need a currently authenticated explicit retry.
    if (command.receipt.status !== 'accepted' || this.jobs.has(command.receipt.runId)) return
    const work = (command.kind === 'checkpoint' || command.kind === 'restore' ? this.maintainOwned(command)
      : command.kind === 'world-create' || command.kind === 'world-prepare' ? this.prepareWorldOwned(command)
        : this.prepareOwned(command)).finally(() => {
      this.jobs.delete(command.receipt.runId)
    })
    this.jobs.set(command.receipt.runId, work)
    void work.catch((_cause: unknown) => {
      /* A failed terminal append leaves the original accepted outcome unknown until journal recovery. */
    })
  }
  private async prepareOwned(command: Extract<SimulationCreationCommand, { kind: 'create' | 'prepare' }>): Promise<void> {
    const creation = this.store().snapshot().creations.get(command.receipt.runId)
    /* v8 ignore next -- accepted create/prepare folding requires this exact original creation. */
    if (creation === undefined || creation.kind !== 'company') throw new Error('Simulation accepted preparation has no company creation')
    let run = this.held.get(command.receipt.runId)?.run
    let failure: SimulationProductRequestReceipt['failure'] = 'preparation-required'
    try {
      await this.register(creation.record)
      if (run === undefined) {
        const selection = { provider: creation.record.provider, spec: creation.record.spec }
        const observation = await this.ctx.simulations.inspect(this.ctx.simulations.resolveInspection(selection))
        if (observation !== undefined && observation.owner !== 'unowned') {
          failure = 'recovery-required'
          throw new Error('Simulation creation ownership requires recovery')
        }
        run = await this.ctx.simulations.open(this.ctx.simulations.resolve({ ...selection, mode: observation === undefined ? 'create' : 'open' }))
      }
      const settings = command.kind === 'prepare'
        ? { ...creation.preparation, checkpoint: { ...creation.preparation.checkpoint,
          id: simulationCheckpointIdSchema.parse(`product-preparation/${command.receipt.commandId}`) } } : creation.preparation
      const owner = this.held.get(command.receipt.runId)?.owner
      const ownedRun = run
      if (!(owner instanceof SimulationCompanyOwner)) {
        await prepareSimulationCompany(this.ctx.simulationTeams, ownedRun, settings)
        this.held.set(command.receipt.runId, { run: ownedRun, owner: this.owner(ownedRun, creation, settings) })
      } else {
        await owner.prepare(settings, () => prepareSimulationCompany(this.ctx.simulationTeams, ownedRun, settings))
      }
    } catch (_cause: unknown) {
      if (run !== undefined && !this.held.has(command.receipt.runId)) {
        try { await run.close() }
        catch (cause: unknown) { this.held.set(command.receipt.runId, { run }); throw cause }
      }
      await this.store().finish(command.receipt.commandId, failure)
      return
    }
    await this.store().finish(command.receipt.commandId)
  }
  private async prepareWorldOwned(command: Extract<SimulationCreationCommand, { kind: 'world-create' | 'world-prepare' }>): Promise<void> {
    const creation = this.store().snapshot().creations.get(command.receipt.runId)
    if (creation?.kind !== 'world') throw new Error('World accepted preparation has no original creation')
    let run = this.held.get(command.receipt.runId)?.run
    let failure: SimulationProductRequestReceipt['failure'] = 'preparation-required'
    try {
      await this.register(creation.record)
      if (run === undefined) {
        const selection = { provider: creation.record.provider, spec: creation.record.spec }
        const observation = await this.ctx.simulations.inspect(this.ctx.simulations.resolveInspection(selection))
        if (observation !== undefined && observation.owner !== 'unowned') {
          failure = 'recovery-required'
          throw new Error('World creation ownership requires recovery')
        }
        run = await this.ctx.simulations.open(this.ctx.simulations.resolve({ ...selection, mode: observation === undefined ? 'create' : 'open' }))
      }
      const currentOwner = this.held.get(command.receipt.runId)?.owner
      const ownedRun = run
      const retryingCheckpoint = command.kind === 'world-prepare'
        && ownedRun.snapshot().checkpoints?.[creation.preparation.checkpoint.id]?.status === 'failed'
      const checkpointFor = (id: SimulationProductCommandId) => ({ ...creation.preparation.checkpoint,
        id: simulationCheckpointIdSchema.parse(`product-world-prepare/${id}`), implementationVersion: 'world/1' })
      const attempt = retryingCheckpoint ? { current: checkpointFor(command.receipt.commandId),
        permittedHistory: [...this.store().snapshot().commands.values()].filter(value => value.kind === 'world-prepare'
          && value.receipt.runId === command.receipt.runId && value.receipt.commandId !== command.receipt.commandId)
          .map(value => checkpointFor(value.receipt.commandId)) } : undefined
      const preparedAnchor = attempt === undefined ? creation.preparation
        : { ...creation.preparation, checkpoint: { id: attempt.current.id,
          maxDrainRounds: attempt.current.maxDrainRounds, maxAttempts: attempt.current.maxAttempts } }
      if (currentOwner instanceof SimulationWorldOwner) {
        await currentOwner.prepare(preparedAnchor,
          () => prepareSimulationWorld(this.ctx.simulationTeams, ownedRun, creation.preparation, attempt))
      } else {
        await prepareSimulationWorld(this.ctx.simulationTeams, ownedRun, creation.preparation, attempt)
        this.held.set(command.receipt.runId, { run: ownedRun, owner: this.worldOwner(ownedRun, creation, preparedAnchor) })
      }
    } catch (_cause: unknown) {
      if (run !== undefined && !this.held.has(command.receipt.runId)) {
        try { await run.close() }
        catch (cause: unknown) { this.held.set(command.receipt.runId, { run }); throw cause }
      }
      await this.store().finish(command.receipt.commandId, failure)
      return
    }
    await this.store().finish(command.receipt.commandId)
  }
  private async maintainOwned(command: Extract<SimulationCreationCommand, { kind: 'checkpoint' | 'restore' }>): Promise<void> {
    const creation = this.store().snapshot().creations.get(command.receipt.runId)
    /* v8 ignore next -- accepted maintenance folding requires the original owned allocation. */
    if (creation === undefined) throw new Error('Simulation maintenance has no original creation')
    const checkpointId = command.receipt.checkpointId
    /* v8 ignore next -- the durable command schema requires the exact derived/selected checkpoint. */
    if (checkpointId === undefined) throw new Error('Simulation maintenance has no checkpoint identity')
    let failure: SimulationProductRequestReceipt['failure']
    let diagnostic: SimulationProductRequestReceipt['diagnostic']
    try {
      if (command.kind === 'restore') {
        await this.restoreOwned(creation, checkpointId)
      } else {
        let owner = this.held.get(command.receipt.runId)?.owner
        if (owner === undefined) {
          // An already accepted interrupted collection resumes only after a full retained checkpoint/suffix validation.
          const observation = await this.ctx.simulations.inspect(this.ctx.simulations.resolveInspection({
            provider: creation.record.provider, spec: creation.record.spec }))
          const anchor = observation?.snapshot.latestCheckpointId
          if (anchor === undefined) throw unavailable('Interrupted checkpoint has no full recovery anchor')
          const recovered = await this.restoreOwned(creation, anchor)
          owner = recovered.owner
        }
        if (owner === undefined) throw unavailable('Simulation checkpoint owner is unavailable after recovery')
        const result = await owner.checkpoint({ id: checkpointId, implementationVersion: creation.kind !== 'company' ? 'world/1' : 'company/1',
          maxDrainRounds: creation.preparation.checkpoint.maxDrainRounds, maxAttempts: creation.preparation.checkpoint.maxAttempts })
        if (result.status !== 'completed') {
          failure = 'checkpoint-failed'
          if (result.status === 'failed') diagnostic = result.diagnostic
        }
      }
    } catch (cause: unknown) {
      failure = command.kind === 'restore' ? 'restore-failed' : 'checkpoint-failed'
      diagnostic = checkpointDiagnostic(cause, { stage: command.kind === 'restore' ? 'restore' : 'collect',
        code: 'unavailable', subject: { kind: 'run' } })
    }
    await this.store().finish(command.receipt.commandId, failure, diagnostic)
  }

  private async restoreOwned(creation: SimulationCreation,
    checkpointId: import('@clocky/clocky-simulation').SimulationCheckpointId): Promise<LiveRun & { owner: SimulationCompanyOwner | SimulationWorldOwner }> {
    const existing = this.held.get(creation.record.id)
    let observed: SimulationRunObservation | undefined
    try { observed = existing === undefined ? await this.ctx.simulations.inspect(this.ctx.simulations.resolveInspection({
      provider: creation.record.provider, spec: creation.record.spec })) : undefined }
    catch (cause: unknown) {
      throw new SimulationCheckpointError('Simulation recovery native history is unavailable',
        { stage: 'restore', code: 'source-unavailable', subject: { kind: 'run' } }, { cause })
    }
    const state = existing?.run.snapshot() ?? observed?.snapshot
    const checkpoints = state?.checkpoints ?? {}
    const selected = Object.hasOwn(checkpoints, checkpointId) ? checkpoints[checkpointId] : undefined
    if (state === undefined || selected?.status !== 'completed') throw new SimulationCheckpointError('Simulation recovery requires a complete compatible checkpoint',
      { stage: 'restore', code: 'manifest-mismatch', subject: { kind: 'checkpoint', checkpointId } })
    if (selected.manifest.implementationVersion !== (creation.kind !== 'company' ? 'world/1' : 'company/1')) throw new SimulationCheckpointError('Simulation recovery requires a complete compatible checkpoint',
      { stage: 'restore', code: 'version-mismatch', subject: { kind: 'checkpoint', checkpointId } })
    if (existing === undefined && observed?.owner !== 'unowned') throw new SimulationCheckpointError('Simulation recovery ownership is unavailable',
      { stage: 'restore', code: 'owner-conflict', subject: { kind: 'run' } })
    let releaseExecutions = (): void => {}
    if (creation.kind !== 'company') {
      const providers = this.ctx.get('simulationWorldExecutions')
      if (providers === undefined) throw unavailable('World restoration requires installed execution providers')
      releaseExecutions = providers.retain(state, this.ctx.simulations.domains(creation.record.provider))
    }
    try {
      if (existing !== undefined) {
        await existing.owner?.close()
        await existing.run.close()
        this.held.delete(creation.record.id)
      }
      const restored = await this.ctx.simulationTeams.restore(this.ctx.simulations.resolve({ provider: creation.record.provider,
        spec: creation.record.spec, mode: 'open' }), { id: checkpointId, implementationVersion: creation.kind !== 'company' ? 'world/1' : 'company/1',
        maxAttempts: creation.preparation.checkpoint.maxAttempts }, this.workLifetime.signal)
      // Publish the run before closing the temporary recovery connection so unconfirmed cleanup retains responsibility.
      const live: LiveRun = { run: restored.run }
      this.held.set(creation.record.id, live)
      try { await restored.connection.close() }
      catch (cause: unknown) {
        throw new SimulationCheckpointError('Simulation recovery cleanup remains unconfirmed',
          { stage: 'retire', code: 'unavailable', subject: { kind: 'run' }, cleanup: 'unconfirmed' }, { cause })
      }
      const settings = { ...creation.preparation, checkpoint: { id: restored.manifest.id,
        maxDrainRounds: selected.request.maxDrainRounds, maxAttempts: selected.request.maxAttempts } }
      const owner = creation.kind !== 'company'
        ? this.worldOwner(restored.run, creation, { ...creation.preparation, checkpoint: settings.checkpoint })
        : this.owner(restored.run, creation, { ...creation.preparation, checkpoint: settings.checkpoint })
      live.owner = owner
      if (owner instanceof SimulationWorldOwner) await owner.recover()
      return { run: restored.run, owner }
    } finally { releaseExecutions() }
  }

  private receipt(command: SimulationCreationCommand): SimulationProductRequestReceipt {
    const value = simulationProductRequestReceiptSchema.parse(command.receipt); this.bytes(value); return value
  }
  private same(command: SimulationCreationCommand, kind: SimulationCreationCommand['kind'], input: unknown, call: AuthenticatedProductCall): void {
    if (command.ownerPrincipalId !== call.principal.id) throw forbidden()
    const original = command.kind === 'create' ? { ...command.input, expectedModel: command.creation.driver.model } : command.input
    if (command.kind !== kind || !isDeepStrictEqual(original, input)) throw invalid('Simulation command identity has another original payload')
  }
  private store(): SimulationCreationStore {
    /* v8 ignore next -- successful ready installs and loads the journal before all admitted calls. */
    if (this.book === undefined) throw new Error('Simulation administration journal is not initialized')
    return this.book
  }
  private admit<T>(call: AuthenticatedProductCall, operation: () => T | Promise<T>): Promise<T> {
    if (this.closing || this.reads.size >= this.options.maxPendingRequests) return Promise.reject(unavailable('Simulation administration admission is unavailable'))
    if (call.signal.aborted) return Promise.reject(forbidden())
    const work = this.ready.then(async () => { this.authorize(call); const value = await operation(); this.authorize(call); return value })
    this.reads.add(work)
    void work.then(() => this.reads.delete(work), () => this.reads.delete(work))
    return work
  }
  private authorize(call: AuthenticatedProductCall): void { if (call.signal.aborted) throw forbidden() }
  private bytes(value: unknown): void {
    if (Buffer.byteLength(JSON.stringify(value)) > this.options.maxBytes) throw invalid('Simulation administration value exceeds complete byte allowance')
  }
  private text(value: string) {
    let text = ''
    for (const character of value) { if (Buffer.byteLength(text + character) > this.options.maxTextBytes) break; text += character }
    return { text, truncated: text !== value }
  }
}
export default SimulationAdministration
function invalid(message: string): SimulationProductError { return new SimulationProductError(message, 'SIMULATION_PRODUCT_INVALID') }
function unavailable(message: string): SimulationProductError { return new SimulationProductError(message, 'SIMULATION_PRODUCT_UNAVAILABLE') }
function modelChanged(): SimulationProductError {
  return new SimulationProductError('Simulation model selection changed; preview and confirm again', 'SIMULATION_PRODUCT_MODEL_CHANGED')
}
function forbidden(): SimulationProductError { return new SimulationProductError('Simulation product access is unavailable', 'SIMULATION_PRODUCT_FORBIDDEN') }

function stale(): SimulationProductError { return new SimulationProductError('Simulation review observation expired; refresh from the first page', 'SIMULATION_PRODUCT_STALE') }
/** The durable administration parser owns this closed operation union. */
/* v8 ignore next -- only an unsupported parser-owned variant reaches this helper. */
function assertNever(value: never): never { throw new Error(`Unknown Simulation administration request: ${String(value)}`) }

/** A serialized refusal before this original creation has any durable acceptance. */
function preflightChanged(): SimulationProductError {
  return new SimulationProductError('World preview changed; preview and confirm again', 'SIMULATION_PRODUCT_PREFLIGHT_CHANGED')
}
