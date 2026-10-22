/** Pure proposal checks against only the current frozen decision's exact domain pins. */
import { z } from 'zod'
import { simulationProposalSchema, SimulationWorldDomainError } from '@clocky/clocky-simulation'
import type { SimulationProposal, SimulationWorldContext, SimulationWorldDomainRegistry,
  SimulationWorldDomainPin } from '@clocky/clocky-simulation'

/** A rejected replacement leaves the previous staged list intact; Native still owns final admission. */
export class SimulationStagePreflightError extends Error {
  /** Stable tool-diagnostic classification for a rejected staged replacement. */
  readonly code = 'SIM_STAGE_PREFLIGHT'
  /** @param diagnostics - Bounded structural correction details, with no proposed payload values. */
  constructor(diagnostics: string) {
    super(`Staged replacement rejected; previous staged list is unchanged. ${diagnostics}`)
    this.name = 'SimulationStagePreflightError'
  }
}

/** UTF-8 limits apply to the final emitted diagnostic, including JSON quoting. */
function bounded(value: string, bytes: number): string {
  let result = '', size = 0
  for (const character of value) {
    const next = Buffer.byteLength(character)
    if (size + next > bytes) break
    result += character
    size += next
  }
  return result
}

function allowedAt(schema: z.ZodType, path: readonly PropertyKey[]): unknown[] {
  let nodes: z.core.JSONSchema.JSONSchema[] = [z.toJSONSchema(schema, { io: 'input' })]
  const branches = (node: z.core.JSONSchema.JSONSchema): z.core.JSONSchema.JSONSchema[] => [node,
    ...[...node.anyOf ?? [], ...node.oneOf ?? []].flatMap(value => typeof value === 'object' ? branches(value) : [])]
  for (const key of path) nodes = nodes.flatMap(branches).flatMap((node) => {
    const next = typeof key === 'number' ? node.items : node.properties?.[String(key)]
    return next !== undefined && typeof next === 'object' && !Array.isArray(next) ? [next] : []
  })
  return nodes.flatMap(branches).flatMap(node => node.enum ?? (node.const === undefined ? [] : [node.const])).slice(0, 8)
}

/** Keep correction paths within the sole matching kind branch; ambiguous unions retain their original diagnostic. */
function* diagnosticIssues(issues: readonly z.core.$ZodIssue[], parent: readonly PropertyKey[] = []): Generator<z.core.$ZodIssue> {
  for (const issue of issues) {
    const path = [...parent, ...issue.path]
    if (issue.code === 'invalid_union') {
      const matching = issue.errors.filter(branch => !branch.some(child => child.code === 'invalid_value'
        && child.path.length === 1 && child.path[0] === 'kind'))
      const branch = matching[0]
      if (branch !== undefined && matching.length === 1 && matching.length < issue.errors.length) {
        yield* diagnosticIssues(branch, path)
        continue
      }
    }
    yield { ...issue, path }
  }
}

function diagnostic(cause: unknown, prefix: string, schema?: z.ZodType): never {
  const error = cause instanceof SimulationWorldDomainError ? cause.cause : cause
  if (!(error instanceof z.ZodError)) throw cause
  const diagnostics: object[] = []
  let truncated = false
  for (const issue of diagnosticIssues(error.issues)) {
    if (diagnostics.length === 8) { truncated = true; break }
    const values = issue.code === 'invalid_value' ? issue.values
      : issue.code === 'invalid_union' && schema !== undefined ? allowedAt(schema, issue.path) : []
    const allowed = values.length === 0 ? undefined : values.slice(0, 8).map(value =>
      typeof value === 'string' ? bounded(value, 64) : value)
    const item = { path: bounded([prefix, ...issue.path.map(String)].join('.'), 128), code: issue.code,
      expected: issue.code === 'invalid_type' ? issue.expected
        : issue.code === 'invalid_value' ? 'one of allowedValues'
          : issue.code === 'unrecognized_keys' ? 'only declared fields'
            : issue.code === 'invalid_union' ? 'one valid schema branch'
              : issue.code === 'too_small' ? `minimum ${String(issue.minimum)}`
                : issue.code === 'too_big' ? `maximum ${String(issue.maximum)}` : 'the exact frozen schema',
      ...allowed === undefined ? {} : { allowedValues: allowed } }
    if (Buffer.byteLength(JSON.stringify([...diagnostics, item])) > 3500) { truncated = true; break }
    diagnostics.push(item)
  }
  throw new SimulationStagePreflightError(JSON.stringify({ diagnostics, truncated }))
}

function sameSelector(pin: SimulationWorldDomainPin, action: { domain: string; operation: string; version: string }): boolean {
  return pin.domain === action.domain && pin.operation === action.operation && pin.version === action.version
}

/**
 * Validate a complete replacement before publishing it as staged state. No requests or leases are allocated.
 * @param values - Complete proposed replacement; values are never repaired or silently stripped.
 * @param scope - Already-authorized frozen decision, never a fresh lookup of another request.
 * @param catalog - Retained parser owner; required only for a scoped domain request or apply plan.
 * @returns parsed proposals; all Native permission, timing and business checks still run at submission.
 */
export function preflightProposals(values: readonly unknown[], scope: SimulationWorldContext | undefined,
  catalog?: Pick<SimulationWorldDomainRegistry, 'payloadSchema'>): SimulationProposal[] {
  return values.map((value, index) => {
    const path = `proposals.${index}`
    let proposal: SimulationProposal
    try { proposal = simulationProposalSchema.parse(value) }
    catch (cause) { diagnostic(cause, path) }
    const action = proposal.action
    let pin: SimulationWorldDomainPin | undefined, kind: 'request' | 'plan' = 'request'
    if (action.kind === 'world/request' && scope !== undefined) {
      const pins = scope.kind === 'goal' ? scope.operations.map(value => value.pin)
        : scope.kind === 'request' || scope.kind === 'director-event' ? [scope.pin] : []
      pin = pins.find(value => sameSelector(value, action))
      if (pin === undefined) throw new SimulationStagePreflightError('Use an operation/version authorized in this frozen context.')
    }
    if (action.kind === 'world/resolve' && (scope?.kind === 'resolve' || scope?.kind === 'scenario-resolve')) {
      if (action.requestId !== scope.requestId)
        throw new SimulationStagePreflightError(`Use the current requestId ${bounded(scope.requestId, 128)}; observe its frozen payload.`)
      if (action.resolution.kind === 'apply') { pin = scope.pin; kind = 'plan' }
    }
    if (pin !== undefined) {
      if (catalog === undefined) throw new SimulationStagePreflightError('The exact protocol parser is unavailable; restore its installed version before retrying.')
      const payload = action.kind === 'world/request' ? action.payload
        : action.kind === 'world/resolve' && action.resolution.kind === 'apply' ? action.resolution.payload : undefined
      const schema = catalog.payloadSchema(pin, kind)
      try { schema.parse(payload) }
      catch (cause) { diagnostic(cause, `${path}.action.${kind === 'plan' ? 'resolution.payload' : 'payload'}`, schema) }
    }
    return proposal
  })
}
