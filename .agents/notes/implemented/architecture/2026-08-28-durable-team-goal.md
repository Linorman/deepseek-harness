# Agent Note: Durable Team goal

Status: implemented

English | [中文](2026-08-28-durable-team-goal.zh.md)

## Problem

A Team can outlive any particular Session, Participant activation, task attempt, or scheduler process. Copying an objective into the Team header loses the revision fence, blocked explanation, and goal-specific budgets that policy and recovery need. Reusing the same-session Goal would instead bind shared work to one Session's log, continuation rounds, and process-local activation.

## Decision

The Team journal owns one revisioned `TeamGoalSnapshot`. `team/created` carries the whole revision-one active goal, including the Team id, objective, and goal-specific budgets. `goal/changed` carries the whole post-mutation value. The Hub compares `expectedRevision`, authorizes both definition and phase changes through `goal-mutate`, and appends only after the value folds successfully.

Goal replay requires the enclosing Team id, revision one at creation, one-step revision continuity afterward, an allowed phase edge, a non-empty normalized objective, JSON-object budgets, and a blocker exactly while the phase is `blocked`. Goal phases are `active`, `paused`, `blocked`, and `complete`; Team failure and cancellation remain Team lifecycle facts. Checkpoints retain the current goal both in the Team summary and direct state projection, and recovery rejects a mismatch.

`tool-team-goal` is the sole shipped model Consumer. It scopes `get_goal` and objective-only `update_goal` to the exact live default TeamRun coordinator. An edit requires the current trusted human direct-v3 Envelope; TeamRun derives the activation actor from its coordinator lease and the Hub rechecks that exact binding. Goal rounds, phase mutation, Agent activation, task dispatch, and scheduler wake remain outside the tools.

## Alternatives considered

**Reuse the same-session Goal domain.** Rejected because its Session ownership, continuation round budget, and process-local activation do not describe a Team with independent participants and lifetime.

**Store only an objective string in Team creation.** Rejected because policy and recovery would lack a compare-and-set identity, blocked explanation, and mutable goal budget.

**Append partial goal fields.** Rejected because strict replay and checkpoint validation need one complete current value for every accepted mutation.

## Consequences

Current Team journals use format 12 and checkpoints use format 13; channel formats remain independent and unsupported formats are rejected. The [local Team Hub decision](2026-08-27-local-team-hub-durable-authority.md) remains the authority for stream ownership and recovery, while the [native multi-agent work-system proposal](../../proposed/architecture/2026-08-27-native-multi-agent-work-system.md) remains proposed.

## Verification

Core tests cover strict goal parsers, revision fencing, phase edges, and blocker rules. Hub tests cover whole-value journal folds, malformed initial and changed goals, checkpoint agreement, policy denial, stale revisions, durable restart, post-commit Goal notification invariants, and activation fences. TeamRun and tool tests cover the scoped human-envelope authorization path. The Hub source remains at per-file 100% coverage.
