import { simulationProductRawArchiveInputSchema } from '@clocky/clocky-simulation-product/schema'
import { simulationProductRunControlInputSchema } from '@clocky/clocky-simulation-product/schema'
import {
  simulationProductWorldBranchInputSchema,
  simulationProductWorldBranchReadInputSchema,
  simulationProductWorldCausalInputSchema,
  simulationProductWorldCompareInputSchema,
} from '@clocky/clocky-simulation-product/experiment-schema'
import { simulationProductBackupExportInputSchema } from '@clocky/clocky-simulation-product/schema'
import { simulationProductRetentionPreviewInputSchema, simulationProductRetentionExecuteInputSchema, simulationProductRetentionReadInputSchema, simulationProductRetentionRecordsInputSchema } from '@clocky/clocky-simulation-product/schema'
import { simulationProductGenerationRequestSchema, simulationProductGenerationReadSchema, simulationProductGenerationTransitionSchema, simulationProductGenerationPersonaDraftSchema } from '@clocky/clocky-simulation-product/schema'
import { simulationProductRebuildIndexInputSchema } from '@clocky/clocky-simulation-product/schema'
import { simulationProductCalendarCommandInputSchema, simulationProductCalendarCancelSchema } from '@clocky/clocky-simulation-product/schema'
import { simulationProductCalendarInputSchema, simulationProductCalendarSubmitSchema } from '@clocky/clocky-simulation-product/schema'
import { scenarioDraftReadSchema, scenarioDraftSaveSchema } from '@clocky/clocky-simulation-product/schema'
import { simulationProductWorldManagementFieldsInputSchema, simulationProductWorldManagementDraftSchema, simulationProductWorldManagementSubmitInputSchema } from '@clocky/clocky-simulation-product/world-management-schema'
import { simulationProductWorldDomainInputSchema } from '@clocky/clocky-simulation-product/world-read-schema'
import { simulationProductWorldCasesInputSchema, simulationProductWorldCaseInputSchema, simulationProductWorldCaseCancelInputSchema } from '@clocky/clocky-simulation-product/schema'
import { simulationProductWorldPreflightInputSchema, simulationProductWorldCreateInputSchema } from '@clocky/clocky-simulation-product/schema'
// Explicit protocol imports and public re-exports repeat contract names, not executable behavior.
/* jscpd:ignore-start */
import { simulationProductTasksInputSchema, simulationProductTaskCancelInputSchema } from '@clocky/clocky-simulation-product/schema'
import { simulationProductRequestsInputSchema, simulationProductRetryRequestInputSchema } from '@clocky/clocky-simulation-product/schema'
import { simulationProductPreflightInputSchema } from '@clocky/clocky-simulation-product/schema'
import { simulationProductOperationRetryInputSchema } from '@clocky/clocky-simulation-product/schema'
import { simulationProductRunStatusesInputSchema } from '@clocky/clocky-simulation-product/schema'
import { simulationProductTaskReviewListInputSchema, simulationProductTaskReviewResolveInputSchema } from '@clocky/clocky-simulation-product/schema'
import { simulationProductSourceInputSchema } from '@clocky/clocky-simulation-product/schema'
import { simulationProductRecordsInputSchema } from '@clocky/clocky-simulation-product/schema'
import { simulationProductWatchInputSchema } from '@clocky/clocky-simulation-product/schema'
import { simulationProductControlInputSchema, simulationProductManageInputSchema, simulationProductManagementInputSchema, simulationProductCheckpointInputSchema, simulationProductRestoreInputSchema, simulationProductIngressInputSchema, simulationProductIngressQuerySchema } from '@clocky/clocky-simulation-product/schema'
/* jscpd:ignore-end */
/** Simulation JSON-RPC requests share the product owners and transport-authenticated call lifetime. */
import type { Context } from '@clocky/cordis'
import type { AuthenticatedProductCall } from '@clocky/clocky-product-principal'
import type { ZodType } from 'zod'
import { isSimulationProductError } from '@clocky/clocky-simulation-product/errors'
import { SimulationProductError } from '@clocky/clocky-simulation-product'
import { JsonRpcRequestError } from '@clocky/clocky-sdk-protocol'
import { simulationProductBrowseInputSchema, simulationProductCreateInputSchema, simulationProductInspectInputSchema, simulationProductListInputSchema, simulationProductObjectInputSchema, simulationProductPrepareInputSchema, simulationProductRequestInputSchema } from '@clocky/clocky-simulation-product/schema'
import { simulationCatalogParamsSchema } from '@clocky/clocky-sdk-protocol'

/**
 * Dispatch authenticated Simulation methods without mounting optional services or taking writer ownership for reads.
 * @param ctx - Current mounted product owners.
 * @param method - Simulation SDK method name.
 * @param params - Untrusted actor-free parameters.
 * @param call - Current transport credential lease; each product operation rechecks it after IO.
 * @returns bounded public product result, retaining original command identities on retries.
 */
export async function dispatchSimulation(ctx: Context, method: string, params: unknown, call: AuthenticatedProductCall): Promise<unknown> {
  const products = () => {
    const service = ctx.get('simulationProducts')
    if (service === undefined) throw new SimulationProductError('Simulation product reads are not deployed', 'SIMULATION_PRODUCT_UNAVAILABLE')
    return service
  }
  const administration = () => {
    const service = ctx.get('simulationAdministration')
    if (service === undefined) throw new SimulationProductError('Simulation administration is not deployed', 'SIMULATION_PRODUCT_UNAVAILABLE')
    return service
  }
  try {
    switch (method) {
      case 'simulation/draft-read': return await products().readScenarioDraft(parse(method, scenarioDraftReadSchema, params), call)
      case 'simulation/draft-save': return await products().saveScenarioDraft(parse(method, scenarioDraftSaveSchema, params), call)
      case 'simulation/world-preflight': {
        const input = parse(method, simulationProductWorldPreflightInputSchema, params)
        return await administration().preflightWorld(input, call)
      }
      case 'simulation/world-create': {
        const input = parse(method, simulationProductWorldCreateInputSchema, params)
        return await administration().createWorld(input, call)
      }
      case 'simulation/world-prepare': {
        const input = parse(method, simulationProductPrepareInputSchema, params)
        return await administration().prepareWorld(input, call)
      }
      case 'simulation/world-export': {
        const input = parse(method, simulationProductControlInputSchema, params)
        return await administration().exportWorldDefinition(input, call)
      }
      case 'simulation/world-calendar-retain': return await administration().retainWorldCalendar(parse(method, simulationProductCalendarSubmitSchema, params), call)
      case 'simulation/world-calendar-command': return await administration().readWorldCalendarCommand(parse(method, simulationProductCalendarCommandInputSchema, params), call)
      case 'simulation/world-calendar-cancel': return await administration().cancelWorldCalendar(parse(method, simulationProductCalendarCancelSchema, params), call)
      case 'simulation/world-calendar-preview': return await administration().previewWorldCalendar(parse(method, simulationProductCalendarInputSchema, params), call)
      case 'simulation/world-calendar-submit': return await administration().submitWorldCalendar(parse(method, simulationProductCalendarSubmitSchema, params), call)
      case 'simulation/world-management-fields': {
        const input = parse(method, simulationProductWorldManagementFieldsInputSchema, params)
        return await administration().worldManagementFields(input, call)
      }
      case 'simulation/world-management-preview': {
        const input = parse(method, simulationProductWorldManagementDraftSchema, params)
        return await administration().previewWorldManagement(input, call)
      }
      case 'simulation/world-management-submit': {
        const input = parse(method, simulationProductWorldManagementSubmitInputSchema, params)
        return await administration().submitWorldManagement(input, call)
      }
      case 'simulation/world-domain-read': {
        const input = parse(method, simulationProductWorldDomainInputSchema, params)
        return await products().readWorldDomain(input, call)
      }
      case 'simulation/world-case-cancel': {
        const input = parse(method, simulationProductWorldCaseCancelInputSchema, params)
        return await administration().cancelWorldCase(input, call)
      }
      case 'simulation/world-case-inspect': {
        const input = parse(method, simulationProductWorldCaseInputSchema, params)
        return await products().inspectWorldCase(input, call)
      }
      case 'simulation/world-cases-list': {
        const input = parse(method, simulationProductWorldCasesInputSchema, params)
        return await products().listWorldCases(input, call)
      }
      case 'simulation/tasks-list': {
        const input = parse(method, simulationProductTasksInputSchema, params)
        return await administration().listTasks(input, call)
      }
      case 'simulation/tasks-cancel': {
        const input = parse(method, simulationProductTaskCancelInputSchema, params)
        return await administration().cancelTask(input, call)
      }
      case 'simulation/catalog': {
        parse(method, simulationCatalogParamsSchema, params ?? {})
        return await administration().catalog(call)
      }
      case 'simulation/operation-retry': {
        const input = parse(method, simulationProductOperationRetryInputSchema, params)
        return await administration().retryOperation(input, call)
      }
      case 'simulation/runs-statuses': {
        const input = parse(method, simulationProductRunStatusesInputSchema, params)
        const service = ctx.get('simulationAdministration') ?? products()
        return await service.runStatuses(input, call)
      }
      case 'simulation/runs-list': {
        const input = parse(method, simulationProductListInputSchema, params ?? {})
        return await products().list(input, call)
      }
      case 'simulation/runs-inspect': {
        const input = parse(method, simulationProductInspectInputSchema, params)
        return await products().inspect(input, call)
      }
      case 'simulation/world-branch': {
        const input = parse(method, simulationProductWorldBranchInputSchema, params)
        return await administration().branchWorld(input, call)
      }
      case 'simulation/world-branch-read': {
        const input = parse(method, simulationProductWorldBranchReadInputSchema, params)
        return await administration().readWorldBranch(input, call)
      }
      case 'simulation/world-causal': {
        const input = parse(method, simulationProductWorldCausalInputSchema, params)
        return await administration().queryWorldCausal(input, call)
      }
      case 'simulation/world-compare': {
        const input = parse(method, simulationProductWorldCompareInputSchema, params)
        return await administration().compareWorlds(input, call)
      }
      case 'simulation/backup-export': {
        const input = parse(method, simulationProductBackupExportInputSchema, params)
        return await administration().backupExport(input, call)
      }
      case 'simulation/retention-preview': {
        const input = parse(method, simulationProductRetentionPreviewInputSchema, params)
        return await administration().retentionPreview(input, call)
      }
      case 'simulation/retention-execute': {
        const input = parse(method, simulationProductRetentionExecuteInputSchema, params)
        return await administration().retentionExecute(input, call)
      }
      case 'simulation/retention-read': {
        const input = parse(method, simulationProductRetentionReadInputSchema, params)
        return await administration().retentionRead(input, call)
      }
      case 'simulation/retention-records': {
        const input = parse(method, simulationProductRetentionRecordsInputSchema, params)
        return await administration().retentionRecords(input, call)
      }
      case 'simulation/generation-request': {
        const input = parse(method, simulationProductGenerationRequestSchema, params)
        return await administration().generationRequest(input, call)
      }
      case 'simulation/generation-read': {
        const input = parse(method, simulationProductGenerationReadSchema, params)
        return await administration().generationRead(input, call)
      }
      case 'simulation/generation-execute': {
        const input = parse(method, simulationProductGenerationReadSchema, params)
        return await administration().generationExecute(input, call)
      }
      case 'simulation/generation-transition': {
        const input = parse(method, simulationProductGenerationTransitionSchema, params)
        return await administration().generationTransition(input, call)
      }
      case 'simulation/generation-persona-draft': {
        const input = parse(method, simulationProductGenerationPersonaDraftSchema, params)
        return await administration().generationPersonaDraft(input, call)
      }
      case 'simulation/index-rebuild': {
        const input = parse(method, simulationProductRebuildIndexInputSchema, params)
        return await products().rebuildIndex(input, call)
      }
      case 'simulation/collections-list': {
        const input = parse(method, simulationProductBrowseInputSchema, params)
        return await products().browse(input, call)
      }
      case 'simulation/sources-inspect': return await products().inspectSource(parse(method, simulationProductSourceInputSchema, params), call)
      case 'simulation/raw-archive': return await products().archiveRaw(parse(method, simulationProductRawArchiveInputSchema, params), call)
      case 'simulation/records-list': return await products().readRecords(parse(method, simulationProductRecordsInputSchema, params), call)
      case 'simulation/changes-watch': {
        return await products().watch(parse(method, simulationProductWatchInputSchema, params), call)
      }
      case 'simulation/objects-inspect': {
        const input = parse(method, simulationProductObjectInputSchema, params)
        return await products().inspectObject(input, call)
      }
      case 'simulation/runs-preflight': {
        const input = parse(method, simulationProductPreflightInputSchema, params)
        return await administration().preflight(input, call)
      }
      case 'simulation/runs-create': {
        const input = parse(method, simulationProductCreateInputSchema, params)
        return await administration().create(input, call)
      }
      case 'simulation/runs-prepare': {
        const input = parse(method, simulationProductPrepareInputSchema, params)
        return await administration().prepare(input, call)
      }
      case 'simulation/requests-list': {
        const input = parse(method, simulationProductRequestsInputSchema, params)
        return await administration().listRequests(input, call)
      }
      case 'simulation/requests-retry': {
        const input = parse(method, simulationProductRetryRequestInputSchema, params)
        return await administration().retryRequest(input, call)
      }
      case 'simulation/requests-get': {
        const input = parse(method, simulationProductRequestInputSchema, params)
        return await administration().request(input, call)
      }
      case 'simulation/runs-control': {
        const input = parse(method, simulationProductControlInputSchema, params)
        return await administration().control(input, call)
      }
      case 'simulation/runs-run-control': {
        const input = parse(method, simulationProductRunControlInputSchema, params)
        return await administration().updateRunControl(input, call)
      }
      case 'simulation/runs-manage': {
        const input = parse(method, simulationProductManageInputSchema, params)
        return await administration().manage(input, call)
      }
      case 'simulation/management-get': {
        const input = parse(method, simulationProductManagementInputSchema, params)
        return await administration().managementRequest(input, call)
      }
      case 'simulation/runs-checkpoint': {
        const input = parse(method, simulationProductCheckpointInputSchema, params)
        return await administration().checkpoint(input, call)
      }
      case 'simulation/runs-restore': {
        const input = parse(method, simulationProductRestoreInputSchema, params)
        return await administration().restore(input, call)
      }
      case 'simulation/runs-ingress': {
        const input = parse(method, simulationProductIngressInputSchema, params)
        return await administration().ingress(input, call)
      }
      case 'simulation/task-reviews-list': {
        const input = parse(method, simulationProductTaskReviewListInputSchema, params)
        return await administration().listTaskReviews(input, call)
      }
      case 'simulation/task-reviews-resolve': {
        const input = parse(method, simulationProductTaskReviewResolveInputSchema, params)
        return await administration().resolveTaskReview(input, call)
      }
      case 'simulation/ingress-get': {
        const input = parse(method, simulationProductIngressQuerySchema, params)
        return await administration().ingressRequest(input, call)
      }
      default: throw new JsonRpcRequestError(-32_601, 'Unknown Simulation SDK method')
    }
  } catch (error: unknown) {
    if (error instanceof JsonRpcRequestError) throw error
    if (isSimulationProductError(error)) {
      throw new JsonRpcRequestError(-32_002, error.message, { code: error.code })
    }
    throw new JsonRpcRequestError(-32_603, 'Simulation request could not be completed', { code: 'SIMULATION_PRODUCT_INTERNAL' })
  }
}

/** Strict input parsing happens before optional service resolution or product IO. */
function parse<T>(method: string, schema: ZodType<T>, params: unknown): T {
  const value = schema.safeParse(params)
  if (value.success) return value.data
  throw new JsonRpcRequestError(-32_602, `invalid ${method} params`, {
    issues: value.error.issues.map(issue => ({ path: issue.path, message: issue.message })),
  })
}
