# Agent Note: Team draft configuration controls

Status: implemented

English | [中文](2026-09-06-team-draft-configuration-controls.zh.md)

## Problem

The Web product creates a Team from a resident no-Session composer, while project, model, and Agent-preset controls were split across an unused legacy Workspace slot, existing Session-only model UI, and Settings. A user could enter text but could not choose the execution context before Team admission.

## Decision

The Team sidebar renders a compact Workspace panel whenever a new Team draft is pending. It opens the Host directory chooser, registers the selected folder in the durable Workspace registry, and stores its path on the local draft. Team summaries retain that path and the sidebar groups each Team below its Workspace, with a direct action for another task in the same folder. `team.start` carries the selected `cwd` in the same retry-safe request that admits the first human text. Model and reasoning choices stay in the chat selector, and the coordinator uses the Agent preset configured as the deployment default.

## Alternatives considered

**Select model and preset in the Workspace panel.** Rejected because the chat model selector already owns model/reasoning choice and the Agent-preset settings row owns the default composition; duplicating them creates conflicting pre-start state.

**Reuse the legacy Workspace picker slot.** Rejected because shipped Web uses Team as its product identity and that slot is not rendered by the Team-first shell; registering it would leave the controls disconnected from the Team start payload.

## Consequences

The browser uses the existing authenticated Host directory capability and Workspace registry. The selected path remains local until the first start and is then retained in Team rules for restart-safe grouping. Existing chat model/reasoning controls and Agent-preset Settings remain the single owners for those choices.

## Testing

Focused client runtime and UI tests cover draft propagation, Workspace grouping, directory selection, retry-safe start payloads, and one-click continuation. An authenticated Playwright run against the real Web server verified the directory flow and inspected the resulting `team.start` JSON request.
