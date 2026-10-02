# Local simulation runs

English | [中文](README.zh.md)

Unknown external outcomes accept one durable exact `retryOutbox()` grant under the unchanged `outboxMaxAttempts` bound. Run-wide grant identity, original acceptance time, reason and observed attempt count cannot change on retry; an identical historical grant is returned without another allowance. Queued caller authority is rechecked before append and after IO. A lost committed response stays reconcilable by the same request. Grant and query perform no target IO or inference, and scheduling resumes only explicitly. Native journal format 46 rejects prior records; no old four-argument retry API is retained.

Interval budgets and resident-slot admission reuse the Simulation Definition's shared `budgetUsage()` and `simulationResidentSlots()` projections. Token bucket and aggregate sums reject unsafe integer totals instead of rounding; reserved and unknown attempts remain charged. Product status reads consume the same authoritative arithmetic without opening a run or performing recovery.

Read-only inspection includes original sequence/value entries only when `includeRecords` is requested. JSON and SQLite use the same fully validated, provider-bounded history observation as the snapshot; neither acquires a writer or creates absent history. These private native entries require consumer authorization before disclosure.

Read-only `inspect()` replays bounded retained history through the same folds and projection checks as open, using no run/coordinator ownership or create/restore calls. `inspectionMaxEntries` defaults to 100000 and `inspectionMaxBytes` to 16777216; both are configurable positive safe limits. Wrong media/spec, incomplete or corrupt history and overflow reject. Owner observations distinguish this provider, another coordinator, unowned and unavailable evidence; they never authorize takeover. Provider shutdown closes inspection admission and drains admitted readers before releasing owned runs. This native foundation does not register a product directory or expose authenticated Web APIs.

Mount `clocky-simulation` and this opt-in provider. Config requires `name`, a dedicated local-filesystem `root`, `backend` (`json` or `sqlite`), and positive integer `replayPageSize`. The [Loader fixture](../../../examples/headless-agent/tests/fixtures/simulation/simulation-local/cordis.yml) is the minimal executable composition.

`inspectEntity(id)` returns a detached entity with the same observation’s run id and global revision, without copying unrelated history. Unknown identities omit the entity; writes still validate their expected revision and authority.

Pending appends and replay pages reuse a private entity dictionary across adjacent entity changes. Every record retains schema, sequence and causal validation; a rejected batch leaves the published projection unchanged. Creation records the exact run configuration and starts paused. Phase writes compare the observed revision, serialize per run, append to one versioned Storage journal, and publish detached projections only after durability. Reopening validates all records and configuration before returning a handle. Invalid formats, removed prefixes, backend changes, and duplicate creation reject. Close rejects new writes, drains accepted operations, and releases the medium before coordinator ownership; failed cleanup remains retryable.

Each run directory holds an `owner.sqlite` database separate from its JSON or SQLite journal. A lifetime `BEGIN EXCLUSIVE` transaction excludes another local process even between journal writes. OS process exit releases the lock; takeover does not use expiry or PID guesses. The owner file must never be deleted/replaced while processes can access the run, and every coordinator must use the same canonical storage root. SQLite support is required even with JSON journals. Dedicated simulation storage has no destructive retention API.

The journal records decision slots, accepted intent batches and atomic local settlements. Transfers conserve resources and validate the entire read set, permissions, grants and resulting balances before publishing any effect. Partial deliveries retain evidence; cancellation cannot erase them. Writer revocation cancels open slots while accepted operations remain owned by the run. A wake nominated by the fair queue must enter through its reserved allocation; a manual decision or window cannot consume it under another identity. Replay validates decision-to-intent references and fingerprints before exposing the projection. Replay also rejects local settlements that skip an earlier unsettled local operation in decision-slot/index order; live execution uses the same fold.

The journal stores exact scheduled keys and allocation counters. Reply expiry, deferred wakes and commitment breach timers are appended atomically with their business effects. Consuming an event advances simulation time and records its consequence in one entry. Same-time consequences use the next microstep. An overflowing zero-time chain retains the event and stalls with `SIM_MICROSTEP_LIMIT`; cancelling that event and explicitly resuming resolves the stall. Real transport TTL is not used as a business deadline.

Journal version 46 retains organization-scoped relations and complete publication references (run, Team, recipient and channel position) alongside readiness and attempts; earlier journal formats reject on open. Task reconciliation retains the accepted creation receipt identity and exact executor/attempt outcome. The fold rejects unrelated creations and attempts owned by another interaction assignee before deriving fulfillment. Target IO runs outside the run queue, allowing writer revocation while a post is in flight. Close drains accepted dispatches before releasing storage. New attempts and pre-dispatch rejections require running admission outside a frozen decision window and terminal prerequisites. Admitted transport completions remain recordable while paused. A transport must atomically deduplicate operation id/fingerprint and, when `publishAllowed` is false, reconcile existing results without publishing anew. A publication receipt does not prove recipient Session persistence or business acceptance.

`recordDeliveryFailure()` retains the exact Hub abandonment record and stalls before further time advancement. Input and wake responsibility remain intact. `resolveDeliveryFailure()` requires retained input, live-writer absence evidence, or irreversible entity termination; it does not change commitments or fabricate a receipt. Resuming is a separate explicit phase transition.

Root-Team reservation and confirmation are durable run events. A retry cannot change the creation payload, and an unconfirmed reservation cannot acquire entity bindings or enter the running phase.

A handle used only to inspect replayed state can close without retiring historical writers; any admitted mutation, recovery or retirement owner requires writer quiescence. Failed pre-admission validation releases the run lock without changing durable writer records, allowing exact source repair and retry.

## Model Experience

### Run administration

#### What the model sees

No direct model-visible input, inference, token cost, or KV-cache change. `simulation/committed` reports the durable projection and matching journal tail to runtime observers. The event supplies the pre-append revision for live writes and omits it for initial replay. The invariant uses this interval to check each newly accepted decision against the active writer epoch; replay checks historical authority in journal order.

#### Token effect

Zero direct token effect.

#### KV Cache effect

No model-request prefix changes.

## Known Limitations and Deferred Work

- Local create/open, snapshots, phase writes, Entity profiles/lifecycles and temporal organization relations are supported. A running phase does not start a scheduler or a model. Authorized Team publication is provided by `simulation-team`; resident-recipient delivery uses the same journal for its wake and target receipt. Distributed execution remains unimplemented. Recovery replays retained history and checks published manifest journal identities; `simulation-team` owns cross-owner restoration. Storage must be local, with working SQLite filesystem locks.

`managePhase()` retains a caller-selected pause/resume request id, its in-progress state and one terminal outcome. Interrupted requests resume under the same identity; changed payloads reject. Retrying a completed request returns its historical result without changing the current phase. Failed resume requests retain their failure and stall; use a new id after resolving the cause. This controls scheduling only and does not flush or quiesce other owners for a complete checkpoint.

`getPersistenceReference(expectedRevision)` captures the actual run journal descriptor, retained floor and full-state fingerprint under the run queue. The expected revision and physical tail must agree with the projection. This is a collection primitive, not a complete checkpoint or a retention pin.

`acquireCheckpointCut(maxDrainRounds, signal?)` blocks new run writes and dispatches, drains admitted attempts and retirement writes, then requires non-running scheduling and released writers/windows. While the cut is held, only reads are admitted; release is idempotent and does not resume scheduling. Cancelling acquisition releases its barrier without cancelling admitted work. The cut is process-local and does not pin other owners or publish a checkpoint manifest.

Completed checkpoints retain `publishedAt`, the real publication time committed with the manifest. Exact publication retry and cold replay preserve that timestamp; it is independent of simulated time and does not claim that sources are currently verified.

`failCheckpoint(id, error, diagnostic?)` retains a terminal failure and its optional validated public diagnosis without replacing the latest complete manifest. Exact terminal repeats return that original failure and diagnosis, including after JSON/SQLite replay. The native `error` remains private to consumers that authorize raw run history; a public projection must select only the structured stage/category/subject.
