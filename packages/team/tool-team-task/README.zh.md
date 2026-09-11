# @clocky/clocky-tool-team-task

[English](README.md) | 中文

`@clocky/clocky-tool-team-task`只会在 live 默认 [`TeamRun`](../team-run/README.zh.md) coordinator 的 scoped Agent 中注册 default task tool 与声明式 workflow tool。它从 `ctx.teamRuns`取得 opaque coordinator capability；每次运行操作时，TeamRun 都会重新验证该 capability、live Agent 及其 activation。其他 Team-bound Agent 和普通 Session 都不会获得这些 tool。

## 操作

`team_worker_pool_set(worker_count)`允许 coordinator 选择目标 worker pool 大小。对于包含多个可并行 workstream 的 non-trivial objective（包括 research、analysis、writing、planning、data、operations、coding、testing 或组合），coordinator 应在启动独立 task 前至少设置为 2。TeamRun 会将其限制在 deployment ceiling 内，激活新增 worker、回收空闲多余 worker，并返回 requested/target/active/idle/busy/queued count；触顶或当前 capacity 满时 `saturated` 为 `true`。该操作不会等待忙碌 worker；ready task 可以先准入，由 scheduler 等待空闲 worker。

`team_task_start(subject, instructions, read_scopes?, write_scopes?)`会创建一个有界的默认 worker task。调用方提供简洁的 subject、完整 instructions、预期 deliverable 与 validation，以及可选的 filesystem region。对于包含多个可并行 workstream 的 non-trivial objective，coordinator 应在等待前至少启动两个独立 task。只有并行修改 shared workspace 的 writer 才使用窄且互不重叠的 workspace-relative file scope；不修改文件的 research、analysis、writing、planning、data、operations 或 review task 保持空 scope；如果只有一个 worker 可以安全写入共享 artifact，则为其他 worker 安排只读工作。tool 会把 coordinator 当前 workspace 内的绝对路径转换成 workspace-relative 形式，拒绝 workspace 外路径，并将 workspace 根规范化为 `.`。省略的 scope array 会变成显式 empty array。结果包含 `task_id`、当前 task `phase` 以及下文说明的审阅事实。

`team_task_wait(task_id)`会等待通过同一 coordinator capability 创建的 task，包括已配置的审阅。它返回紧凑的 terminal result：completion summary、可用时保留的 failure code 与 message，或 terminal phase。取消 tool call 只会取消本地 wait，不会取消 task execution。结果不会包含 worker transcript、activation detail、Team identity 或 lease fact。

`team_task_list()`会返回通过该 coordinator capability 创建的每个非 workflow task 的当前紧凑 phase。`team_task_watch(after_cursor?)`会等待 Team cursor 前进，并用新 cursor 返回同样有界的 task snapshot；取消调用只会停止这一次本地 watch。这些操作暴露 phase 和审阅事实，不包含 worker transcript 或 lease progress。

Start、list、watch 和 wait 返回 `review_policy`：`{ kind: 'none' }` 或 `{ kind: 'participant', reviewer_id }`。其 `review_result` 是 active attempt 对应的 `{ attempt_id, decision: 'accepted' | 'rework' }`；没有 active attempt 时，选择最近结算的 attempt。`null` 表示该选中 attempt 尚无审阅决定，不表示没有配置 reviewer。新的 attempt 不会继承较早 attempt 的决定。结果不包含审阅理由和完整历史。


`team_task_propose_owner(task_id, participant_id?)`会为 owned pending task 设置或清除 durable scheduler hint。被命名的 Participant 不会因为 proposal 获得 authority 或 lease；scheduler 仍可以选择其他合格 Participant。

`team_workflow_start(plan)`准入一个完整的 JSON-serializable `TeamWorkflowPlan`。每个 task template 使用与 `team_task_start` 相同的 workspace-relative scope 规则：coordinator 当前 workspace 内的绝对路径会被转换，workspace 外路径会在准入前拒绝。plan 包含明确的 task template 和 plan-local dependency、有界 concurrency/attempt limit、基于 role 的 versioned workflow channel graph，以及 task-result projection。TeamRun 会在创建任何 durable task 或 workflow channel 前校验完整 graph，并返回稳定的 `plan_id`。

`team_workflow_task_cancel(plan_id, task_template_id, reason?)` 停止所拥有 workflow 的一个任务。无法满足依赖且尚未执行的后继取消，独立节点继续。`team_workflow_wait(plan_id)` 等待全部绑定任务并返回 plan 汇总 phase 与选定的终态 task fact。其 result 来自 durable task attempt；取消这次调用不会取消 plan。

## 重试与权限

`team_worker_pool_set` 和 `team_task_start` 仅对 coordinator 开放。并发 task admission 只会在短暂的 pool/topology 与 task creation 区间串行化，因此自动扩容可以看到每个 outstanding task，而已经准入的 worker task 仍并行执行。每次 `team_task_start`都会从其 `rootCallId`和 `callId`派生 Team task-create idempotency key。同一 model-call lineage 的 replay 会带着相同 durable key 到达 TeamRun。TeamRun 拥有 task creation、worker activation、scheduler dispatch、access check 和 terminal state；本包不会暴露直接的 Team、worker 或 lease authority。

`team_workflow_start`会从同一完整 call lineage 派生 plan-admission key。Hub 会将 plan、channel binding、task binding 和 terminal projection 写入 Team journal，因此 retry 或 restart 会从 durable record 继续 compilation，而不会重放 model-written code。

## 配置

本包没有配置。只有 composition 挂载 `team-run`、`agents`和 `tools`，并创建 current 默认 coordinator 后，capability 才可用。

## 单任务取消

`team_task_cancel(task_id, reason?)`请求停止一个任务，其他 Team task 继续执行。非终态响应表示 owner 或 allocation 清理尚未完成；`team_task_wait`用于观察结束。Start/list/watch/wait/cancel 结果提供有界 `cancellation` 事实，没有单任务 intent 时为 null。 [取消归属](../../../.agents/notes/implemented/architecture/2026-09-06-exact-single-task-cancellation.zh.md)。

## Model Experience

### Worker pool sizing

#### What the model sees

仅 coordinator 可见的 [`team_worker_pool_set`](../../../docs/tool-catalog.zh.md#clockyclocky-tool-team-task) schema 接收目标 worker 数量，并返回有界的 target、active、idle、busy、queued 和 saturation 事实。可以在 fan-out 前或工作进行中安全调用。

#### Token effect

一个稳定的 coordinator-scoped schema 和一个紧凑的 status result。

#### KV Cache effect

schema 在 coordinator 内保持稳定；pool count 是动态 suffix entry。

### 默认 worker task start

#### What the model sees

scoped [`team_task_start`](../../../docs/tool-catalog.zh.md#team_task_start) schema，随后是紧凑的 `task_id`、`phase`、`review_policy` 和 `review_result`。普通 `tool/call`和 `tool/result` event 会保留 request 与 result；本包不会新增 Session event。

#### Token effect

每次 task start 会增加一个 coordinator-scoped schema 和一个紧凑 result。其他 Agent 不会获得该 schema。

#### KV Cache effect

schema 在 current coordinator scope 内保持稳定。每个 request 与 result 都是 dynamic suffix entry。

### 默认 worker task wait

#### What the model sees

scoped [`team_task_wait`](../../../docs/tool-catalog.zh.md#team_task_wait) schema，随后是紧凑 terminal phase、completion summary 或 retained failure fact，以及 policy 和匹配 attempt 的审阅决定。worker transcript、activation identifier、Team identifier 和 lease 不会进入 model-visible result。

#### Token effect

每次 completed wait 会增加一个 coordinator-scoped schema 和一个紧凑 result。其他 Agent 不会获得该 schema。

#### KV Cache effect

schema 在 current coordinator scope 内保持稳定。terminal result 是 dynamic suffix entry。

### 默认 worker task inspection and cancellation

#### What the model sees

scoped [`team_task_list`](../../../docs/tool-catalog.zh.md#team_task_list)、[`team_task_watch`](../../../docs/tool-catalog.zh.md#team_task_watch)、[`team_task_cancel`](../../../docs/tool-catalog.zh.md#team_task_cancel) 和 [`team_task_propose_owner`](../../../docs/tool-catalog.zh.md#team_task_propose_owner) schema。List/watch 返回 owned `task_id`、`phase`、`review_policy` 和 `review_result`，以及 watch 使用的 durable Team cursor。Cancel 返回 owned task 的最终 phase；owner proposal 返回保留的 hint，但不授予 assignment authority。

#### Token effect

一个紧凑的 phase snapshot 可以覆盖当前所有 owned 非 workflow task。Watch result 是动态 suffix entry，不会重复 worker context。

#### KV Cache effect

schema 会在 coordinator scope 内保持稳定；task phase、cursor、cancellation result 和 owner proposal 保持动态。

### 声明式 workflow plan

#### 模型所见

scoped [`team_workflow_start`](../../../docs/tool-catalog.zh.md#team_workflow_start) schema 只接受 data：task template、dependency、bound、基于 role 的 transition graph 和 result selection。compact response 包含 `plan_id` 和 durable phase。`team_workflow_wait`只返回选定的 task result。

#### Token 影响

coordinator 的 request stream 会增加一个 workflow-plan schema 和一个 compact plan result。Plan 与终态 task fact 仍是动态内容。

#### KV Cache effect

schema 在 coordinator scope 内保持稳定；每个 plan 和 result 都是动态 suffix entry。

## 已知限制与延后工作

- **默认 worker pool profile**：shipped compiler 将 task 解析到已配置的本地 worker pool 和 shared workspace；通用 roster selection 与 task-specific placement 仍由独立 Consumer 负责。
- **紧凑的 task monitoring**：list/watch 暴露 durable phase、审阅与 cursor fact，不暴露 percentage progress、worker transcript、lease internals 或 task-specific placement。
- **Advisory owner proposal**：proposal 可以优先指定 Participant，但绝不会绕过 scheduler eligibility 或转移 task authority。
- **workflow channel role resolution 是本地的**：plan role 必须解析到一个 active 默认 coordinator、worker 或已配置 reviewer Participant；remote 和 custom placement 仍需显式组合。
