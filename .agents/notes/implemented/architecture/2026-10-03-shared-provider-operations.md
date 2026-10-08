# Agent Note: Shared provider operations and local filesystem ownership

Status: implemented

English | [中文](2026-10-03-shared-provider-operations.zh.md)

## Problem

Local and remote workspace providers copied allocation identity, reservation, source-policy admission, and recovery-marker provenance rules. Sandbox and shared-root providers also duplicated local file publication and safe portable-change operations. Host and SDK transports independently constructed the same human proofs and traversed Session ancestry, allowing equivalent consumers to drift at authorization boundaries.

## Decision

Core Team owns immutable activation-binding comparison, complete zero-valued metrics construction, and the parsed channel/task human-proof constructors. Proofs retain the exact complete actor-free payload and its original cursor or revision fence. Each transport continues to parse its own input, resolve server-owned Team identity, and authorize the live principal.

Core Session owns nearest-owner ancestry traversal over caller-supplied live and durable header readers. It reads the durable inventory lazily at most once and reports missing or cyclic ancestry as unavailable. Host content reads retain their rejection behavior; SDK listings retain their exclusion behavior. Core header validation also owns rejection of retired product metadata; the JSONL backend retains its additional retired-policy-field rejection.

Core Workspace owns provider-independent exact allocation keys, base-metadata comparison, live local-Participant eligibility, independent reservation registries, single-flight materialization, per-target integration queues, source-integration policy facts, portable artifact decoding, and common recovery-marker provenance. Execution-world comparison stays with consumers that own such a world. Worktree providers retain their existing promise-valued allocation ownership and operation queues.

The `team-workspace-local-files` implementation library owns common local file publication, directory-ancestor checks, portable changes, and local recovery-marker IO for sandbox and shared-root consumers. It receives resolved artifact bounds and provider diagnostic labels. It imports no provider implementation. The library also owns staging, content-version rechecks, backup restoration, and committed/prepared marker settlement for local directory integration. Providers retain root selection, version scanning, directory assertions, deterministic disk naming, and allocation authority. The remote E2B adapter retains its own transport and execution-world loss handling.

Host mutation admission, actor-proof invocation, projection, and error mapping have one local implementation. Channel routes retain their channel-to-Team lookup and protocol-specific validation. Principal inbox operations share their authenticated-call admission without changing which failures carry a Team identity. The HTTP supervisor client and endpoint share the validation fields that identify the same deployment, while each retains its transport-specific limits.

The OTel Session provider exposes an independent `./pipeline` SDK support subpath consumed by both Session and Team backends. It imports no Session service or capture policy and mounts no plugin. Each backend retains privacy, severity mapping, scope naming, alerts, flushing, and bounded shutdown. ACP and SDK startup use the timeout library's shared cancellation race; each provider still owns stop-and-drain settlement and its cancellation diagnosis.

Simulation owners share prepared-context overflow publication, empty-effect continuation acknowledgements, checkpoint movement classification, and independent run-local provisioning queues. Scenario drivers share activation seed/model selection while retaining their eviction policy; task executors share resident-drive stop handling. Product commands retain distinct terminal/admission failure semantics while sharing background-job retention. Task definition consumers explicitly pick their supported fields from the Core validators, so unsafe priority and attempt counts reject before decision acceptance; Simulation specifications still reject caller-selected actor, execution, placement and workflow fields.

## Alternatives considered

**Re-exporting provider implementations through Core.** This keeps copied ownership with the wrong layer and makes the Service Definition depend on platform behavior. Shared protocol rules live in Core; local filesystem code has a separate implementation owner.

**A shared mutable allocation controller across providers.** Provider lifetimes, physical roots and recovery remain independent. Each provider owns its own registry and queues while reusing the operation rules.

**One generic transport mutation schema.** Host and SDK wire schemas have different input normalization and server-owned identities. They retain their parsing and use shared proof construction only after parsing.

## Consequences

Shared rules have current consumers and a single implementation. Provider and transport authority remains explicit, including exact attempt/activation identities and current authenticated principal lifetimes. Existing error messages, marker formats, deterministic paths, model inputs, and published protocol field sets remain stable. The local implementation library adds one static dependency to each local provider and one Host compiler project.

## Testing

The five workspace owner suites pass after protocol consolidation: 14 files and 117 tests. After local file extraction, sandbox and shared-root suites pass: five files and 33 tests, including publication, restore, portable changes, and error paths. Host Team/human-action tests pass: two files and 94 tests. SDK notification ancestry, Core human-proof tests and adjacent owner checks also pass. A combined source run covering workspace, OTel, timeout and AgentRuntime owners passes 25 files and 263 tests; typed lint for these owners passes. Simulation Local/Team tests pass 54 files and 1,159 tests; Product tests pass 41 files and 347 tests. Core AgentRuntime publication tests pass five files and 73 tests; ACP/Agent Client review-fence tests pass eight files and 252 tests. Task schema and rejection tests pass 40 tests, and local-file symlink protection passes two tests. All Client, Host, workspace, AgentRuntime, OTel and Simulation clones in this task scope are removed. Full repository duplication and build verification remain task-wide gates.
