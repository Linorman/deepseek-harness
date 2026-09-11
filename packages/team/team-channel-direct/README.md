# @clocky/clocky-team-channel-direct

English | [中文](README.zh.md)

`@clocky/clocky-team-channel-direct` registers version-one through version-four `direct` `TeamChannelAdapter`s plus the built-in `directed`, `full-transcript`, `recent-window`, and provenance-carrying `summarized-window` view policies on `ctx.teams`. Mount it after a `TeamRuntime` provider. All versions accept no adapter-specific limits. The summarized policy projects the latest durable `channel/summary` plus its uncovered raw tail, or raw messages when no summary exists. The [explicit summary Consumer](../team-channel-summary/README.md) owns generation; reading never creates a summary.

Direct v4 authorizes optional-invitation removal only while at least two invitation members remain. The Hub freezes actual recipients in each Envelope record; a member that acknowledges later receives no earlier broadcast intent. [Durable channel admission](../team-channel-admission/README.md) owns invitation state independently from this stateless adapter.

## Direct v1 protocol

Version one accepts at least two distinct channel participants. Every Envelope names exactly one explicit recipient other than its sender. The recipient and sender must both be channel participants. Broadcast audiences (`null`), multiple recipients, and self-addressing are rejected. The only accepted Envelope kind is `message`, whose payload is exactly `{ text: string }` with nonempty text.

The adapter keeps `null` as its complete fold state and returns it for every WAL record without mutating inputs. It adds no post-accept records, expects no automatic next speaker, and creates one `DeliveryIntent` for the addressed participant using the Envelope's requested delivery treatment. It does not execute that delivery.

## Direct v2 product protocol

Version two accepts exactly two distinct channel participants. It preserves version one's explicit, non-self, member-only recipient rule. Its accepted Envelope kinds are `message` and `final`; each payload is exactly `{ text: string }` with nonempty text. `final` identifies a product final answer but does not close the channel, complete the Team, or schedule a reply.

The adapter also keeps `null` as its complete fold state, creates one `DeliveryIntent` for the addressed participant using the requested delivery treatment, and owns no delivery execution. `DIRECT_CHANNEL_ADAPTER_V2`, `DIRECT_CHANNEL_FINAL_ENVELOPE_KIND`, `parseDirectChannelV2Manifest()`, and `directChannelV2Peer()` let product Consumers select and validate the stable v2 protocol without duplicating its version or two-party checks.

## Direct v3 product protocol

Version three also accepts exactly two distinct channel participants and keeps the explicit, non-self, member-only recipient rule. A `final` Envelope remains exactly `{ text: string }` with nonempty text. A `message` Envelope instead has exactly `{ content }`: a nonempty ordered array of `{ type: 'text', text: string }` blocks with nonempty text and `{ type: 'image', attachment: ImageAttachmentRef }` blocks. Image blocks carry a complete durable attachment reference; encoded image bytes, reasoning blocks, tool blocks, and undeclared fields are rejected.

The adapter remains stateless and creates one `DeliveryIntent` without executing it. `parseDirectChannelV3MessagePayload()` returns the frozen narrow human-content blocks for a delivery Consumer. `parseDirectProductChannelManifest()` and `directProductChannelPeer()` accept exact two-party v2/v3 product channels and v4 channels with coordinator/human roles; the v2- and v3-specific constants, parsers, and peer helpers remain available when a Consumer requires one version.

## Direct v4 messaging protocol

Version four accepts at least two distinct participants. A `message` uses the ordered text/image payload from v3 and either `audience: null` to address every other acknowledged member or an explicit, nonempty subset of distinct members excluding the sender. The Hub checks every addressed Participant is active under its Team/channel locks. Each recipient receives an independent durable pending intent and receipt; one recipient's receipt does not settle another's delivery. The adapter schedules no reply and never broadcasts ordinary assistant output.

A v4 `final` requires exactly two members with coordinator and human roles, an explicit human-only audience, `delivery: 'turn'`, and `{ text }`. The Hub also verifies the sender is an actual coordinator Agent and the recipient is the actual human Participant. Group finals are rejected. A final remains communication; its human receipt and Team completion require a product Consumer.

Select `DIRECT_CHANNEL_ADAPTER_V4` explicitly when opening a channel. The local `team_message` tool converts text to the protocol payload; authenticated Link posts can carry the ordered content array. `TeamAgentClient` persists each claimed recipient input before acknowledging it. Default TeamRun channels remain v3. Durable invitation/ack admission precedes message acceptance.

## Model Experience

### Direct channel protocols

#### What the model sees

This package registers no prompt section, tool, or text. A Team delivery Consumer using `ctx.teams` decides whether an accepted direct Envelope becomes model-visible input.

#### Token effect

Zero direct token effect.

#### KV Cache effect

This package owns no request prefix.

## Known Limitations and Deferred Work

- **No delivery execution** — the adapter produces a `DeliveryIntent`, but a Team delivery Consumer must durably admit and render the recipient input.
- **No automated conversation behavior** — direct v4 supports group messaging, but turn selection and automatic replies require another adapter. Direct v2 and v3 remain exact two-party protocols.
- **No completion transition** — a v2, v3, or v4 `final` Envelope is durable communication; the Team completion policy owns channel closure and Team completion after it accepts that answer.
