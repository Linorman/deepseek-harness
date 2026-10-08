# Agent Note: Web UI information architecture, visual system, and interaction redesign

Status: proposed

English | [中文](2026-10-02-web-ui-redesign.zh.md)

## Problem

The Web client presents Clocky as a chat app that also has a Team page. The product is the reverse: durable multi-agent Team work is the primary object, and Sessions are drill-downs into one participant. The current UI does not communicate that model, so users cannot see at a glance what a Team is doing, who is blocked, or what needs their decision.

The following findings come from the shipped source under [packages/client](../../../../packages/client/README.md), a live `clocky --profile web` launch, and the end-to-end screenshots in `.artifacts/`.

### Information architecture

- **The empty state is a dead end.** The center hero shows a composer whose placeholder says "Start a new task from the sidebar" and whose send button is disabled. The only real entry point is the sidebar button.
- **Navigation labels drift.** The same concepts appear as "New team work" / "New Task", "Team work" / "Tasks", and "Working folders" / "Workspaces". The sidebar also keeps a legacy `sidebar.workspaces` session tree beside the Team list.
- **The sidebar Team list is cramped.** Rows truncate the objective to a few characters ("Write a fil…"). Status text competes with the title, the close button floats outside the row, and the Inbox button sits alone above the folder header.
- **The coordinator Session is a modal over the Team page.** `SessionStage` opens an 88dvh dialog with three stacked headers: the dialog header, the Session header, and the Chat/Trajectory tabs. "Back to team" wraps onto three lines, and the dialog hides the Team state that the conversation is about.
- **Team page header is the raw prompt.** The h1 is the full objective at 24px over two lines. The breadcrumb shows an internal workspace directory name, and failures render as raw diagnostics such as "coordinator turn ended completed before an explicit final Envelope".
- **The overview reports emptiness at full size.** KPI tiles show `0 / 0`, and the "Task execution" card is about 400px tall with only "No execution tasks". Pending items and members sit in a narrow rail with internal vocabulary ("Allowed to participate", "Execution: Resident").
- **Freshness is manual.** Overview cards expose "Refresh pending preview", "Refresh activity", and "Refresh records". `ui-team` locales have 41 refresh strings, while the runtime already pushes Team changes.
- **Transport failures leak into content.** With an expired product credential, the sidebar prints "transport failure for /api/team.list: HTTP 401" in red, and Settings repeats it under the Agent preset row. There is no reauthentication surface.
- **Chat shows protocol text.** Team-delivered user turns begin with "Direct message from participant-<uuid>:" because [team-agent-client](../../../../packages/team/team-agent-client/README.md) writes that prefix into the model-visible text. Think rows, context-injection rows, and tool rows all have the same visual weight. A telemetry line ("1 turns · 2 steps | LLM 6.7s | TTFT … | Cache hit 98% | Input 15.8K tok …") is always visible under the composer.

### Visual system

- **Two parallel palettes.** `design-platform.css` defines `--clocky-workspace-*` for Team pages and `--clocky-alias-*` for everything else. A `[data-team-workspace-page]` scope remaps aliases, so a Team page and a Session page use different canvas, ink, border, and accent values. The brand accent exists as `#315fcc`, `accent-500` (`rgb(65,118,230)`), and `blue-600`.
- **The sidebar is a separate product.** `[data-clocky-navigation]` keeps graphite navigation in light mode. Against a white canvas, the hard edge makes the app look like two products.
- **Tokens are partly dead weight.** The dark block repeats the static palette verbatim, and names such as `brand-primary-new-colorprimary-new-color` or `accent-700-delete` are export residue. There are no spacing, radius, elevation, or z-index scales.
- **Feature CSS bypasses tokens.** Across 99 CSS Modules: 361 literal `font-size` declarations versus 89 typography-token uses, 442 literal paddings, eight different literal radii (1–999px), and z-index values ranging from 0 to 1100.
- **Typography lacks roles.** Typography tokens are named by size (`xs-13`, `m-18` = 16px). Feature CSS therefore picks pixel sizes instead of roles, which produces the flat hierarchy seen in cards and rows.

### Motion and interaction

- 24 keyframes and 56 transitions use durations from 80ms to 3000ms. 43 use `--ds-ease-in-out` for both entering and leaving. Exits have no distinct curve, and no interaction uses spring-like settle.
- 23 reduced-motion blocks exist, but coverage is per-component rather than system-wide.
- Global keyboard navigation is absent. There is no command palette, no shortcut map, and no list keyboard triage. Only the composer and two dialogs read modifier keys.
- Live agent activity, the product's core differentiator, appears only as a colored dot and a status word.

### Simulation workspace

[ui-simulation](../../../../packages/client/ui-simulation/README.md) presents durable Simulation runs: entities with cognition and writers, slot-ordered decisions at exact simulated times, operations with separate publication and delivery evidence, checkpoints, the native journal, and administrative requests. The findings below come from the source and from the run screenshots that the simulation snapshot suites write under `.tmp-simulation-plan/`.

- **The world is invisible.** Every module is a label/value list or a table. Users cannot see who relates to whom, what happened over simulated time, or how one decision led to effects on other entities. The data partly exists: entity `relationships` carry half-open validity intervals, decisions carry `time`/`slot`/`entityId`, and operations carry publication and delivery stages.
- **The directory is a flat list of unknowns.** Each run row repeats "不可用" for scenario, scheduling, time, and accepted work. Below each row are two disclosures ("运行详情", "技术详情"), and "刷新运行状态" floats above the list as a bare text button. Pagination sits at the far bottom right.
- **Run header facts read as a sentence.** Saved phase, driver progress, simulated time, accepted work, and connection appear as one inline row of small label/value pairs. Start and pause show side by side, with one disabled. The simulated clock prints raw values such as `9007199254740993 minute`, without grouping, locale, or a relative scale.
- **The overview is counters plus disclosures.** Four KPI tiles (entities, token charge, pending decisions, unsettled operations) are followed by collapsed "额度与对象详情" and "主机资源". Budget is shown as `180000 / 1000000` text, with no interval, reservation, or unknown-attempt structure.
- **Human work is buried and technical.** Task review is a lower section whose primary content is `task-8e41…` and `simulation-operation:5c51…` hashes. Task control and unknown-operation retry are separate sections, each with its own refresh button ("刷新审核目标", "核对当前任务").
- **Staleness is a red sentence.** "观察已变化，请刷新首页" and "保留的观察可能已过期，请刷新核对" appear as error-colored text above the tabs. Revision-bound continuations legitimately require explicit refresh, but the presentation makes a routine state look like a failure.
- **Tables do not scale to names or numbers.** Long entity names wrap into ten-line cells. Kinds print raw (`org`, `person`), writer state is a small subtitle, and the inspector's section switches (Identity, Relationships, Knowledge) are unstyled text buttons.
- **Dialogs are plain definition lists.** The start confirmation lists model, per-request reservation, interval budget, resident limit, and host concurrency as indented `dt/dd` text. Creation offers four footer actions of equal weight ("放弃输入", "关闭并保留输入", "检查配置", "创建暂停的运行").
- **Honesty states share one look.** The domain distinguishes unavailable versus zero, unknown outcome, stale observation, withheld content, truncated text, charged versus actual tokens, and publication receipt versus business acceptance. In the UI, all of these render as the same muted text.
- **Simulation is a separate palette.** `.root` consumes `--clocky-workspace-*` directly, and `.reference` uses an undefined `--clocky-alias-text-primary`.

## Proposal

Redesign the Web client in eleven stacked phases. Each phase ships independently, keeps the slot and props discipline in [packages/client/AGENTS.md](../../../../packages/client/AGENTS.md), uses CSS Modules and semantic tokens per [web-styling.md](../../../../docs/web-styling.md), and adds no component library or Tailwind. Product copy stays Chinese-first with the existing English locale. The [development plan](../../../plans/2026-10-02-web-ui-redesign/development-plan.md) owns work packages, ordering, verification, and status, and its [checklist](../../../plans/2026-10-02-web-ui-redesign/checklist.md) tracks per-item completion.

### Design principles

1. **Team first, Session second.** The Team is the page; a Session is a pane inside it.
2. **Attention before inventory.** What needs the user comes first; counts of zero collapse.
3. **Live by default.** Pushed state renders as it changes. Manual refresh is a recovery action in an overflow menu, not a primary control.
4. **Human vocabulary on the surface, protocol detail on demand.** IDs, envelopes, and execution modes move behind a details affordance.
5. **One system.** One palette, one type ramp, one spacing, radius, elevation, and motion scale. Feature CSS consumes roles, never pixel values.
6. **Keyboard-complete.** Every primary flow works without a pointer.
7. **Show how a fact is known.** Unavailable, unknown, stale, withheld, truncated, charged, and receipted are distinct visual states, never a fallback to zero or plain gray text.

### Target information architecture

```text
┌───────────────┬──────────────────────────────────────────────────────────────┐
│ ◎ Clocky   ⌘K │  Folder › Team title                    ● Running  [⋯] [▶]   │
│ [+ New team]  │  Overview  Tasks 4  Channels  Members 3  Artifacts 2  ⋯      │
│               ├──────────────────────────────────────┬───────────────────────┤
│ Inbox      3  │  ⚠ Needs you (2)  approve · answer   │  Conversation pane    │
│               │  ────────────────────────────────    │  (coordinator or      │
│ ▾ ~/repo-a    │  Member lanes (live)                 │  selected member)     │
│   ● Team A    │  coordinator ▮▮▮▯ bash · 12s         │                       │
│   ◐ Team B    │  worker-1    ▮▮▯▯ waiting on review  │  …chat…               │
│ ▾ ~/repo-b    │  ────────────────────────────────    │                       │
│   ✓ Team C    │  Task board  [Board | Graph]         │  [composer]           │
│               │  Activity feed (streaming)           │                       │
│ ⚙ Settings    │                                      │                       │
└───────────────┴──────────────────────────────────────┴───────────────────────┘
```

- **Sidebar** owned by [ui-sidebar](../../../../packages/client/ui-sidebar/README.md) and [ui-team](../../../../packages/client/ui-team/README.md): brand and search trigger; one primary "New team work" action; Inbox with a count badge; Teams grouped by working folder with status glyph, two-line title (derived short title, relative time), and hover actions. The legacy `sidebar.workspaces` tree leaves the product composition. When `simulationProducts` is deployed, a Simulations section lists runs with a phase glyph and the current simulated clock. It uses the same row anatomy as Teams.
- **Page header**: breadcrumb (folder › Team), a short title derived from the objective with the full objective in an expandable block, one status badge, a primary action that changes with phase (Resume, Cancel, Open conversation), and an overflow menu. Raw diagnostics move into a status popover with a human summary and "Copy details".
- **Conversation pane replaces the modal.** [ui-layout](../../../../packages/client/ui-layout/README.md) renders the coordinator or selected member Session in a resizable right pane, using the existing `DragHandle` and concession solver, with "Expand" promoting it to full width. Narrow viewports present it as a full-screen sheet. This removes `SessionStage[data-inspecting]` and the three stacked headers.
- **Empty state becomes a launcher.** The hero composer creates Team work directly. It includes a folder picker chip, a preset chip, and three suggested starters. The disabled placeholder goes away.

### Phase 0: Baseline and guardrails

- Add a deterministic visual baseline: a Playwright spec under `apps/web/tests` captures a fixed state matrix (empty, Team active/stalled/completed, conversation with tools, approval, question, plan review, settings, narrow viewport) in light and dark from replayed sessions.
- Add a lint gate in `scripts/` that rejects literal `font-size`, `border-radius`, `z-index`, durations, and colors in feature `*.module.css`. It starts as an allowlisted ratchet: existing violations are listed per file, and the list may only shrink. This applies the root rule to enforce mechanically checkable rules in executed gates.

### Phase 1: Design foundation (`ui-theme`)

Replace the token layer in [ui-theme](../../../../packages/client/ui-theme/README.md) with role-based scales. Keep `--clocky-alias-*` names that are role-correct, and remove the rest with all consumers in the same change, following the pre-release stance.

| Scale | Proposal |
|---|---|
| Color | One neutral ramp and one accent ramp; remove the `workspace-*`/`navigation-*` palettes and the duplicated dark static block. Roles: `bg/{canvas,surface,raised,sunken,overlay}`, `fg/{primary,secondary,tertiary,disabled,on-accent}`, `border/{subtle,default,strong,focus}`, `accent/{fg,bg,bg-hover,subtle}`. |
| Status | First-class agent states, each with `fg`, `bg`, and `border`: `running`, `waiting`, `needs-you`, `blocked`, `done`, `failed`, `idle`. They are used by badges, lanes, sidebar glyphs, and tool rows. |
| Type | Role ramp: `display 28/36`, `title 20/28`, `heading 16/24 600`, `body 14/22`, `body-reading 15/26` (assistant markdown), `label 13/20 500`, `caption 12/18`, `micro 11/14`, `mono 13/20`, `mono-small 12/18`. Size-named tokens are removed. |
| Space | 4px base: `0,1(4),2(8),3(12),4(16),5(20),6(24),8(32),10(40),12(48)`. |
| Radius | `xs 4`, `sm 6`, `md 8`, `lg 12`, `xl 16`, `full`. |
| Elevation | `0` flat, `1` card hairline, `2` popover, `3` dialog/sheet, `4` toast. In dark mode, elevation raises surface lightness and keeps shadows subtle. |
| Layer | `base 0`, `sticky 10`, `dropdown 100`, `overlay 200`, `modal 300`, `toast 400`, `tooltip 500`. |
| Motion | Durations `instant 80`, `fast 140`, `base 200`, `slow 280`, `deliberate 400`. Easings `standard (0.2,0,0,1)`, `enter (0,0,0,1)`, `exit (0.3,0,1,1)`, and `spring` as a CSS `linear()` approximation for settle. A global `prefers-reduced-motion` block maps every duration token to `0.01ms` except opacity fades. |

The sidebar becomes tonal: one step darker than the canvas in light mode and one step deeper in dark mode. The hard graphite seam goes away. Brand customization keeps working through the same alias overrides.

### Phase 2: Primitives (`ui-primitives`)

Extend [ui-primitives](../../../../packages/client/ui-primitives/README.md) so features compose instead of restyling raw elements:

- `Button` sizes `sm/md/lg` × variants `primary/secondary/ghost/danger`, plus `IconButton` with a required accessible label.
- `Tabs` with underline and segmented styles, count badges, and roving focus.
- `StatusBadge` and `StatusGlyph`, driven by status tokens; running states animate a small progress arc.
- `Card` and `Section` with header, actions, and collapsible empty states. `EmptyState` provides an icon, one sentence, and one action.
- `Skeleton`, `KeyValue`, `Avatar` (participant initials and role tint), `Kbd`, `Popover`, `SplitPane`, and `Sheet`.
- `FactValue`, which renders observed, unavailable, unknown, stale, withheld, and truncated values distinctly, and `SimClock`, which formats exact decimal times without numeric conversion.
- `CommandPalette` shell: a fuzzy list with sections, preview area, and keyboard model. Data comes through slots.

### Phase 3: Shell and navigation

- Implement the sidebar IA above, and unify labels on 团队任务 / Team work, 工作文件夹 / Working folder, and 收件箱 / Inbox.
- Add a `ConnectionBanner` state for `401/403` that explains the expired local credential and how to reopen from the terminal. Sidebar and Settings stop printing transport errors inline.
- Introduce the conversation pane in `ui-layout` and remove the inspecting dialog variant.

### Phase 4: Team "mission control" (`ui-team`)

- **Header** as described in the IA, with tabs showing counts and hiding modules that have no content (`Workflows`, `Audit`) under "More".
- **Needs-you strip**: when non-empty, the top of Overview lists approvals, questions, plan reviews, and blockers with inline primary actions. It replaces the rail "Pending items" card.
- **Member lanes**: one row per participant with avatar, role, status badge, current activity ("bash · 12s", "waiting for review of T-3"), and a segmented bar of recent steps. Clicking opens that member's Session in the conversation pane.
- **Task board**: columns by `TeamTaskSnapshot['phase']`, with a toggle to a dependency graph when [team-scheduler-dag](../../../../packages/team/team-scheduler-dag/README.md) data exists. Cards show subject, assignee avatar, and blockers.
- **Compact KPI line** (done/total, running, tokens, elapsed) in the header row instead of four large tiles.
- **Activity feed** streams pushed records with relative time. Manual refresh moves to the overflow menu as "Reload from server".
- **Vocabulary map**: execution and participation states get human labels plus a tooltip that holds the protocol term.

### Phase 5: Conversation (`ui-conversation`, `ui-tool`, `ui-trajectory`)

- **Reading layout**: 720–760px column, `body-reading` type, and a softer user bubble on `accent/subtle` instead of saturated blue.
- **Sender identity**: Team-delivered turns render an identity chip (avatar, role, name) and hide the protocol prefix. This needs structured sender metadata on the Session event; the model-visible text stays unchanged, per the root rule that model-visible input is reconstructable from the session log. If that metadata is absent, add it as a session event field in the owning Team package first.
- **Process groups**: consecutive think, context, and tool rows fold into one "Worked for 42s · 6 steps" disclosure. While running, it shows a single-line live ticker of the current step. Failed steps keep the group open and use the `failed` status color.
- **Tool rows**: leading status glyph, right-aligned duration, and consistent `diff`/`terminal`/`generic` blocks with header bars (path, language, copy).
- **Message actions** appear on hover and on focus-within, and remain keyboard reachable.
- **Turn metadata**: the telemetry line becomes a per-turn "ⓘ" popover, plus a context ring in the composer ([ContextMeter](../../../../packages/client/ui-conversation/README.md)).
- **Composer**: a status row above the input ("Running bash · 12s", Stop), queued steering messages as removable chips, and model, permission, and preset chips grouped on the left with send on the right.
- **Trajectory**: the step strip becomes a scrubber minimap that is also available in Chat as a collapsible rail. Role chips use the status and role palette instead of uppercase colored text.

### Phase 6: Simulation observatory (`ui-simulation`)

Simulation becomes a peer workspace that shares the shell, header anatomy, tabs, inspector pane, and attention model with Team pages. The goal is to show the simulated world, its time, and its causality while keeping every semantic distinction that [ui-simulation](../../../../packages/client/ui-simulation/README.md) and [simulation-product](../../../../packages/simulation/simulation-product/README.md) define:

- Business data stays in Client runtime.
- Reads stay bounded.
- Revision-bound pages keep explicit refresh.
- No view implies acceptance, delivery, or completion that the domain does not assert.

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ Simulations › Procurement        ⏸ Paused · driver idle    [▸ Start]  [⋯]    │
│ ⏱ 1,240 min   interval ▕████▒▒░░░░▏ 12/100   tokens ▕███▨▨░░░░░▏   ●●○○ slots  │
│ Overview  World  Timeline  Effects  Checkpoints  Journal  Requests           │
├───────────────────────────────────────────────┬──────────────────────────────┤
│ ⚠ Needs you (3)                               │ Inspector                    │
│   Review: Buyer → Supplier, 1 unit, applied   │ Buyer · person · Agent       │
│   Unknown outcome: report post · retry        │ ● resident · writer active   │
│   Scheduler stop: budget limit · extend       │ Identity  Relations  Know.   │
│ ───────────────────────────────────────────── │ ↗ Open actor session         │
│ Timeline  CEO      ●───────◐────────●         │                              │
│ (sim)     Finance      ●──✕─────────●         │                              │
│           Supplier ●────────●──▶────●         │                              │
│                    ┆ckpt              ┆ckpt    │                              │
└───────────────────────────────────────────────┴──────────────────────────────┘
```

**Run header and control strip.**

- **Saved phase vs. driver.** The saved phase (paused, running, stalled, completed) is a badge. The driver observation is a separate indicator that animates only while the driver is observed active. "Running requested, driver not observed" uses a hollow ring, so a persisted running phase never looks like active scheduling.
- **Simulated clock.** A `SimClock` component keeps the exact decimal string. It renders grouped digits and a localized unit ("1,240 分钟"), with the exact value in a tooltip. It never converts through `Number`.
- **Budget meter.** It shows the current interval as one segmented bar with separate segments for known charge, reservation, unknown attempts (hatched), and explicit grants. Interval progress sits beside it. An info affordance states that charged budget is not exact model consumption.
- **Resident slots and host pool.** Resident slots render as a dot row: active, reserved, revoked-awaiting-release (outlined), and free. The Host model pool is a separate chip marked host-wide.
- **Primary action.** One primary button follows the Host start/pause hints. Start opens a launch sheet that shows the model route, per-request reservation, interval budget, resident limit, and host concurrency as cards. A pending action keeps its label with a progress indicator. An unknown outcome offers only query and exact retry.
- **Overflow menu.** It holds checkpoint, recovery, entity input, journal export, and request history.

**Directory.** Rows show name, scenario and version, phase glyph, `SimClock`, a mini budget bar, and a needs-you count. One "unavailable" pill with a reason tooltip replaces the repeated "不可用" cells. Status refresh rides the existing bounded `runStatuses` batch on `controlRefreshMs`, so the manual "刷新运行状态" button goes away. The ID moves to an overflow menu ("Copy ID"). Pagination stays adjacent to the list.

**Overview.**

- **Needs-you strip.** It lists, in priority order, task reviews, task cancellations, unknown external operations, scheduler stops with their recovery action, conflict acknowledgements, budget or capacity extensions, and delivery failures.
- **Human summaries.** Each item has a summary such as "采购方 → 供应方：库存转移 1 件 · 已应用 · 报告已发布（接收方处理另行确认）". Task and operation IDs stay copyable in a disclosure.
- **Pulse row.** It shows the decision and message rate per budget interval as a sparkline, the population gauge, the decision queue (open, submitted, queued, reserved), and effect-pipeline counts.

**World.**

- **Entity list.** It shows a kind icon, a cognition chip (Agent, Deterministic, None), and a residency indicator derived from the writer state (active = resident, released = dormant, reserved/revoked = transitional). The Team binding opens that actor's Session in the conversation pane. Names clamp to two lines and expand in the inspector.
- **Relationship graph.** A graph view draws entities as nodes and relations as edges. Organization scopes form containers, and a time scrubber selects the observed simulation time. It ships first as the selected entity's ego network from the existing per-entity `relationships` section. The whole-run graph waits for the run-level read listed below and caps visible nodes. Above the cap, it clusters by scope and kind and offers the table view as a fallback.

**Timeline.**

- **Lanes and markers.** Swimlanes per entity are virtualized, with simulated time on the x-axis. Decisions render as markers by status: open (hollow), submitted (half), accepted (filled), cancelled (✕, with the reason as a tooltip). Same-time slots stack in slot order. Operations appear as ticks under their decision. Checkpoints are vertical rules, and the current time is a cursor.
- **Causal arrows.** Communication arrows connect sender and recipient lanes, and their stroke encodes the furthest confirmed stage: dashed = accepted, solid = published, filled head = receipted. The arrow never implies business processing.
- **Exact positioning.** Offsets are computed from decimal strings with `BigInt` relative to the window origin, and dense windows switch to bucketed counts.
- **Paging.** Until a time-range filter exists, the timeline renders the loaded decision pages with explicit load-more at its edges.

**Effects.** A pipeline board shows Pending → Applied/Rejected → Published → Input persisted → Receipted, with side lanes for Blocked (authority or dependency) and Outcome unknown. Unknown cards are hatched amber and open the existing exact retry form. Each card shows the kind, entity, decision link, and task reference. A persistent footnote states that a receipt is not business acceptance. The current table remains a view toggle.

**Decision inspector.**

- **Two clocks.** The simulated time and the real inference times display with distinct icons.
- **Context.** Context accounting renders as a stacked bar by section bytes, separating required from optional. The label "本地冻结视图，不是完整模型请求" stays visible.
- **Items and sources.** Context items carry provenance icons, and sources link to their exact Team channel.

**Knowledge.** Cards show the provenance type (observation, delivered report, inference, belief, summary) with distinct icons. Premise links draw a small derivation graph. Each card carries a temporal-visibility badge. Withheld bodies show a lock and the permission they require.

**Checkpoints and recovery.**

- **Checkpoint rail.** A horizontal rail shows checkpoint status: in progress, failed (with diagnostic stage and code chips), or completed (with `publishedAt`). The latest successful checkpoint is highlighted.
- **Restore.** Restore is a stepper sheet: choose a checkpoint, review the paged Run/Team/Channel/Session references, then confirm. The consequences are stated: writers retire, the owner stays paused, and nothing replays.

**Journal.** A virtualized log uses family-colored kind chips (run, business, scheduler, outbox) and a sequence column labeled "序号（非时间）". Original JSON uses `JsonTree` when the reader holds historical-content permission. Export runs as a background job: a progress bar against `maxExportPages`, a visible final validation step, and cancel.

**Creation.** A two-pane wizard puts steps on the left (template → participants and stock → limits → check) and a live summary card on the right. Preflight issues attach inline to their fields. The footer keeps "检查配置" and the primary "创建暂停的运行". Discard versus keep-input becomes the close behavior, with confirmation. A banner states that the run is created paused and requests no model.

**Staleness and honesty states.** A shared `FactValue` primitive, added in Phase 2, renders these states:

- observed
- unavailable: dashed outline "—" with a reason
- unknown: hatched amber "?"
- stale: dimmed, with a clock
- withheld: lock
- truncated: fade and expand

A revision change shows a neutral "有更新 · 刷新 (R)" pill at the top of the affected module instead of a red sentence. Red is reserved for actual failures. Team pages use the same primitive.

**Team bridge.**

- **Simulation-managed Teams.** A banner states which Simulation manages the Team, with a link back.
- **Bidirectional links.** Entity and participant pages link to each other.
- **Actor Sessions.** A Session opened from an actor carries a "Simulation actor" chip. Its `simulation_observe` / `simulation_stage` / `simulation_submit` tool rows show staged, submitted, or accepted proposal chips.

**Scale.** Tables, lanes, and the journal virtualize. Timeline and graph marks switch from SVG to canvas above about 500 marks. Every view reads bounded pages and never issues per-row inspection reads. This preserves the request-count assertions in `apps/web/tests/simulation-workspace.snapshot.ts` and the reading-scale suite.

**Data dependencies.** These views need new bounded product reads in `simulation-product` and `client/runtime`. Each follows the existing authorization, `maxPageSize`/`maxBytes`, and revision-bound cursor rules, and the UI never derives them by scanning pages:

1. A run-level relations page at a given simulated time and scope, for the whole-run graph.
2. A simulated-time range filter on decision browsing, for timeline scrolling.
3. The target entity on communication and transfer operation summaries, for causal arrows.
4. Per-interval aggregate series (decisions, messages, charged tokens), for sparklines.
5. Per-entity resource balances. This one requires its own authorization decision because balances may be private, so it stays deferred, and no resource ledger view ships until it lands.

### Phase 7: Attention and global interactions

- **Inbox** (`ui-team` attention, `ui-user-questions`, and `ui-simulation`): one queue across Teams and Simulation runs for approvals, questions, plan reviews, blockers, simulation task reviews and cancellations, unknown external operations, and scheduler stops. Simulation items keep their exact original-command and current-fence semantics; the Inbox opens their existing forms rather than issuing new commands. It supports `J`/`K` navigation, `Enter` to open, `A` to approve, `R` to reject or skip, and an optimistic toast with undo where the backend action allows it.
- **Command palette** (`⌘K` / `Ctrl+K`): jump to a Team, member Session, Simulation run, entity, or setting; run slash commands from [ui-commands](../../../../packages/client/ui-commands/README.md); and create Team work. Results come from slot-registered providers, so feature packages contribute without new cross-feature exports.
- **Hover previews** for task, member, and artifact references use the existing `HoverCard`.
- **Shortcut overlay** (`?`) lists registered shortcuts. Shortcuts register through one shell service so conflicts are detected at registration.

### Phase 8: Motion specification

| Interaction | Spec |
|---|---|
| Pane open/close, sidebar collapse | `slow` + `standard`; content crossfade `fast`; never during drag. |
| Popover/menu enter / exit | scale 0.97→1 + fade, `fast` + `enter`; exit `instant` + `exit`; origin at trigger. |
| Dialog/sheet | translateY 8px + fade, `base` + `enter`; backdrop fade `base`. |
| Status change (badge, lane) | color cross-fade `base`; `needs-you` pulses once (not looping). |
| Running indicator | 1.2s linear arc rotation; paused when off-screen or tab hidden; static under reduced motion. |
| List insert (activity, Inbox) | height auto via `grid-template-rows 0fr→1fr` + fade, `base` + `spring`; removal `fast` + `exit`. |
| Process group live ticker | text swap with 4px slide + fade, `fast`; throttled to ≤4 updates/s. |
| Tab switch | underline indicator slides `base` + `spring`; content fade `fast`; no layout shift. |
| Toast | slide-in from bottom-right `base` + `spring`; auto-dismiss 5s, paused on hover/focus. |

Only `transform` and `opacity` animate, except the explicit grid-row height pattern.

### Phase 9: Secondary surfaces

Apply the primitives to Settings ([ui-settings-general](../../../../packages/client/ui-settings-general/README.md), models, plugins, presets), Team dialogs (`TeamTaskDialog`, `TeamManagementDialog`), onboarding, and the directory pickers. Forms get a consistent field anatomy (label, control, help, error) and a sticky footer.

### Phase 10: Quality pass

Run a contrast audit (body text ≥ 4.5:1, UI glyphs ≥ 3:1 in both themes). Check that targets are ≥ 24px, that focus rings are visible on every control, that reduced motion applies, and that zh and en string lengths fit at 1280px and 768px. Narrow viewports get the sheet-based conversation and a drawer sidebar.

### Delivery plan

Each phase is one or more PRs in a native GitHub stack, ordered 0 → 10. Phases 4–7 can parallelize after Phase 3 because they touch disjoint packages.

| Phase | Packages | Gate evidence |
|---|---|---|
| 0 | `apps/web/tests`, `scripts/` | baseline captured; ratchet gate in `pnpm run lint` |
| 1 | `ui-theme`, all CSS consumers | ratchet shrinks; light/dark baseline diff reviewed |
| 2 | `ui-primitives` | jsdom component tests for each primitive |
| 3 | `ui-sidebar`, `ui-layout`, `ui-team`, `connection` | e2e: navigation, pane open/expand, 401 banner |
| 4 | `ui-team`, `client/runtime` (read models only) | e2e: lanes, board, needs-you actions |
| 5 | `ui-conversation`, `ui-tool`, `ui-trajectory`, Team sender metadata | `CLOCKY_SNAPSHOT=replay pnpm run test:web`; snapshot for any event change |
| 6 | `ui-simulation`, `client/runtime`, `simulation-product` (new bounded reads only) | simulation e2e suites under `apps/web/tests` in json and sqlite; honesty-state component tests |
| 7 | `ui-commands`, `ui-team`, `ui-user-questions`, `ui-simulation`, shell shortcut service | e2e keyboard-only triage |
| 8 | `ui-theme`, touched components | reduced-motion e2e; GIF per PR |
| 9–10 | settings, dialogs, onboarding | baseline diff; accessibility checklist |

Every GUI PR attaches a GIF recorded from the real server flow, as the `record-browser-gif` skill requires. Each phase updates affected package READMEs and [web-styling.md](../../../../docs/web-styling.md). Phase 1 also records the token decision in an implemented note and updates the [styling-system note](../../implemented/process/2026-07-19-web-styling-system.md).

## Alternatives considered

**Adopt a component library or Tailwind.** This would be faster to start, but [packages/client/AGENTS.md](../../../../packages/client/AGENTS.md) forbids both. The slot model already gives per-feature isolation, and the missing piece is a token and primitive layer, not a framework.

**Restyle in place without changing the IA.** New colors and type alone would leave the modal Session, the empty-first overview, and manual refresh, which are the main density and hierarchy problems.

**Keep the coordinator Session as a modal but make it larger.** The modal still hides the Team state that the conversation is about, and it stacks headers. A side pane keeps both visible and reuses the existing column solver.

**Keep the graphite sidebar.** It gives strong brand contrast, but it fragments the surface in light mode and duplicates a full palette. A tonal sidebar still allows brand overrides through aliases.

**Big-bang rewrite in one branch.** It would avoid intermediate visual mixing, but it conflicts with the stacked-PR policy, makes review impractical, and blocks unrelated client work for weeks.

**Fold Simulation into Team pages.** Simulation runs have their own authority, journal, and lifecycle, and they can exist without a bound Team. Embedding them would mix two permission models in one surface. Linking entities and managed Teams in both directions keeps each owner clear.

**Generic dashboard charts for Simulation.** A grid of line charts over counters would be easy to add, but it would hide the distinctions the domain depends on (charged versus actual, receipt versus acceptance, unavailable versus zero). The timeline, effect pipeline, and `FactValue` encode those distinctions directly. Graph layout may still use a maintained layout-only dependency, such as a force or layered layout package, declared under [verify-client-packages](../../../../scripts/verify-client-packages.ts); it is not a component library.

## Acceptance criteria

- One palette and one set of role scales. Feature CSS Modules contain no literal colors, font sizes, radii, z-indexes, or durations outside the ratchet allowlist, and the allowlist is empty at Phase 10.
- A first-time user can create Team work from the empty state without the sidebar.
- On a Team page at 1440×900, the user sees, above the fold and without scrolling: Team status, every pending human action, each member's current activity, and task progress.
- Opening the coordinator or a member conversation keeps the Team page visible at ≥ 1280px width.
- No manual refresh control is required to see pushed Team changes. Reload remains available in an overflow menu.
- No raw transport error or protocol ID appears in primary content. Protocol detail stays reachable through a details affordance.
- Inbox triage, palette navigation, and Team creation work keyboard-only, and the shortcut overlay lists them.
- On a Simulation run at 1440×900, the user sees, above the fold: saved phase, driver observation, simulated clock, interval budget structure, resident slots, and every pending human action with a human-readable summary.
- Every Simulation honesty state renders through `FactValue`. No unavailable count renders as `0`, and no stale or revision-change notice uses error styling.
- World, Timeline, and Effects views render a run at the benchmark scale of 1000 entities using bounded pages, with no per-row inspection reads, and the existing simulation snapshot suites pass in json and sqlite.
- Light and dark modes pass the contrast checks. Reduced motion removes all non-opacity motion.
- `pnpm run typecheck`, `pnpm run lint`, focused `pnpm run test`, and `CLOCKY_SNAPSHOT=replay pnpm run test:web` pass for each phase.

## Risks

- **Token migration touches every client package.** Phase 1 has the largest blast radius. The ratchet gate and visual baseline keep regressions reviewable, and the pre-release stance permits removing old names without shims.
- **Sender identity may require a session event change.** If Team sender metadata is not already in the Session log, Phase 5 depends on a Team package event change, its SDK owners, and a runnable-example snapshot.
- **Live lanes can be expensive.** Member lanes need per-participant current-activity reads. They must use pushed projections with bounded windows rather than polling, and `client/runtime` may need a new read model.
- **Keyboard shortcuts can conflict** with browser, IME, and composer bindings. Registration-time conflict detection and IME-composition guards are required.
- **New Simulation reads widen the product surface.** Run-level relations, time-range filters, operation targets, and interval series each need authorization, byte bounds, cursor binding, and Host tests in `simulation-product` before any UI uses them.
- **Visual metaphors can overclaim.** An arrow, a filled marker, or a green column can imply delivery or completion that the journal does not assert. Each Simulation encoding maps to one named domain state, and component tests assert that mapping.
- **Exact simulated time resists charting.** Times are arbitrary-precision decimals. Axis math must stay in `BigInt` and string space, and must handle windows whose span exceeds `Number` precision.
- **Capabilities given up:** the graphite-sidebar brand look, the legacy workspace session tree in the product composition, and size-named typography tokens.
