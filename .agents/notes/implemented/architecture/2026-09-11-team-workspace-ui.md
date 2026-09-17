# Agent Note: Team workspace overview and on-demand Session inspection

Status: implemented

English | [中文](2026-09-11-team-workspace-ui.zh.md)

## Problem

A coordinator transcript and a small floating Team pane compete for space while users need to compare tasks, find human decisions, and operate channels. Combining every Team collection in that pane obscures the next action and makes task summaries expensive to scan.

## Decision

Team selection opens a read-only operational workspace. The overview derives task counts from the complete Team projection, limits task and member previews, and separates human attention, recent activity, and artifacts. Tasks use a bounded table with one summary inspector; execution history and mutation controls remain explicit disclosures. Channel Hub separates its list, messages, inline composer, and optional protocol diagnostics. Missing usage is unavailable, not zero; completed-task counts are not objective progress, and provider cost units are not currency.

The existing UI owners implement this composition without additional plugins. `ui-team` registers the root `team.workspace` slot and its channel-message child; `ui-layout` owns the workspace and Session containers. The registration-owned store retains per-Team module, filters, selection, scrolling, and channel drafts. Runtime services retain business state and authenticated operations. Shareable URLs contain only object identifiers and view filters, with Team membership checked during restoration. A newer selection cancels pending restoration or Session lookup.

Session inspection uses one stable conversation subtree inside a native dialog, including the existing details slot. Opening, closing, and expanding the view preserve its mounted state; closing clears viewing selection and does not stop execution. Task attempt links resolve the recorded activation, while member links select the latest activation. Selecting a Team does not resume an offline coordinator; Resume is a separate command.

The [design context](../../../../DESIGN.md) owns the graphite navigation, cool neutral workspace surfaces, typography, and restrained transitions. Shared theme tokens support both appearances and reduced motion. Bounded reads and previews prevent presentation from loading every channel journal or member transcript.

Image import checks selected file sizes, base64 expansion and serialized metadata against the configured draft-byte allowance before opening a FileReader. Sequential encoding bounds concurrent readers; rejection leaves the prior draft intact. The workspace store remains the final owner of the combined retained-draft quota.

### Relationship to existing decisions

The [compact-detail decision](../feature/2026-09-07-team-detail-compact-delete.md) retains task authorization, stop/delete semantics, and owner attribution; this decision replaces its floating-pane presentation. The [Team closure decision](2026-08-31-team-closure-authority-and-detail-inspection.md) retains lifecycle and provenance ownership. The [P1 product proposal](../../proposed/architecture/2026-09-04-native-multi-agent-p1-product-convergence.md) retains its wider protocol scope. These records remain active because their independent rationale is not superseded.

## Alternatives considered

**More disclosures in the floating pane.** They hide fields but do not provide enough comparative space for task and channel operations.

**A persistent large Session beside a small dashboard.** It constrains the operational workspace and keeps transcript reading as the default activity.

**A draggable task board.** Scheduler and review rules own task transitions; free dragging implies unsupported mutations and reduces comparative reading density.

**Separate dashboard and inspector plugins.** These presentations already belong to existing UI owners and do not introduce independently evolving capabilities.

## Consequences

Operational navigation gains space and explicit hierarchy; persistent-chat users incur an opening action, supported by a stable coordinator entry and expanded reading mode. Session inspection preserves the source workspace instead of replacing it. The Host continues to authorize mutations, validate revisions, and enforce channel invitation and protocol restrictions.

Complete Team projections provide accurate counts but remain a scaling dependency. Bounded collection rendering does not establish a 1,000-task performance guarantee. The implementation evidence records the measured scenarios and distinguishes viewport-based zoom checks from native browser zoom. Channel drafts survive module changes; this does not promise persistence for every unrelated form or across reloads.

## Testing

Client tests cover bounded previews, exact attempt selection, offline Resume, navigation cancellation, draft retry identity, IME handling, mutation errors, and stable Session mounting. Real-Host keyless browser scenarios cover channel protocols, 65-row pagination and read recovery, child-Team navigation, Session return and browser history, long objectives, both locales and appearances, narrow layouts, and reduced motion. The [implementation report](../../../../design/team-workspace-2026-09-11/implementation-report.md) records verification commands, screenshots, and repository-wide check limitations.
