# Agent Note: Compiled Team workflow-plan Consumer

Status: implemented

[English](2026-08-31-compiled-team-workflow-plan-consumer.md) | 中文

## Problem

保留下来的 workflow package 可以执行 model-written JavaScript，但 shipped Team workflow 需要一个 durable graph，使 admission、task fan-out、channel protocol、result projection 和 restart 行为不依赖 private script state。没有这个边界时，coordinator 可能在完整 graph 校验前逐步创建 task；restart 也无法区分未完成的 compilation 与新请求，因而无法安全重试已打开的 channel。

## Decision

`clocky-team`拥有 version-one、只含 JSON 的 `TeamWorkflowPlan`。它包含带 plan-local dependency 的完整 task template、typed task bound、result selection，以及基于 role 的 workflow-channel graph；graph 可以使用 built-in condition/target 或准确版本的 extension reference。Core validator 会在 durable admission 前拒绝重复或未知 template id、dependency cycle、无效 bound、未知 result reference、无效 role target 和无界 graph syntax。

`TeamRuntime` provider 暴露 plan admission、读取、task/channel binding 和 phase transition operation。本地 Hub 将每个完整 plan revision 作为 `workflow-plan/changed` 写入 Team journal，并保留 task/template provenance 与 plan-owned channel id。当前持久格式版本由 [Hub README](../../../../packages/team/team-hub/README.zh.md) 维护。Plan 与 channel retry 使用 durable plan identity；匹配的 workflow channel open 会返回已有 manifest，不会再生成另一个 channel。Task snapshot 也会在同一 journal format 下保留 advisory `proposedOwnerId` hint；该 hint 受 revision fence 保护，但不会改变 authority。

`TeamRunService`是 shipped compiler Consumer。它的 coordinator-scoped `team_workflow_start` tool 只接受 plan data。Consumer 将声明的 role 解析到一个 active 默认 coordinator、配置的本地 worker pool 或已配置 reviewer，校验准确的 workflow extension，打开或恢复 workflow channel，按确定性 topological order 创建 task，使用稳定的 plan/template key 绑定每个 task，并且只有所有 binding 都存在后才将 plan 转为 `ready`。`team_workflow_wait` 在全部绑定任务结算后读取 Hub 拥有的汇总结果及选定的终态 task result。同一个 coordinator scope 现在也为非 workflow task 暴露紧凑的 list/watch/cancel operation 和 advisory owner-proposal operation；watch 携带 Team cursor，cancel 遵循[准确任务停止协议](2026-09-06-exact-single-task-cancellation.zh.md)，proposal 绝不会转移 authority。Scheduler 在 plan compiling 时忽略其中 task，强制 plan 的 parallelism 与 total-attempt bound，并在自己提交 bounded assignment mutation 后安排后续 ready task 的 coalesced drive。

已有的 script-driven workflow capability 仍只供显式 custom composition 使用。它不与 shipped Team workflow tool 共用名称，也不能修改 shipped Team authority。Shipped default-task tool 另外暴露 `team_task_propose_owner`；其 Participant id 只是 scheduler preference，绝不是 assignment 或 access grant。

## Alternatives considered

**将 model-written JavaScript 继续作为 shipped Team authority。**拒绝，因为任意 control flow、clock access 和 private mutable state 无法作为 durable task/channel graph replay。Script seam 仍可用于明确受信任的 custom composition。

**在完整 plan 校验前创建 task。**拒绝，因为 partial graph 可能在后续校验失败前泄漏可执行 work、占用 budget，或与 scheduler 发生 race。Admission 会先校验完整 plan，compiling task 在 ready revision 前保持不可调度。

**只使用 process-local idempotency map。**拒绝，因为 process unload 或 Hub restart 会重复创建 task 或 channel。Plan snapshot、task provenance、channel plan id 和 compare-and-set revision 才是 authority；进程内 map 只用于合并并发调用。

**让 model-authored graph 直接携带 concrete participant id。**拒绝，因为 id 是 Hub-owned opaque value，也不是稳定的 model vocabulary。Plan 使用 Team role；compiler 将每个 role 解析到一个 active participant，再生成 adapter 所需的 concrete graph。

## Consequences

Shipped coordinator 可以在配置的本地 worker pool 上表达有界 fan-out/fan-in work 和 conditional workflow conversation，而不需要第二个 model loop 或未记录的 script authority，同时保留独立 task 的紧凑查看、advisory owner preference 与 准确 cancellation path。Durable binding 使 admission、channel creation、task creation 与 phase transition 之间发生 crash 时仍可恢复，并允许新 coordinator activation 安全重试。Scheduler 新增 durable readiness gate、plan-local concurrency accounting，以及在自身 bounded assignment mutation 后 coalesced follow-up drive。

首个 compiler 有意保持 local 且面向 default worker：所有 task template 都必须能由配置的 worker 执行并使用 shared workspace；reviewer role 则通过配置的 local reviewer 解析。通用 participant placement、remote workflow compilation、retention 和 multi-host evidence 仍由 [native multi-agent work-system proposal](../../proposed/architecture/2026-08-27-native-multi-agent-work-system.zh.md)作为 deployment work 负责。

## Testing

Core workflow test 通过 typed validator 和 JSON schema 验证语义拒绝，包括空或重复集合、自身或未知 dependency、cycle、normalized text、role 与 reviewer reference、attempt overflow 和 graph bound。所有 built-in condition 与 target、versioned extension，以及保持 source order 的 fan-in 都有覆盖。未知的 JSON condition 和 target kind 在语义验证前就被拒绝；运行时覆盖仅排除对应 closed-union 的穷尽断言及其 helper。同步 topological traversal 的私有 map 始终保留所有已验证的 task 和 dependency，因此缺失 entry 的分支没有生产者。

Task schema test 覆盖可选 owner hint。Hub test 覆盖 JSON 与 SQLite admission、binding、channel idempotency、checkpoint/restart reconstruction、workflow-owned task provenance、owner-proposal CAS 和 malformed owner reference。TeamRun test 覆盖 assembled compiler、result projection、scheduler concurrency race、terminal wait、compact task list/watch、pending cancellation、owner-proposal forwarding 和配置的 worker pool。Scheduler test 覆盖有效 proposal preference、proposed Participant 缺少所需 capability 时的 fallback、两个 eligible worker 的 fan-out 和被阻塞的 fan-in task，以及 scheduler 自身 assignment 后的 follow-up scheduling。Tool test 覆盖 coordinator-only registration 与 model-facing field mapping。Keyless assembled Headless snapshot 会通过真实 Team task assignment/report 运行 shipped workflow tool、配置的 multi-worker workflow fan-out，以及 custom owner-proposal/cancellation path，并检查 Team journal、workflow channel WAL、coordinator/worker Session record 与 final output。Property/model-based、keyed real-model、remote/multi-host、real-browser/GIF 以及 load/retention evidence 仍在 proposal 中明确 pending。
