# Agent Note: Local Team product-run owner

Status: implemented

English | [中文](2026-08-29-local-team-product-run-owner.zh.md)

## Problem

The durable Team provider can create journals and channels, but it does not own a product topology. A client could otherwise create a bare Team, bypass coordinator activation, or treat an assistant message as a human-visible answer. That leaves no durable boundary between human input, coordinator delivery, final output, and Team completion.

## Decision

Team templates can retain explicit additional member routes and zero default workers. The same owner creates their Participant and Activation identities, reconstructs their frozen routes on resume, and releases their leases before coordinator settlement. Workflow role resolution uses the declared active roster; capability checks reject a plan without a non-coordinator execution member. This keeps custom execution and review roles inside the Team journal and existing scheduler instead of introducing private child runs.

`@clocky/clocky-team-run` provides `ctx.teamRuns` for the local default topology. It creates active `human` and `coordinator` Participants, a provisioned inactive `worker`, and one direct v3 human/coordinator channel. It records the configured product template id/version in the initial Team rules projection, activates the coordinator through `ctx.teamActivations`, and retains its lease until terminal settlement or provider unload.

The activation controller is a `ctx.teamActivations` Service. It remains the sole owner of publish, durable bind, status mirroring, and disposal, so Team-run does not duplicate AgentRuntime lifecycle logic. `AgentRuntimeAgentSpec.cwd` carries the resolved local execution root into a fresh coordinator Session header, and an optional request preset is composed by the selected local provider before publication.

`create()` resolves an optional request-selected `ModelSelection` and positive `maxTokens` before activation; an omitted selection reads the current `agentDefaultModel` selection once. It forwards an optional coordinator preset to the selected activation provider. `start()` records the initial topology and first human Envelope under one sender-scoped key; a matching retry returns the same local result while a conflicting reuse fails. Human input re-reads a moved channel cursor under a configured retry limit and keeps that key on every attempt. The JSON-RPC runtime passes its initialized route and cap through this request without changing the process default.

Human input is a trusted human-sender direct v3 `message` Envelope carrying only text and durable image references. `team_final` uses the authenticated Link to atomically derive the calling coordinator's peer and current channel cursor before posting an explicit text `final` Envelope. The local Agent client admits direct v2 text or direct v3 human content; Team-run first persists a receipt-pending completion intent with its TeamRun-scoped proof, then reads the final-output channel through configured bounded `readChannelPage()` pages, receipts the human-addressed final, waits for the coordinator to become idle, releases its lease, verifies both direct recipients have no pending delivery, and commits `active -> quiescing -> completed`. The closure driver resumes that intent after restart once the exact human receipt is durable. Assistant messages never imply a final result.

Team-run mints an opaque default-worker task authority only from an exact live local coordinator Agent. Its task start operation derives the creator binding internally, receives a coordinator-scoped idempotency key plus subject, instructions, and read/write scopes, and fixes the remaining worker task policy. Its task wait operation accepts only a task previously admitted through that authority, returns the retained terminal result or attempt outcome, and lets cancellation stop only the local Team-journal watch.

It separately mints a coordinator Goal authority only for that exact current coordinator. `tool-team-goal` reads the durable objective through it and allows a compare-and-set objective edit only when the current open turn contains the trusted human direct-v3 Envelope. Team-run derives the actor from its lease, and the Hub fences the mutation again; model tools cannot create a goal or change its phase.

Mutating default-worker tasks freeze an explicit participant-review route when the deployment supplies `reviewerPreset`; Team-run lazily provisions the reviewer and the scheduler routes the completed attempt through a durable consult channel. The task Agent also publishes provider-owned workspace changed paths and artifact references before settlement, while providers never auto-integrate user changes.

Concurrent Team writes can race each reviewer preparation step and the subsequent task admission. Reviewer invitation, membership transitions and activation each retain a bounded cursor-conflict allowance, reset after that step commits. Task admission starts its own allowance after participants are ready. Both stages re-read current Team state and issue fresh proofs; non-cursor failures propagate. The mixed-resource runnable example exercises workflow progress during reviewer creation and reaches real review and approval waits before current-owner cancellation.

The Host Team Remote exposes durable Team list/get reads plus local Team-run create, retry-safe start and text input, final wait, and cancellation. Current-run operations require the authenticated product principal to own the Team's active human Participant; detached archive and resume use the separate [authenticated product-principal Team control](2026-09-04-authenticated-product-principal-team-control.md) proof boundary. The Web bundle composes the same local Team stack; an explicit Agent preset reaches the coordinator through the activation request, and `tool-team` installs `team_final` only in Team-bound Agent scopes.

Host Session prompts and cancellation recognize a live coordinator's durable Team provenance before ordinary Agent routing. They validate the unique active human/coordinator binding, post human input through Team-run, and request a soft interrupt through Team authority. A cold or orphaned Team Session fails loudly instead of resuming as an ordinary Session. `@clocky/clocky-tool-team-task` is a separate scoped TeamRun Consumer: it derives a default-worker task-create key from each tool call lineage, returns compact task identity or terminal facts, and never exposes worker transcript or lease data. It registers only after TeamRun recognizes the exact live default coordinator; Headless and Web mount it after Team-run.

Coordinator task projections carry the frozen review policy and at most one matching attempt decision. They select the active lease attempt before the latest settled attempt, so rework cannot make a later running attempt appear reviewed. A null decision means that selected attempt has no recorded decision, not that review is disabled. Review policy and decisions are read from the existing Task snapshot; no parallel state or inferred decision from the terminal phase is stored. This bounded evidence lets the coordinator distinguish reviewed completion from completion without review while leaving full reasons and history with the Team journal. It does not guarantee that a model will describe the evidence accurately.

## Alternatives considered

**Keep the headless direct-Agent runner.** Rejected because it creates a product-visible Session without durable Team membership, a channel, or a human receipt.

**Broadcast the coordinator's assistant message automatically.** Rejected because private model output does not prove recipient routing, durable admission, or completion policy acceptance.

**Let the model post a final through an observed channel cursor.** Rejected because peer selection and cursor can change between a channel read and post. The authenticated Link delegates both facts to the Hub's channel lock.

**Put default topology creation in Team Hub.** Rejected because the Hub owns generic authority and recovery, while template, local placement, model selection, and human-result policy are product concerns.

## Consequences

Headless, ACP, the JSON-RPC runtime, and the Host Team Remote use the local Team product owner; the TypeScript and Python SDKs project its Team creation, completion, cancellation, full Team control plane, and process-local metrics. The Web bundle composes the same services. Its New Task flow creates a local Team draft, sends first text through `team.start`, and opens the returned coordinator transcript; `ui-team` lists durable Teams, renders task/channel/artifact/audit projections, and resolves selection through the same activation binding. The Web roster does not mount Workspace/Session navigation. The [Team-owned product task entry](2026-08-29-team-owned-product-task-entry.md) records the corresponding removal of public Session task creation and forking. It covers text/image direct v3 input, coordinator-authorized default-worker tasks, reviewer routing when configured, workspace outcome publication, and explicit final output for newly created in-process runs. Process reload leaves an active durable Team for an authenticated human recovery owner; automatic multi-host recovery, provider-specific integration, and hard cancellation remain separate work.

Focused tests compose the real Hub, local AgentRuntime, activation controller, Link, Agent Client, direct v3 protocol, scheduler, and Team-run service. They verify durable topology, coordinator Session provenance, preset forwarding, human input admission, coordinator-authorized worker task creation and wait cancellation, explicit final receipt, no pending direct delivery, and completed Team lifecycle.
