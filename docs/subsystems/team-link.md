# Team Link

English | [中文](team-link.zh.md)

`@clocky/clocky-team-link` defines `ctx.teamLinks`, the named registry for activation-bound local or remote channel Links. A Link is an ephemeral transport client: it carries one durable activation binding, derives channel and task-attempt owner facts from that binding, forwards channel post/claim/receipt, task-attempt start/settlement, and artifact-sourced integration operations, notifies a consumer about accepted Envelopes, and reports terminal lifecycle state through `done`. Its activation id, Team, Participant, Session, and placement provider identify the connection; mutable residency status does not.

## Ownership

The registry owns effect-scoped provider registration and verifies that a connected Link returns the requested provider name and activation binding identity. It closes a mismatched Link before rejecting the connection. A Link post includes a sender-scoped opaque idempotency key, so a same-key retry can recover one accepted Envelope without reopening its observed cursor. Providers own connection lifecycle, replay, notification backpressure, terminal failure, and containment of notification-listener failures. The Team Hub remains the durable journal, WAL, claim, and receipt authority; the Agent client remains the local inbox, source-flush, and model-wake owner.

[`clocky-team-link-local`](../../packages/team/team-link-local/README.md) verifies a live local activation binding, replays recipient pending-delivery pages and target-bound soft interrupts through cancellable watches, and retries failed local listeners. [`clocky-team-link-websocket`](../../packages/team/team-link-websocket/README.md) connects the same binding to a configured `ws:` or `wss:` endpoint using a capability environment variable and strict v4 frames, including cooperative endpoint termination. The server-side [`clocky-team-link-websocket-hub`](../../packages/team/team-link-websocket-hub/README.md) maps that capability to one configured binding, rechecks its active durable epoch, derives operation authority, and replays pending deliveries and interrupts from the Hub. Neither provider inserts Agent inbox input; that remains the Agent client's responsibility.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxteamlinks--teamlinkregistry"></a>

### `ctx.teamLinks` — `TeamLinkRegistry`

Named Team Link provider registry at `ctx.teamLinks`. A provider owns every published Link; the registry owns provider registration and connection-time provider/binding verification.

```ts cordis-catalog
/**
 * Register one named Team Link provider. Registration is effect-scoped and
 * its disposer removes only this provider instance.
 * @param provider - local or remote Link implementation for future connections.
 * @returns HMR-safe disposer for this registration.
 */
registerProvider(provider: TeamLinkProvider): () => void

/**
 * Resolve one registered Team Link provider.
 * @param name - provider registry name.
 * @returns the live provider, or `undefined` when no matching provider remains.
 */
getProvider(name: string): TeamLinkProvider | undefined

/**
 * List registered Team Link provider identities in registration order.
 * @returns detached provider references.
 */
listProviders(): TeamLinkProviderRef[]

/**
 * Register callback-only access to one owner's existing bound Link. The
 * caller retains Link lifetime and may remove this access at any time.
 * @param owner - exact same-process owner identity that may later borrow.
 * @param borrower - callback-only accessor for the owner's current Link.
 * @returns HMR-safe disposer for this owner registration.
 */
registerBoundLinkBorrower(owner: object, borrower: TeamLinkBoundLinkBorrower): () => void

/**
 * Resolve callback-only access to an owner's existing bound Link.
 * @param owner - exact owner identity that registered the Link accessor.
 * @returns the current borrower, or `undefined` when that owner has no live Link delivery.
 */
getBoundLinkBorrower(owner: object): TeamLinkBoundLinkBorrower | undefined

/**
 * Register one remote-Link enrollment provider. Registration is effect-scoped
 * and does not expose credentials to ordinary Link consumers.
 * @param provider - issuer for exact activation-bound remote credentials.
 * @returns HMR-safe disposer for this registration.
 */
registerEnrollmentProvider(provider: TeamLinkEnrollmentProvider): () => void

/**
 * Resolve one remote-Link enrollment provider.
 * @param name - provider registry name.
 * @returns the live credential issuer, or `undefined` when no matching provider remains.
 */
getEnrollmentProvider(name: string): TeamLinkEnrollmentProvider | undefined

/**
 * List registered remote-Link enrollment provider identities in registration order.
 * @returns detached provider references.
 */
listEnrollmentProviders(): TeamLinkEnrollmentProviderRef[]

/**
 * Reserve one short-lived credential for an exact active activation binding.
 * @param request - selected enrollment provider and durable binding.
 * @returns opaque credential material owned by the caller until it is revoked.
 */
async reserveEnrollment(request: TeamLinkEnrollmentRequest): Promise<TeamLinkEnrollment>

/**
 * Connect through one registered provider. A returned Link must retain the
 * selected provider name and exact durable activation binding; otherwise the
 * registry closes it before rejecting the connection.
 * @param request - provider name, exact durable activation binding, and optional cancellation signal.
 * @returns the provider-owned Link after connection-time verification.
 */
async connect(request: TeamLinkConnectRequest): Promise<TeamLink>
```

Source: [`packages/core/team-link/src/index.ts`](../../packages/core/team-link/src/index.ts)

<a id="team-link-events"></a>

### `team-link/*` events

<a id="team-linkenrollment-provider-added--emit"></a>

#### `team-link/enrollment-provider-added` — emit

An enrollment issuer became available for new remote Link credentials.

```ts cordis-catalog
/**
 * An enrollment issuer became available for new remote Link credentials.
 * @param provider - registered issuer identity.
 * @mode emit
 */
'team-link/enrollment-provider-added'(this: TeamLinkRegistry, provider: TeamLinkEnrollmentProviderRef): void
```

Source: [`packages/core/team-link/src/index.ts`](../../packages/core/team-link/src/index.ts)

<a id="team-linkenrollment-provider-removed--emit"></a>

#### `team-link/enrollment-provider-removed` — emit

An enrollment issuer stopped accepting credentials. Existing credentials may no longer attach after the issuer's transport listener is replaced.

```ts cordis-catalog
/**
 * An enrollment issuer stopped accepting credentials. Existing credentials
 * may no longer attach after the issuer's transport listener is replaced.
 * @param provider - removed issuer identity.
 * @mode emit
 */
'team-link/enrollment-provider-removed'(this: TeamLinkRegistry, provider: TeamLinkEnrollmentProviderRef): void
```

Source: [`packages/core/team-link/src/index.ts`](../../packages/core/team-link/src/index.ts)
<!-- END GENERATED cordis-surface -->
