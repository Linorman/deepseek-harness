# @clocky/clocky-team-channel-direct

[English](README.md) | 中文

`@clocky/clocky-team-channel-direct` 会在 `ctx.teams` 上注册版本一至版本四的 `direct` `TeamChannelAdapter`，并注册内置的 `directed`、`full-transcript`、`recent-window` 和携带 provenance 的 `summarized-window` view policy。请在 `TeamRuntime` provider 之后挂载它。所有版本都不接受 adapter 专有的 limits。summarized policy 投影最新持久化 `channel/summary` 及未覆盖的原始尾部；没有摘要时投影原始消息。[显式摘要 Consumer](../team-channel-summary/README.zh.md) 负责生成，读取不会创建摘要。

Direct v4 仅在至少保留两名 invitation 成员时授权移除 optional invitation。Hub 在每条 Envelope record 中固定实际 recipient；较晚确认的成员不会获得之前广播的 intent。[持久 channel admission](../team-channel-admission/README.zh.md)独立拥有 invitation state，该 adapter 保持无状态。

## 直接 v1 协议

版本一接受至少包含两个不同 participant 的 channel。每个 Envelope 都必须明确指定一名不同于 sender 的 recipient。recipient 和 sender 都必须是 channel participant。broadcast audience（`null`）、多个 recipient 和向自己发送都会被拒绝。唯一可接收的 Envelope kind 是 `message`，其 payload 必须严格为带有非空 `text` 的 `{ text: string }`。

该 adapter 将 `null` 保留为完整的 fold state，并在每条 WAL record 后返回它，不会修改输入。它不添加 post-accept record、不期待自动的下一位 speaker，并为被指定的 participant 创建一条 `DeliveryIntent`，其 delivery treatment 使用 Envelope 请求的值。它不执行该 delivery。

## 直接 v2 产品协议

版本二只接受恰好两个不同 participant。它保留版本一的显式、非自身、仅限成员的 recipient 规则。可接收的 Envelope kind 是 `message` 和 `final`；每个 payload 都必须严格为带有非空 `text` 的 `{ text: string }`。`final` 标识一个产品最终答案，但不会关闭 channel、完成 Team，或安排回复。

该 adapter 同样将 `null` 保留为完整的 fold state，为被指定的 participant 创建一条使用请求 delivery treatment 的 `DeliveryIntent`，且不拥有 delivery 执行。产品 Consumer 可通过 `DIRECT_CHANNEL_ADAPTER_V2`、`DIRECT_CHANNEL_FINAL_ENVELOPE_KIND`、`parseDirectChannelV2Manifest()` 和 `directChannelV2Peer()` 选择并校验稳定的 v2 协议，而无需重复版本或两方检查。

## 直接 v3 产品协议

版本三同样只接受恰好两个不同 participant，并保留显式、非自身、仅限成员的 recipient 规则。`final` Envelope 仍必须严格为带有非空 `text` 的 `{ text: string }`。`message` Envelope 则必须严格为 `{ content }`：一个非空、有序的数组，成员只能是带有非空 `text` 的 `{ type: 'text', text: string }` 内容块，或带有 `ImageAttachmentRef` 的 `{ type: 'image', attachment: ImageAttachmentRef }` 内容块。图片内容块携带完整的持久化附件引用；编码图片字节、reasoning 内容块、tool 内容块和未声明字段都会被拒绝。

该 adapter 仍无状态，并创建一条 `DeliveryIntent` 而不执行它。`parseDirectChannelV3MessagePayload()` 会为 delivery Consumer 返回已冻结的窄人类内容块。`parseDirectProductChannelManifest()` 和 `directProductChannelPeer()` 接受恰好两方的 v2/v3 产品 channel，以及带 coordinator/human 角色的 v4 channel；当 Consumer 只允许一个版本时，v2 和 v3 各自的常量、parser 和 peer helper 仍可用。

## 直接 v4 消息协议

版本四接受至少两个不同 participant。`message` 使用 v3 的有序文本/图片 payload，`audience: null` 表示向其他所有已确认成员广播，也可显式指定非空、无重复且不含 sender 的成员子集。Hub 在 Team/channel 锁内检查每名被寻址的 Participant 均为 active。每名 recipient 都有独立的持久 pending intent 和 receipt；一名 recipient 的 receipt 不会结算另一名的 delivery。adapter 不安排回复，也不会广播普通 assistant output。

v4 `final` 要求恰好两名成员，角色分别为 coordinator 和 human，并要求显式的单一 human audience、`delivery: 'turn'` 和 `{ text }`。Hub 还会验证 sender 是实际的 coordinator Agent，recipient 是实际的 human Participant。群组 final 会被拒绝。final 仍是通信；其 human receipt 和 Team completion 需要产品 Consumer。

打开 channel 时须显式选择 `DIRECT_CHANNEL_ADAPTER_V4`。本地 `team_message` tool 将文本转换为协议 payload；已认证 Link post 可携带有序 content 数组。`TeamAgentClient` 先持久化每名已 claim recipient 的输入，再确认 receipt。默认 TeamRun channel 仍为 v3。持久 invitation/ack admission 先于消息接受。

## 模型体验

### 直接 channel 协议

#### 模型所见

本包不注册 prompt section、tool 或文本。使用 `ctx.teams` 的 Team delivery Consumer 决定已接收的直接 Envelope 是否成为模型可见输入。

#### Token 影响

没有直接 token 影响。

#### KV Cache 影响

本包不拥有请求前缀。

## 已知限制与延后工作

- **没有 delivery 执行**——adapter 会生成 `DeliveryIntent`，但 Team delivery Consumer 必须持久地接收并渲染 recipient 输入。
- **没有自动会话行为**——direct v4 支持群组消息，但 turn selection 和自动回复需要另一种 adapter。direct v2 和 v3 保持为恰好两方的协议。
- **没有完成转换**——v2、v3 或 v4 的 `final` Envelope 是持久通信；Team completion policy 在接受该答案后拥有 channel 关闭和 Team 完成。
