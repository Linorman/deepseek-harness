# @clocky/clocky-agent-runtime-acp

English | [中文](README.zh.md)

ACP subprocess placement provider for `ctx.agentRuntimes`. It establishes the ACP initialize/session handshake before publishing a Team activation, races that handshake against activation cancellation and reaps an unpublished child, retains the Team/Participant/Session identity independently from the ACP wire session id, forwards interruption to the child session, and owns bounded EOF/termination cleanup.

The provider exposes no local `Agent`. It materializes a durable Clocky proxy Session under the Team-resolved `SessionId`; each claimed Envelope is appended and flushed there before the ACP child's `session/prompt` runs. Consult, discussion, workflow, and review claims use the Hub-rendered `team/channel-view` content for both the proxy event and ACP prompt; direct claims retain their existing Envelope source. A successful response appends a completion fact, flushes it, and only then writes the Team receipt. On resume, an already completed source Envelope is acknowledged without another prompt, while an admitted incomplete prompt remains replayable. With `teamLinkEnrollmentProvider` configured, it reserves a short-lived activation-bound WebSocket enrollment after the Team binding commits, owns the resulting Link, and forwards claimed content to the ACP child. A v4 Hub `cancel` request is handled cooperatively by cancelling the ACP session before the endpoint acknowledges; the provider still proves child-process termination through its bounded EOF/termination path. Without the option, Team channel delivery remains an external Consumer. Mount it after `clocky-agent-runtime`, `clocky-subprocess`, `clocky-session`, and `clocky-session-persistence` (and after a Team Link registry/enrollment provider when the bridge is enabled):

```yaml
- id: agent-runtime-acp
  name: '@clocky/clocky-agent-runtime-acp'
  config:
    command: clocky-acp-agent
    # Optional: a Team Link enrollment issuer such as the WebSocket Hub.
    # teamLinkEnrollmentProvider: websocket
```

`providerName`, `args`, `env`, `disposeEofGraceMs`, `teamLinkEnrollmentProvider`, `teamLinkProviderPrefix`, and `teamLinkReconnectDelayMs` are deployment settings. `recoveryProfile`, `recoveryHostId`, and `recoveryFenceGraceMs` opt into same-host `acp-local-cold-replace` recovery; optional `recoverySupervisor` requires a mounted execution-host supervisor owner, which durably admits the exact process before activation publication. Missing or rejected ownership reaps the unpublished child; unproven cleanup raises `AGENT_RUNTIME_TERMINATION_UNCONFIRMED` and prevents another activation for that Participant through the same provider instance. The provider records exact process identity and registers a matching local fencer, while cross-host ACP recovery remains unsupported until the supervisor deployment is independently verified. The two timer settings are bounded by Node's maximum safe delay, and the post-escalation termination observation is clamped to the same bound. A child that fails initialization or is cancelled during the initialize/session handshake is reaped before activation rejects, and provider unload closes future admission while accepted handles finish their own lifecycle. `offline` is published only after the owned child exits; an unconfirmed termination remains `stopping` and surfaces `AGENT_RUNTIME_TERMINATION_UNCONFIRMED`. The bridge serializes ACP prompts, claims each Envelope through the activation-bound Link, re-enrolls after a transport failure while the activation remains current, and leaves failed prompts unacknowledged for replay; ACP assistant output is never broadcast automatically.

## Model Experience

### ACP Team Link bridge

#### What the model sees

This provider contributes no prompt section or tool. The remote child receives direct content or the exact Hub-rendered `team/channel-view` content through ACP `session/prompt`; the child output remains private until an explicit Team Consumer posts a report or final Envelope.

#### Token effect

The bridge adds one serialized prompt containing the admitted model content; provider usage is recorded by the child runtime when it reports a Session step.

#### KV Cache effect

The bridge does not alter the child's request prefix or cache policy.

## Known Limitations and Deferred Work

- The bridge requires a mounted `ctx.teamLinks` enrollment issuer and a WebSocket Team Link Hub; an ACP child that does not accept the standard `session/prompt` flow cannot consume Team Envelopes through this provider.
- ACP wire session ids are intentionally not reused as Clocky `SessionId` or `ActivationId` values. The proxy Session uses the Team-resolved `SessionId`, retains Team/channel/Envelope provenance, and requires a mounted durable Session persistence provider.
