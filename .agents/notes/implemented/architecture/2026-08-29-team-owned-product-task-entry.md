# Agent Note: Team-owned product task entry

Status: implemented

English | [中文](2026-08-29-team-owned-product-task-entry.zh.md)

## Problem

Public `session.create` and `session.fork` made a Session a user-created task root. That bypassed Team identity, the default human/coordinator topology, durable channel admission, and final-result policy even after Team became the product work system.

## Decision

Shipped product task creation is Team-owned. Web starts a local Team draft and its first submission calls `team.start`; Team state resolves the coordinator Session only as the transcript to display. The Host removes public `session.create` and `session.fork` from its API, HTTP carrier, client facade, fixture transport, and default client controls. Unknown HTTP paths for those methods return the ordinary unknown-route response.

The removal has no invented `team.fork` replacement. Forking a collaboration authority needs explicit membership, channel, task, and policy semantics; duplicating one coordinator transcript would not provide them.

`Session` remains the local execution and transcript primitive. `ctx.sessions.create()` and `fork()`, `ctx.agents.create()` and `resume()`, AgentRuntime placement, persistence recovery, and test setup stay trusted internal APIs. Generic Host Agent/Session resolution rejects Team-provenanced Sessions before resuming them, and `session.updateQueue` rejects them rather than mutating a coordinator inbox. `session.prompt` and `session.cancel` stay available for a live Team coordinator because they route through its human channel and soft-interrupt authority instead of creating standalone work.

## Alternatives considered

**Keep deprecated public Session routes as adapters.** Rejected because a request lacking a Team template, human participant, channel, and completion policy cannot be converted faithfully. A compatibility path would preserve the bypass under another name.

**Add `team.fork`.** Rejected because there is no defined Team-level fork contract. It would imply decisions about participant membership, pending delivery, task attempts, budgets, workspace allocation, and final-output authority that a Session prefix cannot answer.

**Delete Session and Agent creation primitives.** Rejected because Team activation, recovery, and local transcript tests own those trusted operations. Removing a product RPC must not erase provider-layer capabilities.

## Consequences

The default Web navigation lists Teams and starts work through `team.start`; Workspace UI remains a non-product management surface for existing Session records. Explicit custom compositions may still mount that browser for Workspace registry management, but the shipped roster does not. Client Session scopes still render coordinator transcripts after Team activation, but cannot birth or branch a user task.

The direct-entrypoint inventory retains explicitly trusted Session/Agent operations and shipped Team task tools. Headless, ACP, and Web coordinator presets leave same-Session Goal model controls unmounted; ACP rejects the removed `goals` app config, and Web disables its same-Session Goal service, automatic driver, command, and GoalBar, using `command-team-goal` in a coordinator transcript instead. An explicit custom composition may still opt in through the generic spine. Host carrier tests prove the deleted paths are unavailable; Team, client, and assembled Web tests prove a product start creates a Team, admits the first human input, and opens the coordinator transcript. This decision implements the product-entry portion of the [native multi-agent work-system proposal](../../proposed/architecture/2026-08-27-native-multi-agent-work-system.md) and complements the [local Team product-run owner](2026-08-29-local-team-product-run-owner.md).

Generic Session command UI is also not mounted for Team-owned coordinator Sessions: the current command RPC intentionally fences Team ownership, so the generic launcher is disabled and command-dependent decorations such as plan and permission selectors stay absent until a Team control operation supplies the authenticated path. This prevents a Session descendant from appearing to offer a command it cannot authorize.
