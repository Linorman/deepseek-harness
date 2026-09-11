# @clocky/clocky-team-channel-task-assignment

English | [中文](README.zh.md)

`@clocky/clocky-team-channel-task-assignment` registers the version-one `task-assignment` `TeamChannelAdapter` on `ctx.teams`. Mount it after a `TeamRuntime` provider. The adapter represents the durable owner-notification record for one Agent-bound task attempt; it does not assign a task or start an Agent.

## Task-assignment protocol

The manifest contains exactly one participant with role `assignee`. Its strict adapter limits are `{ taskId, activationId, sessionId }`, freezing the task and intended durable Agent binding before the Hub mints an attempt. The adapter's initial fold state copies those immutable facts and expects that participant to provide the one assignment turn.

The sole accepted Envelope is a self-addressed `assignment` turn: its sender and one explicit audience are the `assignee`, its top-level `taskId` equals the manifest task, and it has no `causationId`. Its payload is exactly `{ taskId, attemptId, assignedRevision, activationId, sessionId }`; the task and binding fields must equal the manifest limits, while the attempt id and assigned revision fence the lease created after channel opening. A second Envelope or adapter-owned record is rejected. The accepted Envelope creates one `DeliveryIntent` for the assignee with `turn` treatment.

The package exports stable adapter, role, and Envelope-kind constants plus `parseTaskAssignmentChannelManifest()` and `parseTaskAssignmentEnvelope()`. A delivery Consumer can parse a replayed channel manifest and Envelope without duplicating unchecked JSON access. The parser checks manifest ownership, self-addressing, task/binding equality, and the exact payload before returning branded task, attempt, activation, Session, and recipient facts.

## Model Experience

### Task-assignment channel protocol

#### What the model sees

This package registers no prompt section, tool, model input, or model output. Its durable `assignment` Envelope reaches a model only when a separate Agent delivery Consumer admits it as a logged turn.

#### Token effect

Zero direct token effect.

#### KV Cache effect

This package owns no model request prefix.

## Known Limitations and Deferred Work

- **No lease mutation or owner start** — the Hub must atomically bind its lease to the channel and the later delivery Consumer must claim the exact Envelope before starting the attempt.
- **No transport, inbox admission, receipt, heartbeat, settlement, workspace, or review handling** — Link, Agent Client, Team Hub, workspace, and task-policy Consumers own those independent effects.
