# @clocky/clocky-team-activation-controller

[English](README.md) | 中文

`@clocky/clocky-team-activation-controller`是 Team Consumer，用于把已发布的 `AgentRuntime` handle 接入其权威的持久 Team binding，并在 `ctx.teamActivations`公开该 owner。它依赖 `clocky-team`和 `clocky-agent-runtime`；不导入 `team-hub` 或任何 AgentLoop 实现。

Team 设置 `maxLiveActivations` 时，`activate()` 首先提交 Participant 启动预留，raw binding 保留 `reservationId`，第二个 epoch 不能复用。未发布启动只在确认清理后释放额度，已绑定 epoch 通过 quiescence 释放。未知启动跨重启保留额度，关闭恢复记录 `ACTIVATION_STARTUP_UNCONFIRMED`；即使没有容量上限，清理失败的 raw handle 仍归 controller 拥有并重试。reservation release 重试时保留已确认的 raw termination，不重复释放 handle。关闭失败可以重试，但 activation 接纳仍保持关闭。已知 provider 未启动的拒绝在存储失败后仍保留 reservation-release 责任。Bind 响应丢失时按准确的持久 epoch 核对，通过 quiescence 结算；readback 或 quiescence 重试不重复已确认的 raw termination。插件通过 `ctx.effect()` 注册 disposal，等待已接纳的启动和清理完成后再撤销 proof source。

## 持久 activation

`TeamActivationController.activate()`读取请求的 Team cursor 和 active agent Participant，在 placement 前拒绝 resident epoch 或另一 Session，调用具名 AgentRuntime provider，验证返回 handle 拥有请求的 Session，且任何 local Agent 都属于该 Session，然后调用 `ctx.teams.bindActivation()`。只有 binding 提交后才返回 `TeamActivationLease`。binding 被拒绝时 controller 会释放 raw handle；清理失败会与 binding 失败一起报告。

Provider 启动可以与其他 Team mutation 并行。调用方的 cursor 在启动前校验；provider 返回后，controller 读取当前 Team cursor 用于 binding。Hub 仍在自身 queue 内检查当前 membership、admission、proof 和 cursor。Binding 被拒绝时仍按相同规则清理 raw handle。

controller 将 `team-activation-controller`注册为 system proof source。它只会在为准确 observed epoch 与 cursor 调用 `bindActivation()`、`updateActivationStatus()`、`fenceActivation()`、`quiesceActivation()`或精确的 cancellation-stall transition 期间保留一条不可序列化 proof；Hub 会在 Team lock 内重新验证该 scope。释放 entry 会撤销其已保留 proof。Controller close 拒绝新的恢复工作，同时保留已接纳的恢复权限以及 current stopping entry 的短生命周期 status/quiesce proof，直至对应操作结算。

controller 会合并相同 Team、Participant 和 Session 的并发请求。替换 epoch 要求前一 epoch 已持久化为 `offline`；Hub 会保留两个 epoch，并要求该 Participant 的每个 epoch 使用相同 Session。返回的 lease 公开持久 binding、可选的 local Agent、health 同步、中断和静默释放，而不公开 raw provider handle。

带 recovery plan 的 offline epoch 在获得持久 quiescence proof 前不能重新 bind。raw handle 成功释放后，controller 会调用 `quiesceActivation()`释放 lease 并终结记录的 wake channel；该本地结算证明不能 cold-replace。`coldReplace()`只接受外部已围栏的证明、重试其 wake cleanup，并以新 activation 恢复同一 Session。controller 自身不扫描部署。`fenceStale()` 在释放 owned handle 前核对准确的 activation、Session 和 provider；无 owner 的 epoch 必须有经过验证的 provider fencer 或保留的 quiescence/fence proof，offline status 本身不证明终止。已接纳的 stale fence 阻止该 Participant 的并发 activation、replacement 和重复 fencing。Close 等待 provider 调用及持久写回；插件卸载在结算完成前保留已收集的 proof-source effect。

`recoverClosure()` 只接受与当前持久 intent 和 observed cursor 匹配的有效 closure-driver proof。每轮最多选择一个未结算 epoch：释放准确持有的 handle，或调用经过验证的 provider stale-epoch fencer，不创建替代 activation。缺少所有权证据时记录 `ACTIVATION_TERMINATION_UNCONFIRMED` 或 `REMOTE_CANCELLATION_UNCONFIRMED`；handle 不存在不代表 epoch 已 offline。本地 recovery owner 被卸载或无法 fence 时，cold replacement 会记录 `AGENT_RUNTIME_PROVIDER_UNAVAILABLE`、`AGENT_RUNTIME_FENCER_UNAVAILABLE` 或 `AGENT_RUNTIME_FENCE_FAILED`；supervisor failure 保留其 typed supervisor code。终止已获确认但 allocation 尚未释放时，先持久化 `fencedAt` 并请求释放，再完成 quiescence。该事实跨重启保留，已终止的进程树无需再次提供终止证明。被保留的 allocation 记录 `WORKSPACE_RELEASE_RECOVERY_FAILED` 并保留 metadata。卸载期间，已接纳的恢复操作在结算前保留其 proof authority。

## Health 与 teardown

controller 会订阅已接收 handle 的 status stream，并在其 Team 记录持久 cancellation 时释放每个已拥有 activation。进程内 provider 将本地 Agent 的转换映射为 `running`、`idle`、`stopping` 和 `offline`；远程 provider 可以报告同一组状态，而不需要全局 local-Agent observer。lease 释放会写入 `stopping`、释放 raw handle，然后记录 quiescence。若远程 provider 在持久 cancellation 中无法证明终止，controller 会保留 stopping entry，并将 `REMOTE_CANCELLATION_UNCONFIRMED`记录为 Team stall；绝不会把该 epoch 报为 offline。status 写入按 activation 串行，并重试受配置限制的 Team-cursor 冲突。卸载会等待已接收的 cold replacement 和普通 activation 工作。

`disposalTimeoutMs` 限制卸载结算，默认值为 `5000`，不得超过 Node 的 `2147483647` 毫秒 timer 上限。`statusSyncAttempts`限制一次观测 status 的 cursor-conflict 重试，默认值为 `8`。

`activate()`、`coldReplace()`、`preflightResume()` 和 `recoverClosure()` 在异步工作开始前捕获目标字段。每次校验 human resume authorization 时，它都必须指向同一 Team；provider 发布后以及 fencing 或 durable bind 前的再次校验也遵守这一要求。调用方修改原始 request 不会将已接纳操作转向另一个 Team。Controller close 会保留已接纳的 stopping-epoch cancellation-stall proof，直至对应 policy 或 append 完成。

## 模型体验

### Activation binding

#### 模型所见

controller 不添加提示词、工具或消息。[`clocky-team-agent-client`](../team-agent-client/README.zh.md)只会在匹配的持久 binding 可见后接收 channel 输入。

#### Token 影响

没有直接 token 影响。

#### KV Cache 影响

本包不拥有模型请求前缀。

## 已知限制与延后工作

- controller 接受 local-agent 与 remote-agent Participant。远程 provider 需要准确的 handle-status protocol；远程 channel 投递与 receipt 仍需要 Link。
- 它不调度 task、不分配 workspace、不打开 channel，也不公开 Team 产品 API。
