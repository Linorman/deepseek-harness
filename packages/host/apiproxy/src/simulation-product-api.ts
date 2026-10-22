import { simulationProductRawArchiveInputSchema } from '@clocky/clocky-simulation-product/schema'
import { simulationProductRunControlInputSchema } from '@clocky/clocky-simulation-product/schema'
import {
  simulationProductWorldBranchInputSchema,
  simulationProductWorldBranchReadInputSchema,
  simulationProductWorldCausalInputSchema,
  simulationProductWorldCompareInputSchema,
} from '@clocky/clocky-simulation-product/schema'
import { simulationProductBackupExportInputSchema } from '@clocky/clocky-simulation-product/schema'
import { simulationProductRetentionPreviewInputSchema, simulationProductRetentionExecuteInputSchema, simulationProductRetentionReadInputSchema, simulationProductRetentionRecordsInputSchema } from '@clocky/clocky-simulation-product/schema'
import { simulationProductGenerationRequestSchema, simulationProductGenerationReadSchema, simulationProductGenerationTransitionSchema, simulationProductGenerationPersonaDraftSchema } from '@clocky/clocky-simulation-product/schema'
import { simulationProductRebuildIndexInputSchema } from '@clocky/clocky-simulation-product/schema'
import { simulationProductCalendarCommandInputSchema, simulationProductCalendarCancelSchema } from '@clocky/clocky-simulation-product/schema'
import { simulationProductCalendarInputSchema, simulationProductCalendarSubmitSchema } from '@clocky/clocky-simulation-product/schema'
import { scenarioDraftReadSchema, scenarioDraftSaveSchema } from '@clocky/clocky-simulation-product/schema'
import { simulationProductWorldManagementFieldsInputSchema, simulationProductWorldManagementDraftSchema, simulationProductWorldManagementSubmitInputSchema } from '@clocky/clocky-simulation-product/world-management-schema'
import { simulationProductWorldDomainInputSchema } from '@clocky/clocky-simulation-product/world-read-schema'
import { simulationProductWorldCasesInputSchema, simulationProductWorldCaseInputSchema } from '@clocky/clocky-simulation-product/schema'
import { simulationProductWorldCaseCancelInputSchema } from '@clocky/clocky-simulation-product/schema'
import { simulationProductTasksInputSchema, simulationProductTaskCancelInputSchema } from '@clocky/clocky-simulation-product/schema'
import { simulationProductRequestsInputSchema, simulationProductRetryRequestInputSchema } from '@clocky/clocky-simulation-product/schema'
import { simulationProductPreflightInputSchema } from '@clocky/clocky-simulation-product/schema'
import { simulationProductWorldPreflightInputSchema, simulationProductWorldCreateInputSchema } from '@clocky/clocky-simulation-product/schema'
import { simulationProductOperationRetryInputSchema } from '@clocky/clocky-simulation-product/schema'
import { simulationProductRunStatusesInputSchema } from '@clocky/clocky-simulation-product/schema'
import { simulationProductTaskReviewListInputSchema, simulationProductTaskReviewResolveInputSchema } from '@clocky/clocky-simulation-product/schema'
import { simulationProductSourceInputSchema } from '@clocky/clocky-simulation-product/schema'
import { simulationProductRecordsInputSchema } from '@clocky/clocky-simulation-product/schema'
import { simulationProductWatchInputSchema } from '@clocky/clocky-simulation-product/schema'
import { simulationProductCheckpointInputSchema, simulationProductRestoreInputSchema, simulationProductIngressInputSchema, simulationProductIngressQuerySchema } from '@clocky/clocky-simulation-product/schema'
import { simulationProductControlInputSchema, simulationProductManageInputSchema, simulationProductManagementInputSchema } from '@clocky/clocky-simulation-product/schema'
/** Simulation product dispatch shares current authentication and private-error mapping across reads and commands. */
import type { Context } from '@clocky/cordis'
import { z } from 'zod'
import { isSimulationProductError } from '@clocky/clocky-simulation-product/errors'
import type { SimulationProductError } from '@clocky/clocky-simulation-product'
import type { SimulationProducts } from '@clocky/clocky-simulation-product'
import type { SimulationAdministration } from '@clocky/clocky-simulation-product/administration'
import type {} from '@clocky/clocky-simulation-product/administration'
import { simulationProductCreateInputSchema, simulationProductPrepareInputSchema, simulationProductRequestInputSchema }
  from '@clocky/clocky-simulation-product/schema'
import type { AuthenticatedProductCall } from '@clocky/clocky-product-principal'
import { simulationProductListInputSchema, simulationProductInspectInputSchema, simulationProductBrowseInputSchema,
  simulationProductObjectInputSchema } from '@clocky/clocky-simulation-product/schema'
import type { SimulationsApi } from './api/simulations.ts'
import type { RpcRequest, RpcResponse } from './api/rpc.ts'
import { currentAuthenticatedProductCall } from './authenticated-product-call.ts'

const codes = {
  SIMULATION_PRODUCT_FORBIDDEN: 'simulation-product-forbidden', SIMULATION_PRODUCT_INVALID: 'simulation-product-invalid',
  SIMULATION_PRODUCT_UNAVAILABLE: 'simulation-product-unavailable', SIMULATION_PRODUCT_STALE: 'simulation-product-stale',
  SIMULATION_PRODUCT_MODEL_CHANGED: 'simulation-product-model-changed',
  SIMULATION_PRODUCT_PREFLIGHT_CHANGED: 'simulation-product-preflight-changed',
  SIMULATION_PRODUCT_MANAGEMENT_PREVIEW_CHANGED: 'simulation-product-management-preview-changed',
} as const satisfies Record<SimulationProductError['code'], string>

/**
 * Build actor-free product handlers; each call resolves the currently composed service and current authentication.
 * @param ctx - Host context; this factory neither mounts a product service nor acquires execution ownership.
 * @returns product handlers with stable denial/expiry and private internal errors.
 */
export function createSimulationProductApi(ctx: Context): SimulationsApi {
  async function dispatch<S, I, O>(request: RpcRequest<I>, parser: z.ZodType<I>,
    service: () => S | undefined, operation: (products: S, input: I, call: AuthenticatedProductCall) => Promise<O>):
  Promise<RpcResponse<O>> {
    const call = currentAuthenticatedProductCall()
    if (call === undefined) return { rpcId: request.rpcId, result: { ok: false, error: {
      code: 'PRODUCT_AUTH_REQUIRED', message: 'Product authentication is required.', details: {},
    } } }
    if (retired(call)) return { rpcId: request.rpcId, result: { ok: false, error: {
      code: 'PRODUCT_AUTH_INVALID', message: 'Product authentication is invalid.', details: {},
    } } }
    const products = service()
    if (products === undefined) return { rpcId: request.rpcId, result: { ok: false, error: {
      code: 'simulation-product-unavailable', message: 'This Simulation product operation is not deployed.', details: {},
    } } }
    const input = parser.safeParse(request.payload)
    if (!input.success) return { rpcId: request.rpcId, result: { ok: false, error: {
      code: 'simulation-product-invalid', message: 'Simulation product input is invalid.', details: {},
    } } }
    try { return { rpcId: request.rpcId, result: { ok: true, value: await operation(products, input.data, call) } } }
    catch (cause: unknown) {
      if (retired(call)) return { rpcId: request.rpcId, result: { ok: false, error: {
        code: 'PRODUCT_AUTH_INVALID', message: 'Product authentication is invalid.', details: {},
      } } }
      if (isSimulationProductError(cause)) return { rpcId: request.rpcId, result: { ok: false, error: {
        code: codes[cause.code], message: cause.message, details: {},
      } } }
      return { rpcId: request.rpcId, result: { ok: false, error: {
        code: 'internal', message: 'Simulation product operation failed.', details: {},
      } } }
    }
  }
  const products = () => ctx.get('simulationProducts')
  const administration = () => ctx.get('simulationAdministration')
  const read = <I, O>(request: RpcRequest<I>, parser: z.ZodType<I>,
    operation: (service: SimulationProducts, input: I, call: AuthenticatedProductCall) => Promise<O>) =>
    dispatch(request, parser, products, operation)
  const admin = <I, O>(request: RpcRequest<I>, parser: z.ZodType<I>,
    operation: (service: SimulationAdministration, input: I, call: AuthenticatedProductCall) => Promise<O>) =>
    dispatch(request, parser, administration, operation)
  return {
    readScenarioDraft: request => read(request, scenarioDraftReadSchema, (service, input, call) => service.readScenarioDraft(input, call)),
    saveScenarioDraft: request => read(request, scenarioDraftSaveSchema, (service, input, call) => service.saveScenarioDraft(input, call)),
    worldManagementFields: request => admin(request, simulationProductWorldManagementFieldsInputSchema,
      (service, input, call) => service.worldManagementFields(input, call)),
    retainWorldCalendar: request => admin(request, simulationProductCalendarSubmitSchema,
      (service, input, call) => service.retainWorldCalendar(input, call)),
    readWorldCalendarCommand: request => admin(request, simulationProductCalendarCommandInputSchema,
      (service, input, call) => service.readWorldCalendarCommand(input, call)),
    cancelWorldCalendar: request => admin(request, simulationProductCalendarCancelSchema,
      (service, input, call) => service.cancelWorldCalendar(input, call)),
    previewWorldCalendar: request => admin(request, simulationProductCalendarInputSchema,
      (service, input, call) => service.previewWorldCalendar(input, call)),
    submitWorldCalendar: request => admin(request, simulationProductCalendarSubmitSchema,
      (service, input, call) => service.submitWorldCalendar(input, call)),
    previewWorldManagement: request => admin(request, simulationProductWorldManagementDraftSchema,
      (service, input, call) => service.previewWorldManagement(input, call)),
    submitWorldManagement: request => admin(request, simulationProductWorldManagementSubmitInputSchema,
      (service, input, call) => service.submitWorldManagement(input, call)),
    preflightWorld: request => admin(request, simulationProductWorldPreflightInputSchema,
      (service, input, call) => service.preflightWorld(input, call)),
    createWorld: request => admin(request, simulationProductWorldCreateInputSchema,
      (service, input, call) => service.createWorld(input, call)),
    prepareWorld: request => admin(request, simulationProductPrepareInputSchema,
      (service, input, call) => service.prepareWorld(input, call)),
    exportWorldDefinition: request => admin(request, simulationProductControlInputSchema,
      (service, input, call) => service.exportWorldDefinition(input, call)),
    listTasks: request => admin(request, simulationProductTasksInputSchema, (service, input, call) => service.listTasks(input, call)),
    readWorldDomain: request => read(request, simulationProductWorldDomainInputSchema,
      (service, input, call) => service.readWorldDomain(input, call)),
    listWorldCases: request => read(request, simulationProductWorldCasesInputSchema,
      (service, input, call) => service.listWorldCases(input, call)),
    inspectWorldCase: request => read(request, simulationProductWorldCaseInputSchema,
      (service, input, call) => service.inspectWorldCase(input, call)),
    cancelWorldCase: request => admin(request, simulationProductWorldCaseCancelInputSchema,
      (service, input, call) => service.cancelWorldCase(input, call)),
    cancelTask: request => admin(request, simulationProductTaskCancelInputSchema,
      (service, input, call) => service.cancelTask(input, call)),
    retryOperation: request => admin(request, simulationProductOperationRetryInputSchema,
      (service, input, call) => service.retryOperation(input, call)),
    runStatuses: request => dispatch(request, simulationProductRunStatusesInputSchema,
      () => ctx.get('simulationAdministration') ?? ctx.get('simulationProducts'),
      (service, input, call) => service.runStatuses(input, call)),
    listTaskReviews: request => admin(request, simulationProductTaskReviewListInputSchema,
      (service, input, call) => service.listTaskReviews(input, call)),
    resolveTaskReview: request => admin(request, simulationProductTaskReviewResolveInputSchema,
      (service, input, call) => service.resolveTaskReview(input, call)),
    inspectSource: request => read(request, simulationProductSourceInputSchema,
      (products, input, call) => products.inspectSource(input, call)),
    archiveRaw: request => read(request, simulationProductRawArchiveInputSchema,
      (products, input, call) => products.archiveRaw(input, call)),
    records: request => read(request, simulationProductRecordsInputSchema, (products, input, call) => products.readRecords(input, call)),
    watch: request => read(request, simulationProductWatchInputSchema, (products, input, call) => products.watch(input, call)),
    checkpoint: request => admin(request, simulationProductCheckpointInputSchema,
      (service, input, call) => service.checkpoint(input, call)),
    restore: request => admin(request, simulationProductRestoreInputSchema, (service, input, call) => service.restore(input, call)),
    ingress: request => admin(request, simulationProductIngressInputSchema, (service, input, call) => service.ingress(input, call)),
    ingressRequest: request => admin(request, simulationProductIngressQuerySchema,
      (service, input, call) => service.ingressRequest(input, call)),
    control: request => admin(request, simulationProductControlInputSchema, (service, input, call) => service.control(input, call)),
    updateRunControl: request => admin(request, simulationProductRunControlInputSchema,
      (service, input, call) => service.updateRunControl(input, call)),
    manage: request => admin(request, simulationProductManageInputSchema, (service, input, call) => service.manage(input, call)),
    managementRequest: request => admin(request, simulationProductManagementInputSchema,
      (service, input, call) => service.managementRequest(input, call)),
    catalog: request => admin(request, z.strictObject({}), (service, _input, call) => service.catalog(call)),
    preflight: request => admin(request, simulationProductPreflightInputSchema,
      (service, input, call) => service.preflight(input, call)),
    create: request => admin(request, simulationProductCreateInputSchema, (service, input, call) => service.create(input, call)),
    prepare: request => admin(request, simulationProductPrepareInputSchema, (service, input, call) => service.prepare(input, call)),
    listRequests: request => admin(request, simulationProductRequestsInputSchema,
      (service, input, call) => service.listRequests(input, call)),
    retryRequest: request => admin(request, simulationProductRetryRequestInputSchema,
      (service, input, call) => service.retryRequest(input, call)),
    request: request => admin(request, simulationProductRequestInputSchema, (service, input, call) => service.request(input, call)),
    list: request => read(request, simulationProductListInputSchema, (products, input, call) => products.list(input, call)),
    inspect: request => read(request, simulationProductInspectInputSchema, (products, input, call) => products.inspect(input, call)),
    branchWorld: request => admin(request, simulationProductWorldBranchInputSchema,
      (service, input, call) => service.branchWorld(input, call)),
    readWorldBranch: request => admin(request, simulationProductWorldBranchReadInputSchema,
      (service, input, call) => service.readWorldBranch(input, call)),
    queryWorldCausal: request => admin(request, simulationProductWorldCausalInputSchema,
      (service, input, call) => service.queryWorldCausal(input, call)),
    compareWorlds: request => admin(request, simulationProductWorldCompareInputSchema,
      (service, input, call) => service.compareWorlds(input, call)),
    backupExport: request => admin(request, simulationProductBackupExportInputSchema,
      (service, input, call) => service.backupExport(input, call)),
    retentionPreview: request => admin(request, simulationProductRetentionPreviewInputSchema,
      (service, input, call) => service.retentionPreview(input, call)),
    retentionExecute: request => admin(request, simulationProductRetentionExecuteInputSchema,
      (service, input, call) => service.retentionExecute(input, call)),
    retentionRead: request => admin(request, simulationProductRetentionReadInputSchema,
      (service, input, call) => service.retentionRead(input, call)),
    retentionRecords: request => admin(request, simulationProductRetentionRecordsInputSchema,
      (service, input, call) => service.retentionRecords(input, call)),
    generationRequest: request => admin(request, simulationProductGenerationRequestSchema,
      (service, input, call) => service.generationRequest(input, call)),
    generationRead: request => admin(request, simulationProductGenerationReadSchema,
      (service, input, call) => service.generationRead(input, call)),
    generationExecute: request => admin(request, simulationProductGenerationReadSchema,
      (service, input, call) => service.generationExecute(input, call)),
    generationTransition: request => admin(request, simulationProductGenerationTransitionSchema,
      (service, input, call) => service.generationTransition(input, call)),
    generationPersonaDraft: request => admin(request, simulationProductGenerationPersonaDraftSchema,
      (service, input, call) => service.generationPersonaDraft(input, call)),
    rebuildIndex: request => read(request, simulationProductRebuildIndexInputSchema,
      (products, input, call) => products.rebuildIndex(input, call)),
    browse: request => read(request, simulationProductBrowseInputSchema, (products, input, call) => products.browse(input, call)),
    inspectObject: request => read(request, simulationProductObjectInputSchema,
      (products, input, call) => products.inspectObject(input, call)),
  }
}

/** Re-read mutable lease state after awaited IO without retaining TypeScript's initial narrowing. */
function retired(call: AuthenticatedProductCall): boolean { return call.signal.aborted }
