# Agent Note: Real Loader fixture ownership

Status: implemented

English | [中文](2026-10-03-real-loader-fixture-ownership.zh.md)

## Problem

Real Loader tests can fail for environment and authority assumptions that hand-mounted unit fixtures do not exercise. A temporary workspace beneath the checkout inherits its parent's instructions and skills unless project discovery stops locally. A Host event subscriber without a product principal cannot observe principal-owned Team requests. A shipped profile's resolver cannot import an optional provider absent from its declared dependency closure.

## Decision

The shared ACP and Loader-smoke harnesses create a local `.git` project marker before seeding each workspace. Fixture-owned instructions and skills remain visible; unrelated parent-checkout content does not enter the model's durable log when `TMPDIR` is project-local. The marker does not make the workspace a usable Git repository; scenarios testing Git behavior initialize their own repository.

Simulation benchmark source inventories constrain the Git query to packages, vendor, Simulation scenarios and explicitly owned driver/manifest paths before reading NUL-delimited names. They omit cached paths deleted from the working tree and retain current untracked source files. Unrelated notes and temporary output cannot exhaust the subprocess output buffer; an uncommitted rename cannot make the collector read its deleted old path.

Host question, approval, cancellation and retention fixtures authenticate a stable test principal for the complete scenario, including event subscription. Their human participant belongs to that principal, and creation acknowledges the exact invitation through `createPrincipalChannelAdmission()`. The lease remains live until the scenario settles and is revoked before its provider is unregistered. Production authorization and event filtering remain enforced.

ACP legacy replay scripts that finish with assistant text use an explicitly configured test-only finalizer matching the current direct-v4 protocol. Production completion still requires an explicit final Envelope. Exact schema, prompt and transcript assertions remain enabled; known wording, package-name and JSON-key-order changes are mechanically migrated only after their owned source and successful runtime behavior are checked.

Built profile tests require retired Goal rows to be absent. The generated Remote smoke exercises the current commands namespace through plain Node, a real HTTP route, invalid-input rejection and both explicit and Agent-scoped calls. Optional ACP runtime and digest-principal providers used by CLI overlays are declared in the CLI resolver's dependencies.

Lifecycle fixtures preserve the public owner of each transition. Cordis effect disposal removes a supervisor registration once, so retiring a replaced fiber cannot remove its successor. ACP cancellation awaits the coordinator interrupt request before returning. Browser-launch diagnostics retain the first stderr line with LF or CRLF delimiters. Simulation request comparison reports a conflict only between different terminal receipt and domain outcomes; an accepted receipt cannot simultaneously be conflicting.

## Alternatives considered

**Relax production authentication or infer final output from arbitrary assistant text.** This would allow the test to pass by removing the behavior it must protect. Authentication and explicit completion are instead supplied by the fixture at their existing extension points.

**Keep temporary workspaces outside the project.** Repository-local temporary output is required, and callers may select a project-local `TMPDIR`. A local discovery marker provides the same instruction boundary in either location without removing the fixture's own instruction files.

**Refresh every snapshot after a failed run.** This can accept a missing tool, an authorization failure or a truncated transcript as the new baseline. Runtime defects and incomplete fixtures are repaired before any reviewed mechanical golden migration.

## Consequences

Tests reproduce the current product's authority and configuration instead of relying on obsolete defaults. Fixture helpers carry real principal leases and endpoint confirmation, which makes event visibility and cleanup part of the exercised lifecycle. The existing [ACP replay decision](2026-06-19-acp-snapshot-tests.md), [nested-session replay decision](2026-06-22-subagent-snapshot-replay.md) and [assignment metadata decision](2026-08-31-team-snapshot-workspace-metadata.md) remain active: each owns independent replay or assignment guarantees; none is superseded here.

## Verification

Focused Loader-smoke, ACP-harness, Remote lookup and Simulation watch unit tests pass. Real Loader question and approval scenarios pass on JSON and SQLite without changing their result goldens. CLI profile composition, built config dumps and the built commands Remote smoke exercise the repaired entry paths. ACP replay retains exact prompt/schema and durable-log comparisons.

The four Simulation benchmark snapshot files pass all 36 tests, covering actor/world, storage and message workloads, live samples and organization recovery with the bounded source inventory.

SDK reader fixtures retire the real Cordis Team service during authorization and require the pending read to reject without starting an Agent. ACP provider fixtures launch real child processes while controlling external Link claims and transport settlement: inconsistent ownership, views and attempts leave the proxy log and receipt untouched; cancellation preserves admitted input for retry; completion de-duplicates durable replay. Header-persistence failure and unavailable enrollment issuers release the proxy Session and prove child exit before retry. Public tests also verify supervisor replacement/disposal, cancellation settlement, first-line browser diagnostics and the receipt comparison relation above.
