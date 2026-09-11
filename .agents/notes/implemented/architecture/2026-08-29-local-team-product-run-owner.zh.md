# Agent Note: 本地 Team 产品运行所有者

Status: implemented

[English](2026-08-29-local-team-product-run-owner.md) | 中文

## Problem

持久 Team provider 可以创建 journal 和 channel，但不拥有产品 topology。否则 client 可以创建裸 Team、绕过 coordinator activation，或把 assistant message 当作面向 human 的结果。这样 human input、coordinator delivery、final output 和 Team completion 之间没有持久边界。

## Decision

Team 模板可以保留额外成员的明确执行路由，也可以不创建默认 worker。同一个 owner 创建这些成员的 Participant 和 Activation 身份，恢复时读取冻结路由，并在 coordinator 结算前释放成员 lease。Workflow 角色从已声明的 active roster 解析；没有满足能力要求的非 coordinator 执行者时拒绝计划。自定义执行和审阅角色因此仍由 Team 日志与现有 scheduler 管理，不产生私有子运行。

`@clocky/clocky-team-run`在 `ctx.teamRuns`提供本地默认 topology。它创建 active 的 `human`和 `coordinator` Participant、已 provision 但 inactive 的 `worker`，以及一个 direct v3 human/coordinator channel。它在初始 Team rules projection 中记录配置的产品 template id/version，通过 `ctx.teamActivations`激活 coordinator，并保留其 lease，直到终态结算或 provider 卸载。

activation controller 是 `ctx.teamActivations` Service。它仍是 publish、持久 bind、status mirror 和 dispose 的唯一 owner，因此 Team-run 不会复制 AgentRuntime lifecycle logic。`AgentRuntimeAgentSpec.cwd`会把已解析的本地 execution root 带入新的 coordinator Session header，而可选 request preset 会在发布前由选定的本地 provider 组合。

`create()`会在 activation 前解析可选的请求级 `ModelSelection`和正数 `maxTokens`；未提供 selection 时只读取一次当前 `agentDefaultModel`选择。它会将可选 coordinator preset 转发给选定的 activation provider。`start()`会在一个 sender-scoped key 下记录初始 topology 与首条 human Envelope；匹配的 retry 在本地 owner 存活时返回同一结果，而冲突复用会失败。human input 会在已配置的 retry limit 内重读已移动的 channel cursor，并在每一次尝试保留该 key。JSON-RPC runtime 会通过该请求传入已初始化的 route 和 cap，而不会改变进程默认值。

Human input 是可信 human sender 的 direct v3 `message` Envelope，只携带 text 和持久 image reference。`team_final`通过已认证 Link 原子派生调用 coordinator 的 peer 与当前 channel cursor，再追加显式 text `final` Envelope。本地 Agent client 接收 direct v2 text 或 direct v3 human content；Team-run 会先用其 TeamRun-scoped proof 持久化一个等待 receipt 的 completion intent，再通过配置的 bounded `readChannelPage()` page 读取 final-output channel，receipt 面向 human 的 final、等待 coordinator 变为 idle、释放其 lease、验证两个 direct recipient 没有 pending delivery，并提交 `active -> quiescing -> completed`。重启后 closure driver 会在准确的 human receipt 持久化后继续该 intent。assistant message 不会隐式成为 final result。

Team-run 只会从确切、存活的本地 coordinator Agent 生成 opaque default-worker task authority。其 task start operation 在内部派生 creator binding，接收 coordinator-scoped idempotency key、subject、instructions 及 read/write scope，并固定其余 worker task policy。其 task wait operation 只接收此前通过该 authority 准入的 task，返回保留的终态 result 或 attempt outcome，并允许 cancellation 只停止本地 Team-journal watch。

它也只会为该准确的 current coordinator 生成独立的 Goal authority。`tool-team-goal`通过它读取持久 objective，并且只有当前 open turn 含有可信 human direct-v3 Envelope 时才允许 compare-and-set objective edit。Team-run 从 lease 派生 actor，Hub 会再次为 mutation 设置 fence；model tool 不能创建 Goal 或改变其 phase。

Host Team Remote 提供持久 Team 的 list/get 读取，以及本地 Team-run 的创建、可重试 start 与文本输入、final 等待和取消。current-run operation 要求已认证 product principal 拥有 Team 的 active human Participant；detached archive 与 resume 使用独立的[经认证的产品主体 Team 控制](2026-09-04-authenticated-product-principal-team-control.zh.md) proof boundary。Web bundle 组合相同的本地 Team 栈；显式 Agent preset 会经 activation request 到达 coordinator，`tool-team`只会在 Team-bound Agent scope 中安装 `team_final`。

当部署提供 `reviewerPreset` 时，带 mutation scope 的 default-worker task 会冻结显式 participant-review 路由；Team-run 惰性配置 reviewer，scheduler 通过持久 consult channel 路由已完成 attempt。Task Agent 会在 settlement 前发布 provider-owned workspace 的 changed paths 与 artifact 引用，provider 永远不会自动集成用户改动。

Host Session 的提示词和取消会在普通 Agent routing 前识别 live coordinator 的持久 Team provenance。它们会验证唯一 active human/coordinator binding、通过 Team-run 追加 human input，并通过 Team authority 请求 soft interrupt。cold 或 orphaned Team Session 会响亮失败，而不会作为普通 Session 恢复。`@clocky/clocky-tool-team-task`是独立的 scoped TeamRun Consumer：它从每个 tool call lineage 派生 default-worker task-create key，返回紧凑 task identity 或 terminal fact，且绝不会暴露 worker transcript 或 lease data。它只会在 TeamRun 识别到准确的 live default coordinator 后注册；Headless 和 Web 会在 Team-run 之后挂载它。

Coordinator task projection 包含冻结的审阅 policy，以及至多一个匹配 attempt 的决定。它优先选择 active lease 的 attempt，否则选择最近结算的 attempt，避免 rework 让后续 running attempt 看起来已经审阅。决定为 null 表示该选中 attempt 尚无持久决定，不表示停用了审阅。Policy 和决定直接读取现有 Task snapshot；不存储并行状态，也不从终态 phase 推断决定。这些有界证据让 coordinator 可以区分经过审阅与无须审阅的完成，完整理由和历史仍由 Team journal 保留。它不能保证模型总能准确描述证据。

并发 Team 写入可能与 reviewer 准备的每个步骤及后续 task admission 竞争。Reviewer invitation、membership transition 和 activation 分别保留有界的 cursor-conflict 重试次数，在该步骤提交成功后重置计数。Participant 就绪后，task admission 使用自己的重试次数。两个阶段都会重读当前 Team 状态并签发新 proof；非 cursor 错误直接传播。Mixed-resource 可运行示例验证 workflow 在 reviewer 创建期间继续推进，并达到真实 review 与 approval 等待，再通过当前 owner 取消。

## Alternatives considered

**保留 headless direct-Agent runner。** 不予采用，因为它会创建产品可见的 Session，却没有持久 Team membership、channel 或 human receipt。

**自动广播 coordinator 的 assistant message。** 不予采用，因为 private model output 不能证明 recipient routing、持久 admission 或 completion policy acceptance。

**让模型通过已观察到的 channel cursor 发送 final。** 不予采用，因为 peer 选择与 cursor 可以在 channel read 和 post 之间变化。已认证 Link 将两项事实委托给 Hub 的 channel lock。

**将默认 topology 创建放入 Team Hub。** 不予采用，因为 Hub 拥有通用 authority 和 recovery，而 template、本地 placement、model selection 和 human-result policy 都属于产品。

## Consequences

headless、ACP、JSON-RPC runtime 和 Host Team Remote 使用本地 Team 产品 owner；TypeScript 和 Python SDK 会投影其 Team 创建、完成、取消、完整 Team control plane 和进程内 metrics。Web bundle 组合相同的 service。其 New Task 流程创建局部 Team 草稿、通过 `team.start` 发送首条文本，并打开返回的协调者转录；`ui-team` 列出持久 Team，渲染 task/channel/artifact/audit 投影，并通过同一 activation binding 解析选择。Web 名录不挂载 Workspace/Session 导航。[Team 拥有的产品任务入口](2026-08-29-team-owned-product-task-entry.zh.md)记录了相应的公开 Session 任务创建与分叉移除。它为新建 in-process run 覆盖 text/image direct v3 input、coordinator-authorized default-worker task、按配置启用的 reviewer 路由、workspace outcome publish 和显式 final output。进程 reload 会保留 active durable Team，供 authenticated human recovery owner 使用；automatic multi-host recovery、provider-specific integration 和 hard cancellation 仍是独立工作。

聚焦测试组合真实 Hub、本地 AgentRuntime、activation controller、Link、Agent Client、direct v3 protocol、scheduler 和 Team-run service。它们验证持久 topology、coordinator Session provenance、preset forwarding、human input admission、coordinator-authorized worker task creation 和 wait cancellation、显式 final receipt、没有 pending direct delivery，以及完成的 Team lifecycle。
