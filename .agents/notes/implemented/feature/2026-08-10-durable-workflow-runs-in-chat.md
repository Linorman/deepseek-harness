# Agent Note: Durable workflow runs in Chat

Status: implemented

English | [中文](2026-08-10-durable-workflow-runs-in-chat.zh.md)

## Problem

The ordinary workflow tool row owns the model call and final tool result, but those two records do not explain which members actually started, how they were grouped, whether each member completed, failed, or was cancelled, or what remained unfinished when a process stopped. Live `workflow/*` events expose those facts only inside the current process, so a refresh or later Session open loses the run history.

A custom composition can retain workflow history only when it has a producer that correlates one accepted run with its calling Session and a minimal durable protocol that remains meaningful as a prefix.

## Decision

`clocky-tool-workflow` projects every top-level accepted run into the calling Agent's Session. `tool-workflow/run-start` records the stable `runId` and validated name; matching workflow member events record the member sequence, exact label, optional exact phase, child Session id, and outcome; `tool-workflow/run-end` records the stop reason only after the result exists and `run.dispose()` has reached quiescence. Nested transport executions run normally but write no workflow record because they do not own an independent root record.

Recording is observational. The first failed Session append disables all later writes for that run, logs one warning, and never changes cancellation, result mapping, or disposal. Each possible failure leaves either no record or a legal continuous prefix: a started run may lack later members or its ending, and a started member may lack its ending. The package invariant rejects duplicate run starts, invalid or reused positive member sequences, unpaired or repeated member endings, a run ending while members remain open, and every update after a run ending on both cold load and live append.

The workflow package exposes browser-safe run and observation vocabulary through `@clocky/clocky-workflow/types`; live `Agent` requests and control handles remain Host-only. `@clocky/clocky-tool-workflow/types` owns the four Session events. Client code imports only these type faces, so the Host and Client TypeScript programs share the durable contract without merging Host Cordis context.

The shipped Web composition does not include `clocky-tool-workflow` or a workflow-specific Conversation renderer. A custom consumer may reconstruct these events, but it remains an observer and cannot take ownership of the tool call, execution, or disposal lifecycle.

## Verification

Package tests cover top-level and nested eligibility, zero-member and concurrent runs, disposal-before-ending order, all four append-failure prefixes, and cold/live invariant rejection. Custom compositions that reconstruct these records own their own presentation evidence.

## Alternatives considered

**Append workflow content inside the existing tool card.** Rejected because `ui-tool` and the tool definition own that row's presentation and interaction. A workflow-specific appendix would couple two independently keyed business lifecycles and revive the removed post-tool attachment model.

**Persist a server-side projection or add a workflow wire channel.** Rejected because Session events already provide persistence, live delivery, pagination, and gap repair. Another service, cache, or transport would duplicate the same facts and create a second lifecycle owner.

**Render declared phases or infer a static workflow graph from script text.** Rejected because only member-start events prove work happened. `meta.phases`, `phase()` narration, branches, and script syntax do not describe one authoritative runtime topology.

## Consequences

Workflow progress can survive refresh and process recovery in the same log as its parent conversation, while execution ownership remains with the workflow run holder. The durable protocol adds four small events and one package-owned invariant; first-write failure intentionally sacrifices later observation rather than workflow correctness. The shipped product gives up workflow-specific progress and navigation UI; a future custom presenter can use the durable records without changing execution ownership.
