# @clocky/clocky-client-ui-viz

English | [中文](README.zh.md)

Presentational visualization layer for the Team and Simulation workspaces: deterministic layout functions, an SVG/canvas graph renderer, a lane renderer, the list-view contract every visualization satisfies, numeric primitives, and the tiered live-motion helpers. The package has no Cordis context and no services; feature packages build view models from their runtime data and pass them through props. It ships as a shared browser platform module beside [ui-primitives](../ui-primitives/README.md), so every feature bundle resolves the same instance.

## Layout

All layout functions are pure: equal input yields byte-identical coordinates, rounded to two decimals.

- `layoutLayered(nodeIds, edges, options)` places a directed graph in layers by longest path and orders each layer by barycenter sweeps. Edges that close a cycle are returned as `backEdges` instead of looping. `longestChain` returns the heaviest chain, which callers draw as the critical path only when the whole graph is loaded.
- `layoutRadialSwarm({ nodes, links, seed, previous })` settles a seeded `d3-force` simulation around a fixed center: ring 0 is the center, larger rings sit further out, and nodes that share a `cluster` gather around one anchor. The simulation stops as soon as it cools below its settle threshold. Positions passed in `previous` stay pinned, so a node joining the swarm moves nothing the user has already located.
- `layoutLanes({ lanes, items, position })` places items in lanes and stacks overlaps into rows. The caller injects the time-to-x function. `decimalTimeScale(origin, end, width)` maps exact decimal time strings through `BigInt`, so Simulation times beyond 2^53 keep pixel-exact positions.

## Rendering and interaction

`GraphView` draws SVG up to `markThreshold` marks (500 by default) and canvas above it. Pointer hit-testing (`hitTest`) and keyboard focus run against the same layout-space marks in both modes: each node has one focus proxy button, arrow keys move by `nextSpatialFocus`, Home/End follow reading order, and Enter or Space activates. Pan is a pointer drag on empty space; zoom uses the controls, `+`/`-`, or a modified wheel so ordinary page scrolling keeps working. The view refits while the user has not moved it.

Every visual encoding names one domain fact: `data-state` maps to one status role, `ghost` draws an off-page reference as a dashed outline, `stale` desaturates an observation older than its owner's cursor, `emphasis` marks a highlighted path, and `glow` is a static identity halo. `VizListView` renders the same items with the same loaded/total statement, and `describeVisualization` builds the one-sentence accessible summary. `LaneView` draws lanes, bars, point markers, vertical rules, causal arrows, and a now cursor with the same spatial keyboard traversal. `ModeTile` is the launch-screen workspace tile, with `SwarmGlyph` (loaded items orbiting a hub in their states) and `ConstellationGlyph` (loaded items placed by id, with no lines, so no relation is implied) as its previews. `ViewSwitch` is the segmented control that switches between equivalent views, and `useSlidingIndicator` lets a host track its own active option the same way.

## Motion

Motion follows the four tiers in [web-styling.md](../../../docs/web-styling.md), and elements carry `data-motion-tier` while they animate.

- **L0** — `AmbientBackdrop` draws static mode-tinted glows without animation or visibility subscriptions. Empty and settled glyph rings do not orbit; directory constellations remain static.
- **L1** — `GraphView` `signals` fly particles along edges with WAAPI `translate` keyframes sampled from the edge curve, or ring a node once. At most `MAX_PARTICLES` (24) fly at once; the excess merges into one "+N" pulse. Hidden or off-screen frames drop signals instead of queueing them, and reduced motion replaces a flight with one opacity flash.
- **L2** — `Odometer`, `RadialProgress`, `ViewSwitch`, and `GraphView` `changedIds` animate only when the owner marks the change live.
- **L3** — `Moment` performs assemble, converge, ignite, seal, and stall once per `generation` increment, within `--clocky-duration-celebrate`, and any pointer or key input finishes it. `GraphView` `assemble` staggers nodes in and draws edges in; this edge draw-in is the one documented `stroke-dashoffset` animation.

`useLiveTransition(identity, cursor, value)` and `useLiveChanges(identity, entries)` classify changes: the first value for an identity (hydration, reload, replay into a fresh mount, navigation) is settled, and only a change whose cursor advances while the same identity stays mounted is live. React renders on data changes only; per-frame work runs through refs and WAAPI. Live activity pauses when the document is hidden, a native modal covers the workspace, the shell marks a stage hidden or behind a foreground pane, the element is off-screen, or reduced motion is requested. One shared attribute observer owns stage/modal exposure; it watches neither streaming text nor frames.

`navigateWithTransition` commits React presentation before returning, without waiting for native capture, frames, timers or network. The native callback shares an idempotent commit; it cannot replace a newer browser history target. Optional capture may observe the already committed view, so old-to-new element morphing is not guaranteed. Rapid navigation cancels the previous visual lifetime; each intent runs once. All transition promises are observed, cleanup belongs only to the current transition, and visual snapshots do not intercept input. Hidden documents, reduced motion and missing API support navigate immediately.

Fresh pointer/keyboard input or document hiding commits any pending navigation once and retires the native visual capture. Temporary input listeners belong to that capture and retire on interruption, completion or failure; a delayed skipped callback cannot reapply the intent.

## Model Experience

None, as the package renders browser visualizations from data its consumers already hold; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **Canvas mode draws discs and edges only** — labels, cluster hulls, arrowheads, and halos render in SVG mode; above the mark threshold the list view and focus proxies carry names.
- **No virtualization in `LaneView`** — callers bound the lanes and items they pass; dense windows must be bucketed by the caller before rendering.
- **Particles need a live source** — the renderer performs only the signals its owner lists; it never infers deliveries from static edges.
