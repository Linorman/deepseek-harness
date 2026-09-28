# Simulation

English | [中文](README.zh.md)

`ctx.simulations` registers named durable run providers. Call `resolve(request)` with an explicit provider, create/open mode, run identity, clock unit/origin/maximum, and rules/policy versions, then pass the result to `open()`. Providers return a caller-owned handle with `snapshot()`, revision-checked `setPhase()`, and draining `close()`. Registration is effect-scoped; missing and duplicate providers reject.

`inspectEntity(id)` returns a detached entity with the same observation’s run id and global revision, without copying unrelated history. Unknown identities omit the entity; writes still validate their expected revision and authority.

Times are canonical non-negative decimal strings, validated against the run maximum and compared numerically. Run identities are branded independently of Session and Team identities. The [local provider](../simulation-local/README.md) owns storage and coordinator exclusion; the [design note](../../../.agents/notes/proposed/architecture/2026-09-17-durable-simulation-coordination.md) owns the broader coordination design.

`reserveParticipant()` records immutable local actor configuration and canonical identities before Team IO. Binding must match that reservation; unfinished provisioning prevents the run from entering its running phase. `reserveChannel()` retains a stable direct-channel identity, ordered members and limits; `confirmChannel()` records completed attachment and endpoint consent before execution.

`SimulationRun.change()` owns administrative Entity and organization mutations. `changeMany()` validates ordered changes and publishes them in one atomic append; an invalid change or write failure preserves the prior state. Entities retain immutable kind/cognition and independent profile revisions; termination is irreversible. Run configuration declares relation endpoint kinds and temporal cycle rules. A relation may carry an organization `scope` only when its rule explicitly permits that entity kind through `scopeKinds`; cycles are checked within one scope. `relationsAt(time, scope)` selects that organization, `null` selects unscoped facts, and an omitted scope selects all facts. Relations use half-open simulation-time intervals, revision checks, and stable id ordering in `relationsAt()`. These methods are not model-facing proposal tools. Deterministic decisions retain an immutable policy generation and output before using the same submission/acceptance protocol; inference is forbidden once the policy is selected.

Cognitive entities may retain one immutable Team/Participant/Session binding and one writer epoch. `reserveWriter()` returns a controller-only lease; activation, revocation and proven-stop release share the run queue. Unreleased epochs block a successor and prevent run ownership from being released. `onClose()` installs the single non-reentrant runtime retirement callback. The [Team integration](../simulation-team/README.md) supplies actual controller evidence and server-derived Session identities.

`SimulationRunSpec` requires `maxTokensPerInterval`, `tokensPerModelRequest`, `budgetInterval`, `maxDecisionsPerInterval`, `maxMessagesPerInterval`, `maxPendingEvents`, `maxPendingInteractions`, `maxKnowledgeBytes`, `maxKnowledgePerQuery`, `maxQueuedDecisions`, `maxDispatchWaitRounds`, `maxEntities`, `maxResidentActors`, `maxIngressBytes`, `maxConflictRetries`, `decisionTimeoutMs`, `maxDecisionsPerWindow`, `maxOperationsPerDecision` and `maxResourceQuantity`. A writer installs a live decision-admission check, opens a serial slot, and submits staged operations. Acceptance persists the decision and every intent atomically; it does not execute effects. The run executor settles local operations in slot/index order and returns immutable prior results on retries. Resources use integer strings in fixed units. Exact one-use grants permit cross-entity transfers; requests create commitments only on assignee acceptance, and fulfillment requires matching world evidence or creditor confirmation.

`scheduleWake()` assigns and persists `(time, microstep, phase, slot)` keys. `drive({ until })` settles local operations and events under explicit `maxDriveSteps`, `maxMicrostepsPerTime` and `phaseOrder` policy. Event consumption records a durable wake or deadline fact before returning. A scheduled decision claims its wake; acceptance completes that responsibility, while cancellation or writer retirement returns it for retry.

`openWindow()` freezes an ordered actor set, one run revision and every authorized context in one append. Actors submit durable proposals independently; `commitWindow()` accepts them in slot order and stops at the first unfinished slot. World operations and time advancement wait for window closure. Cancellation preserves the slot and returns its wake to pending; writer retirement cancels unaccepted submissions.

`communication/post` fixes the recipient, channel, text and `deliverAt` in the accepted intent. `dispatchOperation()` invokes a trusted idempotent `SimulationTeamTransport` only after readiness, checks the exact receipt, and persists real-time attempts using explicit `outboxMaxAttempts`/`outboxRetryDelayMs`. Exhaustion records an unknown outcome and stalls; `retryOutbox()` records a new retry budget without changing identity or payload. A due unresolved publication blocks its recipient from opening another decision.

A model decision records one real-time deadline before its first request. Completion time shares the proposal submission or acceptance batch. An unfinished decision reaching the deadline becomes `cancelled` with reason `timeout`; its wake returns to pending and later window slots can proceed. Replay uses recorded timing and never starts timers.

Resource read-version conflicts create one retry responsibility per decision at a later microstep. The next decision inherits the root decision and attempt from its wake; restarting does not reset the chain. `maxConflictRetries` bounds these automatic opportunities, and zero stalls on the initial conflict. Exhaustion records `SIM_CONFLICT_RETRY_LIMIT`; `acknowledgeConflict()` preserves the failed result and budget, followed by an explicit resume. Applied operations are never replayed automatically. Prior operations waiting for future dependencies retain their ownership without blocking retry-window admission.

`ingest()` atomically records external text, receipt order and an allocated event key. Identical ids retain the original payload and assignment; conflicting retries reject. Inputs may arrive while paused or while a window is frozen. Their availability is clamped to the current simulated time and their event cannot enter a prior window. `maxIngressBytes` bounds the complete UTF-8 JSON receipt. Source labels are attribution, not authority.

`population()` derives counts from durable entities and writers. `maxEntities` includes active and inactive entities; irreversible termination releases that population slot while retaining history. `maxResidentActors` charges reserved, active and revoked writers until confirmed release. These limits are enforced in creation/reservation folds before runtime startup and remain charged after restart until controller reconciliation.

`collectDecisionWakes()` collects pending decision events sharing a time, microstep and phase, in original event-key order and within `maxDriveSteps`. A work-limit result requires another collection call before nomination. It stops at claimed wakes, nominated candidates, other phases and later microsteps; partial collection survives restart. `queueDecision()` retains immutable administrative priority, optional deadline and wake identity. `reserveDecisionWindow()` persists distinct-actor order: candidates waiting `maxDispatchWaitRounds` allocations take FIFO precedence, then earliest deadline, descending priority and FIFO. `openWindow()` must use that reservation unchanged. Queue capacity includes reserved candidates; `cancelQueuedDecision()` cancels the whole unopened allocation when any selected candidate is cancelled. Queue rounds and ordinals expose waiting age and survive restart; residency and context resolution follow selection.

`budgetUsage()` derives interval consumption from retained opened decisions and accepted message intents. Intervals start at multiples of `budgetInterval` from simulation zero. Cancellation and transport retries do not refund usage. Oversized windows or message proposals remain unaccepted and record `SIM_BUDGET_LIMIT`. `extendBudget()` adds capacity to one interval with an immutable retry identity and reason; explicit resume requires enough capacity for the denied demand. Grants do not carry into later intervals. `tokensPerModelRequest` is reserved before each model attempt against `maxTokensPerInterval`. Complete usage charges uncached input, cache and output; partial or missing usage retains at least the reservation and any higher observed usage. `reconcileTokenUsage()` resolves unknown attempts without re-inference. Reported overruns stall until acknowledged and covered by interval capacity; a reservation is not proof of a provider-enforced token ceiling.

`queueUsage()` counts pending events plus pending/claimed wakes, and interactions awaiting resolution. Reply expiry alone does not release an unresolved interaction; completion, cancellation or rejection does. `maxPendingEvents` and `maxPendingInteractions` bound these backlogs. Capacity failure records `SIM_QUEUE_CAPACITY` without partially publishing an effect and its derived events. Freeing capacity or idempotent `extendCapacity()` allows explicit resume; historical records remain retained.

`recordKnowledge()` retains owner/kind-stable versions of observations, receipted reports, inferences, configured beliefs and policy-derived summaries. `queryKnowledge()` combines a fixed cursor/time with both historical and current audiences, checking every inference and summary premise without recursive calls. Candidate selection uses explicit ids when supplied and stops after the requested number of authorized results. `prepareContext()` accepts explicit knowledge ids and a required/optional flag; selection uses the decision owner and snapshot, then follows the existing byte budget. Revocation rejects later retrieval/submission without erasing retained Session history. Reports require their recipient receipt and exact body; inferences require premises actually selected for their accepted decision.

## Model Experience

### Run administration

#### What the model sees

`ctx.simulations` has no model-visible contribution; run administration neither requests inference nor changes Session context, token usage, or KV-cache prefixes.

#### Token effect

Zero direct token effect.

#### KV Cache effect

No model-request prefix changes.

## Known Limitations and Deferred Work

- Runs have one local coordinator; distributed execution and branch identity remapping remain unimplemented.

Belief/inference confidence is optional policy metadata in `[0, 1]`; it does not change visibility or world authority. Summaries retain exact premise versions and a policy generation, so current source revocation also blocks later summary retrieval. A future-dated revision does not hide an older version that is still available at the query time.

Compacted report references can be rematerialized without changing decision identity, snapshot or source versions. Presentations retain their required-section budget and prior hashes; Session repair accepts only an authoritative current/prior presentation. Oversized required material must be cancelled and re-prepared with an appropriate budget. A root reservation or completed checkpoint fixes the canonical execution Team even before any entity is bound. Binding, root reservation, checkpoint publication and attachment must agree with that retained identity; an unconfirmed root cannot be published as a complete checkpoint.
