# Agent Note: Swarm and world visual layer for Team and Simulation

Status: proposed

English | [中文](2026-10-04-swarm-and-world-visual-layer.zh.md)

## Problem

The [Web UI redesign](2026-10-02-web-ui-redesign.md) delivered the information architecture, role tokens, primitives, honesty states, conversation pane and command palette. Its result is an operational console. It does not make the product's two differentiators the first thing a user sees: a swarm of agents that finishes work faster by running in parallel, and a simulated organization that operates over simulated time.

The following findings come from the source under [packages/client](../../../../packages/client/README.md) after the redesign:

- **Parallelism has no picture.** The Team overview reports parallel work as one KPI number. [TaskBoard](../../../../packages/client/ui-team/src/client/TaskBoard.tsx) shows at most four cards per column. Dependencies appear as a `dependencyCount` chip or as "depends on" text in the workflow view. Nothing shows how many agents run at once, how work fans out along dependencies, or how throughput changes over time.
- **The swarm structure is a list.** Coordinator, workers, reviewers, channel membership, task ownership and child Teams all render as rows. Users cannot see who works with whom.
- **The two modes look identical.** Team and Simulation are two same-style sidebar buttons over one neutral canvas. Nothing signals which mode is active, or that Simulation models organizations at different scales.
- **Motion stops at controls.** The redesign's motion table covers popovers, dialogs, toasts and list inserts. No motion connects a live data change across views, such as a task changing phase, a message being delivered or a Team completing. Pushed state is visible only as changed text.
- **The specified visualizations did not ship.** The redesign specified a Team dependency graph, member current activity, the Simulation World, Timeline, Effects and checkpoint rail, and reads R1–R4. None of them exists in the source. Building each inside its feature package would duplicate layout, hit-testing, viewport, keyboard traversal, canvas switching and reduced-motion handling.

## Proposal

Add an expressive layer on top of the delivered redesign, and take over the visualizations the redesign specified but did not ship. This note changes none of the redesign's information architecture, honesty encodings or Simulation encodings. It implements the carried-over views with those encodings unchanged, and it owns how every view renders and moves, plus the new Team views listed below. The [development plan](../../../plans/2026-10-04-swarm-and-world-visual-layer/development-plan.md) owns work packages, ordering and status, and its [checklist](../../../plans/2026-10-04-swarm-and-world-visual-layer/checklist.md) tracks completion.

### Ownership split

| Concern | Owner |
|---|---|
| Sidebar, conversation pane, launcher composer, command palette | Delivered by the 2026-10-02 redesign |
| Role tokens, primitives, `FactValue`, `SimClock` | Delivered by the 2026-10-02 redesign |
| Control-level motion (popover, dialog, toast, list insert, tab indicator) | Delivered by the 2026-10-02 redesign |
| Meaning of Simulation World, Timeline, Effects and checkpoint marks | Specified by the 2026-10-02 redesign; implemented here unchanged |
| Simulation reads R1–R4 (R5 stays deferred) | Specified by the 2026-10-02 redesign; implemented here |
| Mode identity, ambient backdrop and expressive tokens | This note |
| `ui-viz`, the rendering engine that every graph and timeline uses | This note |
| Mission banner, swarm topology, task flow graph and agent swimlane | This note |
| Data-driven motion tiers and milestone moments | This note |
| Team reads T1–T4 | This note |

### Design principles

1. **The swarm and the world are the first image.** Each mode's overview leads with one live visualization driven by real data. Tables move one toggle away.
2. **Spectacle never overclaims.** Visualizations carry the honesty states of the 2026-10-02 redesign. They show loaded versus total counts, ghost nodes for off-page references, desaturation for stale observations and dashed slots for unavailable values. Each visual encoding maps to one named domain state, and a component test asserts that mapping.
3. **Only observed live deltas animate.** Initial hydration, reload, replay and navigation render the settled state silently. A historical change is never performed as if it were happening now.
4. **Motion has tiers and caps.** Each tier has a frequency, a duration and a concurrency limit.
5. **Every visualization has an equivalent.** A list or table view shows the same items, and keyboard traversal reaches every node.

### Visual direction and tokens

Design review starts from the dark theme and requires light-theme parity. The canvas carries a faint dot grid that reads as the coordinate space of the graphs. Floating panels use a glass material, live states use a glow, and metrics use tabular monospace numerals.

[ui-theme](../../../../packages/client/ui-theme/README.md) adds these token families, each with light and dark values:

| Family | Tokens | Use |
|---|---|---|
| Mode identity | `--clocky-mode-{team,simulation}-{fg,bg,subtle,glow,gradient}` | Team uses an electric cyan to cobalt ramp; Simulation uses a violet to magenta ramp. Used only on chrome (backdrop, mode switch, header glow), never on a mark that carries state. |
| Glow | `--clocky-glow-{running,needs-you,failed,done}` | Box-shadow composites derived from the status roles |
| Material | `--clocky-surface-glass`, `--clocky-blur-glass` | Floating panels and overlays |
| Visualization | `--clocky-viz-{grid,edge,edge-active,edge-ghost,node-ring,halo}` | Graph grid, edges, ghost references |
| Type | `--clocky-type-hero` (40/48/600), `--clocky-type-metric` (32/36 mono) | Banner numbers and gauges |
| Motion | `--clocky-duration-{orbit,flow,celebrate,drift}`, `--clocky-ease-emphasized`, `--clocky-stagger-step` | Mode-tile orbit, message particles, moments, ambient field drift, staggered entrances |
| Ambient | `--clocky-ambient-{terrain,pulse}-opacity` | Ambient field terrain layer and observation pulse peak |

The Simulation identity ramp must stay distinguishable from the `waiting` status role. A token test measures contrast and hue distance in both themes.

### Motion tiers

| Tier | Examples | Timing | Cap | Reduced motion |
|---|---|---|---|---|
| L0 ambient | Ambient field: terrain drift, air-mass breathing, one observation pulse | Drift period of 60s or more, at most 24px translation; terrain opacity at most 0.10 dark and 0.05 light | One per screen; visible only in whitespace; paused while hidden, off-screen, behind a modal, after 60s without input or when the user turns it off | Static |
| L1 live signal | Running-node halo, channel message particles, running-card sweep | Particle flight about 1.2s | 24 concurrent particles; the excess merges into one "+N" pulse | One opacity flash |
| L2 state transition | Board card moving between columns, node phase change, odometer, progress ring | 200–400ms with `spring` | One choreography at a time; interruptible | Immediate change |
| L3 moment | Assemble, converge, ignite, seal, stall | At most 1.2s, once | Only on a live observed transition; any input skips it | Fade only |

Constraints:

- Only `transform` and `opacity` animate. Particles follow curved edges through WAAPI keyframes that sample the path into `translate` steps.
- Edge draw-in needs SVG `stroke-dashoffset`. [web-styling.md](../../../../docs/web-styling.md) gains one narrow exception for SVG edges inside `ui-viz`, and `verify-client-style-tokens` allowlists only that package.
- React renders on data changes only. Per-frame work goes through refs and WAAPI.
- The redesign's rules stay in force: `needs-you` pulses once rather than looping, running indicators are static under reduced motion, and dialogs and menus keep their in-place fade.
- L0 carries no state. Its only data-driven element is one pulse ring on a live observed simulated-time advance, seal or ignite; triggers within 1.2s merge and nothing replays, so the field never suggests time flowing between observations. Opaque working surfaces hide it, so it shows only in whitespace. A user setting (follow system, on, off) satisfies WCAG 2.2.2; higher-contrast preference and print remove the field.

### `ui-viz` package

`@clocky/clocky-client-ui-viz` is a presentational package with no Cordis context and no services. Feature packages pass it view models through props.

- **Layout functions** are pure and deterministic. `layoutLayered` uses longest-path layering with barycenter crossing reduction. `layoutRadialSwarm` uses a seeded `d3-force` simulation that stops when settled and places new nodes incrementally. `layoutLanes` takes an injected position function, so Simulation callers keep exact decimal time in `BigInt` space.
- **Rendering** uses SVG up to about 500 marks and canvas above that, matching the threshold in the 2026-10-02 redesign. Hit-testing and focus stay identical across both.
- **Interaction** provides spatial roving focus across nodes, an accessible description builder and a list-view contract that every visualization must satisfy.
- **Primitives** are `Odometer`, `RadialProgress`, `Sparkline`, `PulseHalo`, `FlowParticles` and `AmbientField`, which supersedes the static `AmbientBackdrop`.
- **Performance** work pauses while the document is hidden or the element is off-screen.

`d3-force` is the only new runtime dependency, following [dependencies over hand-rolling](../../implemented/process/2026-07-26-dependencies-over-hand-rolling.md) and declared under [verify-client-packages](../../../../scripts/verify-client-packages.ts). Layered layout stays in-house because bounded windows keep graphs small.

### Team views

```text
┌ Mission banner ──────────────────────────────────────────────────────────┐
│ folder › short title  ● Active   [Open coordinator] [⋯]                 │
│ ◔ 12/20 done   ⚡ 5 running   ↗ throughput   ⏱ 01:24:10   Σ 1.2M tokens │
│ Overview · Tasks · Channels · Members · Artifacts · More▾               │
├───────────────────────────────────────────────┬──────────────────────────┤
│ Swarm topology        [Topology|Flow|Lanes|List] │ ⚑ Needs you            │
│   coordinator at center, workers in orbit      │ Live feed              │
│   message particles along channel edges        │                        │
├───────────────────────────────────────────────┴──────────────────────────┤
│ Task board (FLIP column moves)   │ Agent pods (state ring, current task) │
└──────────────────────────────────────────────────────────────────────────┘
```

- **Mission banner.** It extends the header KPI line from [ui-team](../../../../packages/client/ui-team/README.md). A progress ring is segmented by phase from the authoritative task counts. "Running now" counts assigned and running tasks. Elapsed time starts at the Team's `createdAt`. Tokens use an odometer. The throughput sparkline needs T3, and until T3 lands it is absent rather than estimated.
- **Swarm topology.** Nodes are loaded participants. Child Teams referenced by loaded tasks form clusters. Edges come from loaded task ownership and review and from loaded channel membership. Node state comes from member readiness, and T1 adds the current activity label. Particles fly only for channels whose live read the user has open; other Team journal advances pulse the affected node. The view shows loaded versus total members.
- **Task flow graph.** This realizes the redesign's board/graph toggle. It draws a workflow plan from its bounded `blockedBy` window and the selected task's dependency neighborhood from the existing dependency read. Off-page dependencies render as ghost nodes. The critical path appears only when the whole graph is loaded. A Team-wide graph waits for T2.
- **Agent swimlane.** Each participant gets a lane, with one bar per task attempt spanning `assignedAt`, `startedAt` and `settledAt` from `TaskAttemptSnapshot`. It needs T3, because task-detail reads per row are not allowed. Until then, each lane shows only the T1 current activity. A parallel-speedup figure (summed attempt time over wall-clock span) appears only when T3 covers the whole window.
- **Board and feed.** Cards move between columns with FLIP and counts use odometers. Feed entries enter with a stagger, and bursts merge into one entry.
- **Agent pods.** Member lanes gain a state ring around the avatar, the T1 current activity and stale dimming.

### Simulation views

`ui-viz` implements the World, Timeline, Effects and checkpoint rail that the 2026-10-02 redesign specifies, using its encodings unchanged, together with reads R1–R4 under its read rules. Until R1 and R2 land, the World and Timeline ship in the bounded fallback forms the redesign defines. This note adds:

- **Run console.** Start plays an ignition sequence that hands off to the driver state ring. The ring animates only while the driver is observed active, as the redesign requires.
- **Seat map.** Resident slots become a grid with active, reserved, awaiting-release and free states.
- **Entity constellation.** Before R1 provides run-level relations, the World view clusters loaded entities by kind and gives agent-cognition entities a glow. Decisions observed live at the current simulated time ripple their entity.
- **Scale preview.** Creation previews the organization size from the installed template limits.
- **Ambient field.** `AmbientField` replaces the static backdrop behind Simulation workspaces. Over the existing dot grid it adds a run-seeded contour terrain generated once as a deterministic SVG and the two mode glows, both drifting slowly, plus the observation pulse anchored on the overview clock. A paused or idle run mutes the tone that ignite warms. Directory and empty-authoring views use a fixed-seed star map. The [World UI refinement](../../../plans/2026-10-11-world-simulation-completion/ui-refinement.md) owns placement and masking.

### Shell

- [ui-sidebar](../../../../packages/client/ui-sidebar/README.md) renders one segmented mode switch with a sliding indicator when both workspaces register navigation. Switching mode retints the ambient backdrop. Deployments without Simulation keep today's single entry.
- Two mode cards sit above the redesign's launcher composer. Each card shows a miniature live preview and the most recent Team or run.

### Moments

| Moment | Trigger | Choreography |
|---|---|---|
| Assemble | New Team observed live while participants join | Coordinator scales in at center; workers stagger out into orbit; channel edges draw in |
| Converge | Team phase becomes `completed` live | Nodes drift toward the final artifact node; the result card reveals |
| Ignite | Start accepted for a Simulation run | Start control becomes the driver ring; the clock odometer begins; the world warms from muted to full tone |
| Seal | Checkpoint completes or fails live | A marker drops onto the timeline; a failure cracks the marker and links its diagnostic |
| Stall | Team phase becomes `stalled` live | Banner gains the needs-you glow; the needs-you strip pulses once |

### Team reads

Each read follows the R-read rules of the 2026-10-02 redesign: authorization, `maxPageSize` and `maxBytes`, revision-bound cursors, rejection-path tests, and bilingual README updates. None of them adds a session event or changes model-visible input.

1. **T1 member current activity.** A pushed, bounded read model of each participant's current activity, which the redesign specified for member lanes.
2. **T2 task dependency page.** Bounded dependency edges between a Team's tasks, for the Team-wide flow graph.
3. **T3 execution timeline.** Bounded attempt intervals per participant and per-interval completion counts, for the swimlane, the throughput sparkline and the speedup figure.
4. **T4 channel traffic.** Per-interval message counts per channel, for edge weight when no live channel read is open.

## Alternatives considered

**Reopen the 2026-10-02 redesign.** That work is complete. Reopening it to add an expressive layer and its unshipped views would mix delivered and new scope and blur its acceptance criteria. A separate note with an explicit ownership table keeps each scope reviewable.

**Build each visualization inside its feature package.** This avoids a new package but duplicates layout, focus, canvas switching and reduced-motion handling across at least five views.

**Adopt a graph or chart library such as React Flow, Cytoscape or ECharts.** [Client rules](../../../../packages/client/AGENTS.md) forbid component libraries, and these libraries bring their own styling. Only layout is missing, and `d3-force` supplies it.

**Use elkjs for layered layout.** It is about 1.4 MB. Bounded windows keep task graphs small enough for longest-path layering with barycenter ordering.

**Render a 3D swarm with WebGL.** It would be the most spectacular option, but it hurts readability, accessibility and low-end performance.

**Replay history as animation on load.** This would make every visit lively, but it would misstate when events happened and contradict the live-delta principle.

**Light-first design.** Monitoring sessions are long and glow reads poorly on white. Light parity remains a requirement.

## Acceptance criteria

- At 1440×900 without scrolling, the Team overview shows the mission banner, the swarm topology with every loaded participant and its state, and the needs-you strip. The Simulation overview shows the run console with clock, budget, seat map and the world view.
- Every visualization has a list or table view with the same items and full keyboard traversal, covered by jsdom tests.
- No visualization shows an unloaded item as absent. Loaded versus total counts are visible, and off-page references render as ghost nodes.
- After load and reload, no L2 or L3 animation is running (e2e).
- Under reduced motion, no non-opacity motion runs (e2e).
- The ambient field shows only in whitespace, keeps terrain lines no stronger than the dot grid (`--clocky-viz-grid`) against the canvas in both themes, pulses only on live observations, and does no animation work while paused, idle, hidden, behind a modal or turned off.
- A performance test with 150 nodes and 24 particles keeps the 95th-percentile frame time within 18 ms, and a hidden tab performs no animation work.
- `verify-client-style-tokens` passes with only the documented `stroke-dashoffset` exception, and mode identity tokens never appear on state marks.
- Mode identity tokens meet the contrast checks in both themes.
- Speedup and throughput render only from T3 data, never from estimates.
- `pnpm run typecheck`, `pnpm run lint`, focused `pnpm run test` and `CLOCKY_SNAPSHOT=replay pnpm run test:web` pass, and each GUI PR attaches a GIF recorded from a real server flow.

## Risks

- **Visuals can overclaim.** A line, a filled node or a convergence animation can imply completeness or causality that the data does not assert. The mapping tests and loaded/total labels are the guard.
- **Motion fatigue.** Long monitoring sessions magnify ambient and signal motion. The tier caps, the live-delta rule, the 60s idle freeze and the ambient off setting are the guard.
- **Bundle size.** `d3-force` and the visualization code load on every overview unless the client module system defers them.
- **Layout jitter.** Force layout can shuffle nodes when data changes. Seeded layout, settled positions and incremental placement are required.
- **New reads widen the product surface.** T1–T4 and R1–R4 need Host tests and authorization review before any view depends on them.
- **Carried-over scope.** The World graph and continuous Timeline depend on R1 and R2 in `simulation-product`. Until those reads land, the views stay in their bounded fallback forms.
- **Dark-first review can neglect light mode.** The visual baseline captures both themes for every new view.
- **Capabilities given up:** the list-first overview. Lists remain one toggle away.
