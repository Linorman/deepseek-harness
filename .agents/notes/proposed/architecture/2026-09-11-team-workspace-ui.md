# Agent Note: Team workspace overview and on-demand Session inspection

Status: proposed

English | [中文](2026-09-11-team-workspace-ui.zh.md)

## Problem

Selecting a Team opens its coordinator Session, while a 360×520 floating detail pane contains participants, tasks, budgets, workflows, channels, artifacts, human actions, and audit records. Large collections push actionable work below the fold; channel controls wrap into narrow columns while the central conversation can remain empty. The user requests a dashboard-centered Team workspace, concise task summaries, and Session inspection in an on-demand in-page subpage.

The [design proposal and captured evidence](../../../../design/team-workspace-2026-09-11/design-proposal.md) document the current browser flow, proposed layouts, information limits, data definitions, motion, component ownership, and implementation sequence. This task delivers a design proposal, not a product implementation.

## Proposal

Make the Team overview the default selected-Team content. Give tasks, channels, members, and artifacts separate views; keep workflow and audit access under secondary navigation. Prioritize pending human decisions and current execution. A task inspector shows one task's objective, owner, state, latest result, and next action; detailed history and editing remain deeper views.

Open a selected Session in one wide in-page subpage with an explicit return path. Preserve the source Team, module, filters, selection, scroll position, and Session draft. Closing inspection never cancels work. Coordinator input continues through the Hub; opening a worker transcript does not grant direct prompt or model-mutation permission.

Reuse existing `ui-layout`, `ui-team`, `ui-conversation`, `runtime`, `ui-primitives`, `ui-theme`, and locale ownership. Do not create a UI plugin for a dashboard, task inspector, or Session subpage. Keep proposed components package-private and compose plugins through slots and services.

### Composition and data

Add a root-scoped Team workspace slot owned by the existing layout registration. Keep the `conversation` registration and its child-slot declarations intact for Session rendering and first input; do not replace that single slot with a Team component. Separate Team selection from opening a Session, and render only one visible conversation instance. Validate React mounting, IME, draft, attachment, tool-detail, and observer lifetimes before moving the conversation into a modal container.

Derive overview facts from the complete selected Team snapshot; read long lists through bounded collections. Treat completed-task count as task completion, not goal progress. Usage includes the Team subtree and must distinguish input, output, cache, and provider cost units. The existing `team.metrics` request is Host-scoped, so it cannot supply current-Team metrics. Do not infer full totals from loaded pages or invent unread counts, historical trends, currency, or ETA.

The [current design context](../../../../DESIGN.md) explicitly prefers a transcript-centered product and forbids a Team dashboard. The current user request selects the opposite product direction. Implementation must update that design context and its runtime token consumers together; this proposal leaves both unchanged.

### Relationship to existing decisions

The [compact-detail decision](../../implemented/feature/2026-09-07-team-detail-compact-delete.md) retains authority over task mutation authorization, stop/delete semantics, and owner attribution. Its floating-pane presentation is a candidate for replacement when this proposal ships. The [Team closure decision](../../implemented/architecture/2026-08-31-team-closure-authority-and-detail-inspection.md) retains lifecycle, provenance, and authority ownership. The [P1 product proposal](2026-09-04-native-multi-agent-p1-product-convergence.md) retains its wider protocol and product scope.

The scoped supersession review found no implemented decision fully superseded by this unimplemented design. Keep these records active; no archival, consolidation, or lifecycle change is part of this task.

## Alternatives considered

**Add more disclosures to the floating pane.** This hides content without giving tasks, channels, and members appropriate working space or correcting default navigation.

**Keep a large Session beside a small dashboard.** This preserves the center-column priority that the user explicitly wants to change and forces the operational view into a narrow remainder.

**Use a draggable task board by default.** Task phases are scheduler- and review-controlled. Free dragging would imply unsupported mutations, and cards reduce comparative reading efficiency.

**Create separate dashboard and inspector plugins.** These presentations already belong to existing UI owners. Additional plugins would increase composition work without an independently evolving capability.

## Acceptance criteria

- At 1440×900, the overview exposes the Team objective, lifecycle, task distribution, and human-attention entry without opening a Session or scrolling a large roster.
- One click opens a task summary or member Session. Closing the Session restores source selection, filters, scroll, and focus without dropping drafts or stopping execution.
- Channel reading, invitation consent, input, configuration, and diagnostics have distinct presentation areas and preserve protocol restrictions and authenticated mutations.
- Complete-snapshot metrics remain distinct from loaded-page counts and Host-scoped telemetry; unavailable data never renders as a fabricated zero or trend.
- Existing UI packages retain ownership; all registrations and reactive data paths follow the client slot and store rules, with no cross-plugin component import.
- Implementation passes focused keyless behavior snapshots and browser checks for errors, pagination, revision conflicts, late responses, child-Team navigation, worker read-only behavior, and Session return. Verify both locales/themes, keyboard use, 390px layout, 200% zoom, and reduced motion; record a real-flow GIF for the implementation PR.

## Risks

Persistent-chat users gain an extra opening action; keep a stable coordinator-session entry and an expanded reading mode. Dashboard scope can grow until it becomes another overloaded detail page; the proposal's content limits are acceptance requirements. Moving Session rendering can reset React-local state or misplace tool details unless state and slot ownership are addressed first. Modal focus and nested confirmations require consistent shared-primitives behavior. Whole-Team snapshots currently support accurate counts but do not replace a future bounded aggregate contract for very large deployments.

Current investigation reran the two existing Team collection/channel browser files: five tests passed. These runs exercise the existing product with a real isolated Host and replayed model output. They do not validate an implementation of the proposed UI. The strict premium static audit reported zero findings; runtime accessibility and performance claims remain subject to implementation verification.
