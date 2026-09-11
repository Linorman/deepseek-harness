# agent-runtime/ — Participant activation providers

English | [中文](README.zh.md)

This family contains placement providers for Team-resolved Participant activation. The Service Definition remains [`core/agent-runtime`](../core/agent-runtime/README.md), so providers own volatile Agent residency without becoming the Team journal, channel transport, or model-facing control plane.

| Package | Role | ctx key |
|---|---|---|
| [`agent-runtime-in-process/`](agent-runtime-in-process/README.md) | Local fresh/fork/resume placement provider | `ctx.agentRuntimes` provider `in-process` by default |
| [`agent-runtime-sdk/`](agent-runtime-sdk/README.md) | Remote-agent fresh/resume lifecycle placement provider | `ctx.agentRuntimes` provider `sdk` by default |
| [`agent-runtime-acp/`](agent-runtime-acp/README.md) | ACP subprocess lifecycle provider for remote/local Participants | `ctx.agentRuntimes` provider `acp` by default |

The in-process provider is mounted explicitly with [`clocky-agent-runtime`](../core/agent-runtime/README.md), [`clocky-agent`](../core/agent/README.md), and a `SessionPersistence` provider. It creates a durable local Session for each accepted activation but does not mount a Team Hub, channel client, scheduler, or model tool.

The SDK provider uses the SDK lifecycle/status protocol to place active `remote-agent` Participants for fresh or resume activation. Its handles expose no local `Agent`; remote Links and Envelope delivery are not supplied.

The ACP provider starts one ACP server subprocess per activation, performs the ACP initialize/session handshake before publication, exposes an idle/running/stopping/offline activation projection, forwards interruption to `session/cancel`, and reaps the child after EOF or bounded escalation. When configured with a Team Link enrollment issuer, it owns an ephemeral activation-bound WebSocket Link and forwards claimed Team Envelopes to serialized ACP `session/prompt` calls before acknowledging them; ACP output remains private and is never treated as an implicit Team message.

The public registry types and events are defined in [docs/subsystems/agent-runtime.md](../../docs/subsystems/agent-runtime.md). The [AgentRuntime decision](../../.agents/notes/implemented/architecture/2026-08-27-agent-runtime-service-definition.md) records the ownership split.
