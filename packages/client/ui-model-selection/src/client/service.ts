/**
 * ModelDirectoryResolver (`ctx.modelDirectories`): the root owner of
 * {@link ModelDirectory} instances. Both selection entries (the /model popup
 * and the composer model seat) resolve the same target directory through
 * this service, including the host-scoped directory used by the Team draft.
 *
 * Session storage follows the client service pattern (InputTriggerService /
 * CommandUiRuntime): a lazy service-internal map whose entry is deleted by the
 * owning scope's disposer. The Team-draft entry is the one root-scoped
 * exception, because no Session exists until its first message is admitted.
 */
import { Service } from '@clocky/cordis'
import type { Context } from '@clocky/cordis'
import type { ConnectionHandle, ModelSelection, SessionId, SessionModels } from '@clocky/clocky-api-remotes/client'
import type { SessionRuntime } from '@clocky/clocky-client-runtime/client'
import { ModelDirectory } from './directory.ts'

declare module '@clocky/cordis' {
  interface Context {
    modelDirectories: ModelDirectoryResolver
  }
}

/** Live mutable state in one holder (service methods run behind the caller-ctx tracker). */
interface LiveState {
  /** Per-session directories; entries are deleted by their scope disposer. */
  readonly directories: Map<SessionId, ModelDirectory>
  /** The root-scoped directory used by the unsubmitted Team draft. */
  draftDirectory: ModelDirectory | undefined
}

/** The `ctx.modelDirectories` session model-selection service. */
export class ModelDirectoryResolver extends Service {
  static inject = ['connection', 'sessions', 'remote']

  private readonly live: LiveState = { directories: new Map(), draftDirectory: undefined }

  /** Localized composer-block copy; this plugin owns the string it raises. */
  private readonly blockReason: () => string

  /**
   * @param ctx - owning root context (the service registers itself as `models`).
   * @param config - the bound translator for this plugin's own dictionary.
   */
  constructor(ctx: Context, config: { blockReason: () => string }) {
    super(ctx, 'modelDirectories')
    this.blockReason = config.blockReason
    ctx.on('connection/reset', () => {
      for (const directory of this.live.directories.values()) directory.resetConnected()
      this.live.draftDirectory?.resetConnected()
    })
    // Either source can change the directory: registry topology commits and
    // settings documents that carry provider catalogs or default selection.
    const refresh = (): void => {
      for (const directory of this.live.directories.values()) {
        directory.load().catch(() => undefined)
      }
      this.live.draftDirectory?.load().catch(() => undefined)
    }
    ctx.remote.$on('llm/adapters-updated', refresh)
    ctx.remote.$on('settings/document-updated', refresh)
  }

  /**
   * Resolve the per-session shared directory (lazy; the scope disposer
   * removes and disposes it). Unknown sessions fail loud.
   * @param sessionId - the owning session.
   * @returns the resident directory both entries share.
   */
  directoryFor(sessionId: SessionId): ModelDirectory {
    const { live } = this
    const existing = live.directories.get(sessionId)
    if (existing !== undefined) return existing
    const sessions = this.ctx.get('sessions') as SessionRuntime
    const actx = sessions.scope(sessionId)
    if (actx === undefined) throw new Error(`ui-model-selection: session "${String(sessionId)}" resolved no scope`)
    const connection = this.ctx.get('connection') as ConnectionHandle
    const directory = ModelDirectory.forSession(
      connection.api.sessions,
      sessionId,
    )
    live.directories.set(sessionId, directory)
    // The composer cannot read this plugin (the dependency runs one way), so
    // the block is pushed: the Host says whether an adapter serves the
    // session's route, and only a definite `false` makes the input inert.
    // `null` — before the first load, or after one failed — must not, or a
    // slow or unreachable Host would lock a working composer.
    const conversation = this.ctx.get('conversation')
    if (conversation !== undefined) {
      const publish = (): void => {
        conversation.blocks.set(sessionId, directory.store.getSnapshot().routable === false
          ? { reason: this.blockReason() }
          : undefined)
      }
      publish()
      actx.effect(() => {
        const stop = directory.store.subscribe(publish)
        return () => {
          stop()
          conversation.blocks.set(sessionId, undefined)
        }
      }, 'ui-model-selection: composer block')
    }
    actx.effect(() => () => {
      directory.dispose()
      live.directories.delete(sessionId)
    }, 'ui-model-selection: session directory')
    return directory
  }

  /**
   * Resolve the shared directory for the unsubmitted Team draft. The catalog is
   * host-scoped because no coordinator Session exists until the first message
   * is admitted; selecting a row only updates the local draft and is sent with
   * `team.start` later.
   * @returns the draft directory when the Team product is composed.
   */
  draftDirectory(): ModelDirectory | undefined {
    const existing = this.live.draftDirectory
    if (existing !== undefined) return existing
    const teamTasks = this.ctx.get('teamTasks')
    if (teamTasks === undefined) return undefined
    const connection = this.ctx.get('connection') as ConnectionHandle
    const directory = new ModelDirectory({
      load: async (): Promise<SessionModels> => {
        const response = await connection.api.llm.models({})
        if (!response.result.ok) {
          throw new Error(`llm.models failed: ${response.result.error.code}: ${response.result.error.message}`)
        }
        let draftSelection = teamTasks.list.getSnapshot().draft?.selection
        // A draft has no Session-scoped `session.models` response yet. Use the
        // host's configured provider/model as the display current when one is
        // available, while keeping the catalog usable if that snapshot fails.
        if (draftSelection === undefined) {
          try {
            const described = await connection.api.host.describe({})
            if (described.result.ok && described.result.value.provider !== undefined && described.result.value.model !== undefined) {
              draftSelection = {
                provider: described.result.value.provider,
                model: described.result.value.model,
              }
            }
          } catch {
            // A host-default read is a display hint; catalog failures remain authoritative.
          }
        }
        return {
          ...response.result.value,
          ...draftSelection === undefined ? {} : { current: draftSelection },
          routable: draftSelection !== undefined,
        }
      },
      select: (selection: ModelSelection): Promise<ModelSelection> => {
        teamTasks.updateDraft({ selection })
        return Promise.resolve(selection)
      },
    })
    let observedDraftId = teamTasks.list.getSnapshot().draft?.idempotencyKey
    const sync = (): void => {
      const draft = teamTasks.list.getSnapshot().draft
      const draftId = draft?.idempotencyKey
      if (draftId !== observedDraftId) {
        observedDraftId = draftId
        directory.syncCurrent(draft?.selection)
        return
      }
      // Keep a host-default display current across unrelated Team-list
      // refreshes until this draft receives an explicit local selection.
      if (draft?.selection !== undefined) directory.syncCurrent(draft.selection)
    }
    const unsubscribe = teamTasks.list.subscribe(sync)
    sync()
    this.live.draftDirectory = directory
    this.ctx.effect(() => () => {
      unsubscribe()
      directory.dispose()
      if (this.live.draftDirectory === directory) this.live.draftDirectory = undefined
    }, 'ui-model-selection: Team draft directory')
    return directory
  }
}
