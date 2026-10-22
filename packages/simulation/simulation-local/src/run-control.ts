/** Durable stop-target transitions share Native's ordinary commit queue and replay validators. */
import { isDeepStrictEqual } from 'node:util'
import { z } from 'zod'
import { simulationRunControlCommandSchema, simulationRunControlBookSchema, simTimeSchema,
  SimulationStopBoundaryError, simulationTokenCount, assertSimulationStopTime } from '@clocky/clocky-simulation'
import type { SimulationRunControlState, SimulationSnapshot, SimulationStopTarget,
  SimulationWorldDomainRequest, SimulationOperation, SimTime } from '@clocky/clocky-simulation'
import { requireWorldRuntime, type NativeWorldRuntime } from './world-runtime.ts'

const timestamp = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
/** Only Native records timestamps; model tools cannot create or refresh control facts. */
export const runControlRecordSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('control/update'), command: simulationRunControlCommandSchema, recordedAt: timestamp }),
  z.strictObject({ kind: z.literal('control/refresh'), recordedAt: timestamp }),
  z.strictObject({ kind: z.literal('control/checkpoint-retry'), commandId: z.string().min(1).max(128),
    previousCheckpointId: z.string().min(1).max(128), nextCheckpointId: z.string().min(1).max(128) }),
  z.strictObject({ kind: z.literal('control/checkpoint'), commandId: z.string().min(1).max(128),
    checkpointId: z.string().min(1).max(128), status: z.enum(['completed', 'failed', 'external-state-required']) }),
])
/** Closed Native stopping transition, including separate checkpoint disposition. */
export type RunControlRecord = z.infer<typeof runControlRecordSchema>

function position(state: SimulationSnapshot, target: SimulationStopTarget,
  runtime?: NativeWorldRuntime): { value: SimTime; revision: number } {
  if (target.clock.kind === 'native') return { value: state.time, revision: state.revision }
  const selected = target.clock
  if (!state.world?.definition.operations.some(pin => isDeepStrictEqual(pin, selected.pin)))
    throw new SimulationStopBoundaryError('The target clock is not installed in this run')
  const clock = requireWorldRuntime(runtime).original(selected.pin).stopClock
  if (clock?.name !== selected.name)
    throw new SimulationStopBoundaryError('The exact domain clock is unavailable for this target')
  const observed = clock.observe(state)
  if (observed === undefined) throw new SimulationStopBoundaryError('The domain clock has no confirmed position')
  simTimeSchema.parse(observed.value)
  if (!Number.isSafeInteger(observed.revision) || observed.revision < 0 || observed.revision > state.revision)
    throw new SimulationStopBoundaryError('The domain clock revision is invalid')
  return observed
}
function nativeBoundary(state: SimulationSnapshot, target: SimulationStopTarget, runtime?: NativeWorldRuntime): SimTime {
  const mapped = target.clock.kind === 'native' ? target.boundary
    : requireWorldRuntime(runtime).original(target.clock.pin).stopClock?.nativeBoundary?.(state, target.boundary)
  if (mapped === undefined) throw new SimulationStopBoundaryError('The exact domain clock has no proven Native boundary mapping')
  if (mapped.length > 256 || state.time.length > 256)
    throw new SimulationStopBoundaryError('Stop clock mapping exceeds its control metadata allowance')
  const bound = simTimeSchema.parse(mapped)
  if (BigInt(state.time) > BigInt(bound) || BigInt(bound) > BigInt(state.spec.maxTime))
    throw new SimulationStopBoundaryError('The mapped stop target is behind Native time or exceeds its horizon')
  return bound
}
function inFlight(state: SimulationSnapshot): boolean {
  return Object.values(state.world?.executions ?? {}).some(value => value.phase === 'armed' || value.phase === 'outcome-unknown')
    || Object.values(state.operations).some((value) => { const outcome = value.outbox?.attempts.at(-1)?.outcome; return outcome === 'in-flight' || outcome === 'uncertain' })
}
function tokenCharges(state: SimulationSnapshot): Record<string, number> {
  return Object.fromEntries(Object.values(state.tokenReservations ?? {}).map(reservation => [reservation.id,
    reservation.status === 'not-dispatched' ? 0 : reservation.usage !== undefined ? simulationTokenCount(reservation.usage)
      : Math.max(reservation.reserved, reservation.observedUsage === undefined ? 0 : simulationTokenCount(reservation.observedUsage))]))
}
function sumTokens(charges: Record<string, number>): number {
  const total = Object.values(charges).reduce((sum, value) => sum + BigInt(value), 0n)
  if (total > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Control token accounting exceeds safe integer capacity')
  return Number(total)
}
function cut(state: SimulationSnapshot, value: { value: SimTime; revision: number }, now: number) {
  return { nativeRevision: state.revision, nativeTime: state.time, clockRevision: value.revision,
    clockValue: value.value, recordedAt: now, tokenBaseline: sumTokens(tokenCharges(state)), tokenReservations: tokenCharges(state),
    operationIds: Object.values(state.operations).filter(value => value.result === undefined).map(value => value.id),
    requestIds: Object.values(state.world?.requests ?? {}).map(value => value.id),
    decisionIds: Object.values(state.decisions).filter(value => value.status === 'open' || value.status === 'submitted').map(value => value.id) }
}
function requestForDecision(state: SimulationSnapshot, decisionId?: string, wakeId?: string): string | undefined {
  const decision = decisionId === undefined ? undefined : state.decisions[decisionId as never]
  const scope = decision?.context?.status === 'prepared' ? decision.context.world : undefined
  if (scope?.kind === 'resolve' || scope?.kind === 'scenario-resolve') return scope.requestId
  if (scope?.kind === 'result' || scope?.kind === 'scenario-result' || scope?.kind === 'first-action')
    return state.world?.results[scope.resultId]?.requestId
  const wake = wakeId ?? decision?.wakeId
  if (wake === undefined) return undefined
  const request = Object.values(state.world?.requests ?? {}).find(value =>
    wake === `simulation-delivery:${value.notificationOperationId}` || wake === `simulation-world-scenario-resolve:${value.id}`)
  if (request !== undefined) return request.id
  return Object.values(state.world?.results ?? {}).find(value => wake === `simulation-world-result:${value.id}`
    || wake === `simulation-world-first:${value.intentId}`)?.requestId
}
function protocolOperation(state: SimulationSnapshot, decisionId: string, action: SimulationOperation['action']): string | undefined {
  if (action.kind === 'world/resolve' && action.resolution.kind !== 'awaiting-evidence') return action.requestId
  const decision = state.decisions[decisionId as never]
  const scope = decision?.context?.status === 'prepared' ? decision.context.world : undefined
  if (action.kind === 'communication/post' && (scope?.kind === 'result' && isDeepStrictEqual(action, scope.notification)
    || scope?.kind === 'first-action')) return requestForDecision(state, decisionId)
  return undefined
}
function hasRemaining(state: SimulationSnapshot, control: SimulationRunControlState): boolean {
  const frozen = control.cut
  if (frozen === null) return false
  if (inFlight(state) || frozen.operationIds.some(id => state.operations[id as never]?.result === undefined)
    || frozen.requestIds.some(id => state.world?.requests[id as never]?.status === 'open')
    || frozen.decisionIds.some((id) => { const status = state.decisions[id as never]?.status; return status === 'open' || status === 'submitted' }))
    return true
  if (Object.values(state.scheduledEvents).some(event => event.status === 'pending'
    && frozen.requestIds.includes(requestForDecision(state, undefined, event.id) ?? ''))) return true
  if (Object.values(state.wakes).some(wake => (wake.status === 'pending' || wake.status === 'claimed')
    && frozen.requestIds.includes(requestForDecision(state, undefined, wake.eventId) ?? ''))) return true
  return Object.values(state.operations).some(operation => operation.result === undefined
    && frozen.requestIds.includes(protocolOperation(state, operation.decisionId, operation.action) ?? ''))
}

/**
 * Recompute only control facts; domain observation is pure and cannot execute or rewrite an action.
 * @param state - Original queued Native prefix.
 * @param record - Parsed Host update or Native progress record.
 * @param revision - Exact new Native revision.
 * @param runtime - Original pinned domain interpreter.
 * @returns validated immutable control projection; paused states retain unfinished duties.
 */
export function foldRunControl(state: SimulationSnapshot, record: RunControlRecord, revision: number,
  runtime?: NativeWorldRuntime): SimulationSnapshot {
  const previous = state.runControl
  if (record.kind === 'control/checkpoint-retry') {
    const current = previous?.current
    if (current === undefined || current.commandId !== record.commandId || current.state !== 'paused' || state.phase !== 'paused'
      || current.target?.checkpointPolicy !== 'request' || current.cut === null
      || current.checkpoint !== 'failed' || current.checkpointId !== record.previousCheckpointId
      || state.checkpoints?.[record.previousCheckpointId as never]?.status !== 'failed'
      || current.checkpointAttempts.includes(record.nextCheckpointId) || Object.hasOwn(state.checkpoints ?? {}, record.nextCheckpointId)
      || current.checkpointAttempts.length >= state.spec.maxQueuedDecisions)
      throw new Error('Stop checkpoint retry requires its original failed attempt and an unused bounded replacement identity')
    return { ...state, runControl: { current: { ...current, checkpoint: 'pending', checkpointId: record.nextCheckpointId,
      checkpointAttempts: [...current.checkpointAttempts, record.nextCheckpointId] }, commands: previous?.commands ?? {} } }
  }
  if (record.kind === 'control/checkpoint') {
    if (previous === undefined) throw new Error('Checkpoint disposition has no original stopping command')
    const current = previous.current
    if ( current.commandId !== record.commandId || current.state !== 'paused'
      || state.phase !== 'paused' || current.target?.checkpointPolicy !== 'request' || current.cut === null
      || current.checkpointId !== null && current.checkpointId !== record.checkpointId)
      throw new Error('Checkpoint disposition lost its original paused stopping command and save identity')
    if (current.checkpoint !== 'pending' && current.checkpoint !== record.status)
      throw new Error('Stop checkpoint disposition is already terminal')
    const checkpoint = state.checkpoints?.[record.checkpointId as never]
    const external = state.world?.definition.operations.some(pin =>
      requireWorldRuntime(runtime).original(pin).checkpointCoverage !== 'native') ?? false
    if (record.status === 'completed' && (external || checkpoint?.status !== 'completed'
      || checkpoint.manifest.run.runId !== state.spec.runId || checkpoint.manifest.run.cursor < current.cut.nativeRevision))
      throw new Error('Complete stop checkpoint requires a verified Native cut and complete provider backup coverage')
    if (record.status === 'failed' && checkpoint?.status !== 'failed')
      throw new Error('Failed stop checkpoint requires its original failed Native checkpoint')
    if (record.status === 'external-state-required' && !external)
      throw new Error('External stop-checkpoint dependency is not present')
    const attempts = current.checkpointAttempts.includes(record.checkpointId) ? current.checkpointAttempts
      : [...current.checkpointAttempts, record.checkpointId]
    if (attempts.length > state.spec.maxQueuedDecisions) throw new Error('Stop checkpoint attempt allowance exhausted')
    return { ...state, runControl: { ...previous,
      current: { ...current, checkpointAttempts: attempts, checkpointId: record.checkpointId, checkpoint: record.status } } }
  }
  let current: SimulationRunControlState
  let commands = previous?.commands ?? {}
  if (record.kind === 'control/update') {
    const prior = Object.hasOwn(commands, record.command.commandId) ? commands[record.command.commandId] : undefined
    if (prior !== undefined) throw new Error('Repeated control commands must return the original receipt without appending')
    const used = Object.keys(commands).length
    if (used >= state.spec.maxQueuedDecisions && (record.command.target !== null || used > state.spec.maxQueuedDecisions))
      throw new Error('Run control command allowance exhausted')
    const target = record.command.target
    let native: SimTime | null = null
    if (target !== null) {
      const actual = position(state, target, runtime)
      if (BigInt(target.boundary) < BigInt(actual.value))
        throw new SimulationStopBoundaryError('The target is earlier than the confirmed clock; keep the run paused')
      native = nativeBoundary(state, target, runtime)
      if (target.clock.kind === 'native' && BigInt(target.boundary) > BigInt(state.spec.maxTime))
        throw new SimulationStopBoundaryError('The target exceeds the Native run horizon')
    }
    current = { commandId: record.command.commandId, revision, target, nativeBoundary: native,
      activation: inFlight(state) && target !== null ? 'pending' : 'effective',
      state: target === null ? 'cleared' : 'armed', reason: target === null ? 'cleared' : inFlight(state) ? 'external-in-flight' : null,
      cut: null, steps: 0, tokens: 0, checkpointId: null, checkpointAttempts: [], checkpoint: 'not-requested' }
    const receipt = { commandId: record.command.commandId, revision, activation: current.activation, targetId: target?.targetId ?? null }
    commands = { ...commands, [record.command.commandId]: { command: record.command, receipt } }
  } else {
    if (previous === undefined) throw new Error('Control progress has no original target')
    current = previous.current
    if (current.target === null) throw new Error('Cleared control needs no progress record')
  }
  if (current.target !== null) {
    const target = current.target
    const actual = position(state, target, runtime)
    if (current.activation === 'pending' && !inFlight(state)) {
      current = { ...current, activation: BigInt(actual.value) > BigInt(target.boundary) ? 'rejected' : 'effective',
        reason: BigInt(actual.value) > BigInt(target.boundary) ? 'past-boundary' : null }
    }
    if (current.activation === 'effective' && current.cut === null && (BigInt(actual.value) >= BigInt(target.boundary)
      || current.nativeBoundary !== null && BigInt(state.time) >= BigInt(current.nativeBoundary))) {
      current = { ...current, cut: cut(state, actual, record.recordedAt),
        state: target.mode === 'drain-admitted' ? 'draining' : 'paused',
        reason: BigInt(actual.value) >= BigInt(target.boundary) ? 'target-reached' : 'native-boundary-reached',
        checkpoint: target.checkpointPolicy === 'request' ? 'pending' : 'not-requested' }
    }
    if (current.state === 'draining') {
      const steps = current.steps + (record.kind === 'control/refresh' ? 1 : 0)
      const tokens = sumTokens(Object.fromEntries(Object.entries(tokenCharges(state)).map(([id, charge]) =>
        [id, Math.max(0, charge - (current.cut?.tokenReservations[id] ?? 0))])))
      const exhausted = steps >= target.drainBudget.maxSteps || tokens >= target.drainBudget.maxTokens
        || record.recordedAt - (current.cut?.recordedAt ?? record.recordedAt) >= target.drainBudget.maxWallTimeMs
      current = { ...current, steps, tokens,
        state: exhausted || !hasRemaining(state, current) ? 'paused' : 'draining', reason: exhausted ? 'drain-budget' : current.reason }
    }
  }
  const runControl = simulationRunControlBookSchema.parse({ current, commands })
  return { ...state, runControl,
    ...current.activation !== 'effective' || current.state === 'paused' ? { phase: 'paused' as const } : {} }
}

/**
 * Prevent clock consumption past a Native target, including direct scheduler replay.
 * @param state - Original Native prefix with the retained stopping command.
 * @param time - Proposed clock value, never an automatically rewritten action.
 * @returns nothing when bounded; throws a correctable refusal otherwise.
 */
export function assertRunControlTime(state: SimulationSnapshot, time: SimTime): void {
  assertSimulationStopTime(state, time)
}

/**
 * Reject new business after the boundary while retaining the frozen protocol closure.
 * @param state - Original Native prefix.
 * @param responsibility - Actual operation, request, decision or wake being admitted; identities grant no authority.
 * @returns nothing for bounded work; throws for pending activation or closed admission.
 */
export function assertRunControlAdmission(state: SimulationSnapshot,
  responsibility?: { operationId?: string; requestId?: string; decisionId?: string; wakeId?: string }): void {
  const control = state.runControl?.current
  if (control === undefined || control.target === null) return
  if (control.activation !== 'effective') throw new SimulationStopBoundaryError('Stop-target activation requires external reconciliation')
  if (control.state === 'armed' && control.nativeBoundary !== null && BigInt(state.time) < BigInt(control.nativeBoundary)) return
  const frozen = control.cut
  if (control.state === 'draining' && responsibility !== undefined && frozen !== null
    && (responsibility.operationId !== undefined && frozen.operationIds.includes(responsibility.operationId)
      || responsibility.requestId !== undefined && frozen.requestIds.includes(responsibility.requestId)
      || responsibility.decisionId !== undefined && frozen.decisionIds.includes(responsibility.decisionId)
      || frozen.requestIds.includes(requestForDecision(state, responsibility.decisionId, responsibility.wakeId) ?? '')
      || responsibility.operationId !== undefined && (() => {
        const operation = state.operations[responsibility.operationId as never]
        return operation !== undefined
          && frozen.requestIds.includes(protocolOperation(state, operation.decisionId, operation.action) ?? '')
      })())) return
  throw new SimulationStopBoundaryError('The retained stop target closes new business admission')
}

/**
 * Pure domain guard used at request acceptance and immediately before external execution.
 * @param state - Original Native prefix.
 * @param request - Strict original request; the domain interpreter never rewrites it.
 * @param runtime - Original installed clock interpreter.
 * @param responsibility - Frozen case identity for protocol closure, checked independently of authorization.
 * @returns nothing when the exact clock effect is provable and within the target; otherwise throws.
 */
export function assertRunControlRequest(state: SimulationSnapshot, request: SimulationWorldDomainRequest,
  runtime?: NativeWorldRuntime, responsibility?: Parameters<typeof assertRunControlAdmission>[1]): void {
  assertRunControlAdmission(state, responsibility)
  const target = state.runControl?.current.target
  if (request.expectedTime !== null) assertSimulationStopTime(state, request.expectedTime)
  if (target?.clock.kind !== 'domain') return
  const clock = requireWorldRuntime(runtime).original(target.clock.pin).stopClock
  const maximum = clock?.effect(state, request)
  if (clock?.name !== target.clock.name || maximum === undefined)
    throw new SimulationStopBoundaryError('This request has no proven domain-clock effect under the exact installed protocol')
  if (BigInt(simTimeSchema.parse(maximum)) > BigInt(target.boundary))
    throw new SimulationStopBoundaryError('The proposed request exceeds the retained domain stop target; correct the request explicitly')
}

/**
 * Validate control ownership, cut references and command bounds at publication and cold recovery.
 * @param state - Complete Native projection with its original command and checkpoint owners.
 * @returns nothing when the owned relationships hold; malformed projections throw.
 */
export function assertRunControlProjection(state: SimulationSnapshot): void {
  if (state.runControl === undefined) return
  const book = simulationRunControlBookSchema.parse(state.runControl), current = book.current
  if (BigInt(Object.keys(book.commands).length) > BigInt(state.spec.maxQueuedDecisions) + 1n || current.revision > state.revision
    || current.cut !== null && (current.cut.nativeRevision > state.revision || current.cut.clockRevision > current.cut.nativeRevision)
    || !Object.hasOwn(book.commands, current.commandId)) throw new Error('Run control projection lost its original command or cut')
  if ((current.target === null) !== (current.nativeBoundary === null)
    || current.target?.clock.kind === 'native' && current.nativeBoundary !== current.target.boundary)
    throw new Error('Stop target lost its original Native boundary mapping')
  const owner = book.commands[current.commandId]
  if (owner === undefined || current.revision !== owner.receipt.revision || !isDeepStrictEqual(current.target, owner.command.target)
    || (current.target === null) !== (current.state === 'cleared')) throw new Error('Current stopping control differs from its accepted command')
  for (const [id, value] of Object.entries(book.commands)) {
    if (id !== value.command.commandId || id !== value.receipt.commandId || value.receipt.revision > state.revision
      || value.receipt.targetId !== (value.command.target?.targetId ?? null)) throw new Error('Run control receipt changed its original command')
  }
  if (current.checkpointAttempts.length > state.spec.maxQueuedDecisions
    || new Set(current.checkpointAttempts).size !== current.checkpointAttempts.length
    || current.checkpointId !== null && current.checkpointAttempts.at(-1) !== current.checkpointId
    || current.checkpointAttempts.slice(0, -1).some(id => state.checkpoints?.[id as never]?.status !== 'failed'))
    throw new Error('Stop checkpoint attempts lost their original ordered failure history')
  if (current.checkpoint === 'completed') {
    const saved = current.checkpointId === null ? undefined : state.checkpoints?.[current.checkpointId as never]
    if (saved?.status !== 'completed' || current.cut === null || saved.manifest.run.cursor < current.cut.nativeRevision)
      throw new Error('Completed stop checkpoint lost its actual saved Native cut')
  }
  if (current.checkpoint === 'failed' && (current.checkpointId === null
    || state.checkpoints?.[current.checkpointId as never]?.status !== 'failed'))
    throw new Error('Failed stop checkpoint lost its actual Native failure')
  if ((current.activation !== 'effective' || current.state === 'paused') && state.phase !== 'paused')
    throw new Error('Closed run control cannot retain active scheduling')
  if (current.cut !== null && (current.cut.operationIds.some(id => !Object.hasOwn(state.operations, id))
    || current.cut.requestIds.some(id => !Object.hasOwn(state.world?.requests ?? {}, id))
    || current.cut.decisionIds.some(id => !Object.hasOwn(state.decisions, id)))) throw new Error('Stop cut lost an admitted responsibility')
}

/**
 * Permit finite protocol closure for cases admitted before the frozen cut; Native still validates every action.
 * @param state - Original Native prefix.
 * @param decisionId - Actual current decision owning the new operation.
 * @param action - Proposed action; ordinary new business is refused during drain.
 * @returns nothing for allowed protocol shape; throws for an unrelated or expansive action.
 */
export function assertRunControlOperation(state: SimulationSnapshot, decisionId: string, action: SimulationOperation['action']): void {
  const control = state.runControl?.current
  if (control?.state !== 'draining') return
  const requestId = protocolOperation(state, decisionId, action)
  if (requestId === undefined || control.cut?.requestIds.includes(requestId) !== true)
    throw new SimulationStopBoundaryError('Draining admits only original case resolution and its required notification')
}
