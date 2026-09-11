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
| Team detail | `ui-team` | selected `TeamStateSnapshot` plus Team read/control methods | Environment-style upper-right floating popover; hidden, resizable, viewport-clamped | component + API-backed interaction test |
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
- Empty/loading/error treatment: inline text in the fixed Team-list region; opening failure keeps the previous transcript selected.
- Selection: one product-level `TeamId`; the Session selected after resolution is the coordinator transcript descendant.

## Flow ledger

| Operation | Trigger | Pending | Success destination | Success feedback | Failure recovery | Focus outcome | Source ref |
|---|---|---|---|---|---|---|---|
| Start Team task | New Task + first text submit | composer submission | Team coordinator transcript | draft clears after admission | draft and retry key remain | resident textarea follows transcript | `team.start` |
| Open Team | Team row | rows disabled | coordinator transcript | selected row | inline Team-list error | selected transcript retains focus context | `team.get` |
| Edit Team objective | `/goal edit <objective>` in coordinator transcript | command lifecycle | same transcript | durable objective result | command result explains stale or authorization failure | composer remains focused | `command-team-goal` |
| Continue Team transcript | coordinator composer | existing input submission | same transcript | existing conversation feedback | current draft remains | resident textarea | transitional Session bridge |
| Cancel / archive | Team detail or terminal row action | control pending state | Team detail/list | durable Team phase | inline error; retry uses the same Team identity | selected detail remains | `team.cancel`, `team.archive` |
| Delete task | Lease-free task delete action | confirmation and Host actor proof | same Team detail | deleted tombstone is removed from the visible task list | confirmation stays open with an inline error | selected detail remains | `team.task.delete` |
| Stop task | Assigned/running task stop action | confirmation and Host actor proof | same Team detail | durable cancellation intent and stopping status | confirmation stays open with an inline error | selected detail remains | `team.task.cancel` |
| Inspect Participant | Participant detail action | Session resolution | selected descendant Session | Session transcript opens | inline error; Team selection remains | opened transcript | `team.get` + Session projection |
| Manage members / tasks / channels | Detail action | authenticated Host command | same detail | authoritative projection refresh | draft retained; changed task revisions require explicit review | dialog retains focus until closed | Team management APIs |
| Inspect Channel / audit | Channel button or audit action | bounded read | detail pane | records appear in place | inline error; prior detail remains | selected button retains state | `team.channel.read`, `team.audit.read` |
| Read artifact | Visible provider-backed artifact action | bounded byte read | detail pane | bounded text preview or download action | inline error; prior detail remains | read button retains focus context | `team.artifact.read` |

## Navigation and responsive behavior

- The sidebar's Team list is the product navigation region; its selected detail popover exposes durable Team descendants without promoting a Session to a top-level task.
- The selected Team detail opens from a compact upper-right trigger and stays outside sidebar and transcript scroll containers. Display is controlled by the trigger, Escape, and close button; outside pointer events do not dismiss it, so body-portaled confirmations cannot unmount an in-flight Team mutation. The panel starts at a compact size, can be resized from its lower-left grip or keyboard arrows, clamps to the viewport, and can be restored with the reset control.
- In the 56px rail, the Team control expands the sidebar instead of opening an unlabelled compact list.
- Objective text truncates to one line; its complete value remains available through the native button text and DOM title only when a later product surface needs it.
- The transcript remains the center-column destination; Team state is never inferred by scanning Session rows.

## Async and resilience

- First Team admission uses the Host's idempotent `team.start` operation. The client keeps a local retry key and rejects changed text after a failed admission until the draft is restarted.
- Team selection resolves durable Team state, refreshes the Session projection, then opens the returned coordinator Session.
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
