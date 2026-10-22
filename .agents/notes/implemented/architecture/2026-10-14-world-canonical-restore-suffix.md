# Agent Note: World restoration validates canonical owner suffixes

Status: implemented

English | [中文](2026-10-14-world-canonical-restore-suffix.zh.md)

## Problem

An initial checkpoint precedes later hires and representatives. A later Team/Channel projection can agree with its own log while disagreeing with Native's original participant descriptor or Session endpoint. Rechecking only the old checkpoint prefix cannot identify that mismatch. A committed hire also needs the same original Persona contract as a committed representative.

## Decision

[Shared owner-reference checks](../../../../packages/simulation/simulation-team/src/owner-references.ts) compare every reserved participant's immutable kind, name, role, capabilities and runtime hints with Native's original reservation. They compare every confirmed Native Channel's actual manifest and endpoint consent against its original participants, roles, limits, adapter, Session bindings, required flags and manifest fingerprint. Collection and restoration use the same checks, including owners added after the selected checkpoint. Retired membership and closed Channels retain their legitimate phase; phase is not replaced with a requirement to be active.

Session bindings retained by the selected manifest are checked before late Channel traversal. The existing protected-prefix, consumption, activation, cleanup and accepted Envelope checks remain authoritative for their sources. All validation precedes phase change, attachment or writer recovery; an exclusive Native open does not expose a writable restored connection before these checks pass.

Committed generated/representative Persona profiles remain their original accepted profiles. Generic profile mutation refuses replacement before append, and the generated-hire projection rechecks its original plan/profile on replay. Native stream 94 rejects earlier interpretations; checkpoint manifest 4 and compiler 9 remain unchanged. World initialization is not a missing-evidence transition: only changes between retained evidence states use evidence submission allowances. The complete actual evidence batch remains bounded.

## Alternatives considered

**Trust a current owner's own fingerprint.** It proves internal consistency, not agreement with the original Native allocation.

**Require every historical owner to be active.** That rejects lawful departure and confirmed Channel closure instead of verifying their retained identity.

**Regenerate a missing Persona or canonical identity.** That replaces an accepted source, changes model history and can duplicate responsibility. Missing sources refuse writable restoration.

## Consequences

The [durable fault scenario](../../../../examples/simulation-company/tests/world-restore-contract.snapshot.ts) clones real completed company/laboratory worlds and restores from their initial checkpoint. It damages actual later Session files, participant WAL snapshots, Channel invitations, retained Envelopes or appended Native profile records, removing only rebuildable projection caches. The existing correct baseline restores paused; damaged sources refuse without model, activation, publication, attachment or Native journal changes. Faulted media use independent copy-on-write storage; immutable baseline files can share read-only bytes. The Python mutator is test-only and accepts `PYTHON` for an explicit interpreter.

[Checkpoint reference coverage](2026-10-14-world-checkpoint-reference-coverage.md) owns completeness/content commitments; [public failure references](2026-10-01-simulation-checkpoint-failure-diagnostics.md) owns disclosure-safe diagnosis. Both retain independent contracts and are not superseded. These owner checks do not themselves prove the broader SIGKILL matrix or real-model quality.
