# @clocky/clocky-command-team-goal

English | [中文](README.zh.md)

`@clocky/clocky-command-team-goal` installs a scoped human-facing `/goal` command only for a live Agent whose Session header names a valid Team. It reads the Team-owned objective through `ctx.teams`; it never creates a Session-owned Goal or accepts a caller-selected Team or participant. A Session header is routing provenance, not an authenticated actor, so objective mutation waits for the product Actor Proof control plane.

## Commands

| Input | Effect |
|---|---|
| `/goal` | Show the current Team objective, phase, blocker when present, goal budgets, and the authenticated-actor requirement for mutations. |
| `/goal edit <objective>` | Reject until an authenticated product actor can request the objective mutation. |
| `/goal pause` | Reject until an authenticated product actor can request the phase transition. |
| `/goal resume` | Reject until an authenticated product actor can request the phase transition. |
| `/goal complete` | Reject until an authenticated product actor can request the phase transition. |
| `/goal block <code> <message>` | Reject until an authenticated product actor can request the phase transition. |

The command deliberately has no create, clear, or implicit-replace form: every Team starts with one durable goal seed, and an objective change is explicit. It accepts no image attachments.

## Authorization and concurrency

The command derives `TeamId` only for status reads from the exact receiving Agent Session header. It never treats that header, a participant id, or the command text as authority to mutate a durable Team. Each mutation form returns a fixed actor-required result without calling `ctx.teams`; a future Host-authenticated actor proof will own re-enabling the forms.

## Model Experience

### Team goal command

#### What the model sees

Nothing directly. This package registers no prompt section or tool. The command registry records ordinary `command/run` and `command/done` Session events for the human interaction, while the Team provider owns the objective journal record.

#### Token effect

Zero model tokens. The command executes without a model turn.

#### KV Cache effect

This package owns no model request prefix.

## Known Limitations and Deferred Work

- **Coordinator scope only** — the command is mounted by the Web Team composition for a live Team coordinator; it is not a general Team list or remote participant control surface.
- **Mutation requires product authentication** — `/goal` remains status-only until a Host-authenticated Team actor can mint a proof for the requested mutation.
- **No attachment input** — objective edits remain text-only; rich human content continues through Team channel input admission.
