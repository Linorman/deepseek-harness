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
| Toast | `ui-primitives` / feature owner | shared Toast and feature state | transient toast / retryable inline error | component test |

## Component behavior

| Component | Default | Hover | Focus | Active | Disabled | Busy | Error |
|---|---|---|---|---|---|---|---|
| New Task | local draft only | shared sidebar hover | native visible focus | starts a new draft | n/a | disabled during start | composer preserves input |
| Team row | objective + phase | sidebar row fill | native button focus | opens Team | competing rows disabled | fixed row geometry | inline list error |
| Team rail button | goal icon | circular hover fill | native button focus | expands sidebar | n/a | n/a | n/a |
| Composer | text draft | existing input behavior | resident textarea | submits through Team start | no Team draft is inert | submission phase | retryable notice, draft retained |

## Dataset navigation

- Team list: one bounded initial page; explicit Load more extends the requested range, and refresh preserves that range. Channel records and audit records use the Host continuation cursor.
- Selected-Team member, task, workflow, and artifact lists retain one page each. Next page replaces that window; Refresh rereads its starting cursor; First page returns to the beginning. Failed or cancelled reads retain the prior page. Task inspection and unsent input survive page changes.
- Task lists read browse summaries. The inspector retains one current record, its latest attempt, and one page per attempt/review history. The latest result is independent of history navigation. Module changes preserve these bounded windows; explicit dismissal and Team changes release them. Version changes preserve readable data with a refresh notice and prevent mutations based on stale details.
- Task status filtering uses the shared Menu, with a selected marker and keyboard handling. Search applies to loaded tasks and has an explicit clear action.
- Empty/loading/error treatment: inline text in the fixed Team-list region; opening failure keeps the previous transcript selected.
- Selection: one product-level `TeamId`; the Session selected after resolution is the coordinator transcript descendant.

## Flow ledger

| Operation | Trigger | Pending | Success destination | Success feedback | Failure recovery | Focus outcome | Source ref |
|---|---|---|---|---|---|---|---|
| Start Team task | New Task + first text submit | composer submission | Team coordinator transcript | draft clears after admission | draft and retry key remain | resident textarea follows transcript | `team.start` |
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
- Lists, channel history and audit retain one page. Next page replaces rows; failure keeps the current page. Team/channel lists offer First page, and inbox paging confirms before discarding typed answers. An off-page selected Team remains visible as one separate sidebar item.

## Async and resilience

- First Team admission uses the Host's idempotent `team.start` operation. The client keeps a local retry key and rejects changed text after a failed admission until the draft is restarted.
- Team selection reads bounded identity, scalar metadata and aggregate counts. Collections use independent pages; Session inspection starts only through its explicit action. Member Session URLs carry the Participant identity for a bounded ownership check.
- Selection failure is local, retryable, and does not erase a draft or change the current transcript.
- Team list refreshes when a connection is established and on the bounded Team refresh loop. Channel and audit panes use cancellable bounded reads, and stale responses cannot replace a newer selection.
- Artifact reads use an exact durable reference and named provider, allow only non-private visibility, cancel a replaced or unmounted request, and keep provider-less references metadata-only; stale responses cannot replace a newer read.

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
