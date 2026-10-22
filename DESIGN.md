---
version: 1
name: "Clocky Web"
description: "A Team-first agent workspace with an operational overview and on-demand Session inspection."
colors:
  primary: "#171B21"
  accent: "#315FCC"
  surface: "#FFFFFF"
  canvas: "#F6F7F9"
  navigation: "#EEF0F3"
  border: "#DADEE5"
  danger: "#B42318"
  success: "#147638"
typography:
  sans:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, PingFang SC, Hiragino Sans GB, Microsoft YaHei, Helvetica Neue, Helvetica, Arial, sans-serif"
  mono:
    fontFamily: "SF Mono, JetBrains Mono, Fira Code, Consolas, Liberation Mono, Menlo, Courier, PingFang SC, Microsoft YaHei"
rounded:
  xs: "4px"
  sm: "6px"
  md: "8px"
  lg: "12px"
  xl: "16px"
spacing:
  base: "4px"
  sidebar-inline: "12px"
  sidebar-expanded: "224px"
  sidebar-min: "208px"
  sidebar-max: "420px"
  sidebar-rail: "56px"
  control-height: "36px"
  task-row-min-height: "48px"
components:
  sidebar: { surface: "sidebar" }
  team-workspace: { defaultView: "overview" }
  task-inspector: { width: "360px" }
  simulation-inspector: { width: "360px" }
  simulation-run-header: { identityRowHeight: "40px", commandBandMaxHeight: "100px" }
  session-inspection: { maxWidth: "1120px" }
---

# Clocky Web Design System

## Overview

### Creative North Star

A precise operational workspace: users can see what their Team is doing, identify work requiring attention, and inspect execution without losing their place. A quiet sidebar frames a readable working surface. Technology is expressed through live state, clear execution relationships, and restrained feedback motion.

### Product context and register

The audience directs and inspects durable agent work. Team is the top-level work identity; execution tasks, participants, channels, artifacts, and Sessions belong to that Team. The main workspace defaults to an overview. Session transcripts open on explicit request in a wide in-page inspection view. The first-input composer remains the entry before Team creation.

Simplified Chinese and English have equal coverage, including accessibility labels, statuses, and dates. This is global developer tooling; Chinese localization does not imply Japan-market business behavior. Long desktop sessions are primary, with operable single-column and rail layouts at narrow widths.

The design avoids decorative dashboards, invented metrics, arbitrary status changes, nested full applications inside modals, and permanently crowded detail panes. The [Team workspace decision](.agents/notes/implemented/architecture/2026-09-11-team-workspace-ui.md) owns the composition and navigation decisions; [visual concepts](design/team-workspace-2026-09-11/concepts.md) show the intended composition.

Simulation is an optional peer workspace with its own run directory, bounded record inspection and explicit installed-template creation/scheduling. Navigation retains the Team view. Host reads own business facts and authorization; the browser retains view selection, committed filters and bounded raw input drafts. Business receipts and original submitted commands remain in runtime. Exact simulated times remain decimal strings. The [Simulation viewing decision](.agents/notes/implemented/architecture/2026-09-29-simulation-browser-viewing.md) owns this composition.

### Token ownership

[tokens.css](packages/client/ui-theme/src/styles/tokens.css) is canonical. It defines one palette and the shared role layer: surfaces `--clocky-bg-*`, text `--clocky-fg-*`, borders `--clocky-border-*`, interaction `--clocky-accent-*`, agent status `--clocky-status-<state>-{fg,bg,border}`, categorical tints `--clocky-tint-<hue>-*`, mode identity `--clocky-mode-{team,simulation}-*`, World domain identity `--clocky-domain-*`, live halos `--clocky-glow-*`, glass material, visualization `--clocky-viz-*`, ambient field `--clocky-ambient-*`, and the type, space, radius, elevation, layer, duration and ease scales. Light values sit on `body`, dark overrides on `body[data-ds-dark-theme]`; non-color scales sit on `:root`.

Feature CSS consumes role tokens only. Palette steps (`--clocky-neutral-*`, `--clocky-blue-*`) exist so the theme sheets name each color once; features never read them or copy literal colors. A missing role is added to the theme owner with its purpose, not defined locally. Shared Button geometry uses `--clocky-radius-md` at the default size, `--clocky-radius-sm` at the small size, and `--clocky-radius-lg` at the large size.

## Colors

Light content uses a cool gray canvas (`#F6F7F9`), white working surfaces, near-black ink (`#171B21`) and a blue accent ramp centered on `#315FCC`. Accent buttons carry white text. The sidebar uses a slightly deeper neutral (`#EEF0F3`) than the canvas.

Dark content uses canvas `#14171C`, surfaces `#1B1F26`, raised surfaces `#232831`, primary text `#E8ECF2`, secondary text `#B4BCC8`, default borders `#2F3540` and accent text `#8FB0F1`. The dark sidebar is the deepest neutral (`#101317`). Theme changes preserve hierarchy and meaning; they never invert individual feature colors independently.

State uses seven status roles, each with foreground, background and border values: `running` (blue), `waiting` (violet), `needs-you` (amber), `blocked` (orange), `done` (green), `failed` (red) and `idle` (gray). Status color always accompanies text or a distinct glyph and never carries the only explanation of state.

Categorical tints (teal, fuchsia, olive, slate) identify kinds and roles without implying good or bad. Mode identity ramps (Team cyan to cobalt, Simulation violet to magenta) decorate chrome only: backdrop, mode switch, header glow and the simulated-world chip. They never mark state, and the Simulation ramp stays away from the `waiting` hue. World domains use `--clocky-domain-*` aliases over tints (organization teal, governance olive, external slate) for badges and a 2px card edge; they identify the domain, never its state. Fuchsia is not a domain color because it reads as the Simulation ramp.

## Typography

Use the existing native system/CJK stack (`--clocky-font-family`) and the existing mono stack for code, technical identifiers and visualization gauges. Text uses role tokens rather than raw sizes:

| Role | Size / line height | Use |
|---|---|---|
| display | 28px / 36px, 600 | Team and Simulation page titles, overview metrics (tabular) |
| title | 20px / 28px, 600 | Section headings; page titles in narrow layouts |
| heading | 16px / 24px, 600 | Card and inspector headings |
| body | 14px / 22px | Workspace body text |
| body-reading | 15px / 26px | Long-form prose and transcripts |
| label | 13px / 20px, 500 | Controls and field labels |
| caption | 12px / 18px | Auxiliary information; the smallest text for content |
| micro | 11px / 14px, 500 | Badges and chart ticks only |
| metric | 32px / 36px, mono, 500 | Visualization gauges and banner numbers |
| hero | 44px / 48px, mono, 500 | The single largest live figure on a page: simulated time in the World dial |

English labels use sentence case; Chinese labels use natural, concise wording. All numbers that update or compare use tabular figures. Names and objectives can wrap. A summary may clamp long prose only when the complete value remains available through explicit expansion. Do not shrink operational content to fit an overloaded container.

## Layout

Navigation is a 224px expanded sidebar, drag-resizable between 208px and 420px, or a 56px rail; viewports narrower than 1024px collapse it automatically. Team work and installed Simulation are parallel entries above the active directory; switching domains retains each view and keeps Settings at the foot. The Team header sits above module navigation: Overview, Tasks, Channels, Members, Artifacts, with Workflow and Audit under More.

The overview uses three primary business metrics, an execution list, a compact attention area, and bounded member/activity/artifact previews. Token usage is a secondary disclosure. Counts derived from complete Team state stay distinct from bounded collection counts. Task completion is not a claim of goal completion; subtree usage is explicitly labeled.

Task lists prioritize comparative reading. The selected task opens a 360px non-modal inspector with objective, owner, phase, dependencies, latest result, and next action. Full instructions, attempts, and management forms require deliberate expansion or navigation. Narrow views show one primary working surface at a time.

Channel Hub separates channel navigation (248px), message history, inline input, and optional details (292px). Protocol configuration, endpoint admission metadata, and raw records belong in details and diagnostics. Reading a channel never accepts its invitation. Changing modules or channels preserves unsent text, ordered images, audience, delivery selection, and ambiguous-send retry identity.

Session inspection uses a single stable conversation container, up to 1120px wide and 88dvh tall, with an explicit return action. The title distinguishes talking to a writable coordinator from viewing an execution record. Existing-Team empty states name the current context instead of repeating the first-work hero. Closing inspection does not cancel execution. The source Team, task filters, selection, and browsing position survive. Worker inspection does not grant direct prompt or model-change authority.

Team and Simulation roots fill the available product stage independently of module content. Simulation separates identity/actions, grouped status facts and module navigation. A run header is an identity row (back, name, mode eyebrow, simulated-world marker, refresh) that scrolls away, above one sticky command band: the status capsule, a run-details popover, the start and pause controls with the Host-allowed one emphasized, a maintenance overflow popover, then the module row. Both scheduling controls stay visible so neither moves when the phase changes. The band is at most 100px tall; once the identity row leaves the scroller it turns opaque and repeats the run name. Maintenance entries stay buttons and keep their refusal reasons. Simulation has seven primary modules: Overview, Entities, Decisions, Operations, Checkpoints, Records and Cases; Request history is a secondary More destination.

Simulation module bodies are a stage: the collection keeps the page scroll, and the inspector dock sticks below the command band with its own contained scroll, so reading the inspector never moves the collection. Breakpoints use the workspace container width, not the viewport. Below 880px the dock overlays the collection in the same cell on a raised surface, so closing it returns to the collection where it was and focus returns to the originating row; below 540px it spans the width and the shared Menu supplies labeled module selection.

Request history's bounded durable page and retained originals form one reading surface, with off-page originals still recoverable. Request status and original receipts disclose their relationship rather than presenting contradictory results.

Directory, overview and request history scroll with their workspace; collection tables and their non-modal inspector own the reading regions. Long forms use a stable-height card with a scrolling body and stationary actions. At viewport heights of 420px or less, the whole dialog scrolls so fields remain visible. Each message history and Session transcript owns its scroll region. A table's sizing must not impose clipping on sibling forms. Scrollbars remain operable; asynchronous updates do not move active controls or force a reader away from history.

## Elevation & Depth

Use tonal surfaces and thin dividers for ordinary content; cards in a workspace grid are sections of one surface, not floating layers. The elevation scale is reserved: level 1 is a hairline card, level 2 a popover or menu, level 3 a dialog or sheet, level 4 a toast. Glass material (`--clocky-surface-glass` with `--clocky-blur-glass`) is limited to panels floating over a visualization canvas or the ambient field: graph control bars, Simulation directory cards and empty stage, and the World dial. Tables, cards and inspectors use opaque surfaces, so the ambient field never shows through text.

Task and Simulation inspection are neighboring regions, not floating cards; only below 880px does the Simulation dock float over its collection at level 3. Modal Session inspection and confirmations use the shared native dialog layer for depth, focus isolation, and restoration. Do not stack independent workspaces in multiple modals. Stacking order uses the layer tokens; portaled menus use the popover layer so they stay above an open modal.

## Shapes

Working panels use 12px corners, ordinary controls and rows use 6–8px, and badges and status indicators use small or full radii. Avoid nested wrappers and giant rounded cards around every row. Reuse the existing outline icon family; custom brand slots remain authoritative over fallback branding.

## Components

### Controls and feedback

Interactive elements use semantic buttons/links and provide visible focus, hover, pressed, busy, and disabled states. Pressed buttons scale to 0.97 except under reduced motion. Busy controls retain their geometry. Failures remain next to the responsible operation; a transient toast is not the sole copy of an actionable failure.

Task stop, delete, and Team cancellation identify the object and consequence. Reversible navigation, copying, and filtering do not require confirmation. Mutations preserve Host authorization, current revisions, and idempotency. A rejected or ambiguous send retains its draft and retry identity.

### Fact values

Every observed field distinguishes five states through the shared `FactValue`: observed, unavailable (no observation; never shown as zero), unknown (an outcome that only query or exact retry can resolve), stale (a retained observation that may be out of date) and withheld (exists, but the reader lacks permission). Bounded windows state loaded versus total and their revision; a page count is never presented as a total.

Visible Simulation windows follow Native revisions automatically. Background reads retain the selected object, filters, scroll and authored drafts; pending reads coalesce later changes. Revision-bound lists restart without expired continuations. Scheduler lifecycle changes also refresh run and task/request summaries. Background rereads do not animate refresh controls, dim retained content or insert freshness/loading banners. Initial loads and actual failures remain visible. Unchanged heartbeats do not reload content, and leaving the workspace stops automatic reads.

### Overlays and input

Modal views have a visible title and close/return action, contain keyboard focus, and restore focus to the origin on dismissal. Non-modal task inspectors and the initial work composer do not claim modal semantics. Collapsed details are absent from focus and accessibility navigation; image previews use the native top layer above Session inspection. Keep Session input, IME state, attachment ownership, and tool details attached to the existing conversation implementation. The inline channel composer uses the existing authenticated channel command form, including basic-protocol restrictions and ordered media.

### Motion

Navigation commits synchronously before returning, independent of native capture. The delayed visual callback cannot overwrite Back/Forward; optional capture may show the already committed view. Each navigation runs once; fresh pointer or keyboard input and document hiding retire the optional native capture before the next action. Visual completion uses the shared instant timing token and stays within the recorded interaction budget. Settings uses the shared body-portaled native dialog, a section rail at widths of 720px or more and a labeled native section picker below that threshold. Platform popup geometry is accepted for that picker; fields use full content width.

Feedback motion explains navigation or a real state change. The topology frame uses a viewport-bounded height so task and member previews stay on the first desktop screen. Module entry is brief; task inspection enters from its neighboring edge; Session inspection uses a short vertical reveal. The Simulation dock's body follows its entry by one stagger step, section changes ease in from the direction of travel, and closing eases the dock toward its edge before the close commits; a new selection cancels a pending close. The Simulation command band condenses once per identity-row crossing; scroll position never drives per-frame styles. High-frequency interaction remains immediate. No animation invents throughput or progress.

Motion follows four tiers, carried on elements as `data-motion-tier` and owned by the [visual layer](.agents/notes/proposed/feature/2026-10-04-swarm-and-world-visual-layer.md):

| Tier | Purpose | Timing | Limit |
|---|---|---|---|
| L0 ambient | Mode-tinted backdrop or ambient field: terrain drift, air-mass breathing, one observation pulse | Static, or a drift period of 60s or more with at most 24px translation | One per screen; visible only in whitespace; pausable |
| L1 live signal | Running halos, message particles, live-change row marks, mode-tile orbit | About 1.2s per flight | 24 concurrent particles; excess merges into one "+N" pulse |
| L2 state transition | Inspector entry, phase change, odometer, progress ring | 200–400ms, spring or standard ease | One choreography at a time; interruptible |
| L3 moment | Assemble, converge, ignite, seal, stall | At most 1.2s, once | Only on a live observed transition; any input finishes it |

Initial hydration, reload, replay and navigation to an object already in a state render settled, without L2 or L3 motion. Live motion pauses behind a native modal or a shell-marked foreground page, while the document is hidden, and while the element is off-screen. Animations use transform and opacity. Reduced-motion mode collapses durations to near zero, stops loops and keeps only opacity fades, while retaining every text feedback. Durations and easings come from the theme scale (`instant` 80ms through `deliberate` 400ms, plus `fade`, `flow`, `celebrate` and the ambient `drift`); features do not introduce literal timings.

The ambient field carries no state and no readable information. Its only data-driven element is one pulse ring on a live observed simulated-time advance, seal or ignite; triggers within 1.2s merge, nothing replays, and the field is still between observations. A paused or idle run mutes its tone, which the run header still states in text. Terrain lines stay no stronger than the existing dot grid (`--clocky-viz-grid`) against the canvas in either theme, pauses after 60s without pointer or keyboard input, and has a per-browser on/off toggle in the Simulation directory and run headers that satisfies WCAG 2.2.2; reduced motion keeps it still regardless. Higher-contrast preference and print remove it.

## Do's and Don'ts

- **Do:** keep Team identity and actionable attention visible before a user opens a transcript.
- **Do:** bound default previews and expose the complete data through its owning module.
- **Do:** preserve selected objects, drafts, permissions, and exact execution provenance across view changes.
- **Do:** use the existing UI plugins, slot declarations, framework hooks, and shared primitives.
- **Do:** pair every status color with text or a distinct glyph, and show unknown, unavailable and withheld values as such.
- **Do:** lead with a Host display name; show raw identifiers as copyable chips and raw payloads only inside an explicit raw-data disclosure.
- **Don't:** return to an all-in-one Team detail popover or make a Session the implicit selected-Team home.
- **Don't:** show Host-wide telemetry as Team metrics, partial page counts as totals, or provider cost units as currency.
- **Don't:** create a new plugin solely for a dashboard, inspector, modal, or visual component.
- **Don't:** animate deadlines, countdowns or simulated time between observations; time moves only when a new observation arrives.
- **Don't:** parse Host prose into business state, or let background texture show behind tables, cards or inspectors.

## World scenario workspace

### Current scope

World import keeps the existing canonical form modal for quick JSON paste. **New world** opens a chooser (installed template, JSON/YAML file, blank skeleton, unfinished drafts) and then the full-page authoring workbench inside the Simulation workspace: a section rail, form tables and the JSON/YAML source view over one draft model, and a resizable diagnostics-and-preview column that becomes a bottom drawer on narrow screens. Fields the form cannot edit are preserved and labeled; sections the installed compiler rejects are shown read-only as reserved. Checking stays explicit, edits dim the preview, and the primary action remains "Create paused run".

World runs show five primary modules (Overview, Matters, Organization, Governance, External world) and collect engine modules under one labeled Engine menu; other runs keep their module row. World identity comes from the retained run creation. Matters share the existing table and non-modal inspector geometry, adding domain columns, four independent status tracks and evidence/source sections. Organization, Governance and External world use the same table + 360px inspector frame (up to the configured maximum on screens of at least 1440px), a lens switch and an explicit decimal viewing time. Runtime domain readers render authoritative Host windows and retain an explicit unpublished state for unsupported reads; nothing is inferred from names or counts. Transfer, departure and existing-person hire use the authenticated preview/original-command flow.

Authoring table choices and references share the feature's keyboard combobox. It preserves the current option, accepts only declared closed choices and places its list with the shared anchored-position owner outside the table scroll clip. Textarea height belongs to explicit rows or the source pane; content remains scrollable. The source editor has a visible focus ring and documents Escape then Tab to leave its indentation key handling.

### Interaction rules

The [World UI design](.agents/plans/2026-10-11-world-simulation-completion/ui-design.md) owns the complete World workspace contract; the [World UI refinement](.agents/plans/2026-10-11-world-simulation-completion/ui-refinement.md) owns its second-pass layout, components, motion and ambient field. Host readers and management owners publish its typed facts and actions; undeclared actions remain unavailable. These system rules apply:

- **Navigation.** World runs show five primary modules (Overview, Cases, Organization, Governance, External world); engine modules move into one labeled menu. Non-World runs keep the current modules. World identity comes from the retained run creation, never from names.
- **Authoring.** The complete definition editor is a full page inside the Simulation workspace, not a modal: a section rail, a form/table editor that shares one draft with the JSON/YAML source view, and a resizable diagnostics-and-preview column. Fields the form cannot edit are preserved and labeled. Editing marks the preview stale; checking stays explicit; the primary action remains "Create paused run".
- **State.** Request, planning authorization, execution and notification render as four independent tracks, never as one combined status. Intervals display as `[from, until)`; recorded, effective, known and notified times stay separate.
- **Management.** Every user mutation uses one preview → submit → original-receipt flow with a fixed command identity; actions and their availability come from Host hints.
- **Observation only.** Votes, enactment and world-internal decisions are displayed, never performed on a role's behalf. The External world module states permanently in its toolbar that the external world is simulated; other World modules carry a simulated-world chip in the run header whose popover holds the full statement, and the creation preview keeps it.
- **Motion.** New domains reuse the existing moments: seal for an enacted norm, assemble for a committed hire, converge for a ready external representative and stall for a newly unknown or unconfirmed outcome, each only on a live observed transition. Live L2 moves cover the overview clock jumping to a newly observed time, a seat filling with an observed vote, occupancy changing from reserved to occupied and a matter card moving between status columns; each merges bursts and settles on load.
- **Readability.** Columns whose loaded values are identical collapse into a summary labeled as this page. Confirmation dialogs state the object, what will happen, what will not happen and the sources, with long identifiers as chips.

Personnel totals in the World overview come from authenticated run inspection, independently of unpublished domain cards. Existing fact feedback and refresh controls retain exact zero, unavailable history and stale metadata; Participants and Activation epochs remain distinct historical counts. The refinement adds the `--clocky-domain-*` and `--clocky-ambient-*` token families, `--clocky-duration-drift`, and the motions listed in its plan.
