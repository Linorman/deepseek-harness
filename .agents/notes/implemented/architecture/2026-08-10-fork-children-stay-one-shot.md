# Agent Note: Forked children stay one-shot

Status: implemented

English | [中文](2026-08-10-fork-children-stay-one-shot.zh.md)

## Problem

Fork's only difference from spawn is that the child Session is seeded with the parent's completed-turn prefix ([subagent-fork-in-process](../../../../packages/subagent/subagent-fork-in-process/README.md)). That seed costs real tokens — the inherited history is re-sent in every child request — and its one concrete payoff is provider-side prefix reuse: under the same provider and model, a child request whose leading bytes are identical to the parent's re-prefills none of the shared span. Anything a child scope adds *ahead* of the inherited history spends that payoff, because reuse stops at the first differing byte.

The child-scoped `report` return channel is now the largest such addition, and since [the report obligation](../feature/2026-08-06-continuable-child-report-obligation.md) it is two deltas rather than one: the `report` tool schema and the `tool:report` system-prompt section. Both live in the request head — the system block and the tool block precede every message — so a continuable forked child invalidates reuse before the first inherited turn and re-prefills the whole transcript it was forked to reuse. That composition pays fork's duplication cost and collects none of its benefit, while the parent still holds a reusable prefix the child could have shared.

## Decision

The [base bundle](../../../../packages/bundle/base/cordis.patch.yml), its headless descendant, and the shipped Web `standard`, `code`, and `cordis` presets do not mount the fork provider or expose `subagent_fork`. Product tasks therefore enter through Team topology and Team tools rather than a model-directed Session fork. The standalone examples and an explicit custom composition may still mount the fork provider and tool when inherited conversation is an intentional deployment choice.

`spawn` keeps `backgroundMode: continuable`. Continuable spawned children and the report obligation remain available for configured direct-child compositions; they do not establish a second product task entry path.

### The restriction is composition, not code

`ForkInProcessProvider.prepareContinuable`, `ctx.subagents.startContinuable({ provider: 'fork' })`, and trusted `ctx.sessions.fork()` stay implemented. `tool-subagent` does not reject inherited-context continuations at mount because a custom composition can omit the child-scoped report contribution and retain a byte-identical prefix. That provider policy belongs to the composition, not the generic delegation tool.

The reintroduction condition is recorded as a `TODO(fork-continuable-prefix-reuse)` marker on `prepareContinuable` itself, the one method the shipped compositions do not call, and tracked as issue #2124: continuable fork reopens when a child's system prompt and tool schemas can match its parent's byte for byte.

## Alternatives considered

**Reject `inheritsParentContext` + `continuable` at mount.** A loud load-time failure would prevent silent reintroduction, which is what the configuration change cannot do. Rejected because the delegation tool cannot see the report package and the combination is legitimate without it; the invariant would be false for a deployment that never installs a child-scope delta, and `tool-subagent` would be asserting a fact owned by the roster.

**Keep the fork provider and `subagent_fork` in product bundles.** Rejected because model-directed Session forks preserve a second product orchestration path after Team becomes the task owner. A custom composition retains the capability without making it part of the shipped model catalog.

**Delete the core fork provider and Session API.** Rejected because trusted tests and explicit custom compositions still need a completed-prefix child; product unmounting does not remove that internal capability.

**Ship continuable forked children and accept the loss.** Rejected because the loss is total rather than marginal: reuse breaks ahead of the inherited history, so the child pays full prefill on a transcript it duplicated for the sole purpose of not paying it. A deployment that wants a long-lived child with no inherited context already has `spawn`.

**Make `report` visible to every Agent.** A global registration would restore byte-identical prefixes by giving parent and child the same schema and section. Rejected because roots, one-shot children, remote children, and agentless callers would advertise a tool with no derivable recipient, and execution-time rejection would make schema visibility disagree with authority — the scope-local decision the [report tool Agent Note](../feature/2026-07-30-continuable-subagent-report-tool.md) already settled.

**Install the child-scope deltas after the inherited history.** Rejected as unrepresentable: the system prompt and the tool schemas are request-head structures in every provider's wire format, so no ordering within them can place a child-only addition behind the message list.

## Consequences

- The shipped headless and Web model catalogs omit `subagent_fork`; assembled composition tests pin that absence alongside the Team final path.
- The fork provider and its package-level tests remain available to examples, tests, and custom composition. Its continuable path has no shipped product caller.
- The report obligation remains scoped to continuable spawned children in shipped product compositions. Its scheduling, authority model, and coverage remain independent of custom fork composition.

### Accepted risks

An explicit custom bundle or profile patch can reintroduce the fork provider and tool without a code change. That is accepted because the capability remains outside the shipped product catalog, and the generic delegation tool cannot infer a custom composition's child-prefix policy.
