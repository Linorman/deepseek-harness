import { worldExecutionReads } from './world.ts'
import type { NativeWorldRuntime } from './world-runtime.ts'
/** Native generation responsibility is replayed from the same journal as world mutations. */
import { isDeepStrictEqual } from 'node:util'
import { simulationTokenCount, activePlannerAncestors, plannerReservedTokens, simulationGeneratedPlanSchema, validateGenerationOutput, budgetInterval, hiringMarket } from '@clocky/clocky-simulation'
import type { SimulationSnapshot, SimulationGenerationRecord, SimulationGenerationTransition } from '@clocky/clocky-simulation'
import { assertBudget } from './budget.ts'

/**
 * Apply one validated host transition without inference or provider IO.
 * @param state - Original authoritative Native prefix.
 * @param change - Strict parsed transition; the host rechecks live disclosure authorization before append.
 * @param sequence - Committed journal sequence.
 * @param runtime - Exact installed Native domain implementations used to freeze planner reads.
 * @returns a fresh projection retaining original bytes, identity and unresolved costs.
 */
export function foldGeneration(state: SimulationSnapshot, change: SimulationGenerationTransition, sequence: number,
  runtime?: NativeWorldRuntime): SimulationSnapshot {
  const jobs = state.generationJobs ?? {}
  let next: SimulationGenerationRecord
  let planningReads: SimulationGenerationRecord['planningReads']
  if (change.kind === 'accept') {
    const job = change.job, entity = state.entities[job.assistantEntityId]
    if (Object.hasOwn(jobs, job.id)) throw new Error('Generation job identity is already retained')
    if (entity?.binding === undefined || entity.phase !== 'active' || entity.cognition !== 'agent'
      || entity.readiness !== 'ready' || entity.id === state.world?.definition.directorEntityId)
      throw new Error('Generation requires a separate ready canonical assistant')
    if (BigInt(job.deadline) <= BigInt(state.time) || BigInt(job.deadline) > BigInt(state.spec.maxTime))
      throw new Error('Generation requires a finite future run deadline')
    const prior = Object.values(jobs).filter(value => value.job.assistantEntityId === entity.id)
    if (prior.some(value => value.job.scope !== job.scope || !isDeepStrictEqual(value.job.audience, job.audience)))
      throw new Error('Generation Session cannot be reused across disclosure scopes or audiences')
    if (Object.values(state.decisions).some(value => value.entityId === entity.id)
      || Object.values(state.relations).some(value => value.subject === entity.id))
      throw new Error('Generation assistant must have no prior decisions or world authority')
    if (prior.some(value => ['accepted', 'generating', 'unknown'].includes(value.status)))
      throw new Error('Generation assistant still owns an unresolved job')
    if (job.supersedes !== undefined && !Object.hasOwn(jobs, job.supersedes)) throw new Error('Generation successor requires its original job')
    if (Object.keys(jobs).length >= state.spec.maxDecisionsPerInterval) throw new Error('Generation retained job capacity exceeded')
    if (job.planner !== undefined) {
      const assignment = job.planner
      activePlannerAncestors(state, assignment)
      const request = state.world?.requests[assignment.requestId]
      const intent = request === undefined ? undefined : state.world?.intents[request.intentId]
      if (intent === undefined || request?.status !== 'open' || intent.pin.domain !== assignment.domain
        || intent.scopeEntityId !== assignment.scope || !assignment.effects.includes(intent.pin.operation))
        throw new Error('Planner requires its original open scoped domain request')
      planningReads = worldExecutionReads(state, intent, runtime)
      if (assignment.effects.some(effect => !state.world?.definition.operations.some(pin =>
        pin.domain === assignment.domain && pin.operation === effect)))
        throw new Error('Planner effects require their installed domain operations')
      if (Object.values(jobs).some(value => value.job.planner?.id === assignment.id)) throw new Error('Planner assignment identity is already retained')
      if (assignment.parentId !== undefined) {
        const parent = Object.values(jobs).find(value => value.job.planner?.id === assignment.parentId)
        const original = parent?.job.planner
        if (parent === undefined || original === undefined || parent.cancellation !== undefined || ['rejected', 'cancelled', 'incorporated'].includes(parent.status))
          throw new Error('Planner delegation requires its live original parent')
        const children = Object.values(jobs).flatMap((value) => {
          const child = value.job.planner
          return child?.parentId === original.id ? [child] : []
        })
        if (original.maxDepth < 1 || assignment.maxDepth >= original.maxDepth || children.length >= original.maxChildren
          || plannerReservedTokens(state, parent) + BigInt(assignment.maxTokens) > BigInt(original.maxTokens)
          || BigInt(assignment.deadline) > BigInt(original.deadline) || assignment.domain !== original.domain
          || assignment.scope !== original.scope || assignment.effects.some(effect => !original.effects.includes(effect)))
          throw new Error('Planner delegation exceeds its original parent bounds')
      }
    }
    assertBudget(state, 'tokens', job.budget.maxTokens)
    next = { job, binding: entity.binding, acceptedSequence: sequence, status: 'accepted', interval: budgetInterval(state, state.time), ...planningReads === undefined ? {} : { planningReads } }
  } else {
    const prior = Object.hasOwn(jobs, change.id) ? jobs[change.id] : undefined
    if (prior === undefined) throw new Error('Generation job is not retained')
    next = prior
    switch (change.kind) {
      case 'start': {
        if (prior.job.planner !== undefined) activePlannerAncestors(state, prior.job.planner)
        if (state.phase !== 'running' || prior.status !== 'accepted' || prior.cancellation !== undefined || BigInt(state.time) >= BigInt(prior.job.deadline)
          || state.entities[prior.job.assistantEntityId]?.phase !== 'active') throw new Error('Generation start is no longer admitted')
        if (!isDeepStrictEqual(state.entities[prior.job.assistantEntityId]?.binding, prior.binding))
          throw new Error('Generation canonical identity changed')
        next = { ...prior, status: 'generating', sessionSequence: change.sessionSequence }
        break
      }
      case 'output': {
        if (prior.content !== undefined && prior.content === change.content && isDeepStrictEqual(prior.usage, change.usage)) break
        if (!['generating', 'unknown'].includes(prior.status) || prior.content !== undefined) throw new Error('Generation output cannot overwrite its original result')
        if (Buffer.byteLength(change.content, 'utf8') > 1048576) throw new Error('Generation output exceeds its byte allowance')
        next = { ...prior, content: change.content, status: 'output-retained', ...change.usage === undefined ? {} : { usage: change.usage } }
        break
      }
      case 'validate': {
        if (prior.content !== undefined && ['validated', 'rejected', 'incorporated'].includes(prior.status)) break
        if (prior.status !== 'output-retained' || prior.content === undefined) throw new Error('Generation must retain output before validation')
        const parsedPlan = prior.job.planner === undefined ? undefined : (() => {
          try { return simulationGeneratedPlanSchema.safeParse(JSON.parse(prior.content)) }
          catch { return undefined /* Malformed raw output remains retained for rejection. */ }
        })()
        const valid = (prior.job.planner === undefined || parsedPlan?.success === true
          && isDeepStrictEqual(parsedPlan.data.readSet, prior.planningReads) && parsedPlan.data.requestId === prior.job.planner.requestId)
          && prior.cancellation === undefined && BigInt(state.time) < BigInt(prior.job.deadline)
          && (prior.usage === undefined || simulationTokenCount(prior.usage) <= prior.job.budget.maxTokens)
          && validateGenerationOutput(prior.job, prior.content)
        next = { ...prior, status: valid ? 'validated' : 'rejected',
          ...!valid && prior.usage !== undefined && simulationTokenCount(prior.usage) > prior.job.budget.maxTokens
            ? { reason: 'generation-token-budget-exceeded' } : {} }
        break
      }
      case 'incorporate': {
        if (prior.status === 'incorporated' && prior.incorporatedReference === change.reference) break
        if (prior.status !== 'validated' || prior.cancellation !== undefined || BigInt(state.time) >= BigInt(prior.job.deadline))
          throw new Error('Only a current validated generation output can be incorporated')
        const draft = hiringMarket(state).drafts.get(change.reference)
        if (prior.job.purpose !== 'persona' || draft === undefined || prior.content === undefined
          || !isDeepStrictEqual(draft.body.persona, JSON.parse(prior.content)))
          throw new Error('Generation incorporation requires the exact retained Persona draft')
        next = { ...prior, status: 'incorporated', incorporatedReference: change.reference, incorporatedRevision: draft.revision, incorporatedBodyHash: draft.bodyHash }
        break
      }
      case 'cancel': {
        if (prior.cancellation !== undefined) {
          if (prior.cancellation !== change.reason) throw new Error('Generation cancellation cannot change its original reason')
          break
        }
        if (prior.status === 'incorporated') throw new Error('Incorporated generation is immutable')
        next = { ...prior, cancellation: change.reason,
          status: prior.status === 'generating' || prior.status === 'unknown' ? 'unknown' : 'cancelled' }
        break
      }
      case 'unknown': {
        if (prior.status !== 'generating' && prior.status !== 'unknown') throw new Error('Only an accepted provider attempt can remain unknown')
        const observed = change.observedUsage
        const previous = prior.observedUsage
        next = { ...prior, status: 'unknown', reason: change.reason,
          ...observed === undefined ? {} : { observedUsage: {
            inputTokens: Math.max(previous?.inputTokens ?? 0, observed.inputTokens),
            outputTokens: Math.max(previous?.outputTokens ?? 0, observed.outputTokens),
            ...previous?.cacheReadTokens === undefined && observed.cacheReadTokens === undefined ? {}
              : { cacheReadTokens: Math.max(previous?.cacheReadTokens ?? 0, observed.cacheReadTokens ?? 0) },
            ...previous?.cacheWriteTokens === undefined && observed.cacheWriteTokens === undefined ? {}
              : { cacheWriteTokens: Math.max(previous?.cacheWriteTokens ?? 0, observed.cacheWriteTokens ?? 0) },
          } } }
        break
      }
      default: return assertNever(change)
    }
  }
  return { ...state, generationJobs: { ...jobs, [next.job.id]: next } }
}
function assertNever(value: never): never { throw new Error(`Unknown generation transition: ${String(value)}`) }
