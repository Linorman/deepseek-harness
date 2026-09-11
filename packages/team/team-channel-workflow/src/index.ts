/** Declarative workflow Team-channel adapter provider. @module @clocky/clocky-team-channel-workflow */

import { Service } from '@clocky/cordis'
import type { Context } from '@clocky/cordis'
import { createWorkflowChannelAdapter, parseTransitionGraph, workflowChannelAdapter } from './workflow.ts'
import type { JsonValue, TeamEnvelope } from '@clocky/clocky-team'
import type {
  TransitionGraph,
  WorkflowExtensionLeaseSet,
  WorkflowResolvedTarget,
} from './workflow.ts'

export {
  WORKFLOW_CHANNEL_ADAPTER,
  WORKFLOW_CHANNEL_ADAPTER_V1,
  WORKFLOW_CHANNEL_TYPE,
  WORKFLOW_CHANNEL_VERSION,
  WORKFLOW_CHANNEL_VERSION_V1,
  WORKFLOW_GRAPH_LIMIT,
  parseTransitionGraph,
  parseWorkflowChannelManifest,
  parseWorkflowTextPayload,
  createWorkflowChannelAdapter,
  isWorkflowExtensionLeaseableAdapter,
  workflowChannelAdapter,
} from './workflow.ts'
export type {
  TransitionGraph,
  WorkflowChannelManifest,
  WorkflowCondition,
  WorkflowTarget,
  WorkflowTransition,
  WorkflowExtensionLeaseAcquirer,
  WorkflowExtensionLeaseHandle,
  WorkflowExtensionLeaseSet,
  WorkflowExtensionLeaseableAdapter,
  WorkflowExtensionResolver,
  WorkflowResolvedTarget,
} from './workflow.ts'

/** Named versioned extension used by dynamic workflow graph consumers. */
export interface WorkflowExtension {
  /** Extension kind selected by a graph node. */
  readonly kind: 'condition' | 'target'
  /** Stable implementation name. */
  readonly name: string
  /** Behavior version frozen by the workflow deployment. */
  readonly version: number
  /** Validate one JSON node before it is admitted into a graph. */
  validate(value: JsonValue): void
  /** Evaluate a condition node against one accepted Envelope and pure state. */
  evaluate?(input: { readonly config: JsonValue; readonly envelope: TeamEnvelope; readonly state: JsonValue }): boolean
  /** Resolve a target node to a concrete participant or terminal action. */
  resolve?(input: { readonly config: JsonValue; readonly state: JsonValue }): WorkflowResolvedTarget
}

declare module '@clocky/cordis' {
  interface Context { workflowExtensions: WorkflowExtensionRegistry }
  interface Events {
    /**
     * A workflow graph extension became available.
     * @param extension - extension identity.
     * @mode emit
     */
    'workflow/extension-added'(this: WorkflowExtensionRegistry, extension: Omit<WorkflowExtension, 'validate'>): void
    /**
     * A workflow graph extension was removed from future graph admission.
     * @param extension - extension identity.
     * @mode emit
     */
    'workflow/extension-removed'(this: WorkflowExtensionRegistry, extension: Omit<WorkflowExtension, 'validate'>): void
  }
}

/** Effect-scoped registry for deployment-defined workflow conditions and targets. */
export class WorkflowExtensionRegistry extends Service {
  private readonly extensions = new Map<string, RetainedWorkflowExtension>()
  private readonly retiredExtensions = new Set<RetainedWorkflowExtension>()

  constructor(ctx: Context) { super(ctx, 'workflowExtensions') }

  /**
   * Register one condition or target implementation.
   * @param extension - validated implementation.
   * @returns an effect-scoped disposer.
   */
  register(extension: WorkflowExtension): () => void {
    if (
      extension.name.length === 0
      || extension.name.trim() !== extension.name
      || !Number.isSafeInteger(extension.version)
      || extension.version < 1
      || extension.kind === 'condition' && extension.evaluate === undefined
      || extension.kind === 'target' && extension.resolve === undefined
    ) {
      throw new TypeError('workflow extension name/version is invalid')
    }
    const key = extensionKey(extension)
    const entry: RetainedWorkflowExtension = {
      extension,
      accepting: true,
      leases: 0,
    }
    // oxlint-disable-next-line typescript/no-misused-promises -- Cordis effect consumes the generator disposer synchronously.
    return this.ctx.effect(function* (this: WorkflowExtensionRegistry) {
      if (this.extensions.has(key)) throw new Error(`workflow extension '${key}' is already registered`)
      this.extensions.set(key, entry)
      const ref = { kind: extension.kind, name: extension.name, version: extension.version }
      yield () => {
        if (!entry.accepting) return
        entry.accepting = false
        if (this.extensions.get(key) === entry) this.extensions.delete(key)
        if (entry.leases > 0) this.retiredExtensions.add(entry)
        this.ctx.emit('workflow/extension-removed', ref)
      }
      this.ctx.emit('workflow/extension-added', ref)
    }.bind(this), 'workflowExtensions.register()')
  }

  /**
   * Resolve one exact extension identity.
   * @param kind - condition or target.
   * @param name - implementation name.
   * @param version - behavior version.
   * @returns the extension, or undefined when no exact implementation is registered.
   */
  get(kind: WorkflowExtension['kind'], name: string, version: number): WorkflowExtension | undefined {
    const entry = this.extensions.get(extensionKey({ kind, name, version }))
    return entry?.accepting === true ? entry.extension : undefined
  }

  /**
   * List extension identities in registration order.
   * @returns detached extension identities.
   */
  list(): WorkflowExtensionRef[] {
    return [...this.extensions.values()].map(entry => ({
      kind: entry.extension.kind,
      name: entry.extension.name,
      version: entry.extension.version,
    }))
  }

  /**
   * Retain every exact condition and target extension referenced by one graph.
   * @param graph - graph to validate against extensions currently accepting work.
   * @returns a release-once resolver for the exact acquired implementations.
   */
  acquireForGraph(graph: TransitionGraph): WorkflowExtensionLeaseSet {
    const validated = parseTransitionGraph(graph as unknown as JsonValue, this)
    const entries = workflowGraphExtensionRefs(validated)
      .map(ref => this.extensions.get(extensionKey(ref)) as RetainedWorkflowExtension)
    for (const entry of entries) entry.leases += 1
    let active = true
    const retained = new Map(entries.map(entry => [extensionKey(entry.extension), entry]))
    const leaseSet: WorkflowExtensionLeaseSet = {
      get(kind, name, version) {
        if (!active) return undefined
        return retained.get(extensionKey({ kind, name, version }))?.extension
      },
      release: () => {
        if (!active) return
        active = false
        for (const entry of entries) {
          entry.leases -= 1
          if (!entry.accepting && entry.leases === 0) this.retiredExtensions.delete(entry)
        }
        retained.clear()
      },
    }
    return Object.freeze(leaseSet)
  }

  /**
   * Return process-local registration and lease counts for HMR diagnostics.
   * @returns detached current extension retention counts.
   */
  getLeaseMetrics(): WorkflowExtensionLeaseMetrics {
    let activeLeases = 0
    for (const entry of this.extensions.values()) activeLeases += entry.leases
    for (const entry of this.retiredExtensions) activeLeases += entry.leases
    return Object.freeze({
      acceptingExtensions: this.extensions.size,
      retiredExtensions: this.retiredExtensions.size,
      activeExtensionLeases: activeLeases,
    })
  }

}

/** Public identity of one registered workflow extension. */
export interface WorkflowExtensionRef {
  readonly kind: WorkflowExtension['kind']
  readonly name: string
  readonly version: number
}

/** Process-local counts for accepting and retirement-retained workflow extensions. */
export interface WorkflowExtensionLeaseMetrics {
  /** Extensions currently eligible for new graph admission. */
  readonly acceptingExtensions: number
  /** Retired extensions still retained by active workflow channels. */
  readonly retiredExtensions: number
  /** Total live condition and target leases. */
  readonly activeExtensionLeases: number
}

/** One exact registered extension plus its HMR-retention state. */
interface RetainedWorkflowExtension {
  /** Extension implementation that remains stable for each acquired lease. */
  readonly extension: WorkflowExtension
  /** Whether new graphs may select this implementation. */
  accepting: boolean
  /** Number of active graph handles retaining this exact object. */
  leases: number
}

function extensionKey(extension: Pick<WorkflowExtension, 'kind' | 'name' | 'version'>): string {
  return `${extension.kind}\u0000${extension.name}\u0000${String(extension.version)}`
}

/** Return each unique extension identity referenced by a validated graph in graph order. */
function workflowGraphExtensionRefs(graph: TransitionGraph): WorkflowExtensionRef[] {
  const refs = new Map<string, WorkflowExtensionRef>()
  const addTarget = (target: TransitionGraph['initial']): void => {
    if (target.kind !== 'extension') return
    const ref: WorkflowExtensionRef = { kind: 'target', name: target.name, version: target.version }
    refs.set(extensionKey(ref), ref)
  }
  const addCondition = (condition: TransitionGraph['transitions'][number]['condition']): void => {
    if (condition.kind !== 'extension') return
    const ref: WorkflowExtensionRef = { kind: 'condition', name: condition.name, version: condition.version }
    refs.set(extensionKey(ref), ref)
  }
  addTarget(graph.initial)
  for (const transition of graph.transitions) {
    addCondition(transition.condition)
    addTarget(transition.target)
  }
  if (graph.defaultTarget !== undefined) addTarget(graph.defaultTarget)
  return [...refs.values()]
}

/** Cordis plugin name. */
export const name = 'team-channel-workflow'
/** The Team adapter registry must exist before the workflow protocol registers. */
export const inject = ['teams']

/** Register the workflow adapter on the active Team runtime. */
export function apply(ctx: Context): void {
  // The production Cordis context always exposes `reflect`; keeping the
  // registry construction conditional preserves the adapter's narrow direct
  // registration seam for lightweight contract doubles.
  const reflectiveContext = ctx as unknown as { readonly reflect?: unknown }
  const registry = reflectiveContext.reflect === undefined ? undefined : new WorkflowExtensionRegistry(ctx)
  ctx.teams.registerAdapter(registry === undefined
    ? workflowChannelAdapter
    : createWorkflowChannelAdapter(registry))
}
