# @clocky/clocky-team-activation-recovery

[English](README.md) | 中文

`@clocky/clocky-team-activation-recovery`是一个显式挂载、通过本地 fencer 或准确远程 supervisor 执行同主机 SDK 或 ACP 恢复的 Consumer。启动期间，它将选中的未完成或外部已围栏 epoch 委托给 `ctx.teamActivations.coldReplace()`；可选 pulse 会重复相同的 latest-binding scan 并发现启动后创建的 activation；它注册 `team-activation-recovery`，并且只通过一条 one-shot proof 调用 `ctx.teams.quiesceActivation()`来为本地已结算 epoch 重试 wake cleanup。它自身绝不调用 fencer。

## 启动选择

扫描只考虑 active `local-agent`或 `remote-agent` participant 的最新持久 activation。其 plan kind、binding provider、recovery profile 必须与配置值准确匹配；默认 kind 是 `sdk-local-cold-replace`，ACP 使用显式的 `acp-local-cold-replace`。本地计划匹配`hostId`；supervised 计划也可以匹配显式列出的`supervisorHosts`执行主机。它接受任意未 quiesce 的 activation status，包括 `offline`，因为 controller 拥有 process fencing 和持久 replacement。

`quiescenceSource: 'quiesced'`表示完成的本地 shutdown，绝不会被替换；保留的非终态 wake 只会重试 `quiesceActivation()`。`quiescenceSource: 'fenced'`证明旧进程已经停止，仍可 cold replacement；controller 拥有的 fence 路径会在 bind 新 epoch 前重试 wake cleanup。每个 candidate 在执行前重新读取，且按顺序运行。已有 controller owner 的 epoch 会跳过。controller 若已记录命名的 `SUPERVISOR_*` 或 `AGENT_RUNTIME_*` durable stall，则继续扫描其余 Team；generic controller 或 persistence failure 仍会拒绝 plugin startup。

## 配置

`provider`、`profile`和 `hostId`均为必填，且必须是没有首尾空白的非空值。`kind`默认为 `sdk-local-cold-replace`，且必须匹配 provider 的 durable plan。`pulseIntervalMs` 可选地启用有界重复 scan。`pageSize`默认每页发现 128 个 Team；`supervisorHosts`添加准确远程执行主机。卸载先等待已接纳 pulse 工作结算，再释放 proof owner。请在受控 Hub-start window 中、匹配的 runtime provider 和 activation controller 之后挂载此 Consumer。 重复或回退的 Team-list continuation 会让 startup recovery 以 `TEAM_CURSOR_CONFLICT` 失败，而不会重复扫描同一 page。

## 模型体验

### 启动恢复

#### 模型可见内容

该包不注册 `prompt`、tool、model input 或 model output。恢复后的 Agent 只会接收由独立 Team Link Consumer 投递的输入。

#### Token 影响

零直接 token 影响。

#### KV Cache 影响

该包不会修改 model request prefix。

## 已知限制与延期工作

- 每次挂载选择一个 SDK provider/profile。远程监督要求准确注册版本，以及能恢复所选 Session 的 replacement provider；stalled Team 需要显式生命周期恢复。
- 未设置 `pulseIntervalMs` 时扫描只在显式挂载时运行一次；设置后会以 single-flight 方式重试失败恢复并发现新创建的 activation。
