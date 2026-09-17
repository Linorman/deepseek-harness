---
version: 1
name: "Clocky Web"
description: "A Team-first agent workspace with an operational overview and on-demand Session inspection."
colors:
  primary: "#182230"
  accent: "#315FCC"
  surface: "#FFFFFF"
  canvas: "#F4F6FA"
  navigation: "#151B26"
  border: "#DFE5EE"
  danger: "#B42318"
  success: "#15803D"
typography:
  sans:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, PingFang SC, Hiragino Sans GB, Microsoft YaHei, Helvetica Neue, Helvetica, Arial, sans-serif"
  mono:
    fontFamily: "SF Mono, JetBrains Mono, Fira Code, Consolas, Liberation Mono, Menlo, Courier, PingFang SC, Microsoft YaHei"
rounded:
  sm: "6px"
  md: "8px"
  lg: "12px"
spacing:
  sidebar-inline: "12px"
  sidebar-expanded: "224px"
  sidebar-rail: "56px"
  control-height: "36px"
  task-row-min-height: "48px"
components:
  sidebar: { surface: "graphite" }
  team-workspace: { defaultView: "overview" }
  task-inspector: { width: "360px" }
  session-inspection: { maxWidth: "1120px" }
---

# Clocky Web Design System

## Overview

### Creative North Star

A precise operational workspace: users can see what their Team is doing, identify work requiring attention, and inspect execution without losing their place. Graphite navigation frames a quiet, readable working surface. Technology is expressed through live state, clear execution relationships, and restrained feedback motion.

### Product context and register

The audience directs and inspects durable agent work. Team is the top-level work identity; execution tasks, participants, channels, artifacts, and Sessions belong to that Team. The main workspace defaults to an overview. Session transcripts open on explicit request in a wide in-page inspection view. The first-input composer remains the entry before Team creation.

Simplified Chinese and English have equal coverage, including accessibility labels, statuses, and dates. This is global developer tooling; Chinese localization does not imply Japan-market business behavior. Long desktop sessions are primary, with operable single-column and rail layouts at narrow widths.

The design avoids decorative dashboards, invented metrics, arbitrary status changes, nested full applications inside modals, and permanently crowded detail panes. The [Team workspace decision](.agents/notes/implemented/architecture/2026-09-11-team-workspace-ui.md) owns the composition and navigation decisions; [visual concepts](design/team-workspace-2026-09-11/concepts.md) show the intended composition.

### Token ownership

[design-platform.css](packages/client/ui-theme/src/styles/design-platform.css) is canonical. Its `--clocky-workspace-*` variables define light/dark working surfaces; `--clocky-navigation-*` variables define graphite navigation. The `[data-team-workspace-page]` and `[data-clocky-navigation]` selectors map those values into existing `--clocky-alias-*` consumers. Feature styles consume aliases and do not copy literal colors. Shared Button geometry reads `--clocky-control-radius`; Team workspace controls use 8px, while transcript and other established controls retain their existing default geometry.

## Colors

Light content uses a cool gray canvas, white working surfaces, dark ink, and a blue interactive accent. Deep blue buttons support white text. Semantic success, warning, and failure colors accompany text or symbols and never carry the only explanation of state.

Dark content uses canvas `#111722`, surfaces `#1A2230`, primary text `#E6EDF7`, secondary text `#A8B5C8`, borders `#334155`, and interaction color `#85ABFF`. Navigation remains graphite in both modes. Theme changes preserve hierarchy and meaning; they do not invert individual feature colors independently.

## Typography

Use the existing native system/CJK stack. Workspace body text is 14px/22px, auxiliary information is at least 12px/18px, page titles are 24px/32px, and metrics use 28px tabular numbers. Session code and technical identifiers use the existing mono stack. English labels use sentence case; Chinese labels use natural, concise wording.

Names and objectives can wrap. A summary may clamp long prose only when the complete value remains available through explicit expansion. Do not shrink operational content to fit an overloaded container.

## Layout

Navigation is a 224px expanded sidebar or a 56px rail, with drag resizing and automatic narrow-window collapse. The Team header sits above module navigation: Overview, Tasks, Channels, Members, Artifacts, with Workflow and Audit under More.

The overview uses one shared metric band, a primary execution list, an attention area, and bounded member/activity/artifact previews. Counts derived from complete Team state stay distinct from bounded collection counts. Task completion is not a claim of goal completion; subtree usage is explicitly labeled.

Task lists prioritize comparative reading. The selected task opens a 360px non-modal inspector with objective, owner, phase, dependencies, latest result, and next action. Full instructions, attempts, and management forms require deliberate expansion or navigation. Narrow views show one primary working surface at a time.

Channel Hub separates channel navigation, message history, inline input, and optional details. Protocol configuration, endpoint admission metadata, and raw records belong in details and diagnostics. Reading a channel never accepts its invitation. Changing modules or channels preserves unsent text, ordered images, audience, delivery selection, and ambiguous-send retry identity.

Session inspection uses a single stable conversation container, up to 1120px wide and 88dvh tall, with an explicit return action. Closing inspection does not cancel execution. The source Team, task filters, selection, and browsing position survive. Worker inspection does not grant direct prompt or model-change authority.

Each table, message history, and Session transcript owns its scroll region. A table's sizing must not impose clipping on sibling forms. Scrollbars remain operable; asynchronous updates do not move active controls or force a reader away from history.

## Elevation & Depth

Use tonal surfaces and thin dividers for ordinary content. Task inspection is a neighboring region, not another floating card. Modal Session inspection and confirmations use the shared native dialog layer for depth, focus isolation, and restoration. Do not stack independent workspaces in multiple modals.

## Shapes

Working panels use 10–12px corners, ordinary controls and rows use 6–8px, and status indicators remain small. Avoid nested wrappers and giant rounded cards around every row. Reuse the existing outline icon family; custom brand slots remain authoritative over fallback branding.

## Components

### Controls and feedback

Interactive elements use semantic buttons/links and provide visible focus, hover, pressed, busy, and disabled states. Busy controls retain their geometry. Failures remain next to the responsible operation; a transient toast is not the sole copy of an actionable failure.

Task stop, delete, and Team cancellation identify the object and consequence. Reversible navigation, copying, and filtering do not require confirmation. Mutations preserve Host authorization, current revisions, and idempotency. A rejected or ambiguous send retains its draft and retry identity.

### Overlays and input

Modal views have a visible title and close/return action, contain keyboard focus, and restore focus to the origin on dismissal. Non-modal task inspectors do not claim modal semantics. Keep Session input, IME state, attachment ownership, and tool details attached to the existing conversation implementation. The inline channel composer uses the existing authenticated channel command form, including basic-protocol restrictions and ordered media.

### Motion

Feedback motion explains navigation or a real state change. Module entry is brief; task inspection enters from its neighboring edge; Session inspection uses a short vertical reveal. High-frequency interaction remains immediate. No animation invents throughput or progress. Reduced-motion mode removes movement and ongoing status animation while retaining text feedback. Shared theme timing and easing remain the source for reusable motion values.

## Do's and Don'ts

- **Do:** keep Team identity and actionable attention visible before a user opens a transcript.
- **Do:** bound default previews and expose the complete data through its owning module.
- **Do:** preserve selected objects, drafts, permissions, and exact execution provenance across view changes.
- **Do:** use the existing UI plugins, slot declarations, framework hooks, and shared primitives.
- **Don't:** return to an all-in-one Team detail popover or make a Session the implicit selected-Team home.
- **Don't:** show Host-wide telemetry as Team metrics, partial page counts as totals, or provider cost units as currency.
- **Don't:** create a new plugin solely for a dashboard, inspector, modal, or visual component.
