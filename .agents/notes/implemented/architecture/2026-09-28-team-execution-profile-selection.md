# Agent Note: Deployment-owned execution profile selection

Status: implemented

English | [中文](2026-09-28-team-execution-profile-selection.zh.md)

## Problem

Member registration accepts execution descriptors, but active membership does not establish that a matching deployment route exists. Operators need selectable current configurations without receiving startup paths or credentials.

## Decision

Placement registers public profiles through the Team runtime using its own plugin context. Each route role contributes local-agent and remote-agent descriptors. Availability checks the actual runtime provider and its declared participant kinds. Removing the placement plugin removes its registrations; provider removal updates availability without changing the descriptor identity.

A profile ID hashes only the public kind, role, provider, preset and model. It identifies a descriptor, not an immutable startup specification or an execution reservation. Work directories, token limits, credentials and executable options are excluded. Service members retain manual registration because their lifecycle is owned by their service.

`getExecutionProfiles()` requires a payload-bound active-human read proof. Missing invite authority, an inactive Team, the member limit or Simulation ownership suppresses profile data. Pages are row- and byte-bounded. Continuation binds the Team, member kind and registry revision; the selected descriptor is returned independently of the current page. Availability is recomputed on reads.

Invitation binds the selected ID and complete descriptor in the human command proof. The Hub checks their exact match and availability before authorization policy work and again before committing the participant. Revoked configuration rejects the command without writing membership. The profile ID is command metadata and is not persisted on the participant. Manual descriptors continue through the ordinary invitation and placement checks.

The browser runtime owns catalog reads, polling and cancellation. The form owns the selected ID, page cursor and authored fields. Selected descriptors lock execution fields. Loading, transport failure, permission loss or unavailable selection prevents submission while retaining input. Refresh returns to the first page after catalog changes. Registration does not activate an actor. Member management refreshes the existing member-list window so completed commands become visible without resetting pagination.

## Alternatives considered

**Infer routes from provider names in the UI.** Names do not establish current registration, accepted participant kinds or exact descriptor matching.

**Store full launch configuration in profiles.** Startup paths and credentials belong to deployment owners. A public choice needs only the participant descriptor.

**Validate selection only when listing.** Policy work is asynchronous and plugins may unload before the invitation commits. The commit-side check prevents stale selection from being accepted.

## Consequences

[Member readiness](2026-09-28-team-member-execution-readiness.md) remains the current execution observation after registration. Profile availability does not guarantee preset loading, model access, capacity or eventual task success. The [product proposal](../../proposed/architecture/2026-09-28-web-team-simulation-product-integration.md) retains the broader identity, draft and Simulation requirements.

## Verification

Registry tests cover lifecycle disposal, exact descriptor matching, independent selected rows, continuation and byte bounds. Runtime and component tests cover stale responses, permission loss, kind changes and retained rejected drafts. The real Host test removes placement during invitation policy work and checks that no membership is committed. The browser scenario selects a registered profile and uses the production scheduler and task-report tool to complete its task.
