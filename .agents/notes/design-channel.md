# Simulation communication design review

English | [中文](design-channel.zh.md)

The direction is sound: reuse Team delivery, keep durable entities separate from activations, distinguish beliefs from world facts, and schedule simulation work by events. The original design needed stronger rules for atomic persistence, identity binding, delayed visibility, and recovery before implementation.

The maintained design is the [durable simulation coordination proposal](proposed/architecture/2026-09-17-durable-simulation-coordination.md). It remains proposed; this review changes documentation only.

| Design issue | Correction |
|---|---|
| Entity has one Session but participates in multiple Teams | MVP uses one canonical Team/Participant/Session; future memberships need separate Sessions and cognition mediation |
| Organization relation cannot identify the manager endpoint | Subject/relation/object edges with endpoint validation and one membership owner |
| Request mixes delivery, acceptance, and execution | Independent projections; commitment fulfillment requires declared evidence |
| Decision, World, and Outbox imply separate writes | One Simulation stream atomically accepts decisions/intents and local world transactions; Team dispatch remains a saga |
| Recovery assumes any system source can post for a stopped Agent | Explicit narrow Team proof extension with durable decision evidence and current authority validation |
| Fixed slots coexist with immediate tool effects | Stage proposals; effectful commit follows slots; log timeouts and bounded conflicts |
| Future messages can enter non-waking context | Delay Team publication until simulation eligibility; exclusively own delivery and all retrieval paths |
| bigint appears in durable records | Validated decimal strings with numeric comparison |
| Checkpoint collects only selected revisions | Exact owner cursors, pending operations, Session state, barriers, and reference pins |
| Channel rollover is assumed to enable history deletion | Drain immutable channels; disable destructive retention until all owners enforce Simulation pins |
| Recovery/context/activation safety are late phases | Deliver them in the first keyless vertical scenario before scaling |

Existing Team protocol, implementation-lease, and implicit-Lead retirement decisions remain active. No runtime code is changed and no unimplemented capability is represented as shipped.
