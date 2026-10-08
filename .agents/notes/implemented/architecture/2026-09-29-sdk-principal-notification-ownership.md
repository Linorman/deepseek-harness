# Agent Note: Principal-owned SDK notification streams

Status: implemented

English | [中文](2026-09-29-sdk-principal-notification-ownership.zh.md)

## Problem

An initialized SDK connection shares a runtime with other principals' Teams and Sessions. Authentication at initialization does not authorize global notifications, and an event can wait behind provider IO or output backpressure after its membership or credential retires.

## Decision

SDK Team and channel notifications recheck current direct or canonical parent read authority immediately before publication. Session notifications capture provenance at production and verify the durable member/Session relationship, resolving parent-only ancestry without letting a header grant access. Missing, cyclic or unbound ancestry is withheld.

Parent lookup reads `sessions` through `ctx.get()` because the SDK serving plugin does not declare a Session injection. The persistence fallback uses the same optional-service store. A scoped notification context must not resolve these services through the topology-sensitive property proxy; a valid child's notification would otherwise fail the stream and retire its authenticated connection.

Internal remote activation records belong to the principal that accepted their exact target. A Session event uses this authority only when its source is the record's exact published Agent Session. Resident activation identity prevents a principal change; offline tombstones cannot be inspected or reopened by another principal. This authority works without mounting a child-process Team Hub and grants no management access to other Sessions.

One serialized queue retains notifications through authorization and transport drain. Deployment frame and byte allowances include the active packet, complete JSON-RPC envelope, UTF-8 and newline. Overflow or unexpected publication failure cancels output-drain waiting, terminates the stream, disposes the plugin root and exits with code 1; it never drops an arbitrary middle packet. Reinitialization discards the previous generation; its late responses or failures cannot publish into the replacement connection. Management responses also check their retained lease before returning. A Team final result waits for admitted notifications so SDK transcript collection finishes before its subscription closes.

Product-principal leases expose an identity-free retirement signal, including between calls. Revocation aborts that signal and active call signals immediately, then waits for admitted calls before releasing provider resources. The SDK stops an idle stream on credential/provider retirement and removes its signal listener before replacing or releasing the lease. Publication and transport-owner failures expose credential-safe diagnostics.

## Alternatives considered

**Authenticate once and broadcast every runtime event.** A credential identifies a principal without supplying membership in every Team.

**Use a matching Session id for remote authority.** Another Session object with the same header can impersonate an accepted epoch; the record must own the exact published source.

**Notify retirement only when an admitted call ends.** An idle connection receives no invalidation, and a waiting stream can prevent resource release indefinitely.

**Bound only queued payloads.** The active authorization/write packet, JSON-RPC wrapper and multibyte text can exceed the actual retained allowance.

## Consequences

Management notifications require the same read providers as management requests; internal placement retains its independent exact-epoch authority. Read-denied events are withheld; unexpected provider failures fail the stream and require reinitialization. The [SDK reader decision](2026-09-28-sdk-principal-team-readers.md) retains request and directory semantics, and [remote placement](2026-08-28-sdk-remote-agent-runtime-placement.md) retains activation lifecycle and Link ownership. Both remain active decision owners.

## Verification

Real-Hub tests construct the server in a plugin context without Session injection and exercise two principals, Team/channel/Session filtering, ancestry, membership withdrawal during IO, idle and in-flight credential/provider retirement, generation replacement and frame/byte overflow. Remote lifecycle tests cover exact Session ownership, principal changes and tombstones. Queue tests pin ordering, transport drain, exact UTF-8 limits and callback containment; principal tests pin immediate cancellation with delayed provider release. The keyless JSON-RPC Team-final scenario exercises the assembled transport and durable result path.
