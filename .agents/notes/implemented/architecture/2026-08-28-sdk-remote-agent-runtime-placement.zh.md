# Agent Note: SDK remote AgentRuntime placement

Status: implemented

[English](2026-08-28-sdk-remote-agent-runtime-placement.md) | 中文

## Problem

远程 Team Participant 需要一个准确的 activation epoch，可在不与 Team Hub 共享进程或本地 `Agent` 的情况下发布、观察、中断和释放。既有 SDK Session prompt 路径会惰性创建 Session 并发出通用 Session status，因此无法证明某个 Team／Participant／Session epoch 的所有权，也无法安全驱动其持久 residency。

## Decision

`clocky-sdk-protocol`新增严格的 `activation/open`、`activation/link-enroll`、`activation/status`、`activation/interrupt` 和 `activation/dispose` 消息。每个 lifecycle 消息都命名完整的 activation、Team、Participant 和 Session target。state 会重复该 target，携带封闭的 residency status，并推进每个 epoch 的 `statusSequence`。post-bind enrollment 会以 placement provider 和短期 credential 重复该 target。SDK server 会在 fresh 发布前实体化成对 Team／Participant Session provenance，在 resume 时验证它，阻止向 activation-owned Session 直接 prompt，并且只发出准确的 activation status notification。

`clocky-agent-runtime-sdk`注册远程 placement provider。它接收带 fresh 或 resume seed 的 active `remote-agent`，要求显式 provider/model option，并为已接收 epoch 创建一个 SDK child process。其 handle 的 `localAgent: undefined`，会验证每个返回 target 与 status progression，控制 listener failure，在 transport 或 protocol 失败且缺少准确终止证明时保留`stopping`，并且只在远程 dispose 与进程结算后释放 child。provider unload 会关闭 admission，而不会撤销已返回 handle。

Team activation controller 会通过与本地 placement 相同的持久事务绑定该 handle。它只在 handle 发布后记录远程 epoch，镜像其 status stream，并在失败时释放它。

配置 recovery profile 和 host identity 的 SDK 部署会在隔离进程组中启动每个 child，并返回不含密钥的 recovery plan。只有本地 inspector 能证明 creation identity 时才启用恢复；macOS 会拒绝此配置，而不会围栏粗粒度时间戳。匹配 fencer 会在发信号前验证 provider、profile、host 和身份。若 wake cleanup 被中断，其持久 quiescence source 保持为 `fenced`，后续启动扫描可以通过 `coldReplace()`完成 cleanup 并以同一 Session 和 `resume` seed 打开新 activation id；本地已结算的 epoch 永远不会恢复。

## Alternatives considered

**把 `session/prompt`复用为远程 activation API。** 不予采纳，因为 Session id 不标识一个 activation epoch，而通用 Session status 可能属于不相关的 SDK activity。

**适配一次性的 SDK subagent provider。** 不予采纳，因为它会创建带私有 Session identity 的 child task，并在 task 结算时关闭完整 runtime，而不是保留可复用的 Participant epoch。

**把 Link enrollment 放进 `activation/open`。** 不予采用，因为 Hub 只有在 activation controller 提交持久 binding 后才能授权 attach，而该提交只会发生在 placement 发布之后。post-bind 操作由 [SDK post-bind Team Link enrollment 决策](2026-08-29-sdk-post-bind-team-link-enrollment.zh.md)拥有。

**在 Hub 重启后重新附接旧 activation id。** 不予采用，因为新 Hub 无法证明旧进程、credential、task lease 或 receipt 流仍然有效。冷替换会 fence 旧 epoch 并创建新 id。

## Consequences

SDK process 可以托管带有 fresh/resume provenance 和准确生命周期观察的 durable-bound remote Participant epoch。持久 binding 提交后，它可以经 activation-local 固定 Link 接收 direct 和 task-assignment input、flush Session source、确认持久 delivery、报告 task outcome 并提交显式 final output。同主机部署可在 Hub 重启后冷替换已 fence 的 child。显式 startup-recovery Consumer 会扫描最新且匹配、未完成或 `fenced` 的 SDK epoch 以替换，并且只为本地 `quiesced` epoch 重试 wake cleanup；远程监督由[带版本的 endpoint 决策](2026-09-08-owned-activation-supervisor-endpoints.zh.md)拥有。

[AgentRuntime Service Definition 决策](2026-08-27-agent-runtime-service-definition.zh.md)仍是注册表和进程内 provider 的权威。[持久 activation binding 决策](2026-08-28-durable-local-activation-binding.zh.md)仍是 Team journal admission 的权威。[原生多 agent 工作系统提案](../../proposed/architecture/2026-08-27-native-multi-agent-work-system.zh.md)仍为 proposed，因为投递、调度、workspace 和产品阶段尚未完成。

## Verification

SDK protocol、client、server 和 fencer 测试覆盖严格 wire parsing、target matching、fresh/resume provenance、detached-group teardown、PID/start fencing、profile mismatch、post-bind enrollment、status ordering、中断、dispose 与进程丢失。activation-recovery 测试覆盖 current-state revalidation、startup proof invalidation、single-flight pulse cleanup、非法 interval rejection，以及跨 restart 的 interrupted wake cleanup；其定向 source suite 已达到 statement、branch、function 和 line 100% 覆盖。真实 SDK child 只会在第二个 Hub fence 第一个 Hub 遗留的 child 后，在新 binding 下恢复同一 Session，并经新 Link 写入 receipt。
