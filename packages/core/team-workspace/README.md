# @clocky/clocky-team-workspace

English | [中文](README.zh.md)

`@clocky/clocky-team-workspace` defines the named `ctx.teamWorkspaces` registry for task execution-root providers. It selects providers by the immutable `TeamTaskWorkspaceMode` carried by a Team task, but imports neither a Team Hub implementation, Agent, Session loop, filesystem backend, nor transport.

## Provider contract

A `TeamWorkspaceProvider` registers under one non-empty name for one or more distinct workspace modes. Only one live provider may own a mode. `resolve(mode)` fails when a composition has no provider for a task's required mode; optional `preflight(mode, { task, participant, route })` rejects a route before activation without allocating or mutating Team state; `eligible(mode, { task, binding })` checks a bound candidate without allocation. `prepare(mode, request)` returns root-free provider metadata, `materialize()` creates its live root only after Team reservation, and `restore()` reopens exact durable metadata. `reconcileRelease()` proves or completes a release-requested cleanup without creating a root.

`encodeTeamWorkspaceChangeSet()` and `parseTeamWorkspaceChangeSet()` define the bounded portable JSON payload used by non-Git providers that own their own integration targets. It carries one source attempt, distinct safe relative paths, file bytes, symlink targets, and deletions; providers still own target authorization, expected-version fencing, staging, and recovery semantics.

Preparation and allocation metadata carry the Team, task, current attempt, assigned revision, Participant, activation, and Session identities; roots and credentials remain live provider data. The registry rejects metadata or materialized results whose provider or identity differs from the request. A live allocation has an idempotent `release()` operation. `publish(mode, request)` reports provider-owned changes; `integrate(mode, request)` is an explicit proposal/merge operation whose authority remains provider- and policy-owned. `integrateSource(provider, request)` supplies a completed source attempt's durable artifact manifest to a named provider, so the source allocation can be released before integration. Providers never auto-merge or force-push. The registry owns registration identity only; a provider owns root allocation, resource cleanup, and eligibility policy. A task-delivery Consumer owns the exact Agent-keyed live root and optional cleanup settler; the activation owner awaits that settler before local process disposal.

An allocation may expose `onLoss()` for exact provider observations. The current Agent Client records its world and retained artifacts as `unavailable`, stops only the task's proven turn, and releases a confirmed expired world before attempt settlement. Unconfirmed execution remains stalled; a missing path never becomes a replacement world. [Loss ownership](../../../.agents/notes/implemented/architecture/2026-09-08-e2b-workspace-loss-settlement.md).

Providers may expose a default-off periodic observation pulse. A pulse records `stage: 'periodic'` for bounded live allocations through the same Team WAL and proof path; it does not represent a filesystem lock or identify a writer.

## Model Experience

### Team workspace registry

#### What the model sees

`ctx.teamWorkspaces` registers no prompt section, tool, model input, or model output. A task Agent Consumer decides how a provider-backed allocation changes execution behavior. `publish()` reports provider-owned changes; `integrate()` handles a live owned allocation, while `integrateSource()` handles a completed source attempt from durable artifacts. Both make the proposal/merge decision explicit and leave authority to the selected provider and Team policy.

#### Token effect

Zero direct token effect.

#### KV Cache effect

This registry owns no model request prefix.

## Known Limitations and Deferred Work

- **No default provider** — a composition must mount a provider for every task workspace mode it schedules.
- **No task mutation or artifact storage** — the Team provider remains the authority for leases and task lifecycle; workspace and artifact providers own their separate resources.
