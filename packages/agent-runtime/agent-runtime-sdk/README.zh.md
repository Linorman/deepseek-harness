# @clocky/clocky-agent-runtime-sdk

[English](README.md) | 中文

`@clocky/clocky-agent-runtime-sdk`在 `ctx.agentRuntimes` 上注册进程外远程 placement provider。它需要 `clocky-agent-runtime`、`clocky-sdk-client`、`clocky-subprocess` 和 `clocky-subprocess-local`；默认 provider 名称是 `sdk`，可通过 `providerName` 更改注册名称。`command`、`args`、`cwd`、`env` 和 disposal 限制会显式选择 child runtime。

## Activation 语义

只有 active `remote-agent` Participant 可以使用该 provider。request 支持 `fresh` 或 `resume`，要求显式 Agent `provider` 和 `model` option，并为已接收 activation epoch 创建一个 SDK child process。fresh activation 会在远程 runtime 中实体化成对 Team／Participant Session provenance；resume 会验证已存储的 provenance。fork seed 与具名 preset 会在分配 child process 前被拒绝。

每个 SDK operation 都携带准确的 activation、Team、Participant 和 Session target。返回的 handle 公开 `localAgent: undefined`，验证 target echo 与单调 status sequence，并且只转发 `activation.status` lifecycle observation。过期 status 无法重新激活 epoch。只有精确的远程 `offline` response 或受控 child process 已关闭时才发布 `offline`；lifecycle 或 transport failure 后两者都无法证明终止时，handle 保持 `stopping`，而 `health()`／`dispose()` 会报告 `AGENT_RUNTIME_TERMINATION_UNCONFIRMED`。同一 Team／Participant 的并发 request 只有在选择相同 Session 时才共享 handle。

配置 `teamLinkEnrollmentProvider` 后，provider 会等待 Team controller 的匹配持久 `activation/changed` binding，从 issuer 预留不透明 credential，并把 post-bind enrollment 发送到 SDK child。child 拥有固定 Link delivery；parent 拥有 credential 撤销。dispose 会在远程 dispose 前关闭 child delivery，并等待终止证明。provider 卸载会阻止新 request，而不会撤销已接收 handle。

同时配置 `recoveryProfile` 和 `recoveryHostId`会在 Linux、macOS 或 Windows 的本地 inspector 能提供准确 creation identity 时启用同主机冷替换。provider 会记录该 profile、模型路由和进程身份，以隔离的 POSIX 进程组启动 child，并注册匹配的 fencer。profile 或 host 不匹配会在替换前失败；macOS 使用包含微秒的内核创建时间，不使用 `ps` 的秒级时间戳。

`recoverySupervisor: { name, version, endpointId }`还会记录准确的 supervisor descriptor，并在发布 handle 前通过本地`activationSupervisors` registry 持久登记进程 owner。在此 provider 之前挂载[执行主机 endpoint](../activation-supervisor-http/README.zh.md)。Provider 声明`terminationMode: 'owned-process'`；远程 health/fence 不改变其本地进程启动行为。

## 模型体验

### 远程 placement

#### 模型所见

`ctx.agentRuntimes`不添加提示词片段或工具。本包不公开本地 Agent。配置 enrollment 后，SDK child 会通过 activation-local 固定 Link delivery 接收持久 direct 或 task-assignment input。

#### Token 影响

没有直接 token 影响。

#### KV Cache 影响

本包不拥有请求前缀。

## 已知限制与延后工作

- **没有 fork 或具名 preset 组合**——只支持 fresh 和 resume activation request。
- **仅同主机 provider**——启动恢复编排和多主机 supervision 仍是独立 Consumer。

[SDK 远程 placement 决策](../../../.agents/notes/implemented/architecture/2026-08-28-sdk-remote-agent-runtime-placement.zh.md)和[子系统参考](../../../docs/subsystems/agent-runtime.zh.md)定义共享 placement 行为。
