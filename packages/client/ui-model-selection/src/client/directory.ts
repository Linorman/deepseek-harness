/**
 * Shared model directory state for an ordinary Session or the unsubmitted Team
 * draft. The /model popup and composer seat load through one controller and
 * submit through the same backend, so a switch made in either entry is echoed
 * by the other surface.
 */
import type {
  IApiClient, ModelCatalogFailure, ModelProviderGroup, ModelSelection, SessionId, SessionModels,
} from '@clocky/clocky-api-remotes/client'
import type { SnapshotStore } from '@clocky/clocky-client-runtime/client'
import { createSnapshotStore } from '@clocky/clocky-client-runtime/client'

/** Directory snapshot both entries render from. */
export interface ModelDirectoryState {
  /** Model selection the host reports for the next assembled step; null before the first load. */
  current: ModelSelection | null
  /**
   * Whether an adapter serves the current selection's provider, as the host reports
   * it — null before the first load, which is NOT the same as blocked. Read
   * this rather than "current matches no group": catalog membership is
   * advisory, so a route serving a model it stopped advertising is missing
   * from the groups yet perfectly usable.
   */
  routable: boolean | null
  /** Successfully loaded provider groups (last good load). */
  groups: readonly ModelProviderGroup[]
  /** Provider-local failures from the last load; usable groups stay usable. */
  failures: readonly ModelCatalogFailure[]
  /** Lifecycle of the in-flight operation. */
  status: 'idle' | 'loading' | 'ready' | 'selecting' | 'error'
  /** Whole-request or selection failure text; null when none. */
  error: string | null
}

/** Transport-independent model directory operations. */
export interface ModelDirectoryBackend {
  /** Read the current selection and advisory catalog. */
  load: () => Promise<SessionModels>
  /** Validate or retain one complete model selection. */
  select: (selection: ModelSelection) => Promise<ModelSelection>
}

/** One target's shared model directory controller; disposed with its owning scope. */
export class ModelDirectory {
  /** The shared snapshot both entries render from (uSES-safe store). */
  readonly store: SnapshotStore<ModelDirectoryState> = createSnapshotStore<ModelDirectoryState>({
    current: null, routable: null, groups: [], failures: [], status: 'idle', error: null,
  })

  /** Latest operation wins; an older response never overwrites a newer one. */
  private generation = 0
  private disposed = false

  /**
   * @param backend - the source and mutation owner for this directory.
   */
  constructor(private readonly backend: ModelDirectoryBackend) {}

  /**
   * Create a directory backed by one ordinary Host Session.
   * @param sessions - Host Session methods used for model reads and selection.
   * @param sessionId - ordinary Session identity owned by the Host.
   * @returns a shared model-directory controller for that Session.
   */
  static forSession(
    sessions: Pick<IApiClient['sessions'], 'models' | 'selectModel'>,
    sessionId: SessionId,
  ): ModelDirectory {
    return new ModelDirectory({
      load: async () => {
        const { result } = await sessions.models({ sessionId })
        if (!result.ok) throw new Error(`session.models failed: ${result.error.code}: ${result.error.message}`)
        return result.value
      },
      select: async (selection) => {
        const { result } = await sessions.selectModel({
          sessionId,
          provider: selection.provider,
          model: selection.model,
          ...selection.reasoningEffort === undefined ? {} : { reasoningEffort: selection.reasoningEffort },
        })
        if (!result.ok) throw new Error(`session.selectModel failed: ${result.error.code}: ${result.error.message}`)
        return result.value.selected
      },
    })
  }

  /**
   * Refresh the advisory directory (both entries call this on open).
   * Failure preserves the last good groups and current selection.
   * @returns the fresh directory value.
   */
  async load(): Promise<SessionModels> {
    const generation = ++this.generation
    this.store.update((s) => { s.status = 'loading'; s.error = null })
    try {
      const value = await this.backend.load()
      if (this.disposed || generation !== this.generation) return value
      const { current, routable, groups, failures } = value
      this.store.update((s) => {
        s.current = current ?? null
        s.routable = routable
        s.groups = groups
        s.failures = failures
        s.status = 'ready'
        s.error = null
      })
      return value
    } catch (error: unknown) {
      if (this.disposed || generation !== this.generation) throw error
      const message = error instanceof Error ? error.message : String(error)
      this.store.update((s) => { s.status = 'error'; s.error = message })
      throw error
    }
  }

  /**
   * Select the complete provider/model/reasoning selection (both entries submit through here). Success
   * updates the shared current; failure surfaces on the store and throws so
   * each entry's own retry surface engages.
   * @param selection - provider, provider-owned model id, and optional adapter-owned effort.
 */
  async select(selection: ModelSelection): Promise<void> {
    const generation = ++this.generation
    this.store.update((s) => { s.status = 'selecting'; s.error = null })
    try {
      const selected = await this.backend.select(selection)
      if (this.disposed || generation !== this.generation) return
      this.store.update((s) => {
        s.current = selected
        s.routable = true
        s.status = 'ready'
        s.error = null
      })
    } catch (error: unknown) {
      if (this.disposed || generation !== this.generation) throw error
      const message = error instanceof Error ? error.message : String(error)
      this.store.update((s) => { s.status = 'error'; s.error = message })
      throw error
    }
  }

  /**
   * Synchronize an external draft selection without starting a catalog request.
   * @param selection - draft model selection, or `undefined` to clear it.
   */
  syncCurrent(selection: ModelSelection | undefined): void {
    if (this.disposed) return
    this.store.update((s) => {
      s.current = selection ?? null
      s.routable = selection !== undefined
    })
  }

  /**
   * Drop the previous Host generation's projection and repull it. Clearing
   * first prevents an unconsumed process-local selection from being displayed
   * while the restarted Host has restored the last logged model selection.
   */
  resetConnected(): void {
    if (this.disposed) return
    ++this.generation
    this.store.update((s) => {
      s.current = null
      s.routable = null
      s.groups = []
      s.failures = []
      s.status = 'idle'
      s.error = null
    })
    void this.load().catch(() => { /* the next menu open remains the explicit retry surface */ })
  }

  /** Scope teardown: late settlements lose write access to the store. */
  dispose(): void {
    this.disposed = true
  }

}
