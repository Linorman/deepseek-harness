# Agent Note: Scoped Team goal command

Status: implemented

English | [中文](2026-08-28-team-goal-scoped-command.zh.md)

## Problem

A human command arrives through an Agent Session, but the durable objective belongs to a Team that can outlive that Session and its activation. A global command that accepts a target Team or participant from command text would not authenticate the actor, while reusing the legacy same-session command would write the wrong journal and retain obsolete continuation semantics.

## Decision

`@clocky/clocky-command-team-goal` installs `/goal` in an Agent scope only when the exact live Agent Session header parses `TeamId`. Its scoped registration shadows the legacy global `/goal` for that Team-bound Agent while non-Team Sessions continue to see the legacy command during the product cutover.

The command reads the current Team for status only. It rejects every mutation form without calling `ctx.teams`, because a Session header routes a command but does not authenticate a Team actor. The [Team actor proof control-plane proposal](../../proposed/architecture/2026-09-01-team-actor-proof-control-plane.md) owns the proof source required to re-enable authenticated mutation.

The grammar exposes status, explicit objective editing, pause, resume, complete, and structured block transitions. It deliberately has no create, clear, implicit replacement, image attachment, model tool, or automatic continuation behavior. The Team journal remains the only source of objective state; the command registry records its normal Session lifecycle events separately.

## Alternatives considered

**Replace the legacy same-session command immediately.** Rejected because default product bundles and Session entry points have not moved to Team creation yet. The scoped command can shadow it for Team Agents without breaking current non-Team runs.

**Use one global command with Team identifiers in its text.** Rejected because a command argument cannot authenticate a participant or prove that the receiving Session belongs to that Team.

**Cache the Team goal in the receiving Session.** Rejected because a cached revision would become a second mutable source of truth and could survive an activation after Team state changed elsewhere.

## Consequences

The local Team-bound command path is status-only until a Host-authenticated actor can mint a proof. This removes the Session-header mutation bypass while preserving durable objective inspection. The [durable Team goal decision](2026-08-28-durable-team-goal.md) remains the authority for persistence and replay; the [human same-session goal-command decision](../feature/2026-07-19-human-goal-command.md) remains current only for legacy Session-owned runs.

## Verification

Command tests cover Team-scoped registration, command grammar, read-only mutation rejection, teardown, and a real Hub composition that leaves the durable objective and goal policy untouched after a Session-header-only mutation request.
