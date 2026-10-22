# Agent Note: Authenticated World personnel management

Status: implemented

English | [中文](2026-10-14-authenticated-world-personnel-management.zh.md)

## Problem

A product owner needs to transfer a person, close an assignment or hire an existing eligible person while preserving the original identity. Reusing a simulated director or inventing a Decision would falsify the source and bypass the ordinary actor protocol. A preview also needs a stable Native and canonical Team observation, rather than a promise based on stale UI state.

## Decision

The [Native management contract](../../../../packages/simulation/simulation/src/world-management.ts) accepts three closed actions: transfer, depart and hire-existing. The trusted product owner resolves complete form choices against the real person and assignment, obtains a bounded canonical personnel inventory and retains a finite Team/Channel event fence through Native queue admission. The authenticated source records the actual principal, credential generation, installed policy identity/generation, original command ID and Native time. Clients supply none of those authority fields.

Read-only fields and preview do not open a run, attach a connection, reserve business work or infer. The preview commits the complete resolved action, Native prefix, typed dependencies, canonical source fingerprint and current authority policy. It reports actual identities, fees, admission blockers and later settlement requirements separately. Closing an assignment at its own start time refuses before execution is armed. Missing or incomplete sources cannot claim admissibility.

Transfer and departure inspect the exact original assignment. Relations that Native closes in that mutation do not become false handoff requirements; other canonical obligations retain their actual owner and disposition. Resource control, accepted work and unknown responsibility cannot disappear merely because a person leaves a position.

The product format 4 journal retains one immutable user form and resolved Native command before Native acceptance. Native derives the sole request and direct plan from the original run/principal/command identity; repeated identical input returns those originals. User requests and plans have no Operation or simulated requester, and use the explicit `authenticated-user` source. Product case v3 exposes a nullable requester and closed origin/source unions; actor cases retain actual Decision/Operation provenance. No synthetic Channel post or human result wake represents a user command.

Scheduling readiness validates the installed original execution generations and Native parser contracts before reporting start as available. A paused run cannot start with missing or retired providers; restoring the declared deployment and explicitly refreshing controls does not itself start scheduling. Personnel hints explain pending management and offer the original obligation inventory; a pending assignment fence does not claim that a transfer is a completed departure.

The original product-held World owner durably pauses scheduling after acceptance and executes only that direct plan. It drains independently of a newer pause intent, invokes no model and leaves scheduling paused. An interrupted callback remains accepted until its original result and execution responsibility are known; exact retry reconciles the original plan. A typed refusal with no Native original can settle the product attempt as failed. Querying original receipts never restores writable ownership.

The submit response awaits Native admission while its authenticated call lease is live. Long execution then retains its own completion responsibility. Case cancellation has a separate bounded control job and a fixed impact quote; its Native acknowledgement does not wait for an outstanding provider callback. Cleanup remains owned until the original execution and reservations settle.

Hiring fees require an explicit installed principal-to-Native-controller delegation. The actual controller remains the resource actor; the user principal is retained separately on the original World resource hold, whose created Operation is null. One committed hold funds one original hire. Missing delegation, insufficient funds or an approval requirement cannot be bypassed by selecting a director or account controller implicitly.

Independent scoped hiring eligibility belongs to the person, while declared position permissions belong to their original assignment. Native classifies them from the persisted static/derived grant directories and frozen position policy; it rejects ambiguous provenance. Leaving a role closes its derived permissions without deleting independent eligibility or the person's Participant, Session and profile. Retirement still requires the original personnel settlement proofs; unknown responsibility stays retained.

Native stream 97 and checkpoint manifest 7 bind these original authenticated requests, plans, sources and holds. Earlier formats reject explicitly. The compiler version and generic SQLite/Session formats are unchanged.

## Alternatives considered

**Submit as a simulated director.** This invents a Decision or sender and conflates product authorization with actor permissions.

**Keep a second management business database.** It duplicates Native requests, plans, results and resource responsibility. The product journal retains administrative intent; Native remains the business owner.

**Resolve new input after a lost response.** It can change assignments, fees or identity. Retained original input and source-aware lookup preserve one business attempt.

## Consequences

The strict [product contracts](../../../../packages/simulation/simulation-product/src/world-management-schema.ts), authenticated Host handlers and both SDK clients correlate every original choice and result identity. The Client runtime owns quote invalidation and query-before-retry behavior; the UI only renders those facts and retains one command before submitting. Canonical source coverage, callback confirmation, business outcome and future first-action work remain independent observations.

After a browser reload, the Client discovers the original run/command selector through durable request history. Querying that selector correlates the returned management case metadata before exposing its Native case link. Explicit retry asks the Host to reuse its complete saved input; private form text is unnecessary in browser history or storage. A failed metadata query cannot substitute another run or command.

The flow requires a distinct confirmation click. The second click of a preview or submit double-click cannot activate the next step's confirmation or dismiss its retained original. Keyboard confirmation and closing remain available.
