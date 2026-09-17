# @clocky/clocky-team-activation-controller

English | [中文](README.zh.md)

`@clocky/clocky-team-activation-controller` is the Team Consumer that joins a published `AgentRuntime` handle to its authoritative durable Team binding and exposes that owner at `ctx.teamActivations`. It depends on `clocky-team` and `clocky-agent-runtime`; it imports neither `team-hub` nor an AgentLoop implementation.

For a Team with `maxLiveActivations`, `activate()` first commits a Participant startup reservation. The raw binding retains its `reservationId`; a second epoch cannot reuse it. Unpublished starts release capacity only after confirmed cleanup, while bound epochs release through quiescence. Unknown starts retain capacity across restart; closure recovery records `ACTIVATION_STARTUP_UNCONFIRMED`. Failed raw cleanup remains controller-owned for retry even without a capacity ceiling. A confirmed raw termination is retained while reservation release retries; the handle is not disposed twice. Failed close remains retryable with activation admission closed. Known pre-start refusals retain reservation-release ownership through storage failures. A lost bind response is reconciled against the exact durable epoch and settled through quiescence; confirmed raw termination is not repeated when readback or quiescence retries. The plugin registers disposal through `ctx.effect()` so admitted startup and cleanup settle before its proof sources retire.

## Durable activation

`TeamActivationController.activate()` reads the requested Team cursor and active agent Participant, rejects a resident epoch or another Session before placement, calls the named AgentRuntime provider, verifies that the returned handle owns the requested Session and that any local Agent belongs to that Session, then calls `ctx.teams.bindActivation()`. It returns a `TeamActivationLease` only after the binding commits. If the binding rejects, the controller disposes the raw handle; a cleanup failure is reported together with the binding failure.

Provider startup can overlap unrelated Team mutations. The caller's cursor is checked before startup; after the provider returns, the controller reads the current Team cursor for binding. The Hub still checks current membership, admission, proof and cursor under its queue. A rejected bind retains the same raw-handle cleanup behavior.

The controller registers `team-activation-controller` as a system proof source. It retains one nonserializable proof only while it calls `bindActivation()`, `updateActivationStatus()`, `fenceActivation()`, `quiesceActivation()`, or its exact cancellation-stall transition for an observed epoch and cursor; the Hub revalidates that scope under its Team lock. Releasing an entry revokes its retained proofs. Controller close rejects new recovery work while preserving accepted recovery authority and the current stopping entries' short-lived status/quiesce proofs until they settle.

The controller joins concurrent requests for the same Team, Participant, and Session. A replacement epoch requires the prior epoch to be durably `offline`; the Hub retains both epochs and requires every epoch of that Participant to use the same Session. The returned lease exposes the durable binding, optional local Agent, health reconciliation, interruption, and quiescent disposal without exposing the raw provider handle.

A recovery-bearing offline epoch cannot be rebound until it has a durable quiescence proof. After successful raw-handle disposal the controller calls `quiesceActivation()` to release its leases and retire recorded wake channels; that locally settled proof cannot be cold-replaced. `coldReplace()` accepts only an externally fenced proof, retries its wake cleanup, and resumes the same Session under a new activation. The controller itself does not scan deployments. `fenceStale()` checks the exact activation, Session and provider before disposing an owned handle. An unowned epoch requires a validated provider fencer or a retained quiescence/fence proof; offline status alone does not prove termination. An admitted stale fence excludes concurrent activation, replacement and duplicate fencing for that Participant. Close waits for its provider call and durable writeback; plugin unload retains the collected proof-source effects until that settlement finishes.

`recoverClosure()` accepts only a live closure-driver proof for the current durable intent and observed cursor. Each pass selects at most one unresolved epoch. It disposes an exact owned handle or invokes the provider's validated stale-epoch fencer without creating a replacement. Missing ownership evidence records `ACTIVATION_TERMINATION_UNCONFIRMED` or `REMOTE_CANCELLATION_UNCONFIRMED`; an absent handle never proves offline status. Cold replacement records `AGENT_RUNTIME_PROVIDER_UNAVAILABLE`, `AGENT_RUNTIME_FENCER_UNAVAILABLE`, or `AGENT_RUNTIME_FENCE_FAILED` when local recovery ownership is retired or cannot fence, while supervisor failures retain their typed supervisor code. A confirmed fence with outstanding allocations persists `fencedAt` and requests their release before complete quiescence. The same fact survives restart, so already terminated process trees need no second termination proof. Preserved allocations record `WORKSPACE_RELEASE_RECOVERY_FAILED` and retain their metadata. Accepted recovery operations keep their proof authority until settlement during unload.

## Health and teardown

The controller subscribes to the accepted handle's status stream and releases every owned activation when its Team records a durable cancellation. The in-process provider maps its local Agent transitions to `running`, `idle`, `stopping`, and `offline`; a remote provider can report the same states without requiring a global local-Agent observer. Lease disposal writes `stopping`, releases the raw handle, then records quiescence. If a remote provider cannot prove termination during a durable cancellation, the controller retains the stopping entry and records `REMOTE_CANCELLATION_UNCONFIRMED` as a Team stall; it never reports that epoch offline. Status writes serialize per activation and retry configured Team-cursor conflicts. Unload waits for accepted cold replacement as well as normal activation work.

`disposalTimeoutMs` bounds unload settlement, defaults to `5000`, and cannot exceed Node’s `2147483647` millisecond timer limit. `statusSyncAttempts` bounds cursor-conflict retries for one observed status and defaults to `8`.

`activate()`, `coldReplace()`, `preflightResume()` and `recoverClosure()` capture their target fields before asynchronous work. A human resume authorization must keep naming that same Team at every authorization check, including checks after provider publication and before fencing or durable bind. Editing the caller’s original request cannot redirect an accepted operation to another Team. Controller close retains an accepted stopping-epoch cancellation-stall proof while its policy or append is pending.

## Model Experience

### Activation binding

#### What the model sees

The controller adds no prompt, tool, or message. [`clocky-team-agent-client`](../team-agent-client/README.md) admits channel input only after the matching durable binding is visible.

#### Token effect

Zero direct token effect.

#### KV Cache effect

This package owns no model-request prefix.

## Known Limitations and Deferred Work

- The controller accepts local-agent and remote-agent Participants. A remote provider needs an exact handle-status protocol; remote channel delivery and receipts still require a Link.
- It does not schedule tasks, allocate workspaces, open channels, or expose Team product APIs.
