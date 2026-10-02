import { simulationProductTasksInputSchema, simulationProductTaskCancelInputSchema } from '@clocky/clocky-simulation-product/schema'
import { simulationProductRequestsInputSchema, simulationProductRetryRequestInputSchema } from '@clocky/clocky-simulation-product/schema'
import { simulationProductPreflightInputSchema } from '@clocky/clocky-simulation-product/schema'
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
    listTasks: request => admin(request, simulationProductTasksInputSchema, (service, input, call) => service.listTasks(input, call)),
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
    records: request => read(request, simulationProductRecordsInputSchema, (products, input, call) => products.readRecords(input, call)),
    watch: request => read(request, simulationProductWatchInputSchema, (products, input, call) => products.watch(input, call)),
    checkpoint: request => admin(request, simulationProductCheckpointInputSchema,
      (service, input, call) => service.checkpoint(input, call)),
    restore: request => admin(request, simulationProductRestoreInputSchema, (service, input, call) => service.restore(input, call)),
    ingress: request => admin(request, simulationProductIngressInputSchema, (service, input, call) => service.ingress(input, call)),
    ingressRequest: request => admin(request, simulationProductIngressQuerySchema,
      (service, input, call) => service.ingressRequest(input, call)),
    control: request => admin(request, simulationProductControlInputSchema, (service, input, call) => service.control(input, call)),
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
    browse: request => read(request, simulationProductBrowseInputSchema, (products, input, call) => products.browse(input, call)),
    inspectObject: request => read(request, simulationProductObjectInputSchema,
      (products, input, call) => products.inspectObject(input, call)),
  }
}

/** Re-read mutable lease state after awaited IO without retaining TypeScript's initial narrowing. */
function retired(call: AuthenticatedProductCall): boolean { return call.signal.aborted }
