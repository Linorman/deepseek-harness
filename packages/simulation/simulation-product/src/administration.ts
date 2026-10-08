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
import { createHash, randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import type {} from '@clocky/clocky-agent-presets'
import type {} from '@clocky/clocky-llm'
import { isInProcessAgentRuntimeProvider } from '@clocky/clocky-agent-runtime-in-process'
import type { AuthenticatedProductCall } from '@clocky/clocky-product-principal'
import type { LogStream } from '@clocky/clocky-storage'
import { simulationRunIdSchema, simulationCheckpointIdSchema, simulationIngressRequestSchema } from '@clocky/clocky-simulation'
import { checkpointDiagnostic, SimulationCheckpointError } from '@clocky/clocky-simulation'
import type { SimulationRun, SimulationSnapshot, SimulationManagementOperation, SimulationIngress } from '@clocky/clocky-simulation'
import { SimulationProductError } from './index.ts'
import type {} from './index.ts'
import { prepareSimulationCompany, simulationCompanyPreparationSchema } from './company-preparation.ts'
import { simulationInstalledCompanyTemplateSchema } from './creation-schema.ts'
import { currentTemplateModel, resolveTemplateModel, templateProviderAvailable } from './template-model.ts'
import { resolveCreation } from './creation-preflight.ts'
import { resolveScenarioTopology } from './scenario-topology.ts'
import { maintenanceControl } from './maintenance-control.ts'
import type { SimulationRunObservation, SimulationOwnerObservation } from '@clocky/clocky-simulation'
import { managementAt } from './management-read.ts'
import { simulationProductCheckpointInputSchema, simulationProductRestoreInputSchema, simulationProductIngressInputSchema,
  simulationProductIngressQuerySchema, simulationProductIngressReceiptSchema, simulationProductIngressResultSchema } from './maintenance-schema.ts'
import type { SimulationProductCheckpointInput, SimulationProductRestoreInput, SimulationProductIngressInput, SimulationProductIngressQuery,
  SimulationProductIngressReceipt, SimulationProductIngressResult } from './maintenance-types.ts'
import { SimulationCompanyOwner } from './company-owner.ts'
import { registerCompanyTaskPolicies } from './company-task-policies.ts'
import type { SimulationCompanyPreparation } from './company-preparation.ts'
import { simulationProductManageInputSchema, simulationProductControlInputSchema, simulationProductManagementInputSchema,
  simulationProductControlSchema, simulationProductManageResultSchema, simulationProductManagementResultSchema } from './control-schema.ts'
import type { SimulationProductManageInput, SimulationProductControlInput, SimulationProductManagementInput, SimulationProductControl,
  SimulationProductManageResult, SimulationProductManagementResult, SimulationProductManagementReceipt } from './control-types.ts'
import { SimulationCreationStore } from './creation-store.ts'
import type { SimulationCompanyTemplate, SimulationInstalledCompanyTemplate,
  SimulationCreationCommand, SimulationCompanyCreation, SimulationCreationBook } from './creation-types.ts'
import { simulationProductRunIdSchema } from './schema-common.ts'
import { simulationProductCreateInputSchema, simulationProductPrepareInputSchema, simulationProductRequestInputSchema,
  simulationProductCatalogSchema, simulationProductRequestReceiptSchema, simulationProductRequestResultSchema,
  simulationProductPreflightInputSchema, simulationProductPreflightResultSchema,
  simulationProductRequestsInputSchema, simulationProductRequestsPageSchema, simulationProductRetryRequestInputSchema } from './administration-schema.ts'
import type { SimulationProductCreateInput, SimulationProductPrepareInput, SimulationProductRequestInput, SimulationProductCatalog,
  SimulationProductRequestReceipt, SimulationProductRequestResult, SimulationProductPreflightInput, SimulationProductPreflightResult,
  SimulationProductPreflightIssue, SimulationProductConfiguration, SimulationProductRequestsInput, SimulationProductRequestsPage,
  SimulationProductRetryRequestInput } from './administration-types.ts'
import type { SimulationProductRecord } from './registration-types.ts'

/** Trusted templates and independent accepted-work/journal allowances. */
export interface Config {
  readonly journalStream: string
  readonly templates: SimulationInstalledCompanyTemplate[]
  readonly maxCommands?: number
  readonly maxTemplates?: number
  readonly maxPendingRequests?: number
  readonly maxPendingPreparations?: number
  readonly maxHeldRuns?: number
  readonly recoveryPageSize?: number
  readonly maxBytes?: number
  readonly maxEntryBytes?: number
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
export const Config: z<Config> = z.object({ journalStream: z.string().required(), templates: z.array(z.any()).required(),
  maxCommands: z.number().min(1).step(1).default(10000), maxTemplates: z.number().min(1).step(1).default(32),
  maxPendingRequests: z.number().min(1).step(1).default(32), maxPendingPreparations: z.number().min(1).step(1).default(16),
  maxHeldRuns: z.number().min(1).step(1).default(16), recoveryPageSize: z.number().min(1).step(1).default(64),
  maxBytes: z.number().min(1).step(1).default(1048576), maxEntryBytes: z.number().min(1).step(1).default(1048576),
  maxTextBytes: z.number().min(1).step(1).default(512),
  driverIntervalMs: z.number().min(1).max(2147483647).step(1).default(50),
  driverRetryMs: z.number().min(1).max(2147483647).step(1).default(1000),
  maxManagementRequestsPerRun: z.number().min(1).step(1).default(10000),
  maxIngressRequestsPerRun: z.number().min(1).step(1).default(10000), maxReviewPageSize: z.number().min(1).step(1).default(32),
  maxRequestPageSize: z.number().min(1).step(1).default(32) })

interface LiveRun { run: SimulationRun; owner?: SimulationCompanyOwner }

/** One administration journal and one Host handle per original product creation; startup never resumes models. */
export class SimulationAdministration extends Service<Config> {
  static inject = ['storageLog', 'simulationProducts', 'simulations', 'simulationTeams', 'llm', 'agentPresets', 'agentRuntimes']
  static Config = Config
  private readonly options: Required<Config>
  private readonly templates = new Map<string, SimulationInstalledCompanyTemplate>()
  private readonly reviewCursors = new DirectoryCursorCodec()
  private readonly requestCursors = new DirectoryCursorCodec()
  private readonly taskCursors = new DirectoryCursorCodec()
  private readonly jobs = new Map<string, Promise<void>>()
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
    this.options = { journalStream: config.journalStream, templates: config.templates, maxCommands: config.maxCommands ?? 10000,
      maxTemplates: config.maxTemplates ?? 32, maxPendingRequests: config.maxPendingRequests ?? 32,
      maxPendingPreparations: config.maxPendingPreparations ?? 16, maxHeldRuns: config.maxHeldRuns ?? 16,
      recoveryPageSize: config.recoveryPageSize ?? 64, maxBytes: config.maxBytes ?? 1048576,
      maxEntryBytes: config.maxEntryBytes ?? 1048576, maxTextBytes: config.maxTextBytes ?? 512,
      driverIntervalMs: config.driverIntervalMs ?? 50, driverRetryMs: config.driverRetryMs ?? 1000,
      maxManagementRequestsPerRun: config.maxManagementRequestsPerRun ?? 10000,
      maxIngressRequestsPerRun: config.maxIngressRequestsPerRun ?? 10000, maxReviewPageSize: config.maxReviewPageSize ?? 32,
      maxRequestPageSize: config.maxRequestPageSize ?? 32 }
    if (config.journalStream.trim().length === 0) throw invalid('Simulation administration stream must have a name')
    for (const [key, value] of Object.entries(this.options)) {
      if (key === 'journalStream' || key === 'templates') continue
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
    const registerRetryReader = ctx.simulationProducts.operationRetryReaderRegistrar()
    ctx.effect(() => registerRetryReader((runId, operationId, native, call) =>
      this.operationRetryCapability(runId, operationId, native, call)))
    this.register = ctx.simulationProducts.creationRegistrar()
    this.ready = this.load()
    void this.ready.catch((_cause: unknown) => { /* Calls and teardown observe this same initialization failure. */ })
    ctx.effect(() => async () => {
      this.closing = true
      this.workLifetime.abort(new Error('Simulation administration is retiring'))
      await Promise.allSettled([this.ready, ...this.reads, ...this.jobs.values(),
        ...[...this.held.values()].flatMap(value => value.owner === undefined ? [] : [value.owner.close()])])
      const results = await Promise.allSettled([...this.held.values()].map(async (value) => {
        await value.owner?.close(); await value.run.close()
      }))
      const failures = results.filter(value => value.status === 'rejected').map(value => value.reason as unknown)
      if (failures.length !== 0) throw new AggregateError(failures, 'Simulation administration retains unconfirmed run ownership')
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
    this.stream = await this.ctx.storageLog.open({ name: this.options.journalStream, version: 2 })
    this.book = new SimulationCreationStore(this.stream, this.options)
    await this.book.load()
    if ([...this.templates.values()].some(value => (value.driver.tasks !== undefined || value.driver.scenario !== undefined))
      || [...this.book.snapshot().creations.values()].some(value =>
        value.driver.tasks !== undefined || value.driver.scenario !== undefined)) {
      if (this.ctx.get('teams') === undefined) throw invalid('Company task execution requires a canonical Team reader')
      this.ctx.effect(() => registerCompanyTaskPolicies(this.ctx.simulationTeams))
      this.ctx.effect(() => registerTaskScenarioPolicies(this.ctx.simulationTeams))
    }
    for (const creation of this.book.snapshot().creations.values()) await this.register(creation.record)
  }

  /**
   * Read the complete bounded installed company catalog under current authentication.
   * @param call - Transport-authenticated principal and wait lifetime.
   * @returns safe version/route/limit metadata; never resolves a native execution handle.
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
        configuration: { ...this.configuration(template.spec), editable: template.editableLimits ?? [] } }))) }
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
      const readiness = await resolveTemplateModel(this.ctx, template, call.signal)
      if (readiness.status !== 'ready') issue('model', 'unavailable', readiness.status === 'needs-model'
        ? 'Configure a default model before creating this simulation' : `Simulation model is unavailable: ${readiness.reason}`)
      const resolved = resolveCreation(template, parsed.data, value => this.text(value))
      issues.push(...resolved.issues)
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
          const readiness = await resolveTemplateModel(this.ctx, template, call.signal)
          if (readiness.status !== 'ready') throw unavailable(`Simulation model is not ready: ${readiness.reason}`)
          if (!isDeepStrictEqual(input.expectedModel, readiness.model)) throw modelChanged()
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
    return this.admit(call, () => {
      const input = simulationProductRequestInputSchema.parse(request); this.bytes(input)
      const command = this.store().snapshot().commands.get(input.commandId)
      const value = command?.ownerPrincipalId !== call.principal.id ? { status: 'not-found' as const, commandId: input.commandId }
        : { status: 'found' as const, request: this.receipt(command), ...command.kind === 'review' ? { review: command.input } : {},
          ...command.kind === 'retry-operation' ? { retryOperation: command.input } : {},
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
      this.creation(input.runId, call)
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
      this.creation(input.runId, call)
      const original = this.store().snapshot().commands.get(input.commandId)
      if (original === undefined || original.receipt.runId !== input.runId
        || original.ownerPrincipalId !== call.principal.id) throw forbidden()
      return original
    })
    if (command.receipt.status !== 'accepted') return this.receipt(command)
    switch (command.kind) {
      case 'create': return this.create({ ...command.input, expectedModel: command.creation.driver.model }, call)
      case 'prepare': return this.prepare(command.input, call)
      case 'checkpoint': return this.checkpoint(command.input, call)
      case 'restore': return this.restore(command.input, call)
      case 'review': return this.resolveTaskReview(command.input, call)
      case 'cancel-task': return this.cancelTask(command.input, call)
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
      const received = await owner.ingest(native, () => {
        this.authorize(call); this.creation(input.runId, call)
        if (this.preparing(input.runId)) throw unavailable('Simulation native maintenance is in progress')
        if (!resolveScenarioTopology(creation.preparation).actors.some(value => value.id === input.entityId)) {
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
      const observation = await this.observation(creation, call)
      const result = this.controlValue(creation, observation?.snapshot, observation?.owner)
      this.bytes(result); return simulationProductControlSchema.parse(result)
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
        const creation = book.creations.get(item.run.id)
        if (creation === undefined || creation.record.ownerPrincipalId !== call.principal.id) {
          return { ...item, operational: { status: 'unavailable' as const, observedAt: Date.now(),
            scenario: { status: 'unavailable' as const } } }
        }
        const observed = this.held.get(item.run.id)?.owner?.observe()
        return { ...item, operational: { status: 'observed' as const, observedAt: Date.now(),
          scenario: this.versions(creation).scenario, owner: this.held.has(item.run.id) ? 'held' as const : 'not-held' as const,
          driver: observed?.driver ?? 'idle' as const, inFlight: observed?.inFlight ?? this.jobs.has(item.run.id),
          ...observed?.stop === undefined ? {} : { stop: observed.stop },
          ...observed?.nextAttemptAt === undefined ? {} : { nextAttemptAt: observed.nextAttemptAt } } }
      })
      const result = { ...page, items, modelPool: observeModelPool(() => this.ctx.simulationTeams.modelUsage()) }
      this.bytes(result); return simulationProductRunStatusesPageSchema.parse(result)
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
      const observation = await this.observation(creation, call)
      const state = observation?.snapshot
      const prior = managementAt(state, input.managementId as unknown as import('@clocky/clocky-simulation').SimulationManagementId)
      if (prior !== undefined && prior.request.phase !== input.phase) throw invalid('Simulation management identity has another original phase')
      const owner = this.held.get(input.runId)?.owner
      let operation
      if (prior !== undefined && prior.status !== 'in-progress') operation = prior
      else {
        if (owner === undefined) throw unavailable('Simulation scheduling requires completed preparation or explicit recovery')
        const authorize = () => {
          this.authorize(call); this.creation(input.runId, call)
          if (this.preparing(input.runId)) throw unavailable('Simulation preparation is still in progress')
          // Numeric widths are bounded by the native safe-integer protocol, independent of concurrent model appends.
          const control = this.controlValue(creation, this.held.get(input.runId)?.run.snapshot())
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
        control: this.controlValue(creation, this.held.get(input.runId)?.run.snapshot() ?? state, observation?.owner) }
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
      const creation = this.creation(input.runId, call)
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
        catch { this.authorize(call); this.creation(input.runId, call); throw unavailable('Canonical Simulation task metadata is unavailable') }
        this.authorize(call); this.creation(input.runId, call)
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
        this.creation(input.runId, call)
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
        let terminal = false
        const work = owner.cancelTask(command.input, () => { this.authorize(call); this.creation(input.runId, call)
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
    const work = operation.finally(() => { this.jobs.delete(runId) })
    this.jobs.set(runId, work)
    void work.catch((_cause: unknown) => { /* The receipt owner retains an unknown accepted outcome after a lost response. */ })
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
      const creation = this.creation(input.runId, call)
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
          this.authorize(call); this.creation(input.runId, call)
          throw unavailable('Simulation canonical task review metadata is unavailable')
        }
        this.authorize(call); this.creation(input.runId, call)
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
        const creation = this.creation(input.runId, call)
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
        let terminalPublication = false
        const work = owner.review(command.input, () => { this.authorize(call); this.creation(input.runId, call)
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
  private creation(id: string, call: AuthenticatedProductCall): SimulationCompanyCreation {
    const value = this.store().snapshot().creations.get(id)
    if (value === undefined || value.record.ownerPrincipalId !== call.principal.id) throw forbidden()
    return value
  }
  private preparing(id: string): boolean {
    return [...this.store().snapshot().commands.values()].some(value => value.receipt.runId === id && value.receipt.status === 'accepted'
      && (value.kind !== 'review' && value.kind !== 'retry-operation' && value.kind !== 'cancel-task' || this.jobs.has(id) || this.held.get(id)?.owner !== undefined))
  }
  private async observation(creation: SimulationCompanyCreation,
    call: AuthenticatedProductCall): Promise<SimulationRunObservation | undefined> {
    const held = this.held.get(creation.record.id)
    if (held !== undefined) return { snapshot: held.run.snapshot(), owner: 'this-provider' }
    let observation
    try { observation = await this.ctx.simulations.inspect(this.ctx.simulations.resolveInspection({
      provider: creation.record.provider, spec: creation.record.spec })) }
    catch {
      this.authorize(call); this.creation(creation.record.id, call)
      throw unavailable('Simulation scheduling history is unavailable')
    }
    this.authorize(call); this.creation(creation.record.id, call)
    return observation
  }
  private controlValue(creation: SimulationCompanyCreation, state: SimulationSnapshot | undefined,
    nativeOwner?: SimulationOwnerObservation): SimulationProductControl {
    const versions = this.versions(creation)
    const observed = this.held.get(creation.record.id)?.owner?.observe()
    const book = this.store().snapshot()
    const pending = [...book.commands.values()].filter(value => value.receipt.status === 'accepted')
    const accepted = pending.some(value => value.receipt.runId === creation.record.id
      && (value.kind !== 'review' && value.kind !== 'retry-operation' && value.kind !== 'cancel-task' || this.jobs.has(creation.record.id) || this.held.get(creation.record.id)?.owner !== undefined))
    const retained = new Set([...this.held.keys(), ...pending.map(value => value.receipt.runId)])
    const administration = maintenanceControl(creation, state, {
      nativeOwner: nativeOwner ?? (this.held.has(creation.record.id) ? 'this-provider' : 'unowned'),
      held: observed !== undefined, unstarted: observed?.unstarted ?? true,
      driver: observed?.driver === 'retiring' || observed?.driver === 'checkpointing' ? observed.driver : 'other',
      pending: accepted, capacity: book.commands.size < this.options.maxCommands
        && pending.length < this.options.maxPendingPreparations
        && (retained.has(creation.record.id) || retained.size < this.options.maxHeldRuns),
      ingressLimit: this.options.maxIngressRequestsPerRun,
    }, value => this.text(value))
    if (observed !== undefined) {
      const { unstarted: _unstarted, ...current } = observed
      return { ...current, administration, versions, ...accepted ? {
        actions: { start: { allowed: false, reason: 'preparation-in-progress' }, pause: { allowed: false, reason: 'preparation-in-progress' } },
      } : {} }
    }
    const reason = accepted ? 'preparation-in-progress' as const : 'recovery-required' as const
    return { versions, modelPool: observeModelPool(() => this.ctx.simulationTeams.modelUsage()),
      runId: creation.record.id, administration, budget: { model: creation.driver.model,
        tokensPerRequest: creation.record.spec.tokensPerModelRequest, tokensPerInterval: creation.record.spec.maxTokensPerInterval,
        interval: creation.record.spec.budgetInterval, residentActors: creation.record.spec.maxResidentActors,
        sharedModelLimit: this.ctx.simulationTeams.modelUsage().limit }, owner: this.held.has(creation.record.id) ? 'held' : 'not-held',
      driver: 'idle', inFlight: false, observedAt: Date.now(),
      ...state === undefined ? {} : { phase: state.phase, revision: state.revision },
      actions: { start: { allowed: false, reason }, pause: { allowed: false, reason } } }
  }
  private versions(creation: SimulationCompanyCreation): import('./control-types.ts').SimulationProductVersionSummary {
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

  private capacity(state: SimulationCreationBook, target?: string, restoring = false): void {
    if (state.commands.size >= this.options.maxCommands) throw unavailable('Simulation retained request capacity is occupied')
    const pending = [...state.commands.values()].filter(value => value.receipt.status === 'accepted')
    if (target !== undefined && (this.jobs.has(target) || pending.some(value => value.receipt.runId === target && (!restoring || value.kind !== 'review' && value.kind !== 'retry-operation' && value.kind !== 'cancel-task')))) {
      throw unavailable('Simulation run already has preparation in progress')
    }
    const retained = new Set([...this.held.keys(), ...pending.map(value => value.receipt.runId)])
    if (pending.length >= this.options.maxPendingPreparations
      || retained.size >= this.options.maxHeldRuns && (target === undefined || !retained.has(target))) {
      throw unavailable('Simulation preparation or owned-run capacity is occupied')
    }
  }
  private launch(command: SimulationCreationCommand): void {
    /* v8 ignore next -- Only create, prepare and maintenance call launch; scoped mutations run elsewhere. */
    if (command.kind === 'review' || command.kind === 'retry-operation' || command.kind === 'cancel-task') return // Accepted mutations need a currently authenticated explicit retry.
    if (command.receipt.status !== 'accepted' || this.jobs.has(command.receipt.runId)) return
    const work = (command.kind === 'checkpoint' || command.kind === 'restore' ? this.maintainOwned(command) : this.prepareOwned(command)).finally(() => {
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
    if (creation === undefined) throw new Error('Simulation accepted preparation has no creation')
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
      if (owner === undefined) {
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
        const result = await owner.checkpoint({ id: checkpointId, implementationVersion: 'company/1',
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

  private async restoreOwned(creation: SimulationCompanyCreation,
    checkpointId: import('@clocky/clocky-simulation').SimulationCheckpointId): Promise<LiveRun & { owner: SimulationCompanyOwner }> {
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
    if (selected?.status !== 'completed') throw new SimulationCheckpointError('Simulation recovery requires a complete compatible checkpoint',
      { stage: 'restore', code: 'manifest-mismatch', subject: { kind: 'checkpoint', checkpointId } })
    if (selected.manifest.implementationVersion !== 'company/1') throw new SimulationCheckpointError('Simulation recovery requires a complete compatible checkpoint',
      { stage: 'restore', code: 'version-mismatch', subject: { kind: 'checkpoint', checkpointId } })
    if (existing === undefined && observed?.owner !== 'unowned') throw new SimulationCheckpointError('Simulation recovery ownership is unavailable',
      { stage: 'restore', code: 'owner-conflict', subject: { kind: 'run' } })
    if (existing !== undefined) {
      await existing.owner?.close()
      await existing.run.close()
      this.held.delete(creation.record.id)
    }
    const restored = await this.ctx.simulationTeams.restore(this.ctx.simulations.resolve({ provider: creation.record.provider,
      spec: creation.record.spec, mode: 'open' }), { id: checkpointId, implementationVersion: 'company/1',
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
    const owner = this.owner(restored.run, creation, settings)
    live.owner = owner
    return { run: restored.run, owner }
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
