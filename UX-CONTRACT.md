# UX Contract

## Product context

- Audience: people directing durable agent work in a browser workspace.
- Primary jobs: start a task, return to a Team, inspect its coordinator transcript, and continue the conversation.
- Target markets: global developer tooling.
- Active locales: Simplified Chinese and English.
- Language/content register: concise technical product language; locale service owns visible copy and aria labels.
- Timezone/calendar policy: Team navigation shows no user-facing timestamps in this slice.
- Accessibility target: WCAG 2.2 AA.

## Business-context sources

| Domain / scope | Authoritative source | Source type | Reviewed date |
|---|---|---|---|
| Team lifecycle and identity | [.agents/notes/proposed/architecture/2026-08-27-native-multi-agent-work-system.md](.agents/notes/proposed/architecture/2026-08-27-native-multi-agent-work-system.md) | Architecture proposal | 2026-08-29 |
| Local Team admission | [packages/team/team-run/src/index.ts](packages/team/team-run/src/index.ts) | Domain implementation | 2026-08-29 |
| Browser Team RPC | [packages/host/apiproxy/src/api/teams.ts](packages/host/apiproxy/src/api/teams.ts) | API contract | 2026-08-29 |

## Visual contract

- Project `DESIGN.md`: [DESIGN.md](DESIGN.md)
- Token ownership model: existing runtime canonical.
- Runtime design-system/token source: [packages/client/ui-theme/src/styles/design-platform.css](packages/client/ui-theme/src/styles/design-platform.css).
- Mapping/export/adapters: feature CSS consumes semantic `--clocky-*` aliases only.
- Token drift gate: client type, lint, and UI test lanes; no feature-local token copies.
- Supported themes: the existing light and dark theme token sheets.
- Design-context owner/review policy: UI changes extend the existing sidebar/composer patterns and keep this contract current.

## Canonical UI Map

| Capability | Canonical owner | Source of truth | Allowed variants | Verification |
|---|---|---|---|---|
| Team list | `ui-team` | `ctx.teamTasks.list` | wide list / collapsed rail | component + assembled slot test |
| Team detail | `ui-team` | selected Team, bounded collections and runtime-owned task inspection | main Team workspace with a non-modal task inspector | component + API-backed interaction test |
| Sidebar shell | `ui-sidebar` | `sidebar` slot | expanded / 56px rail | component + snapshot |
| Coordinator transcript | `ui-conversation` | `ctx.sessions` | Team descendant only | assembled flow test |
| Composer | `ui-conversation` | `SessionInputShell` | Team first-input draft / coordinator transcript | component + assembled flow test |
| Scrollbar | `ui-theme` | shared theme aliases | documented stable-gutter regions | CSS and browser checks |
| Form | `ui-primitives` Input/Modal and native radio controls | installed product template and Host command DTOs | creation with raw retained input / explicit original-result query | component + real Host browser |
| Toast | `ui-primitives` / feature owner | shared Toast and feature state | transient toast / retryable inline error | component test |

## Component behavior

| Component | Default | Hover | Focus | Active | Disabled | Busy | Error |
|---|---|---|---|---|---|---|---|
| New team work | local draft only | shared sidebar hover | native visible focus | starts a new draft | n/a | disabled during start | composer preserves input |
| Team row | objective + phase | sidebar row fill | native button focus | opens Team | competing rows disabled | fixed row geometry | inline list error |
| Team rail button | goal icon | circular hover fill | native button focus | expands sidebar | n/a | n/a | n/a |
| Composer | text draft | existing input behavior | resident textarea | submits through Team start | no Team draft is inert | submission phase | retryable notice, draft retained |

## Dataset navigation

- Team list: one bounded initial page; explicit Load more extends the requested range, and refresh preserves that range. Channel records and audit records use the Host continuation cursor.
- Selected-Team member, task, workflow, and artifact lists retain one page each. Next page replaces that window; Refresh rereads its starting cursor; First page returns to the beginning. Failed or cancelled reads retain the prior page. Task inspection and unsent input survive page changes.
- Task lists read browse summaries. The inspector retains one current record, its latest attempt, and one page per attempt/review history. The latest result is independent of history navigation. Module changes preserve these bounded windows; explicit dismissal and Team changes release them. Version changes preserve readable data with a refresh notice and prevent mutations based on stale details.
- Task status filtering uses the shared Menu, with a selected marker and keyboard handling. Search and status use an independent bounded Host query over the authorized Team, with explicit submit, IME handling and immediate clear with focus restoration. Committed filters survive URL reloads. A Host without the query exposes the labeled loaded-page search.
- Empty/loading/error treatment: inline text in the fixed Team-list region. Exact route restoration has its own loading/error body; a failed destination never displays the prior Team as its content. A single bounded source route in history carries only workspace view fields and is independently revalidated on return.
- Selection: one product-level `TeamId`; the Session selected after resolution is the coordinator transcript descendant.

## Flow ledger

| Operation | Trigger | Pending | Success destination | Success feedback | Failure recovery | Focus outcome | Source ref |
|---|---|---|---|---|---|---|---|
| Start Team task | New team work + first text submit | composer submission | Team coordinator transcript | draft clears after admission | draft and retry key remain | resident textarea follows transcript | `team.start` |
| Open Team | Team row | rows disabled | Team overview | selected row | inline Team-list error | Team navigation remains available | read-only Team inspection |
| Edit Team objective | `/goal edit <objective>` in coordinator transcript | command lifecycle | same transcript | durable objective result | command result explains stale or authorization failure | composer remains focused | `command-team-goal` |
| Continue Team transcript | coordinator composer | existing input submission | same transcript | existing conversation feedback | current draft remains | resident textarea | transitional Session bridge |
| Cancel / archive | Team detail or terminal row action | control pending state | Team detail/list | durable Team phase | inline error; retry uses the same Team identity | selected detail remains | `team.cancel`, `team.archive` |
| Delete task | Lease-free task delete action | confirmation and Host actor proof | same Team detail | deleted tombstone is removed from the visible task list | confirmation stays open with an inline error | selected detail remains | `team.task.delete` |
| Stop task | Assigned/running task stop action | confirmation and Host actor proof | same Team detail | durable cancellation intent and stopping status | confirmation stays open with an inline error | selected detail remains | `team.task.cancel` |
| Inspect Participant | Participant detail action | Session resolution | selected descendant Session | Session transcript opens | inline error; Team selection remains | opened transcript | `team.member.session` |
| Manage members / tasks / channels | Detail action | authenticated Host command | same detail | authoritative projection refresh | draft retained; changed task revisions require explicit review | dialog retains focus until closed | Team management APIs |
| Inspect Channel / audit | Channel button or audit action | bounded read | detail pane | records appear in place | inline error; prior detail remains | selected button retains state | `team.channel.read`, `team.audit.read` |
| Read artifact | Visible provider-backed artifact action | bounded byte read | detail pane | bounded text preview or download action | inline error; prior detail remains | read button retains focus context | `team.artifact.read` |

## Navigation and responsive behavior

- The sidebar selects a Team workspace. Overview, Tasks, Channels, Members, Artifacts and the secondary modules retain their own browsing state; Session inspection remains an explicitly opened descendant.
- Task selection opens a neighboring non-modal inspector. Closing it returns focus to the originating row or the task filter when that row is not loaded. Workflow links to off-page tasks open the inspector without adding a fabricated list row. Session inspection uses the shared dialog and returns to the retained Team view.
- In the 56px rail, the Team control expands the sidebar instead of opening an unlabelled compact list.
- Objective text truncates to one line; its complete value remains available through the native button text and DOM title only when a later product surface needs it.
- The Team workspace remains the main destination; Team state is never inferred by scanning Session rows.
- Workflow lists contain summaries. Opening a plan retains one revision-pinned task/dependency page; navigation keeps its plan ID, failures keep the previous page, and newer revisions require explicit refresh.
- Deep-link restoration waits for a completed connection handshake before issuing Team reads. Connection loss cancels restoration and preserves the URL; reconnection revalidates referenced objects through the Host.
- Lists, channel history and audit retain one page. Next page replaces rows; failure keeps the current page. Team/channel lists offer First page, and inbox paging confirms before discarding typed answers. An off-page selected Team remains visible as one separate sidebar item.

## Async and resilience

- Explicit authentication refusal terminates automatic reconnect and retires each principal projection once. Clearing does not request data. Renewed browser access requires one explicit check; only a successful handshake restarts loading. Different-principal handshakes clear old settings, provider/preset directories and private drafts before restoring reads. Ordinary domain refusals stay local, while temporary network failures retain backoff recovery.

- Team pending totals and previews come from the [pending read projection](.agents/notes/implemented/architecture/2026-09-29-team-pending-read-projection.md), independent of principal inbox acknowledgement. Nonzero totals retain all-pending navigation after preview failure. The pending module pages one revision at a time and keeps readable content on failure; human links open one runtime-owned current request inspection. The dedicated dialog requires an explicit current check before an answer, marks changed/disconnected facts and disables submission, and leaves Session context inspection explicit.
- Human-answer drafts retain only input and retry identity in the bounded registration store. Close, module/Team navigation and reconnect preserve them. Explicit discard confirms; page departure warns. Reload, account replacement and permission withdrawal clear them. Request URLs carry only an opaque action ID, which the Host revalidates. Processed requests remain readable and offer no new answer.

- First Team admission uses the Host's idempotent `team.start` operation. The client keeps a local retry key and rejects changed text after a failed admission until the draft is restarted.
- Team selection reads bounded identity, scalar metadata and aggregate counts. Collections use independent pages; Session inspection starts only through its explicit action. Member Session URLs carry the Participant identity for a bounded ownership check.
- Selection failure is local, retryable, and does not erase a draft or change the current transcript.
- Team list refreshes when a connection is established and on the bounded Team refresh loop. Channel and audit panes use cancellable bounded reads, and stale responses cannot replace a newer selection.
- Artifact reads use an exact durable reference and named provider, allow only non-private visibility, cancel a replaced or unmounted request, and keep provider-less references metadata-only; stale responses cannot replace a newer read.

- Task creation, edit, review and integration drafts have separate Team/operation/task slots in the registration store. Closing and navigation preserve raw fields and creation identity; explicit discard confirms loss. Page departure warns for retained task input, and reload or authorization replacement clears memory-only form drafts. Restored forms await current Host inspection and keep their original revision until explicit current-version review.

- Conflict review uses current runtime task fields and exact dependency references. It compares all three writable task fields, labels unread newer data, preserves the proposed payload and requires explicit current-revision confirmation. Deleted/unavailable references remain selected until explicit removal; stale or failed reference reads block submitting a dependency set.

## Validation

- First input is trimmed before it becomes both Team objective and first human message.
- Image attachments are not accepted for a Team draft until the Team API admits direct-v3 content blocks.
- The resident input machine owns duplicate-submit prevention, IME protection, and draft recovery.

## Migration status

- Current slice: Team-first draft, idempotent first admission, Team sidebar navigation, coordinator-transcript opening, Participant descendant selection, channel WAL inspection, bounded Team audit inspection, and provider-backed visible artifact reads.
- Team objective control: sidebar objective/phase plus the scoped coordinator `/goal` command; the same-Session Goal bar and automatic rounds are not part of Web.
- Non-product Workspace and direct Session APIs remain available to trusted providers and tests; the Web bundle does not mount their navigation path.
- Removal gate: no shipped top-level Session creation or model-visible direct orchestration path remains, as defined by the native multi-agent work-system proposal.

## Verification

- Static: `pnpm exec tsc -b tsconfig.client.json --pretty false`.
- Component and assembled UI: relevant `vitest` suites under `packages/client/ui-team`, `ui-sidebar`, and `ui-conversation`.
- Browser/GIF: a real Host and real model run are required before presenting GUI recording evidence; fixture output is not a substitute. The component tests cover detail interaction and owner failure handling; real browser/GIF evidence remains a release-tier requirement.

## Simulation viewing and administration

The opt-in `ui-simulation` plugin owns the `simulation.workspace` slot. Its navigation opens an authorized bounded run directory and entity, decision, operation, and checkpoint metadata. Deep links wait for the authenticated connection generation. The runtime owns responses and cancels replaced reads; account replacement clears them, while ordinary failures retain readable content. Route state contains opaque identities, submitted search, collection filters and operation sections only. Status/cognition menus reuse the shared Menu; related entity/decision scope is an explicit bounded Host query. Filter changes reset pagination and scroll. Attempts and checkpoint references have independent continuation tied to the observed revision; failure preserves readable content and blocks continuation until refresh. Detail refresh remains available, and cross-module links retain only meaningful selectors. Browsing and reload do not acquire execution ownership or request a model. Administrative actions require their own implemented Host capabilities.

Installed administrative compositions add creation and explicit scheduling. Raw creation input stays in the view store; immutable originals and receipts stay in bounded runtime ownership. Unknown results use explicit original query/retry, never automatic replacement. Changing credentials clears private input and operations; ordinary reconnect preserves them. Closing retains drafts, explicit discard confirms loss, and unresolved original selectors remain recoverable. Reload/leaving protects input and unknown command identities.

Host control hints and budget/model summaries govern costly-start confirmation. Writes recheck native admission. Background refresh preserves valid controls; pause retains separate in-flight cleanup status. Newer control revisions mark metadata counts for explicit refresh. Viewing authorization and administrative permission remain independent. These behaviors derive from the [product APIs](packages/simulation/simulation-product/README.md) and [browser owner](packages/client/ui-simulation/README.md).

Creation-template execution mode comes from the Host catalog; an existing run uses the immutable mode in its retained creation version. Only a confirmed cognition-only run omits automatic-task controls; unavailable reads retain recovery actions. Creation displays cognition-only or automatic scoped Team tasks without changing authority or starting inference. Task-enabled company runs retain exact attempt/input/effect evidence; resumed completed transfers use native continuation acknowledgement rather than repeating world operations. The existing command/draft, costly-start and read-only associated-Team rules remain authoritative.

Entity relationships use independent Host section paging and retain exact historical intervals. Frozen decision contexts retain original projection/version provenance and source references; separate Host grants select plain-text parts or explicit redaction. Text renders as text, unsupported payloads stay withheld, and this view is never named as the complete model request. Readiness, pagination and authorization replacement remain owned by runtime.

Visible Simulation runs hold one bounded authenticated metadata watch. Changed policies clear old context bodies, cancel held source reads and revalidate the selected section while retaining authoring scope, drafts and original commands. Later world revisions mark pages stale without moving their window. Policy-plugin hot reload leaves the directory and browser plugin mounted; hidden/disposed views retire watches, and reconnect requires fresh body verification.

Entity knowledge lists show authorized current records; decision knowledge retains exact original references and versions. Current audience and transitive premise revocation govern both. World changes hide these bodies before revalidation, independently of historical context permission. Original report text requires a separate source grant; plain text previews remain literal and attributed rather than presenting beliefs as world truth.

Request history is a secondary More destination with `simulationModule=requests`. It unifies a durable request with its warm original once, retains off-page originals and separates management/ingress identity families. Unknown creations without a run remain recoverable from the directory. Query never executes; terminal or conflicting journal observations block retry. An explicit capacity marker blocks retry/release when newer reconciliation cannot fit, while preserving original input and lookup.

Simulation Records keeps type filters and exact source sequences in navigation. Runtime owns separate metadata and original-text pages; source links confer no permission. Explicit downloads cover all matching pages at one revision and policy with complete-file byte/page bounds, progress and cancellation. Final revalidation precedes file creation; interruption, revocation or incomplete parts leave no partial download. Policy changes clear retained originals without altering commands or drafts.

Frozen Envelope sources use a URL-stable decision ordinal and a runtime-owned inspector. Location/body paging is explicit; periodic Team authorization checks retain the selected original page and never move focus. Known Team revocation clears text, including possible canonical-parent dependencies, while Simulation policy changes independently retire responses. World progress alone does not reset immutable source text.

Simulation references navigate through the shared layout service to exact Team/task/channel/Session read routes, preserving in-memory drafts and original commands. Browser Back/Forward restores the workspace and Simulation selection. Destination authorization remains independent; historical Session binding mismatch refuses without substituting a new Session. Unmaterialized Session references remain inert.

Persistent Simulation request metadata is discoverable after renewed authentication without restoring private browser input. Queries are read-only; explicit same-original retry uses the Host-retained identity/payload and cannot execute terminal results again. The bounded journal window has an independent revision, retires replaced reads and preserves failed pages. Warm original commands and cold opaque selectors stay in runtime; the UI store receives neither receipts nor recovered body text.
