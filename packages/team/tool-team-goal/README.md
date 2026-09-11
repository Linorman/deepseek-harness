# `@clocky/clocky-tool-team-goal`

English | [中文](README.zh.md)

Scoped `get_goal` and `update_goal` tools for the durable objective of one live default TeamRun coordinator. They replace the same-session model goal controls in shipped Team products; Team creation already supplies the initial objective, so there is no `create_goal`.

## Tools

- `get_goal()` returns `{ revision, objective, phase, blocker?, budgets }` for the current Team objective.
- `update_goal(revision, objective)` performs a compare-and-set edit. The coordinator must be live and its current turn must contain an exact trusted human direct-v3 Team Envelope.

Neither tool accepts a Team, Participant, Session, activation, or provider identifier. TeamRun derives those facts from its coordinator lease; the Team Hub rechecks the exact active binding before committing an edit.

## Model Experience

### Tool schemas and results

#### What the model sees

The scoped [`get_goal` and `update_goal`](../../../docs/tool-catalog.md#clockyclocky-tool-team-goal) schemas and compact durable-objective results. `update_goal` only edits objective text; phase transitions, goal-round limits, and autonomous completion remain outside this tool.

#### Token effect

One small schema pair and one compact JSON result per call.

#### KV Cache effect

Schemas remain prefix-stable while the coordinator scope and tool definitions remain unchanged.

## Known Limitations and Deferred Work

- **No phase mutation** — pause, block, and complete need Team scheduler and completion-policy semantics.
- **Default local coordinator only** — remote coordinator support needs a Link-level goal operation and the same activation fence.
