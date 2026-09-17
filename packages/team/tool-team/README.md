# @clocky/clocky-tool-team

English | [中文](README.zh.md)

`@clocky/clocky-tool-team` installs Team tools only in a live Agent scope whose Session header names a valid Team and Participant. `team_task_report` and `team_task_integrate` consume the durable task-assignment source admitted by [`@clocky/clocky-team-agent-client`](../team-agent-client/README.md). All tools use an activation-bound `TeamLink` and never accept model-supplied Team, Participant, activation, Session, revision, recipient, or next-phase authority.

Repeated original and continuation inputs may carry the same durable assignment. Reporting, heartbeat, and integration require all sources for the selected task/attempt to agree on Team, channel, Envelope, activation, and revision; a conflicting source still rejects.

## Task reporting

`team_task_report(task_id, attempt_id, outcome, summary?, failure_code?, failure_message?, evidence?, artifacts?, changed_paths?, verification?)` accepts `completed`, `failed`, or `released`. `completed` requires `summary` and may carry evidence statements, changed paths, verification text, and workspace-owned artifact references; `failed` requires `failure_code` and `failure_message`; `released` accepts no outcome-specific text. The tool requires exactly one persisted `team-task-assignment` `user/message` source for the requested task/attempt, requires that source to match the calling Agent's current Team/Participant header and active activation binding, and requires its task to retain the exact running lease. With local Team authority it opens a short-lived configured Link; a remote child instead borrows its current fixed Link. Both paths derive actor facts before the Team provider applies its owner fence and `task-mutate` policy.

`team_task_heartbeat(task_id, attempt_id)` renews the exact running lease through the same assignment source and activation-bound Link. It returns the new expiry and never changes task phase or attempt identity.

## Integration tasks

`team_task_integrate(task_id, attempt_id, verification?)` executes the current assigned integration task. The Hub derives the source task and completed attempt, workspace provider, target, expected target revision, and proposal/integrate mode from the frozen task; the model supplies only the assignment identities and optional verification. The provider receives the source attempt's durable artifact manifest, so the source allocation can be released before integration. A provider returns a proposal, an integrated target version, or a conflict; the result is retained in the integration attempt before the tool returns.

`team_task_review(task_id, decision, reason)` is available to the exact configured reviewer. The current review-assignment source supplies the revision fence; the tool posts a response to the assignment initiator and resolves the durable `completed` or `pending` transition through the activation-bound Link.

`team_message(channel_id, text, delivery, audience?)` posts an explicit text Envelope through the caller's current activation-bound Link. Direct v1/v2/v3 channels default to their peer. A direct v4 call defaults to broadcast and accepts an explicit recipient subset; it wraps text in the ordered-content payload. A remote call reads its exact member-authorized channel metadata through the bound Link and prepares the same protocol payload and default audience. Other adapters apply their manifest audience rules. Its retry key is derived from the `team_message` call lineage and remains distinct from `team_final` retries.

The Hub retains authority over task phases. A completed report enters `review` only when the task's frozen policy names a reviewer; a `{ kind: 'none' }` policy completes the task directly. Failed and released reports return to `pending` until the task reaches `maxAttempts`, then enter `failed`. `team_task_report` does not resolve review, mark a Team complete, or route a later assignment. A repeated report succeeds only when the durable attempt history contains the exact same outcome; a different recorded outcome or a replaced lease is rejected.

## Final answers

`team_final(channel_id, text)` accepts only a nonempty `text` and the id of an active direct v2/v3 product channel or an exact coordinator/human v4 channel. A local caller verifies Team state; a remote caller borrows its fixed Link. In both cases the Team provider atomically derives the peer and current cursor from the authenticated binding and channel.

The tool posts a `final` Envelope with `{ text }` and `turn` delivery through `postDirectFinal()`. Its key derives from the model-call lineage, so a lost response replays the same Envelope while changed arguments conflict. It returns the accepted channel and Envelope ids.

## Configuration

```yaml
- id: tool-team
  name: '@clocky/clocky-tool-team'
  config:
    linkProvider: local
```

`linkProvider` defaults to `local` and must name the Link provider that can authenticate the calling Agent's current activation binding.

## Model Experience

### Task attempt report

#### What the model sees

The scoped [`team_task_report`](../../../docs/tool-catalog.md#team_task_report) schema and a compact result containing the task id, revision, phase, attempt outcome, and whether the result was newly settled or already recorded. A reviewer also receives the exact `team_task_review` schema and a Team review-assignment input containing the attempt result, initiator, and review revision. The assignment remains the logged input supplied by the Agent Client. Normal `tool/call` and `tool/result` events retain the requested outcome and returned task state; this package adds no separate Session event.

#### Token effect

One scoped task-report schema and one compact result per report. Agents outside a Team-bound Session receive neither Team tool.

#### KV Cache effect

The schema is stable while this plugin remains in the Agent scope. Assignment messages and report results are dynamic suffix entries.

### Task integration

#### What the model sees

The scoped [`team_task_integrate`](../../../docs/tool-catalog.md#team_task_integrate) schema accepts only the assigned task id, attempt id, and optional verification. Its compact result retains the task phase, integration status, target, optional target version, conflict paths, artifacts, and whether the result was newly settled or already recorded. Source task, source attempt, provider, target fence, mode, and activation authority remain durable or derived facts rather than model-selected arguments.

#### Token effect

One scoped integration schema and one compact result per integration attempt. Agents outside a Team-bound Session receive no integration tool.

#### KV Cache effect

The integration schema is stable while the plugin remains in the Agent scope; the assignment, provider result, and verification are dynamic suffix entries.

### Task heartbeat

#### What the model sees

The scoped `team_task_heartbeat` schema and a compact running-task result with the renewed attempt expiry. The assignment source and activation identity remain durable but hidden from model arguments.

#### Token effect

One scoped heartbeat schema and one compact result per renewal.

#### KV Cache effect

The schema is stable for the current task Agent scope; each renewal result is a dynamic suffix entry.

### Task review and explicit channel message

#### What the model sees

Reviewer Agents receive the scoped `team_task_review` schema; any Team-bound Agent may receive `team_message` when its preset mounts this tool. Both return compact channel/task confirmations and hide the derived activation identity.

#### Token effect

One review schema and one explicit-message schema are added to the owning Agent scope.

#### KV Cache effect

Both schemas remain stable for the scope; decisions and accepted Envelopes are dynamic suffix entries.

### Final answer

#### What the model sees

The scoped [`team_final`](../../../docs/tool-catalog.md#clockyclocky-tool-team) schema accepts only `channel_id` and `text`, plus a compact accepted channel/Envelope result. Recipient and activation facts never enter the model-visible arguments. Normal `tool/call` and `tool/result` events retain the request and confirmation; the accepted final remains in the channel WAL rather than creating a Session event here.

#### Token effect

One additional scoped schema and one compact result per final answer.

#### KV Cache effect

The final-answer schema is stable while this plugin remains in the Agent scope. Its request and confirmation are dynamic suffix entries.

## Known Limitations and Deferred Work

- **Artifact storage remains provider-owned** — reports retain validated artifact ids and provenance metadata, while bytes and publish/integrate operations belong to the selected workspace/artifact provider. The shipped worktree route consumes one provenance-bound Git patch artifact; shared, sandbox, and E2B directory routes consume one provenance-bound portable change-set patch artifact; report-only providers may define another artifact interpretation.
- **Requires durable assignment delivery** — a manually started task without an admitted `team-task-assignment` source cannot use this model tool.
- **No local final-answer delivery** — `team_final` appends a final Envelope, while the local Agent client deliberately leaves final Envelopes out of Agent inboxes; TeamRun or a human delivery Consumer owns final receipt.
