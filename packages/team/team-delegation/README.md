# @clocky/clocky-team-delegation

English | [中文](README.zh.md)

`@clocky/clocky-team-delegation` drives the shared-workspace child-Team saga. It discovers durable parent delegations, reserves child identity before creation, binds the child consult endpoints, admits the parent-service result, and settles or cancels the parent task only after child state and usage charges are durable.

## Delegation lifecycle

The Consumer uses bounded event-driven drives and restart discovery. `maxOperationsPerDrive` bounds progress for one parent, `channelPageSize` bounds child-result reads, `teamPageSize` bounds Team discovery per pulse, and `pulseIntervalMs` controls the restart-safe discovery interval. Parent delegation proofs, child-creation proofs, channel-consent proofs, request-post proofs, and child-result proofs are retained only while their selected operation is live.

Child creation uses the parent task's frozen authority grant, budget, and workspace path. Child tasks never acquire a Participant activation lease. The child runtime binds one consult channel with a parent-service initiator and child coordinator respondent; the parent objective becomes the only request, and the coordinator response is admitted by its causal Envelope identity. A child cannot complete through the root Team final-result sink.

Pending child usage charges are repaired before the child continues or completes. A parent result admission is durable before child completion records the service receipt, terminal closure, and parent settlement. Missing endpoints, stale delegation state, unavailable workspace roots, policy denial, and changed result provenance fail closed.

## Model Experience

### Delegated child work

#### What the model sees

The child coordinator receives one consult request containing the parent task's retained objective. The parent coordinator reads the admitted `delegation_result` text and non-private artifact references through Team task state.

#### Token effect

The child request and response consume model context only in the child coordinator's Session; parent settlement records do not add model input.

#### KV Cache effect

Delegation does not rewrite the parent coordinator's static prompt prefix. The child consult is a separate channel and Session input.

## Known Limitations and Deferred Work

- The Consumer supports one shared-workspace child generation per reserved parent task. Non-shared child roots, child workflow nodes, multiple generations, parent review, placement, and integration remain separate scope decisions.
- The parent task must use `reviewPolicy: { kind: 'none' }` and a child-Team execution descriptor; Participant task placement and worker leases are not substituted for child execution.
