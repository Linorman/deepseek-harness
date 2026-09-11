# @clocky/clocky-agent-runtime-in-process

[English](README.md) | 中文

`@clocky/clocky-agent-runtime-in-process`在 `ctx.agentRuntimes` 上注册本地 placement provider。它需要 `clocky-agent-runtime`、公开的 `ctx.agents` factory 和 `ctx.sessionPersistence`；默认 provider 名称是 `in-process`，可通过 `providerName` 更改注册名称。

## Activation 语义

只有 `local-agent` Participant 可以使用该提供方。fresh 或 fork activation 会在 root-owned activation scope 中创建 Agent、在发布前写入成对的 opaque `SessionHeader.teamId`和 `participantId`，以及可选的已解析 `cwd`和 `agentPreset`，然后将所有权转移给返回的 handle。命名 `agent.preset` 的 request 会在未发布的 Agent scope 中挂载该 preset；preset service 或配置缺失、不可用时，会以 `AGENT_RUNTIME_IN_PROCESS_PRESET_UNAVAILABLE`拒绝。fork request 还会持久化源 `parentSession` 和复制事件的 `seedLength`。resume 会在发布 Agent 前验证已存储的 Team／Participant 对，并在同一 setup boundary 挂载其请求的 preset。

同一 Team／Participant 的并发 activation request 只有在指定相同 Session 时才共享完全相同的 handle。`health()`报告不可变的本地 `running`、`idle`、`stopping` 或 `offline` projection；`onStatus()`观察之后的转换而不重放初始状态。该 handle 以 `keepInbox: true` 中断当前 turn；dispose 会取消、排空、移除 Agent 并释放其 activation scope。provider 卸载会阻止新的 activation，而已接收的 handle 仍由调用方拥有。AgentLoop reload 会清除过期的本地槽位并将其 handle 标为 offline，之后的 activation 会创建新的 epoch。

该提供方会拒绝非本地 Participant、无法提供的具名 preset、不匹配的 Session request，以及指向另一 Team participant 的 resume provenance。它不推断 parent-Agent 权限；`parentSession`只保留 fork 谱系含义。

## 模型体验

### 本地 placement

#### 模型所见

`ctx.agentRuntimes`不添加提示词片段或工具。请求的具名 preset 会在 Team client 将持久 channel input 投递到本地 Agent 前贡献其 scoped prompt section 和 tool。

#### Token 影响

该 provider 本身没有直接 token 影响；请求的 preset 拥有自身的影响。

#### KV Cache 影响

本包不拥有请求前缀；请求的 preset 拥有自身的 scoped prefix。

## 已知限制与延后工作

- **没有 Team 投递或持久 activation 注册表**——[`clocky-team-activation-controller`](../../team/team-activation-controller/README.zh.md)会把已接收的本地 handle 绑定到 Team journal 并镜像本地 health。Envelope 接收、回执、调度和远程 placement 都在本提供方之外。

[AgentRuntime 决策](../../../.agents/notes/implemented/architecture/2026-08-27-agent-runtime-service-definition.zh.md)和[子系统参考](../../../docs/subsystems/agent-runtime.zh.md)定义共享注册表边界。
