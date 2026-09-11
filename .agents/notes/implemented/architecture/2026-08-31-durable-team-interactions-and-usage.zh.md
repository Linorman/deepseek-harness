# Agent Note：持久 Team human action 与 provider usage

Status: implemented

[English](2026-08-31-durable-team-interactions-and-usage.md) | 中文

## Problem

Approval 和 question 请求之前只是 host 进程中的等待项，并只通过 mux frame 表示。进程重启后，Team 可能没有任何持久事实表明仍在等待 human decision。Team budget 也已经配置了 token、turn 和 cost 上限，却没有 Team-owned usage fact 或供 Session adapter 幂等报告 provider 计量的入口。

## Decision

`clocky-team` 定义 `TeamHumanActionSnapshot` 以及带 cursor fence 的 `upsertHumanAction()`／`resolveHumanAction()` 操作。`team-hub` 将完整的 `human-action/changed` record 存入 Team journal，折叠到 `TeamStateSnapshot.humanActions`，并在 JSON／SQLite recovery 后保留 request detail 与终态 outcome。source request identity 按 Team、Session、kind 和 provider request id 稳定生成；只有 immutable request fact 匹配时，已有 action 才会重放。pending action 会参与 quiescence 诊断。

同一个 journal 还拥有 `TeamUsageSample` 与 `TeamUsageSnapshot`。`recordUsage()`会替换重复的 turn／step sample（例如早期 stream sample 与最终 assistant message），而不是重复计数。Hub 会折叠 token bucket、不同的 Session turn 以及 provider 提供的 cost unit，在 replay 时验证 aggregate，并在超过冻结的 turn、output-token 或 cost 上限时将 Team 持久置为 stalled。显式 provider cost 保持权威；否则由配置的创建时 rate table 计算 sample 价格，具体见[usage admission 决策](2026-08-31-team-closure-authority-and-detail-inspection.zh.md)。

Typed Team budget 不能放宽创建时的 deployment ceiling：两者同时约束，实际 limit 取已定义值中较小者。`recordUsage()`先保留观测到的消耗，再在超过上限时置为 stalled；closure-driver scan 在消耗达到同一个上限时停止新工作。双方派生相同的 observation reason。Typed token、turn 或 cost 的零上限表示已耗尽，小数 typed cost unit 仍然有效；整数计数与 deployment limit 的验证规则不变。Team stalled 后到达的结算用量仍须保留。Retry 与 concurrency 上限约束新 attempt 的接纳；recovery budget scan 不会停止已经接纳的最后一次 retry，或正在占用 concurrency slot 的 attempt。

当 Session header 提供 Team 与 Participant identity 时，Host approval 和 question adapter 会持久化带 Team provenance 的 request 及终态 outcome。浏览器 Team projection 会从持久 Team state 预置 pending action，并继续消费 live mux requested／resolved frame。因此 host 重启仍会保留 pending Team record，尽管 host 本身无法重建进程崩溃时正在等待的 tool promise。

绑定的本地 Agent 会携带准确的 Team／Participant／Session／turn／step provenance 转发最终 `assistant/message.usage` event。Team Hub 仍是计量权威；delivery、model execution 和 pricing 仍属于 provider。

## Alternatives considered

**只把 approval 与 question 保留在 host mux registry。** 不予采用：Hub 重启后 Team page 和 audit consumer 会丢失 pending decision，即使来源 Team 与 Session 仍然持久存在。

**把每个 usage event 都累计为新的计费 sample。** 不予采用：adapter 可能先报告同一 turn／step 的 stream usage sample，再报告最终 assistant-message sample；使用稳定 id 替换 sample 可以避免重复计数。

**推断未配置的 provider price。** 不予采用：pricing、cache multiplier 和 deployment currency 属于 provider route；normalized cost unit 只能来自显式 sample cost 或配置的冻结 rate table。

**让 typed budget 覆盖 deployment ceiling。** 不予采用：独立提供的 Team budget 不能放宽创建时保留的 deployment limit。采用较小的已定义 ceiling 可以保留双方约束；未提供 typed ceiling 时，deployment ceiling 仍然生效。

## Consequences

Team journal 与 checkpoint format 分别为 26 和 27。既有 pre-release stream 会被拒绝，而不会猜测转换到新 projection。Team state consumer 读取手写 test fixture 时可以把 `humanActions`、`usage` 与 `workflowPlans` 视为可选；新创建的持久 Team 则由 Hub 发出适用的字段。Typed Team 与 task resource budget 覆盖 token、turn、wall-time、retry、concurrency、cost 和 provider-extension ceiling；assignment admission 会在提交 lease 前检查静态 reservation 与运行时 retry/concurrency limit。

这不宣称 host-side promise 在进程崩溃后可以恢复、不宣称存在通用 cost catalog，也不宣称自动 multi-host consensus。这些边界仍在 native multi-agent work-system note 中明确保留。

## Verification

JSON 与 SQLite Hub test 覆盖 pending／settled human-action recovery、action write 幂等、usage replacement、budget stalling 和 checkpoint validation。真实 closure-driver／Hub test 覆盖 typed／deployment 精确上限、零上限、小数 cost、越界 sample 保留、stalled 后的结算计量及已经接纳的最后一次 retry。Headless Loader snapshot 验证实际 AgentClient Session usage、更紧上限与小数 cost 的 driver stall，以及零预算在激活前的拒绝。Host approval／question test 保持并行请求行为。Core、Host、client 以及生成的 Cordis catalog 均可 typecheck，聚焦 Team／Agent-client suite 通过。
