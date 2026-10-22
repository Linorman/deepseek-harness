# Agent Note: Federated resource ownership and consistent cuts

Status: implemented

English | [中文](2026-10-20-world-federation-ownership.zh.md)

## Problem

Durable messages alone cannot decide which partition may spend a shared resource. A lost confirmation must not create two usable copies, and a mailbox-only checkpoint omits the Native and cognitive history required to resume a partition.

## Decision

The opt-in [ownership coordinator](../../../../packages/simulation/simulation-product/src/federation-ownership.ts) owns a separate federated credit resource, its quantity, unique home and monotonically increasing generation. It does not mirror existing Native resources. All spending and whole-resource transfers pass through this one durable authority. Partition principals cannot mint resources or settle ownership. A reserved resource is unavailable to both partitions; destination confirmation remains a retained responsibility until coordinator settlement increments the generation. Old home and old target generations fail. Unknown delivery has no timeout release. An unavailable coordinator grants no local fallback. This central authority deliberately does not claim distributed consensus or a transaction across arbitrary Native effects.

Spend retries return the balance derived at the original operation, including after ownership transfer and restart; former owners cannot query a new home’s later balance through an old operation ID.

The registry journals its exact partition/principal policy and rejects changed policy on reopen. Accepted source reservations, target confirmations and settlement have original IDs and strict replay relationships. Storage append failure closes admission until an owner reloads the durable outcome; it does not infer success or release unknown responsibility.

[Consistent checkpoint capture](../../../../packages/simulation/simulation-product/src/federation-checkpoint.ts) sorts run IDs, holds each actual mailbox queue and sealed quiescent Native/Team/Channel/Session collection, then holds the coordinator queue. It retains complete original streams, full per-run D1 archives, versions, hashes and in-flight reservations/messages. A callback cannot substitute an arbitrary world snapshot: callers provide actual Team connections. Readers validate complete byte/entry bounds, policy partitions, generation, original source messages and target receipts before isolated strict owner replay. The format carries both outgoing and incoming time promises through original mailbox journals. Releasing collections and queues unwinds in reverse order.

Native federation time evidence includes a mandatory `sourceSequence` and the SHA-256 of the exact original mailbox log prefix. The checkpoint validates every historical Native fence and its final projection against the matching owner/run/generation, then checks limit/stop facts through the mailbox owner's shared pure time reducer. Hashing prefixes uses incremental hash copies, so long fence histories do not cause quadratic scans. Later mailbox records may follow the last Native cut. Missing ancestor mailbox dependencies reject rather than inventing a historical authority. Source-scoped message identity and receipt cursors preserve private peer isolation. Mailbox boundary results are detached from retained state. Newly received messages must respect both the local clock and every previously accepted promise from their source, even before the local clock advances; strict replay enforces the same rule.

## Alternatives considered

**Independent local ownership decisions** allow partitioned hosts to spend the same resource. The coordinator must remain reachable for a write.

**Releasing on timeout** mistakes an unknown destination result for rejection. Reservation persists until explicit target confirmation and coordinator settlement.

**Mailbox projections as checkpoints** omit Native, Team, Channel, Session and attachment evidence, as well as outbound time promises. Original owner archives and mailbox journals retain that evidence.

## Consequences

The [two-run resource tests](../../../../packages/simulation/simulation-product/tests/federation-ownership.spec.ts) prove duplicate spending refusal, reservation blocking, coordinator reopen, confirmation recovery, monotonic handoff and stale-generation fencing over JSON and SQLite. Mailbox regressions mutate returned boundary objects and inject an earlier message after an accepted promise, proving rejection before persistence and on replay. [Checkpoint tests](../../../../packages/simulation/simulation-product/tests/federation-checkpoint.spec.ts) capture two actual paused Native runs with root Teams, a delivered message whose reply is lost, an undelivered message and an unresolved resource transfer. An actual Native append barrier proves concurrent clock synchronization and checkpoint acquisition complete without reversing mailbox-to-Native lock order. Original registry/mailbox streams reopen in empty storage; each full run archive restores into a new isolated root through actual owner parsers.

This is an explicit single-coordinator deployment and an independent resource class. Existing Native resources require an explicit domain integration before they can use this coordinator. Coordinator replication, automatic partition membership changes, arbitrary object migration, source/target Native effect atomicity and production federation rollout remain unsupported. Independent authorization and partition-safety review remains a separate release gate. Reference regressions also reject changed owner/run/generation, absent/out-of-range cursors, wrong prefix hashes and forged limit/stop facts after recomputing package hashes; plain bundles reject federated ancestors.
