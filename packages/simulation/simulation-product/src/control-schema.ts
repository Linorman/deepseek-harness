import { simulationRunControlObservationSchema } from '@clocky/clocky-simulation/run-control-observation'
import { simulationDriverFailureSchema as simulationProductFailureSchema } from '@clocky/clocky-simulation/driver-observation'
/** Strict scheduling requests and bounded owner DTOs; native diagnostics and execution configuration remain private. */
import { z } from 'zod'
import { simulationTokenRecoverySchema, simulationRequestBudgetBlockSchema } from '@clocky/clocky-simulation/tokens'
import type { SimulationEntityId, SimulationCheckpointId } from '@clocky/clocky-simulation/identities'
import { simulationProductCheckpointIdSchema } from './maintenance-schema.ts'
import type { SimTime } from '@clocky/clocky-simulation/time-types'
import { simulationProductRunIdSchema, simulationProductTextSchema } from './schema-common.ts'
import type { SimulationProductManagementId, SimulationProductManageInput, SimulationProductControlInput,
  SimulationProductManagementInput, SimulationProductControl, SimulationProductManagementReceipt,
  SimulationProductManageResult, SimulationProductManagementResult } from './control-types.ts'

/** Validate a caller-retained durable scheduling identity. */
export const simulationProductManagementIdSchema = z.string().min(1).transform(value => value as SimulationProductManagementId)
/** Exact directory selection for read-only owner observation. */
export const simulationProductControlInputSchema = z.strictObject({ runId: simulationProductRunIdSchema }) satisfies
  z.ZodType<SimulationProductControlInput>
/** Scheduling phase has native ordered semantics; no proxy-only CAS field is accepted. */
export const simulationProductManageInputSchema = z.strictObject({ runId: simulationProductRunIdSchema,
  managementId: simulationProductManagementIdSchema, phase: z.enum(['paused', 'running']),
  tokenRecovery: simulationTokenRecoverySchema.optional() }).refine(value => value.tokenRecovery === undefined || value.phase === 'paused',
  'Token recovery must remain paused') satisfies z.ZodType<SimulationProductManageInput>
/** Original result lookup without scheduling side effects. */
export const simulationProductManagementInputSchema = z.strictObject({ runId: simulationProductRunIdSchema,
  managementId: simulationProductManagementIdSchema }) satisfies z.ZodType<SimulationProductManagementInput>
const integer = z.number().int().nonnegative()
const checkpointId: z.ZodType<SimulationCheckpointId> = simulationProductCheckpointIdSchema
const action = z.strictObject({ allowed: z.boolean(), reason: z.enum(['ready', 'recovery-required', 'checkpoint-in-progress', 'preparation-in-progress',
  'management-in-progress', 'stop-target-pending', 'stop-target-reached', 'stalled', 'driver-failed', 'execution-unavailable', 'review-required', 'scenario-completed', 'scenario-blocked', 'outcome-unknown', 'retiring']) }).refine(value => value.allowed === (value.reason === 'ready'), 'Allowed controls must have a ready reason')
const maintenanceAction = z.strictObject({ allowed: z.boolean(), reason: z.enum(['ready', 'preparation-in-progress', 'request-capacity',
  'recovery-required', 'retiring', 'checkpoint-in-progress', 'management-in-progress', 'checkpoint-required', 'ownership-unavailable',
  'scenario-progressed', 'ingress-capacity', 'target-unavailable']) }).refine(value => value.allowed === (value.reason === 'ready'), 'Allowed maintenance must be ready')
const time: z.ZodType<SimTime> = z.string().regex(/^(0|[1-9][0-9]*)$/).transform(value => value as SimTime)
const interval: z.ZodType<SimTime> = z.string().regex(/^[1-9][0-9]*$/).transform(value => value as SimTime)
/** The original trusted definition or template supplies the installed scenario version. */
export const simulationProductScenarioVersionSchema = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('unavailable') }),
  z.strictObject({ status: z.literal('observed'), templateId: simulationProductTextSchema,
    version: z.literal('1'), driverVersion: z.literal('1'), execution: z.enum(['cognition-only', 'automatic-tasks']) }),
])
/** Bounded immutable public version labels stay separate from driver and scheduling state. */
export const simulationProductVersionSummarySchema = z.strictObject({ rulesVersion: simulationProductTextSchema,
  policyVersion: simulationProductTextSchema, tickUnit: simulationProductTextSchema, scenario: simulationProductScenarioVersionSchema })
/** Live shared permits and real-time queueing are independent of simulated per-run budget usage. */
export const simulationProductModelPoolObservationSchema = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('unavailable'), clock: z.literal('real'), observedAt: integer }),
  z.strictObject({ status: z.literal('observed'), clock: z.literal('real'), observedAt: integer,
    active: integer, queued: integer, limit: integer.positive(), queueLimit: integer }),
]).refine(value => value.status !== 'observed' || value.active <= value.limit && value.queued <= value.queueLimit,
  'Observed model admission cannot exceed its configured pool and queue limits')
/** Safe failure parsing is shared with the durable Native event. */
export { simulationDriverFailureSchema as simulationProductFailureSchema } from '@clocky/clocky-simulation/driver-observation'
const driverSource = z.strictObject({ status: z.enum(['live', 'owner-unavailable']), revision: integer.optional(), observedAt: integer })
/** History errors expose only stable categories, never provider paths or source bodies. */
export const simulationProductReadFailureSchema = z.enum(['history-limit', 'unsupported-version', 'corrupt-history', 'owner-unavailable', 'unavailable'])
/** Safe read-limit dimensions retain measured demand without source paths. */
export const simulationProductReadLimitSchema = z.strictObject({ dimension: z.enum(['entries', 'bytes', 'entry-bytes']),
  actual: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), limit: z.number().int().positive().max(Number.MAX_SAFE_INTEGER) })
/** Current ownership does not imply that scheduling is running, or that accepted work is idle. */
export const simulationProductControlSchema = z.strictObject({ runId: simulationProductRunIdSchema,
  tokenRecovery: z.strictObject({ request: simulationTokenRecoverySchema, allowed: z.boolean(),
    reason: z.enum(['ready', 'pause-required', 'in-flight', 'unknown-usage', 'ownership-unavailable']) })
    .refine(value => value.allowed === (value.reason === 'ready'), 'Token recovery readiness must match its reason').optional(),
  requestBudget: simulationRequestBudgetBlockSchema.safeExtend({ decisionId: z.string().min(1) }).optional(),
  administration: z.strictObject({ actions: z.strictObject({ checkpoint: maintenanceAction, restore: maintenanceAction,
    prepare: maintenanceAction, ingress: maintenanceAction }),
  ingress: z.strictObject({ maxTime: time, maxBytes: integer.positive(),
    coverage: z.strictObject({ complete: z.boolean(), returned: integer, total: integer }).optional(), targets: z.array(z.strictObject({
      id: z.string().min(1).transform(value => value as SimulationEntityId), name: simulationProductTextSchema })).max(32) })
    .refine(value => value.coverage === undefined || value.coverage.returned === value.targets.length
      && value.coverage.returned <= value.coverage.total && value.coverage.complete === (value.coverage.returned === value.coverage.total),
    'Ingress target coverage must match its returned window'),
  recovery: z.strictObject({ checkpointId, publishedAt: integer, time, revision: integer,
    references: z.strictObject({ runs: integer, teams: integer, channels: integer, sessions: integer }) }).optional() }),
  budget: z.strictObject({ model: z.strictObject({ provider: z.string().min(1), name: z.string().min(1) }),
    tokensPerRequest: integer.positive(), tokensPerInterval: integer,
    interval,
    residentActors: integer, sharedModelLimit: integer.positive() }),
  modelPool: simulationProductModelPoolObservationSchema.optional(), versions: simulationProductVersionSummarySchema.optional(), owner: z.enum(['held', 'not-held']),
  phase: z.enum(['paused', 'running', 'stalled']).optional(), revision: integer.optional(),
  driver: z.enum(['idle', 'scheduled', 'advancing', 'checkpointing', 'waiting', 'completed', 'failed', 'retiring']), inFlight: z.boolean(), observedAt: integer,
  stop: z.enum(['message-rejected', 'context-integrity', 'decision-timeout', 'token-overrun', 'request-budget', 'paused', 'stalled', 'until', 'work-limit', 'decision-required', 'retry', 'outcome-unknown', 'recipient-required',
    'recipient-busy', 'coordination-limit', 'resident-capacity', 'residency-recovery-required', 'review-required', 'completed', 'scenario-blocked',
    'recovery-required', 'idle', 'maintenance-blocked', 'position-capacity', 'authority-missing', 'approval-required', 'existing-obligations', 'plan-stale', 'plan-budget',
    'stale-time', 'waiting-effective-time', 'handoff-required',
    'retirement-unknown',
    'resource-capacity', 'resource-history-limit', 'resource-reservation-expired',
    'entity-capacity', 'identity-capacity', 'channel-capacity', 'world-byte-limit', 'world-request-limit', 'world-command-limit',
    'world-birth-limit', 'world-expansion-limit', 'world-mutation-limit', 'budget-limit', 'context-limit', 'microstep-limit', 'model-pool-capacity', 'activation-history-limit', 'message-byte-limit']).optional(),
  historyRead: z.strictObject({ status: z.literal('unavailable'), reason: simulationProductReadFailureSchema,
    limit: simulationProductReadLimitSchema.optional() }).optional(),
  stopTarget: simulationRunControlObservationSchema.optional(), driverSource: driverSource.optional(),
  failure: simulationProductFailureSchema.optional(), nextAttemptAt: integer.optional(),
  actions: z.strictObject({ start: action, pause: action }),
}) satisfies z.ZodType<SimulationProductControl>
/** Failed native diagnostic messages are represented only as an explicit redaction. */
export const simulationProductManagementReceiptSchema = z.strictObject({ managementId: simulationProductManagementIdSchema,
  phase: z.enum(['paused', 'running']), status: z.enum(['in-progress', 'completed', 'failed']), startedSequence: integer,
  finishedSequence: integer.optional(), failure: z.literal('details-withheld').optional(),
}).refine(value => (value.status === 'in-progress') === (value.finishedSequence === undefined)
  && (value.status === 'failed') === (value.failure !== undefined), 'Management terminal fields must match its original status') satisfies
  z.ZodType<SimulationProductManagementReceipt>
/** Original scheduling receipt and separate current observation share one product run. */
export const simulationProductManageResultSchema = z.strictObject({ runId: simulationProductRunIdSchema,
  operation: simulationProductManagementReceiptSchema, control: simulationProductControlSchema,
}).refine(value => value.runId === value.control.runId, 'Control observation belongs to another run') satisfies z.ZodType<SimulationProductManageResult>
/** Exact found/absence result, never a guessed transport outcome. */
export const simulationProductManagementResultSchema = z.discriminatedUnion('status', [
  z.strictObject({ runId: simulationProductRunIdSchema, managementId: simulationProductManagementIdSchema, status: z.literal('not-found') }),
  z.strictObject({ runId: simulationProductRunIdSchema, managementId: simulationProductManagementIdSchema, status: z.literal('found'),
    operation: simulationProductManagementReceiptSchema }),
]).refine(value => value.status === 'not-found' || value.operation.managementId === value.managementId,
  'Original management result belongs to another request') satisfies z.ZodType<SimulationProductManagementResult>

/** Independent metadata includes no budget body, task text, grants or controls. */
export const simulationProductOperationalStatusSchema = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('unavailable'), observedAt: integer,
    scenario: z.strictObject({ status: z.literal('unavailable') }) }),
  z.strictObject({ status: z.literal('observed'), observedAt: integer, scenario: simulationProductScenarioVersionSchema,
    owner: simulationProductControlSchema.shape.owner, driver: simulationProductControlSchema.shape.driver,
    stopTarget: simulationRunControlObservationSchema.optional(),
    driverSource: driverSource.optional(), failure: simulationProductFailureSchema.optional(),
    inFlight: z.boolean(), stop: simulationProductControlSchema.shape.stop,
    nextAttemptAt: simulationProductControlSchema.shape.nextAttemptAt }),
])
