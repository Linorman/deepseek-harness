/**
 * Models settings page store: one snapshot joining the configurable-provider
 * directory (`llm.providers`), the settings namespaces (shared settings mirror),
 * and the referenced credentials (`credentials.describe`). The host stays the
 * single fact source — every mutation writes through the wire and the page
 * re-renders from the next describe, pushed or refetched.
 */

import type {
  ConfigurableProviderView, CredentialView, IApiClient, SettingsNamespaceView,
  ModelProviderGroup, ModelCatalogFailure,
} from '@clocky/clocky-api-remotes/client'
import type { SnapshotStore } from '@clocky/clocky-client-runtime/client'
import { createSnapshotStore } from '@clocky/clocky-client-runtime/client'
import type { SettingsDescribeFace } from '@clocky/clocky-client-ui-settings/client'
import type { SettingsSchemaOperations } from './schema-operations.ts'

/**
 * Any route key walks a dict schema to the same profile node, so the lookup
 * names one that cannot collide with a configured route.
 */
const PROBE_ROUTE = '\u0000probe'

/** One provider row the page renders. */
export interface ProviderRow {
  /** The directory entry (route id, display name, settings address, live state). */
  entry: ConfigurableProviderView
  /** Whether any layer configures this provider (its profile resolves). */
  configured: boolean
  /** Whether the user layer alone carries the profile (removal restores the base). */
  removable: boolean
  /** The credential reference the resolved profile names, when one does. */
  apiKeyEnv: string | undefined
  /** Credential state for {@link apiKeyEnv}, once described. */
  credential: CredentialView | undefined
}

/** Page snapshot. */
export interface ModelsSettingsState {
  /** Host model directory used by the default-selection editor; it performs no inference. */
  modelCatalog?: { readonly groups: readonly ModelProviderGroup[]; readonly failures: readonly ModelCatalogFailure[] } | undefined
  /** Catalog refresh failed; an existing directory remains readable but cannot authorize a new selection. */
  modelCatalogError?: true | undefined
  status: 'idle' | 'loading' | 'ready' | 'error' | 'unauthorized'
  /** Retires component-owned private editors when the authenticated principal is cleared. */
  authorizationRevision?: number
  /** Whole-load failure text; row-level write failures stay in the editor. */
  error: string | null
  /** Credential enrichment failure; provider/settings rows remain usable. */
  credentialError: string | null
  /** Whether the settings provider accepts writes. */
  writable: boolean
  /** Every configurable provider joined with its configured/credential state. */
  rows: readonly ProviderRow[]
  /** Namespace views by ns, for the editor's schema/layers/secrets. */
  namespaces: ReadonlyMap<string, SettingsNamespaceView>
}

/**
 * Human text for a rejected wire call. A transport failure rejects with an
 * Error; a host or a runtime can reject with anything, and the page still has
 * to say something.
 * @param error - the rejection value.
 * @returns the message to show.
 */
export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Derive the conventional credential reference for a provider route: the v1
 * page never asks for an environment-variable name, so a typed key stores
 * under this derived reference and the profile records it as `apiKeyEnv`.
 * @param provider - provider route id (e.g. `anthropic`, `minimax-cn`).
 * @returns the derived reference name (e.g. `MINIMAX_CN_API_KEY`).
 */
export function deriveKeyRef(provider: string): string {
  return `${provider.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_API_KEY`
}

/**
 * The wire protocols a hand-declared route may name, read out of the owning
 * namespace's own schema. This stays a schema read rather than a wire field so
 * the choices the page offers cannot drift from the ones the adapter accepts:
 * both come from the same `Config`.
 * @param namespace - the namespace view whose schema declares the profile shape.
 * @param schema - settings schema operations.
 * @returns the protocol identifiers, or an empty list when the schema has none.
 */
export function protocolChoices(
  namespace: SettingsNamespaceView | undefined,
  schema: SettingsSchemaOperations,
): string[] {
  if (namespace === undefined) return []
  const node = schema.nodeAtPath(schema.rehydrate(namespace.schema), ['providers', PROBE_ROUTE, 'api'])
  const list = (node as { type?: string; list?: readonly { value?: unknown }[] } | undefined)
  if (list?.type !== 'union' || list.list === undefined) return []
  return list.list.map(entry => entry.value).filter((value): value is string => typeof value === 'string')
}

/** The credential reference a resolved profile names (its `apiKeyEnv` field). */
function apiKeyEnvOf(
  namespace: SettingsNamespaceView | undefined,
  path: readonly string[],
  schema: SettingsSchemaOperations,
): string | undefined {
  if (namespace === undefined) return undefined
  const profile = schema.getPath(namespace.value, path)
  if (typeof profile !== 'object' || profile === null) return undefined
  const ref = (profile as { apiKeyEnv?: unknown }).apiKeyEnv
  return typeof ref === 'string' && ref.length > 0 ? ref : undefined
}

/** The models settings page controller (one per settings surface). */
export class ModelsSettingsStore {
  /** The snapshot the section renders from (uSES-safe store). */
  readonly store: SnapshotStore<ModelsSettingsState> = createSnapshotStore<ModelsSettingsState>({
    status: 'idle', error: null, credentialError: null, writable: false, rows: [], namespaces: new Map(),
  })

  /** Latest load wins; an older response never overwrites a newer one. */
  private generation = 0
  private authorization = new AbortController()

  /** Cancel reads and remove provider/credential data and private editor ownership without refetching. */
  clearAuthorization(): void {
    this.authorization.abort()
    this.generation += 1
    this.store.set({ status: 'unauthorized', authorizationRevision: (this.store.getSnapshot().authorizationRevision ?? 0) + 1,
      error: null, credentialError: null, writable: false, rows: [], namespaces: new Map() })
  }

  /** Resume reads after a successful handshake; the caller owns the refresh budget. */
  resumeAuthorization(): void {
    if (this.authorization.signal.aborted) this.authorization = new AbortController()
  }

  /**
   * @param api - the wire face (credentials/llm domains, and settings writes).
   * @param describeFace - the shared mirror's describe face (namespace views and writability).
   */
  constructor(
    private readonly api: Pick<IApiClient, 'settings' | 'credentials' | 'llm'>,
    private readonly schema: SettingsSchemaOperations,
    private readonly describeFace: SettingsDescribeFace,
  ) {}

  /**
   * Save one explicitly picked default route; no inference or catalog-first automatic selection occurs.
   * @param selection - Provider/model and optional explicit reasoning effort chosen by the user.
   * @param expectedRevision - Revision captured when the default editor opened.
   * @returns after the committed settings view is folded and the page refreshes; refusal preserves the draft.
   */
  async saveDefault(selection: { provider: string; model: string; reasoningEffort?: string }, expectedRevision: number):
  Promise<SettingsNamespaceView | undefined> {
    const signal = this.authorization.signal
    const cancelled = () => signal.aborted
    if (cancelled()) throw new Error('Browser access is unavailable')
    const response = await this.api.settings.replace({ ns: 'agent-default-model', section: selection, expectedRevision }, signal)
    if (cancelled()) return
    if (!response.result.ok) throw new Error(response.result.error.message)
    const view = response.result.value
    this.describeFace.acceptView(view)
    const namespaces = new Map(this.store.getSnapshot().namespaces).set(view.ns, view)
    this.store.update((state) => { state.namespaces = namespaces })
    await this.load()
    return view
  }

  /**
   * Refresh the whole page snapshot: the provider directory and the mirror's
   * settings answer in parallel, then one batched credential describe over
   * every referenced ref. Provider failure or absence of an initial settings
   * answer keeps the last good rows and surfaces an error; a failed settings
   * refresh reuses the mirror's held view.
   * @returns nothing; the snapshot carries the outcome.
   */
  async load(): Promise<void> {
    if (this.authorization.signal.aborted) return
    const signal = this.authorization.signal
    const generation = ++this.generation
    this.store.update((s) => { s.status = 'loading'; s.error = null })
    let providers: ConfigurableProviderView[]
    let writable: boolean
    let views: readonly SettingsNamespaceView[]
    let modelCatalog: ModelsSettingsState['modelCatalog']
    let modelCatalogError: true | undefined
    try {
      const [providersResponse, catalogResponse] = await Promise.all([
        this.api.llm.providers({}, signal),
        this.api.llm.models({}, signal),
        this.describeFace.ensure(),
      ])
      if (!providersResponse.result.ok) throw new Error(providersResponse.result.error.message)
      const mirrored = this.describeFace.getSnapshot()
      if (mirrored.view === undefined) {
        throw new Error(mirrored.error ?? 'settings are unavailable in this browser')
      }
      providers = providersResponse.result.value.providers
      writable = mirrored.view.writable
      views = mirrored.view.namespaces
      modelCatalog = catalogResponse.result.ok ? catalogResponse.result.value : this.store.getSnapshot().modelCatalog
      modelCatalogError = catalogResponse.result.ok ? undefined : true
    } catch (error) {
      if (generation !== this.generation) return
      this.store.update((s) => {
        s.status = 'error'
        s.error = error instanceof Error ? error.message : String(error)
      })
      return
    }
    const namespaces = new Map(views.map(view => [view.ns, view]))
    if (generation !== this.generation || signal.aborted) return
    const rows: ProviderRow[] = providers.map((entry) => {
      const namespace = namespaces.get(entry.settingsNs)
      const configured = namespace !== undefined
        && (entry.settingsPath.length === 0 || this.schema.getPath(namespace.value, entry.settingsPath) !== undefined)
      const removable = namespace !== undefined
        && entry.settingsPath.length > 0
        && this.schema.hasPath(namespace.user, entry.settingsPath)
        && !this.schema.hasPath(namespace.base, entry.settingsPath)
      return {
        entry,
        configured,
        removable,
        apiKeyEnv: apiKeyEnvOf(namespace, entry.settingsPath, this.schema),
        credential: undefined,
      }
    })
    const refs = [...new Set(rows.flatMap(row => row.apiKeyEnv === undefined ? [] : [row.apiKeyEnv]))]
    let credentials: Record<string, CredentialView> = {}
    let credentialError: string | null = null
    if (refs.length > 0) {
      try {
        const response = await this.api.credentials.describe({ refs }, signal)
        // Credential state is an enrichment for the Models page: neither a
        // business rejection nor a transport failure fails the load. The
        if (response.result.ok) credentials = response.result.value.credentials
        else credentialError = response.result.error.message
      } catch (error) {
        credentialError = messageOf(error)
      }
    }
    if (generation !== this.generation) return
    this.store.update((s) => {
      s.status = 'ready'
      s.error = null
      s.credentialError = credentialError
      s.writable = writable
      s.rows = rows.map(row => ({
        ...row,
        ...row.apiKeyEnv !== undefined && credentials[row.apiKeyEnv] !== undefined
          ? { credential: credentials[row.apiKeyEnv] }
          : {},
      }))
      s.namespaces = namespaces
      s.modelCatalog = modelCatalog
      s.modelCatalogError = modelCatalogError
    })
  }
}
