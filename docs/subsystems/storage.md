# Storage

English | [中文](storage.zh.md)

The storage subsystem persists everything that is not a session event log (session logs have their own seam — [persistence.md](persistence.md)). It is one optional capability, not part of the agent-loop spine, split as a [capability seam](../../.agents/notes/implemented/architecture/2026-06-13-capability-seams.md): the hub and Service Definition ([clocky-storage](../../packages/storage/storage), `ctx.storage`), the Service Providers ([clocky-storage-json](../../packages/storage/storage-json), registered as `json`, and [clocky-storage-sqlite](../../packages/storage/storage-sqlite), registered as `sqlite`), and Consumer data forms for current records ([clocky-storage-domain](../../packages/storage/storage-domain), `ctx.storageDomain` / `ctx.storage.domain`) and append-only streams ([clocky-storage-log](../../packages/storage/storage-log), `ctx.storageLog` / `ctx.storage.log`). The hub performs no IO itself: backends own media, data forms own semantics, and product packages never touch backends directly. Design record: [domain KV storage Agent Note](../../.agents/notes/proposed/architecture/2026-07-24-domain-kv-storage-and-workspace.md).

Source: [`packages/storage/storage/src/backend.ts`](../../packages/storage/storage/src/backend.ts) · [`packages/storage/storage/src/log.ts`](../../packages/storage/storage/src/log.ts) · [`packages/storage/storage-domain/src/spec.ts`](../../packages/storage/storage-domain/src/spec.ts) · [`packages/storage/storage-domain/src/events.ts`](../../packages/storage/storage-domain/src/events.ts)

## The hub: `ctx.storage`

`Storage` ([signatures](#ctxstorage--storage)) is a meeting point, not a store. `ctx.storage.backend` is a name → backend table: multiple backends stay mounted side by side, and which backend serves which consumer is that consumer's configuration (the domain layer's route table), never a hub-global choice. `register(name, backend)` returns the disposer; duplicate names and unknown lookups throw `StorageError`. Disposal only unregisters the name — the owning plugin closes the backend after unregistering. Each backend plugin also publishes a lifecycle-only service key (`storageBackendServiceKey(name)`), which form providers inject so their activation cannot race backend registration.

Data forms mount on the hub under a merge-extensible key map:

```ts type-equiv
/**
 * Data forms mountable on the hub, keyed by form name. Form owners extend
 * this map via declaration merging (the domain and log layers merge their
 * facilities) and mount the facility in their `apply`.
 */
interface StorageForms {}
```

`mount(form, facility)` is an effect whose disposer unmounts; a second mount of the same key throws `duplicate-mount`. `form(form)` resolves a mounted facility and throws `form-not-mounted` until the owning plugin loads — assemblies order plugins accordingly rather than silently deferring. The domain and log layers merge `domain: DomainFacility` and `log: StorageLogFacility`, so each form is reachable through both `ctx.storage.<form>` and its injectable service.

`LogNameScanRequest` selects a prefix, work limit and optional `LogNameScanCursor`. `StorageLogFacility.scanNames()` returns `LogNameScanPage.names`, `scanned` and an optional continuation, even for empty pages. Backend `LogFacet.scanNames()` yields at most one physical entry per step without loading values; `LogFacet.has()` checks exact materialization. Local scan cursors can expire and never grant authority.

## The backend contract

```ts type-equiv
/**
 * One registered backend. A backend owns exactly one medium and shares its
 * lifecycle across all facets; facets are optional members — a backend that
 * cannot serve a data kind simply omits it, and resolution fails loud instead.
 */
interface StorageBackend {
  /** Key-value operations; absent when this backend cannot serve them. */
  readonly kv?: KvFacet

  /** Append-only stream operations; absent when this backend cannot serve them. */
  readonly log?: LogFacet

  /**
   * Drain in-flight writes across all open units and release the medium.
   * Idempotent; concurrent and repeated calls resolve once teardown finishes.
   * @returns resolution after the medium is released.
   */
  close(): Promise<void>
}
```

A backend owns one medium (a file-tree root, a database file) and exposes optional operation groups. `KvFacet.open(descriptor)` opens one named unit — `KvUnitDescriptor` carries the name, format version, table names, and whether a global singleton slot exists — and returns a `KvUnit` with `loadAll`, `putRecord`, `deleteRecord`, `setGlobal`, and `close`. Unit and table names must match `UNIT_NAME_RE` (safe as a file name and as a SQL identifier segment); record keys are arbitrary strings that never reach file paths. A unit does not serialize concurrent writes — ordering belongs to the caller — but each single call is atomic on the medium and durable once resolved. A medium stamped with a different version rejects `version-mismatch`; one that cannot be parsed as the unit rejects `malformed-medium` (no migration, pre-release stance). [`backend.ts`](../../packages/storage/storage/src/backend.ts) is the normative clause-by-clause contract, and the shared conformance suites in [`tests/contract.ts`](../../packages/storage/storage/tests/contract.ts) and [`tests/log-contract.ts`](../../packages/storage/storage/tests/log-contract.ts) check both facets against each backend. The [json backend](../../packages/storage/storage-json/README.md) publishes human-readable files; the [sqlite backend](../../packages/storage/storage-sqlite/README.md) stores records and append streams in one database.

## Append-only streams

`LogFacet.open({ name, version })` returns a caller-owned `LogStream`. A stream accepts a non-empty batch only when its current tail equals `expectedSequence`; the batch receives contiguous entries and is durable as one operation, otherwise it rejects `sequence-conflict`. `read(afterSequence, limit)` returns an ordered bounded page. A checkpoint carries the sequence it covers, never advances beyond the tail, and never moves backward. `compact({ throughSequence, expectedCheckpointSequence })` atomically removes only a prefix covered by an exact later checkpoint; a read before the retained prefix rejects `compacted`. Values cross the durable boundary as detached JSON snapshots.

`LogAppendOptions.summary` carries an optional consumer projection committed with its batch; omission clears it. `LogFacet.readSummary(descriptor, maxBytes)` returns `LogSummary` with the projection and current tail without journal hydration, and rejects incompatible formats or oversized metadata. It does not certify history validity. Unsupported backends reject this capability.

`StorageLogFacility` routes each stream name to the configured default backend or an own-property `routes` override. It permits one local handle per name, closes admission during disposal, drains every accepted open, and then settles every returned handle. A backend that lacks `log` fails with `facet-unsupported`. Stream names are opaque rather than KV identifiers, allowing `team/<TeamId>` and `channel/<ChannelId>` streams. The JSON provider admits one local Hub per root and rejects another owner; SQLite serializes expected-tail comparisons and full batches in a transaction.

## Declaring a domain

A domain is declared once by its owning package as a spec object — the single source of the domain's identity, layout, and record schemas (zod, so `z.infer` keeps consumer types un-duplicated):

```ts type-equiv
/** Static declaration of one domain: identity, version, and record layout. */
interface DomainSpec {
  /** Domain name; must match `UNIT_NAME_RE` (doubles as the backend unit name). */
  readonly name: string
  /** Domain format version; a medium stamped with a different version rejects at open. */
  readonly version: number
  /** Optional global singleton slot. */
  readonly global?: DomainGlobalSpec<unknown>
  /** Table declarations keyed by table name; each name must match `UNIT_NAME_RE`. */
  readonly tables: Record<string, DomainTableSpec>
}
```

`defineDomain(spec)` pins the spec's literal types and fails loud at the owner's module load, before any medium is touched: a domain or table name outside `UNIT_NAME_RE`, a version that is not a non-negative integer, or a global schema that accepts `null` all throw (`null` is the medium's "never written" sentinel, so a stored nullable global could not round-trip). `domainTable<K, V>(schema)` declares one table with a phantom compile-time key type (typically a [branded id](core.md#branded-ids)); `descriptorOf(spec)` projects the backend-facing unit descriptor.

## The open domain

```ts type-equiv
/** One open domain, typed by its spec. */
interface Domain<S extends DomainSpec> {
  /** Domain name from the spec. */
  readonly name: string
  /** Global singleton handle; a spec without `global` has no usable handle (`never`). */
  readonly global: DomainGlobalHandleOf<S>
  /**
   * Resolve one declared table handle. Handles are stable — repeated calls
   * return the same instance.
   * @param name - Declared table name.
   * @returns the typed table handle.
   */
  table<N extends keyof S['tables'] & string>(name: N): KvTable<TableKeyOf<S, N>, TableValueOf<S, N>>

  /**
   * Close this domain: reject new writes immediately, drain already-queued
   * writes (their events still emit), release the backend unit, then free
   * the domain name for a later open. Idempotent — repeated calls share one
   * teardown. The consumer owns this call (typically as its own `ctx.effect`
   * disposer); the facility closes any domain left open when it unmounts.
   * @returns resolution after the unit is released.
   */
  close(): Promise<void>
}
```

Reads are synchronous from authoritative in-memory state: `KvTable` exposes `get`/`entries`/`keys`/`size` (snapshot iterators that stay stable while queued writes land), and the global handle's `get()` serves the spec's `initial` until the first `set` materializes the slot on the medium. Every write — `put`, `delete`, `update`, `global.set` — queues on one per-domain chain and reaches backend durability first, then mutates memory, then emits `domain/changed`; a rejected backend write leaves memory untouched, so reads never diverge from the medium. `update(key, fn)` is an atomic read-modify-write at its chain slot (a missing key rejects `missing-key`); `delete` of an absent key resolves `false` with no write and no event. Returned records are the stored objects themselves, not copies — replace via `put`/`update`, never mutate in place.

## The domain facility: `ctx.storageDomain`

`DomainFacility` ([signatures](#ctxstoragedomain--domainfacility)) opens declared domains over routed backends. Routing is the domain plugin's configuration, never the hub's: `backend` names the required default route and `routes` overrides it per domain name. `open(spec)` runs a strict sequence, each step failing the whole call: it rejects a name already open or still closing (`already-open`), resolves the route (`backend-not-found`), requires the backend's `kv` facet (`facet-unsupported`), opens the unit (backend `version-mismatch`/`malformed-medium` pass through), and validates every stored record and global against the spec's zod schemas (`invalid-record` with the offending table and key). The caller owns the returned handle and releases it with `Domain.close()`; domains still open when the plugin unmounts are closed by the facility, and a closed domain's name frees for reopening only after teardown fully completes. `get(name)` is an untyped diagnostic lookup onto the package-private `DomainImpl` runtime behind every typed handle; `closeAll()` is the unmount path.

## The change event: `domain/changed`

Every durable write emits one event strictly after the backend acknowledged durability, in the domain's write-chain order ([event entry](#domainchanged--emit)):

```ts type-equiv
/** Shared location fields of one durable domain change. */
interface DomainChangedBase {
  /** Owning domain name. */
  readonly domain: string
  /** Table name; `''` for a global-singleton write. */
  readonly table: string
  /** Record key; `''` for a global-singleton write. */
  readonly key: string
}
```

```ts type-equiv
/** One durable domain change; a closed union — switch on `operation`. */
type DomainChanged = DomainChangedPut | DomainChangedDeleted
```

`put` (inserts, overwrites, and global writes) carries the new snapshot in `value` — never the old value; a diffing consumer keeps its own previous snapshot. `deleted` is a tombstone with no value. The event is a notification, not a transaction participant: the commit point has passed at emission, so a synchronously throwing listener is contained with a logged warning rather than rejecting the already-durable write, and emitted values equal the in-memory state at emission. The event is in-process only; cross-process change push is a recorded limitation ([package README](../../packages/storage/storage-domain/README.md)).

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxstorage--storage"></a>

### `ctx.storage` — `Storage`

The storage hub service. Backends register under `backend`; data forms mount under their `StorageForms` key and are reached as `ctx.storage.<form>`.

```ts cordis-catalog
/**
 * Mount a data-form facility on the hub. Mounting is an effect: the
 * returned disposer unmounts the form.
 * @param form - Form key declared in {@link StorageForms}.
 * @param facility - The facility instance to expose.
 * @returns the disposer that unmounts the form.
 */
mount<K extends keyof StorageForms>(form: K, facility: StorageForms[K]): () => void

/**
 * Resolve a mounted data form.
 * @param form - Form key declared in {@link StorageForms}.
 * @returns the mounted facility.
 */
form<K extends keyof StorageForms>(form: K): StorageForms[K]
```

Source: [`packages/storage/storage/src/index.ts`](../../packages/storage/storage/src/index.ts)

<a id="ctxstoragedomain--domainfacility"></a>

### `ctx.storageDomain` — `DomainFacility`

The mounted domain facility. Opens declared domains over routed backends; one facility instance owns the open-domain table and enforces single-open per domain name.

```ts cordis-catalog
/**
 * Open one declared domain. Steps, each failing the whole call: reject a
 * name that is already open (`already-open`); resolve the backend route
 * (`backend-not-found` passes through from the hub); require its `kv` facet
 * (`facet-unsupported`); open the unit projected from the spec (backend
 * `version-mismatch`/`malformed-medium` pass through); load and validate
 * every stored record against the spec's zod schemas (`invalid-record`
 * with the offending table and key); construct the domain.
 *
 * Lifecycle: the CALLER owns the returned handle and closes it via
 * `Domain.close()` (typically as its own `ctx.effect` disposer) — the
 * facility does not tie the domain to any consumer fiber. Domains still
 * open when the facility unmounts are closed by the plugin disposer.
 * @param spec - The domain declaration, typically from `defineDomain`.
 * @returns the opened domain handle, typed by the spec.
 */
async open<S extends DomainSpec>(spec: S): Promise<Domain<S>>

/**
 * Look up an open domain by name, untyped. Diagnostic surface (the package
 * invariant cross-checks change events against live domain state); typed
 * consumers hold the handle returned by {@link open}.
 * @param name - Domain name.
 * @returns the open domain runtime, or `undefined` when not open.
 */
get(name: string): DomainImpl | undefined

/**
 * Close every domain still open on this facility. The unmount path for
 * consumers that never called `Domain.close()` themselves; closing is
 * idempotent, so double-closing an already-closed domain is harmless.
 * @returns resolution after every unit is released.
 */
async closeAll(): Promise<void>
```

Source: [`packages/storage/storage-domain/src/index.ts`](../../packages/storage/storage-domain/src/index.ts)

<a id="ctxstoragelog--storagelogfacility"></a>

### `ctx.storageLog` — `StorageLogFacility`

The mounted facility. A caller owns each returned stream and closes it when its projection/runtime stops. Unmount closes admission, drains accepted backend calls, settles every returned handle, then releases the form.

```ts cordis-catalog
/**
 * Open a caller-owned log stream over its configured backend. The facility
 * preserves one open handle per stream name, so a Consumer has exactly one
 * local serialization owner for its expected-tail mutations.
 * @param descriptor - Stream declaration owned by the caller package.
 * @returns a routed handle that releases the name only after backend close.
 */
async open(descriptor: LogStreamDescriptor): Promise<LogStream>

/**
 * Enumerate materialized streams through their configured backends. An entry
 * stored on a backend that no longer owns its name under this route table is
 * excluded, so recovery cannot accidentally reopen it through the wrong
 * provider.
 * @returns durable stream metadata in stable stream-name order.
 */
async list(): Promise<readonly LogStreamInfo[]>

/** Scan bounded physical entries instead of reading complete journal metadata or values.
 * @param request - Prefix, optional local cursor, and requested scan work.
 * @returns names and a continuation; empty pages still advance. Expired cursors require a fresh scan.
 */
async scanNames(request: LogNameScanRequest): Promise<LogNameScanPage>

/** Distinguish a concurrently deleted stream from a materialized malformed journal.
 * @param name - Exact routed stream name.
 * @returns whether its configured backend retains durable metadata.
 */
async hasStream(name: string): Promise<boolean>

/** Read bounded tail metadata through the stream's configured backend.
 * @param descriptor - Exact journal identity and durable version.
 * @param maxBytes - Positive metadata byte budget, including its wrapper.
 * @returns a detached tail summary, or undefined if absent.
 */
async readSummary(descriptor: LogStreamDescriptor, maxBytes: number): Promise<LogSummary | undefined>

/**
 * Read an open handle for diagnostics. Consumers hold the typed result of
 * `open`; this method does not infer a descriptor's value type.
 * @param name - Stream name.
 * @returns its live routed handle, or `undefined`.
 */
get(name: string): LogStream | undefined

/**
 * Close admission, settle accepted backend calls, then close every resolved caller
 * handle. All owned work settles before an aggregate failure is reported.
 * @returns resolution after every accepted call and returned handle settles.
 */
closeAll(): Promise<void>
```

Source: [`packages/storage/storage-log/src/index.ts`](../../packages/storage/storage-log/src/index.ts)

<a id="domain-events"></a>

### `domain/*` events

<a id="domainchanged--emit"></a>

#### `domain/changed` — emit

A domain record or the global singleton changed, emitted once per write strictly after the backend acknowledged durability. Events of one domain arrive in its write-chain order.

```ts cordis-catalog
/**
 * A domain record or the global singleton changed, emitted once per write
 * strictly after the backend acknowledged durability. Events of one
 * domain arrive in its write-chain order.
 * @param change - domain, table (`''` for global), key (`''` for global),
 * operation discriminant, and on `put` the new snapshot.
 * @mode emit
 */
'domain/changed'(change: DomainChanged): void
```

Source: [`packages/storage/storage-domain/src/events.ts`](../../packages/storage/storage-domain/src/events.ts)
<!-- END GENERATED cordis-surface -->
