# Agent Note: Native multi-agent P0 safety closure

Status: proposed

English | [中文](2026-09-04-native-multi-agent-p0-safety-closure.zh.md)

## Problem

The [native multi-agent work-system proposal](2026-08-27-native-multi-agent-work-system.md) has a stable local Team foundation, but four unresolved boundaries can still violate its security, durability, or model-reconstruction guarantees. Product Team mutations have no authenticated human principal, Team closure depends on one process-local `TeamRun`, active channels do not retain adapter or workflow-extension implementations after provider removal, and non-direct channel turns enter a Session as one ad hoc `TeamEnvelopeSource` message rather than an exact versioned channel view.

These gaps block safe product writes, restart convergence, HMR-safe protocol execution, and the rule that every Team-derived model input is reconstructable from the Session log. P1 product expansion must not build on those unresolved boundaries.

## Proposal

Land one P0 stack that establishes authenticated product principals, restart-safe lifecycle settlement, retained channel implementation leases, and durable non-direct channel views. P0 changes the relevant pre-release durable and wire formats atomically, rejects older formats, and reaches per-file coverage before P1 enables broader participant, channel, scheduler, or UI behavior.

P0 owns the following stable requirement ids:

| Requirement | Outcome |
|---|---|
| `P0-AUTH` | Every Host or SDK Team mutation derives one human `TeamActorProof` from an authenticated product principal; no wire payload supplies actor identity or proof. |
| `P0-LIFE` | Accepted completion, failure, cancellation, missing-final, and budget-expiry facts converge after restart without a process-local `TeamRun` credential. |
| `P0-LEASE` | An active channel retains its exact adapter, view-policy, and workflow-extension implementations until terminal release; retirement blocks only new use. |
| `P0-VIEW` | Every consult, discussion, workflow, and review turn is logged as an exact `team/channel-view` Session surface event before its delivery receipt commits. |
| `P0-GATE` | The changed runtime, Host, SDK, and provider files satisfy their per-file coverage, snapshot, documentation, and packed-consumer checks. |

### Scope and non-goals

P0 enables authenticated mutations and lifecycle recovery for one authoritative Hub. It does not add multi-Hub consensus, federation, remote hard-kill authority, child Teams, direct broadcast, generalized placement, or the final Team management UI. Those belong to the [P1 product-convergence specification](2026-09-04-native-multi-agent-p1-product-convergence.md).

Loopback address checks, `trustedHosts`, Team membership, Session headers, Participant ids, and Team cursors are not authentication. P0 retains the [Team actor-proof control-plane](2026-09-01-team-actor-proof-control-plane.md) rule that an unavailable principal or proof source fails closed.

### Package and ownership changes

| Package | Role | Required change |
|---|---|---|
| `packages/core/product-principal` | Service Definition | Define branded product-principal identity, authenticated-call values, credential-provider registration, and revocable provider leases at `ctx.productPrincipals`. |
| `packages/host/product-principal-local` | Service Provider | Supply the shipped single-user local principal, rotating bootstrap credential, digest persistence, browser-cookie binding, and SDK token validation. |
| `packages/team/team-human-actor` | Consumer/binder | Map one authenticated principal to exactly one active human Participant, mint one-shot operation proofs, and register the corresponding human proof source on `ctx.teams`. |
| `packages/client/connection` and `packages/host/apiproxy` | Transport Consumer | Authenticate before Team mutation dispatch and pass a runtime-only call context beside the parsed JSON request. |
| `packages/sdk/protocol`, `packages/sdk/server`, and both SDK clients | Transport Consumer | Authenticate the connection during initialization, retain the principal only for that connection, and keep all Team mutation payloads actor-free. |
| `packages/team/team-closure-driver` | Lifecycle Consumer | Recover accepted closure work, drive durable stalls/failures, and settle quiescing or cancelling Teams through source-scoped system proofs. |
| `packages/core/team` and `packages/team/team-hub` | Definition and Provider | Add human proof sources, recovery proof families, implementation leases, channel-view claim data, format validation, and recovery operations. |
| Channel adapter providers | Service Providers | Return model-delivery views and retain adapter, view-policy, and workflow-extension leases for active channels. |
| `packages/team/team-agent-client` and ACP/SDK proxy Session owners | Consumers | Append and flush `team/channel-view` before acknowledgement while preserving task and review fences. |

`product-principal` is a complete capability seam: the core package defines it, the local package provides the shipped implementation, and Host/SDK plus `team-human-actor` consume it. No authentication behavior is added to the reserved non-authenticated values under `packages/identity`.

### Authenticated product principal

#### Principal contract

`ProductPrincipalId` is a brand independent of `TeamId`, `ParticipantId`, and `SessionId`. An authenticated principal is immutable runtime data containing its id, issuer, subject, assurance class, and credential generation. Only the non-secret principal id may enter durable Team participant ownership; credentials, digests, cookies, bearer values, and proof objects never enter a Team journal, Session event, channel WAL, audit payload, diagnostic, metric label, or model input.

`ctx.productPrincipals` registers named providers through Cordis effects. Authentication returns a revocable lease rather than a bare value. Provider removal rejects new authentication and revokes its live leases after admitted calls settle. Distinct requests do not share mutable authentication state.

The transport creates this runtime-only call context after authentication and before RPC payload dispatch:

```text
AuthenticatedProductCall {
  principal: ProductPrincipal
  credentialGeneration: number
  signal: AbortSignal
}
```

The call context is a function argument to the Host or SDK dispatcher, not a field in `ClientRequest`, `RpcRequest`, `Team*Input`, or a generated Typert schema. In-process tests and transports must supply the same context instead of bypassing authentication with a Participant id.

#### Shipped local provider

The local provider persists one stable, non-secret `ProductPrincipalId` in Harness-owned storage. Each Host start rotates a 256-bit random bootstrap credential, stores only its digest and generation, and invalidates credentials from the prior generation. The CLI writes the plaintext credential to an owner-only temporary `file:` handoff document and opens that document without placing the credential in a URL or process argument. The document posts it once to a loopback-only bootstrap endpoint, receives an `HttpOnly`, `SameSite=Strict`, path-scoped session cookie, and is removed after acceptance, expiry, or Web teardown; the browser never writes the value to persistence or application state logs.

Every unary request, response action, SSE subscription, and WebSocket upgrade authenticates the cookie before reaching an API handler. A non-loopback deployment must replace the local provider with an explicit authentication provider; `trustedHosts` remains only a DNS-rebinding and reachability fence.

The SDK initialization handshake may carry a connection credential because it is an authentication boundary, but later Team methods carry no credential, principal id, Participant id-as-actor, or proof. The server compares the credential through the configured provider, retains the resulting lease for the connection, and drops it on shutdown or transport loss. TypeScript and Python clients accept the credential through an explicit secret option or credential reference and redact it from exceptions and process arguments.

#### Principal-to-Participant binding

Interactive root Team creation records the authenticated principal id as the owner of its human Participant. Headless system-owned runs record a closed system owner and do not fabricate a human principal; that Participant cannot invoke generic human control-plane mutations. Loading a current-version Team rejects a missing or malformed owner and rejects duplicate active human bindings for one principal within that Team.

For each mutation, `team-human-actor` reads the Team, selects exactly one active human Participant whose owner equals the authenticated principal id, verifies that Participant's immutable grant contains the operation, and mints a one-shot proof bound to the complete operation payload and observed cursor or revision. The Hub resolves the proof before policy, re-resolves it under every relevant Team/channel lock, and appends only the derived Participant attribution. A retry receives a new proof and reaches the existing idempotency record.

Authentication proves the product principal; the Hub still enforces Team identity, membership, grant subsets, target validity, budgets, and policy. Neither layer may restore authority denied by the other.

#### Product operations and errors

P0 re-enables `team.resume`, detached terminal `team.archive`, Team Goal mutation, participant mutation, ordinary channel lifecycle, channel post, task create/update/cancel/delete/review, and soft interrupt only after each route owns an exact human-proof scope. Current-run `team.start`, `team.postInput`, `team.waitFinal`, and `team.cancel` keep their narrower `TeamRun` proof paths.

| Error code | Condition |
|---|---|
| `PRODUCT_AUTH_REQUIRED` | The transport supplied no authenticated principal for a protected call. |
| `PRODUCT_AUTH_INVALID` | Credential verification, generation, issuer, or lease validation failed. |
| `TEAM_HUMAN_ACTOR_NOT_FOUND` | The principal owns no active human Participant in the selected Team. |
| `TEAM_HUMAN_ACTOR_AMBIGUOUS` | Durable state maps the principal to more than one active human Participant. |
| `TEAM_HUMAN_ACTOR_FORBIDDEN` | The Participant grant or Team policy denies the selected operation. |
| `TEAM_ACTOR_PROOF_INVALID` | The proof is forged, revoked, stale, cross-Team, cross-operation, or does not match its payload fence. |

Authentication failures occur before a mutation policy waterfall or durable append. Authorization denials remain durable audit records only when the authenticated actor and selected Team are known; unauthenticated probes do not create Team facts.

### Restart-safe Team lifecycle convergence

#### Closure driver authority

`team-closure-driver` is mounted in every shipped Team composition after the Hub, scheduler, activation controller, Link providers, and workspace recovery owners. It may continue only an already durable closure or cancellation intent. It cannot create a completion intent, select a final answer, impersonate a human, resume an ordinary stalled Team, or mutate unrelated tasks and channels.

The driver registers short-lived proof sources for these exact operations:

| Scope | Durable prerequisite | Permitted effect |
|---|---|---|
| `closure-recover-complete` | Completion intent naming a human-receipted coordinator final | Re-run quiescence cleanup and commit `completed`. |
| `closure-recover-cancel` | Durable cancellation intent | Continue attempt interruption/fencing, allocation release, channel closure, and terminal cancellation. |
| `closure-recover-fail` | Durable failure intent | Release owned resources and commit `failed` after quiescence. |
| `closure-stall-missing-final` | A current coordinator turn ended normally without an accepted final | Commit `stalled` with `FINAL_ANSWER_MISSING`. |
| `closure-fail-turn` | A current coordinator turn ended with a structured infrastructure or model error | Commit `failed` with the exact terminal code and message. |
| `closure-stall-budget` | A frozen wall-time, token, turn, cost, retry, or concurrency ceiling prevents further work | Commit `stalled` with the typed budget reason. |

The first three scopes are reconstructable from durable Team/channel facts and may be recreated after restart. The last three require a current observer of the triggering fact and append their intent before returning an error to the product caller. Recovery never manufactures an absent trigger.

#### Drive and recovery algorithm

Each drive uses bounded Team pages and one serializer per Team. It repairs parent charges and audit projections, reads the current closure intent, computes quiescence, and performs only the next idempotent cleanup action. Every provider action records its requested, released, preserved, or unconfirmed state before the next branch. Cleanup uses `Promise.allSettled` at each ownership level and returns one aggregate only after all accepted branches settle.

On startup the driver scans only nonterminal Teams with a closure/cancellation/failure intent or a `quiescing` phase. Event listeners request coalesced later drives; an optional configured pulse repairs missed process notifications. A Team with no possible producer receives a durable stall reason. A remote epoch whose provider cannot prove termination remains `stopping` and stalls with `REMOTE_CANCELLATION_UNCONFIRMED`.

Human resume is a separate authenticated operation. It may move a recoverable stalled Team to `active` only after verifying that no closure intent is terminally committed and that provider-specific recovery can produce a valid coordinator epoch. Completion and cancellation recovery do not require that broader resume authority.

### Retained protocol implementation leases

Adapter, view-policy, and workflow-extension registration returns a retirement handle backed by a registry entry with `accepting` state and a reference count. Disposing the contributing Cordis effect sets `accepting: false`, removes the implementation from list and create resolution, and emits the removal event, but retains the exact object while any active channel lease references it.

Opening or recovering a channel atomically acquires its adapter and optional view-policy leases. A workflow channel additionally acquires every versioned condition and target extension referenced by its validated graph. Failed WAL attachment releases all acquired leases. A loaded channel releases them only after its terminal WAL record is committed, every provider-admitted operation drains, and its in-memory projection is evicted.

Restart has no in-memory lease to inherit. Recovery therefore requires the exact registered adapter, view-policy, and workflow-extension versions before accepting the channel projection. A missing version fails startup or channel load loudly; it never substitutes a newer implementation or closes the channel heuristically.

The Hub exposes process-local counts for active and retired leased implementations. HMR tests must prove that retirement blocks new channels, an already active channel continues through replay and terminal close, and the implementation becomes collectible only after release.

### Durable non-direct channel views

#### Claim result

For consult, discussion, workflow, and review delivery, the Hub resolves a bounded WAL range under the channel serializer and asks the retained adapter/view policy for one pure model-delivery projection. A successful claim carries this JSON-safe value:

```text
TeamChannelViewSource {
  teamId: TeamId
  channelId: ChannelId
  adapter: { type: string, version: number }
  viewPolicy: { type: string, version: number }
  triggeringEnvelopeId: EnvelopeId
  sourceEnvelopeIds: EnvelopeId[]
  delivery: 'context' | 'turn' | 'steer'
  content: MessageContent[]
  causationId?: EnvelopeId
  taskId?: TeamTaskId
  review?: {
    attemptId: TaskAttemptId
    reviewRevision: number
    reviewerId: ParticipantId
  }
}
```

`sourceEnvelopeIds` is nonempty, duplicate-free, ordered by WAL sequence, and ends at or before the triggering Envelope. `content` is the exact content sent to the model. The configured view policy must be explicit for non-direct model delivery; absence rejects channel creation. A summarized view may select only a durable summary record whose covered range and provenance pass validation.

The claim remains ephemeral, but every field above is copied into a `team/channel-view` Session event before acknowledgement. `team/channel-view` is a required surface event that derives exactly one user-role message from its stored `content`; message history never re-renders the current channel or calls a live adapter. The event retains optional review fences so `team_task_review` derives its revision from the current logged view rather than a model argument.

The Agent Client appends the event, waits for `ctx.sessions.flush()`, and only then records the channel receipt. Redelivery finds the same triggering/source ids in the Session log and acknowledges without a second model turn. ACP proxy Sessions and SDK remote Sessions use the same event and ordering. Direct unicast may continue to use an identified `user/message` with `TeamEnvelopeSource`; task-assignment start retains its exact `TeamTaskAssignmentSource` and allocation fence.

View generation must remain bounded by channel limits, a recent-window size, or a durable summary range. `full-transcript` is legal only when the manifest's hard turn and byte bounds prove the complete rendered value fits the configured model-view limit.

### Durable and wire versioning

P0 advances the Team journal/checkpoint version for principal ownership, lifecycle recovery facts, and new proof-derived attribution; it advances the channel WAL/checkpoint version only where retained model-view or implementation identity facts change. Host Remotes, generated Typert artifacts, SDK protocol schemas, TypeScript projections, and Python models update in one stack item.

The new Session event follows `SESSION_FORMAT_VERSION = 0`. Current readers must understand `team/channel-view`; they reject a log containing it unless the event is explicitly marked ignorable by its owner, which P0 does not do because it carries complete model-visible meaning.

No pre-release converter, fallback reader, or old direct-session control path ships. Tests create current-version fixtures and assert that old Team/channel values fail loudly without modifying user-owned data.

### Delivery plan

The P0 stack lands in this order. Each item updates or adds its owning Agent Note and remains buildable independently.

| Item | Depends on | Deliverables | Exit condition |
|---|---|---|---|
| `P0-0` Contract lock | Current Team spine | Failing fixtures for unauthenticated writes, restart closure, retired adapters/extensions, and non-direct view logging; complete bypass inventory | Every P0 mutation and recovery path has a failing replacement test. |
| `P0-1` Product principal seam | `P0-0` | Core registry, local provider, Host/SDK authentication context, secret redaction, root-human principal ownership | Authenticated calls identify one principal; unauthenticated calls reach no Team mutation. |
| `P0-2` Human actor control plane | `P0-1` | `team-human-actor`, one-shot payload-bound proofs, re-enabled Host/SDK/Goal mutations, denial audit | Every enabled mutation resolves a live proof twice and journals only derived attribution. |
| `P0-3` Lifecycle convergence | `P0-1`, `P0-2` | Closure driver, durable missing-final/failure/budget intents, restart scans, aggregate cleanup | Kill-point tests converge to completed, failed, cancelled, or an exact durable stall. |
| `P0-4` Implementation leases | `P0-0` | Retiring registries, channel-held adapter/view/extension leases, restart validation, metrics | HMR cannot strand an accepted active channel or admit a new channel through a retired implementation. |
| `P0-5` Channel views | `P0-4` | Claim projection, Session event, Agent Client/ACP/SDK admission, de-duplication, snapshots | Every non-direct model input is reproduced byte-for-byte from its Session log before receipt. |
| `P0-6` Cutover gate | `P0-2`–`P0-5` | Format bump, generated artifacts, focused and full checks, packed probes, docs | P0 acceptance criteria and per-file coverage pass on the outgoing stack. |

### Verification matrix

| Area | Required evidence |
|---|---|
| Authentication | Missing, malformed, rotated, revoked, cross-provider, replayed, and redacted credentials; browser bootstrap; SDK initialize; connection teardown. |
| Human authority | Multiple human principals, absent/ambiguous ownership, inactive membership, grant denial, policy denial, stale cursor, retry, forged/cross-Team/cross-operation proof. |
| Lifecycle | Fault injection before and after intent, final receipt, task settlement, activation stop, workspace release, channel close, and terminal append on JSON and SQLite. |
| Missing final and budgets | Normal turn end, cancelled turn, structured model failure, wall-time expiry without another mutation, token/turn/cost/retry/concurrency ceilings, explicit human resume. |
| Leases | Adapter/view/extension retirement during create, send, replay, checkpoint, summary, close, HMR, and Hub disposal; missing exact versions after restart. |
| Channel views | Directed/full/recent/summarized policies, consult/discussion/workflow/review, duplicate delivery, flush failure, receipt failure, compaction boundary, ACP proxy, SDK remote Session. |
| Product composition | Keyless Headless, Web, ACP, and JSON-RPC snapshots; TypeScript and Python expected outputs; no standalone Session product creation. |
| Repository | Relevant unit/property/race tests, `typecheck`, `lint`, per-file `test:coverage`, snapshots, `hygiene`, `doc-sync`, website build, and packed consumers. |

### Decision ownership and supersession

The parent native multi-agent proposal remains the product architecture owner. The [Team actor-proof control-plane](2026-09-01-team-actor-proof-control-plane.md) remains the security owner for runtime-only proofs; P0 supplies its missing product-principal provider and authenticated human Consumer. Implemented closure, direct delivery, channel protocol, Session reconstruction, and local product-run notes remain active foundations and are not superseded.

No implemented Note qualifies for archival at proposal time. P0 updates each owning implemented Note only when its shipped contract changes; archived records remain frozen.

## Alternatives considered

**Treat loopback or `trustedHosts` as the human principal.** Rejected because they constrain network reachability and DNS rebinding, not possession of a user identity. A caller reaching the same authority could still impersonate the Team's human Participant.

**Put a principal id or Team actor token in every mutation payload.** Rejected because a serializable identifier is replayable authority, would enter generated wire contracts, and could be copied across Teams. Authentication stays at connection admission and proofs remain runtime-only.

**Persist `TeamActorProof` so closure can resume after restart.** Rejected because the proof is a revocable process-local capability. Recovery receives narrow authority from an already committed closure intent and persists only business attribution.

**Close every channel when its adapter provider unloads.** Rejected because unload timing is not protocol authority and could discard accepted messages or outstanding receipts. Retirement blocks new use while leases preserve accepted work.

**Re-render a channel from its live WAL when the next model request starts.** Rejected because the model input could differ after later Envelopes, summaries, policy changes, or adapter replacement. The exact rendered view is a durable Session event before acknowledgement.

**Implement P1 features in the same stack.** Rejected because broader fan-out, remote placement, and UI mutation would multiply the callers of boundaries that P0 is intended to make safe and recoverable.

## Acceptance criteria

- Every shipped Host and SDK Team mutation is either authenticated and proof-authorized or fails before policy and persistence; no request accepts caller-selected actor identity or a serialized proof.
- A browser or SDK credential can rotate or revoke without changing the durable principal id, and no secret appears in logs, diagnostics, Team streams, Session streams, URLs sent to the Host, process arguments, snapshots, or telemetry.
- A current-format interactive Team maps each human owner to a branded principal id, a system-owned Headless Team records its closed system owner, and both reject missing or ambiguous ownership.
- Accepted completion, cancellation, and failure intents resume after a full Host process restart and settle every owned task, Activation, Link, workspace, channel, and human action before a terminal Team phase.
- A coordinator turn ending without final records `FINAL_ANSWER_MISSING`; a structured model or infrastructure failure records `failed`; wall-time and other exhausted budgets record a durable typed stall without waiting for another user mutation.
- Disposing an adapter, view-policy, or workflow-extension registration blocks new admission but does not break an active channel; the exact implementation is released only after terminal quiescence.
- Restart rejects an active channel when any exact referenced implementation version is unavailable.
- Every consult, discussion, workflow, and review model turn is reconstructable byte-for-byte from one `team/channel-view` Session event with ordered Envelope provenance and exact adapter/view versions.
- Session durability precedes a receipt, and redelivery of an already admitted view cannot start another model turn.
- JSON and SQLite lifecycle/recovery suites, Host and SDK contracts, both SDK projections, keyless product snapshots, per-file coverage, documentation gates, and packed-consumer probes pass for all P0 changes.

## Risks

- A flawed local bootstrap flow could leak a bearer credential through browser history, referrers, logs, or process inspection. P0 keeps plaintext only in an owner-only temporary handoff document until a one-time loopback exchange, redacts all errors, and tests every carrier surface.
- Persisting a stable principal id creates a durable account-like reference. It carries no credential or reusable authority, and deleting or rotating credentials does not rewrite historical attribution.
- Recovery proof scopes could accidentally become generic system authority. Each scope requires an existing durable intent, exact ids and cursors, one operation, revalidation under locks, and revocation after the call.
- Retained implementation objects may delay HMR memory reclamation. Reference counts and process-local metrics make retirement visible; terminal channel release is the only collection point.
- Channel views can amplify context. Every policy has a hard render bound, summaries are durable inputs rather than synthesized replacements, and full transcript views require finite manifest limits.
- The format cutover rejects pre-release Team and channel data. The repository's pre-release stance prefers loud rejection over a compatibility reader that could weaken authority or reconstruction.
