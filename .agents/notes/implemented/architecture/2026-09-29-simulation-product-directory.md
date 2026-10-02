# Agent Note: Simulation product registration and authenticated reads

Status: implemented

English | [中文](2026-09-29-simulation-product-directory.zh.md)

## Problem

Native Simulation snapshots contain private world facts and require provider identities and immutable specs. Browser discovery needs a persistent authorized identity that survives Host restart without becoming an execution owner. Native read-only inspection alone supplies neither registration nor public redaction and credential-bound pagination.

## Decision

The opt-in [product plugin](../../../../packages/simulation/simulation-product/README.md) owns a Storage Log directory, format 1, independent of world history. Trusted imports bind opaque product identities to immutable provider/run specs and one owning authenticated principal. Exact retry and restart reuse registrations and timestamps; duplicate product or provider/run identities, changed imports and incomplete/corrupt history reject. Removing an import does not delete retained identity or transfer authority.

Discovery reads only directory metadata. Provider activation is independent of registration; actual inspection resolves support and explicitly refuses unavailable providers. Loader activation follows dependencies, so textual configuration order cannot establish provider readiness for registration construction.

List and inspection use current runtime-only product calls. Missing and private product identities share one refusal. Credential retirement and cancellation are checked before provider IO and after success or failure. Public observations omit principal associations, provider/spec/path, profiles, knowledge and model context; they retain exact decimal time, revision, administrative phase, counts and observed ownership. Inspection does not open, restore or mutate a run, and persisted running phase does not imply active scheduling.

Encrypted pages bind service lifetime, credential generation, principal issuer/subject/ID, directory revision, search and limit. Public UTF-8 budgets cover complete requests/results, wrappers and cursors. Durable registration bytes have an independent allowance, so smaller public limits do not prevent recovery of private specs. Text truncation is explicit. Configured admission bounds independent reads; unload drains accepted work before releasing directory storage.

Host fetch and its typed carrier expose `simulation.runs.list/inspect`. Known forbidden, invalid and unavailable failures retain distinct categories; unknown failures return generic internal messages. The exact-run response parser rejects identity substitution.

`simulation.collections.list` provides revision-bound entity, decision, operation and checkpoint metadata. Filtered totals come from the same complete native observation as each page. Decimal slots sort exactly; effect order follows parent slot/index and refuses orphaned operations. `simulation.objects.inspect` reads exact sections, with independently paged entity relationships, frozen contexts, attempts and checkpoint references and complete outer-wrapper byte admission. A selected revision or continuation mismatch returns `simulation-product-stale`; unknown/other-run objects share absence. Typed carriers reject substituted run, collection, object, section and revision.

Entity relationships retain exact half-open time intervals and include incoming, outgoing and scoped references. Frozen-context sections read only the original retained view, ordered block parts and knowledge/source references. A trusted principal/entity-scoped `contextReaders` grant is separate from run discovery and management; its optional product run narrows owned registrations. Defaults withhold every body. Explicit grants disclose historical plain text only, not current knowledge or source Team/Session content. Unsupported blocks omit their payload. The owner validates and copies policy before IO and rechecks its lifetime after asynchronous settlement, so retirement cannot return an already-built body. Unicode-safe part limits and the complete envelope budget both apply; continuation binds disclosure and part size. This view does not substitute for reconstruction and separate authorization of the complete logged model request.

Public labels select only the entity's name; profile bodies remain private. Decision/context accounting withholds original content and does not represent the whole model request. Effect status, publication, input persistence, recipient receipt, task creation and delivery-failure resolution remain separate facts. A completed checkpoint does not imply current source verification: the public field explicitly says `not-performed`. Team/Session references require their own content authorization. Shared Host dispatch owns authentication and private-error mapping independently of the gateway's other domains.

Browser DTOs and parsers have explicit `./types` and `./schema` entries, independent of private registration and Host Cordis declarations. Simulation exports its existing `SimTime` brand through a pure `./time-types` declaration, preserving native identity without importing provider and Session declarations into Client programs.

The pure `./identities` entry preserves native entity, decision/slot, operation, checkpoint and writer-epoch brands for the same purpose. Existing schemas and durable encodings are unchanged.

The [read-only history decision](2026-09-29-simulation-readonly-history.md) retains native consistency and coordinator observation. This partially implements the [product proposal](../../proposed/architecture/2026-09-28-web-team-simulation-product-integration.md), which retains live execution ownership, sectioned collections, administrative and UI requirements. Neither note is fully superseded.

The [persistent creation decision](2026-09-29-persistent-company-creation.md) owns public allocation, original request outcomes and paused preparation handles; this note retains its independent rules.

## Alternatives considered

**Expose native snapshots and selections.** They disclose private facts and allow substitution of provider/spec instead of an authorized registered identity.

**Open a run for browsing.** It competes for coordinator ownership and conflates discovery with execution or recovery.

**Resolve providers in registration construction.** Loader dependency activation can register them later; read-time resolution also explicitly handles provider unload.

**Serialize every read.** Immutable directory metadata does not require serialization; one slow native observation would block unrelated discovery.

Independent context-policy contributions use a runtime-only registrar and their own deployment-plugin effect. Addition/removal changes a non-authorizing read version and wakes bounded watch waits; it does not replace discovery, administration or the browser module. Authenticated watches bind run, credential, policy and source lifetime, and report only revision/availability. Native probes use ordinary read admission while sleeping waits have separate capacity. Context replies carry their policy tag; retirement and later client observations cannot republish old text. Client invalidation preserves uncertain original commands and drafts, and metadata-only world advances retain stale pages rather than fabricating updated totals.

Knowledge retrieval uses the definition package’s shared native temporal/transitive projection, while providers retain journal folding. Historical context permission does not authorize current or selected knowledge: explicit content domains govern these reads, and current audience revocation still applies at a decision’s frozen cutoff. Exact references cannot escape that decision’s original selection. Report source disclosure requires a separate grant and a matching retained communication/durable-delivery record. World revision changes release knowledge bodies without reinterpreting historical context permission.

Original journal records use the same native read-only history verification. Metadata and separately authorized JSON text remain distinct. Whole-run `recordReaders` are privileged historical readers, independent of entity audience/context grants; granting them deliberately permits retained private history. Lazy text parts bound allocation, complete wrappers bound public pages, and policy/version changes refuse held original content and continuation. Browser records/export is owned by the client runtime and UI; non-run-event sources remain separate work.

Frozen Team Envelope references expose a stable ordinal into the recorded source vector. Product lookup follows at most one channel page per request and discloses no unrelated rows. Exact body pages retain the found immutable position. Entity source grants and current Team human reads are independent requirements, and both success and failure settle after revalidation. Missing access does not confirm a private target’s existence. Original parts are inert text; unknown provider blocks stay withheld.

## Consequences

Access is one owning principal per immutable registration, without mutable ACL/removal operations. Directory lists contain unobserved metadata; object pages carry exact native revisions. Native full-history replay remains bounded but potentially expensive; there is no performance claim. The browser owner provides source inspection and independent Team-permission refresh; its full interaction matrix remains separately tracked.

The [browser viewing decision](2026-09-29-simulation-browser-viewing.md) owns optional browser composition. The [company preparation decision](2026-09-29-company-initial-preparation.md) owns initial native topology reconciliation. Neither replaces the directory's authorization or read-only observation rules.

## Verification

JSON/SQLite directory tests cover recovery, exact retry, ownership duplication, retained capacity, incomplete history, entry limits, encrypted query replacement, UTF-8 and complete-page limits, and drained unload. Collection/detail tests cover exact decimal ordering, stale pages, typed filters, private-body/diagnostic omission, layered effect evidence, missing objects, independent section pages and complete-wrapper admission. Host tests exercise fetch authentication, private/missing equivalence, provider errors, mid-read retirement and substituted response selectors. A keyless snapshot boots a native writer and separate credential-authenticated product reader through real Loader compositions; it reads durable decisions and actual resource-transfer effects, verifies held/released ownership and precise time, and reuses registration after reader restart.

The [context/relationship regressions](../../../../packages/simulation/simulation-product/tests/context-and-relations.spec.ts) inspect real JSON/SQLite frozen views, verify Unicode part reconstruction, independent body grants and unload/credential fences, and keep world snapshots unchanged. Web scenarios inspect production actor contexts and exact relationship paging; the SDK maintenance scenario reads both sections over real stdio, including cold lifecycle checks. Neither body grants nor references authorize other source content.

Watch regressions cover native JSON/SQLite changes, independent policy retirement, credential/unload cancellation, metadata-only unavailable states and old response fences. The real browser maintenance composition unloads and remounts the policy plugin while preserving the same directory, run snapshot, model count and later input draft. The stdio SDK scenario resets a prior watch cursor after process restart.
