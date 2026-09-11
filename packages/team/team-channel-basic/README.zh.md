# @clocky/clocky-team-channel-basic

[English](README.md) | 中文

`@clocky/clocky-team-channel-basic` 在 `ctx.teams` 注册 v1 `consult` 和 `discussion` 通道适配器。Consult 接受一次 initiator 请求和一次 respondent 响应，然后请求 Hub 原子关闭通道。Discussion 面向至少两个参与者，在显式的 `round-robin` 或 `free-form` 策略以及必需的 `maxTurns` 上限下接受文本消息。

适配器校验不可变成员与限制，只折叠 JSON 状态，推导接收者投递意图，不执行模型轮次或传输工作。Discussion 的 `audience: null` 表示广播；显式 audience 必须是不重复且不包含发送者的通道成员。

## Model Experience

### 基础通道协议

#### 模型看到的内容

本包不拥有提示词或工具。Team 投递 Consumer 决定已校验的 Envelope 如何成为已记录的模型输入。

#### Token effect

直接 token effect 为零。

#### KV Cache effect

本包不拥有模型请求前缀。

## Known Limitations and Deferred Work

- **不执行投递** — 适配器返回协议推导出的意图；Link 和 Agent Client 层负责接纳并确认接收者输入。
- **不包含 workflow graph** — consult 和 discussion 之外的条件转移属于独立的 workflow 适配器。
