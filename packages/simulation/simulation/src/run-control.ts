/** Durable Host stop targets, independent of scene completion and checkpoint success. */
import { z } from 'zod'
import { simTimeSchema } from './time.ts'
import { simulationWorldDomainPinSchema } from './world-domain.ts'

const identity = z.string().min(1).max(128)
const sequence = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
/** Native time or one exact installed provider's named integer clock; there is no wall-clock inference. */
export const simulationStopClockSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('native') }),
  z.strictObject({ kind: z.literal('domain'), pin: simulationWorldDomainPinSchema, name: identity }).superRefine((clock, ctx) => {
    for (const key of ['domain', 'operation', 'version', 'schemaRef', 'implementationRef'] as const) {
      if (clock.pin[key].length > 256) ctx.addIssue({ code: 'custom', path: ['pin', key], message: 'Stop-clock metadata exceeds 256 UTF-16 units' })
    }
  }),
])
/** All budgets are explicit deployment choices; zero never means unbounded. */
export const simulationDrainBudgetSchema = z.strictObject({
  maxSteps: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  maxTokens: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  maxWallTimeMs: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
})
/** A stopping boundary does not cancel unfinished business duties or claim the scene succeeded. */
export const simulationStopTargetSchema = z.strictObject({ targetId: identity,
  clock: simulationStopClockSchema, boundary: simTimeSchema.refine(value => value.length <= 256, 'Stop boundary exceeds its control metadata allowance'),
  mode: z.enum(['at-boundary', 'drain-admitted']),
  checkpointPolicy: z.enum(['none', 'request']), drainBudget: simulationDrainBudgetSchema,
})
/** Authenticated Host command payload; principals and authorization never come from model JSON. */
export const simulationRunControlCommandSchema = z.strictObject({ commandId: identity,
  target: simulationStopTargetSchema.nullable() })
/** Immutable accepted-work identities at the exact boundary; later notifications cannot expand this cut. */
export const simulationStopCutSchema = z.strictObject({ nativeRevision: sequence, nativeTime: simTimeSchema,
  clockRevision: sequence, clockValue: simTimeSchema, recordedAt: sequence, tokenBaseline: sequence,
  tokenReservations: z.record(z.string(), sequence),
  operationIds: z.array(z.string().min(1)), requestIds: z.array(z.string().min(1)), decisionIds: z.array(z.string().min(1)),
})
/** Current control projection. Pending activation always closes business admission until reconciliation. */
export const simulationRunControlStateSchema = z.strictObject({ revision: sequence,
  commandId: identity, target: simulationStopTargetSchema.nullable(), nativeBoundary: simTimeSchema.nullable(),
  activation: z.enum(['effective', 'pending', 'rejected']),
  state: z.enum(['armed', 'draining', 'paused', 'cleared']),
  reason: z.enum(['target-reached', 'native-boundary-reached', 'external-in-flight', 'past-boundary', 'drain-budget', 'cleared']).nullable(),
  cut: simulationStopCutSchema.nullable(), steps: sequence, tokens: sequence,
  checkpointId: identity.nullable(), checkpointAttempts: z.array(identity),
  checkpoint: z.enum(['not-requested', 'pending', 'completed', 'failed', 'external-state-required']),
})
/** Stable response identity survives subsequent control changes; current state is observed separately. */
export const simulationRunControlReceiptSchema = z.strictObject({ commandId: identity, revision: sequence,
  activation: z.enum(['effective', 'pending', 'rejected']), targetId: identity.nullable() })
/** Durable command history uses maxQueuedDecisions plus one reserved final clear, so exhaustion cannot prevent releasing a target. */
export const simulationRunControlBookSchema = z.strictObject({ current: simulationRunControlStateSchema,
  commands: z.record(z.string(), z.strictObject({ command: simulationRunControlCommandSchema,
    receipt: simulationRunControlReceiptSchema })) })
/** Exact persisted clock identity. */
export type SimulationStopClock = z.infer<typeof simulationStopClockSchema>
/** Explicit stopping boundary and bounded drain policy. */
export type SimulationStopTarget = z.infer<typeof simulationStopTargetSchema>
/** Idempotent authenticated Host request. */
export type SimulationRunControlCommand = z.infer<typeof simulationRunControlCommandSchema>
/** Current stopping projection, independent of driver availability. */
export type SimulationRunControlState = z.infer<typeof simulationRunControlStateSchema>
/** Original accepted command identity and activation disposition. */
export type SimulationRunControlReceipt = z.infer<typeof simulationRunControlReceiptSchema>
/** Current control facts and bounded immutable command receipts. */
export type SimulationRunControlBook = z.infer<typeof simulationRunControlBookSchema>

/** A correctable refusal never rewrites the chosen action or grants retry authority. */
export class SimulationStopBoundaryError extends Error {
  /** Stable machine-readable rejection identity for a retained stopping boundary. */
  readonly code = 'SIM_STOP_BOUNDARY'
  /** @param message - Safe structural stopping reason, without private domain payloads. */
  constructor(message: string) { super(message); this.name = 'SimulationStopBoundaryError' }
}

/**
 * Enforce the original explicit Native bound for either clock without assuming how domain time maps to Native time.
 * @param state - Authoritative prefix containing the resolved immutable bound.
 * @param time - Proposed Native execution or delivery time.
 * @returns nothing within the bound; throws a correctable stopping refusal otherwise.
 */
export function assertSimulationStopTime(state: import('./types.ts').SimulationSnapshot, time: import('./time-types.ts').SimTime): void {
  const boundary = state.runControl?.current.nativeBoundary
  if (boundary !== undefined && boundary !== null && BigInt(time) > BigInt(boundary))
    throw new SimulationStopBoundaryError('The proposed Native time exceeds the retained stop target')
}
