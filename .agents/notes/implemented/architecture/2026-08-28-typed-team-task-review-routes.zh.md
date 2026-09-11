# Agent Note: 类型化 Team task review route

Status: implemented

[English](2026-08-28-typed-team-task-review-routes.md) | 中文

## Problem

task 先前的 `reviewPolicy`是一个不受解释的 JSON object。每个成功 attempt 都会进入 `review`，而任何 active participant 都可以在没有持久说明的情况下 resolve 它。这会让无需 review 的工作经历不必要的状态转换，也使未来 reviewer router 无法证明谁被选中，或为何已接收的工作会返回 rework。

## Decision

`TeamTaskReviewPolicy`是封闭的 task-creation 值：`{ kind: 'none' }`或 `{ kind: 'participant', reviewerId }`。`none`下的 completed attempt 直接到达 `completed`。participant route 会进入 `review`；只有准确的 active configured reviewer 才能通过 `resolveTaskReview()`resolve 它。

每次 resolution 都会将不可变 `TeamTaskReviewDecision`追加到 task snapshot。它标识 completed attempt、reviewer、已接收的 `completed`或 rework 的 `pending` phase、非空 reason 和 decision time。Hub 会在 journal fold 和 checkpoint recovery 中校验 policy 与 decision history，跨 rework 保留先前 decision，并拒绝缺失、重复、乱序、错误 reviewer 或尚未 resolve 的 completed attempt。

task report tool 仍由 owner fence 保护，并且只报告 attempt result。现在它会为 no-review task 返回直接 `completed` phase，为 participant-routed task 返回 `review`。review routing、review-channel delivery 和面向模型的 review action 仍是独立 Consumer。这次 snapshot 变更将 Team journal 推进到 format 7，将 Team checkpoint 推进到 format 8；更早 Team format 会被拒绝。

## Alternatives considered

**保留任意 JSON 的 `reviewPolicy`。** 不予采纳，因为 Hub 无法在没有 provider-specific、未经检查 key 的情况下校验 reviewer identity，或决定 completed task 是否需要 review。

**允许任意 active participant resolve review。** 不予采纳，因为这会让 worker 或无关 teammate 批准工作，并且不会为 recovery 或 audit 保留持久 reviewer selection。

**在定义 route 前创建独立 reviewer task。** 延后，因为 task-assignment channel 会启动 worker attempt，不能安全地代替 reviewer delivery。类型化 route 和 decision history 建立了后续 review Consumer 要消费的持久事实。

## Consequences

调用方创建 Team task 时必须选择明确的 no-review 或 participant-review route，review resolution 必须提供 reason。rework 会将同一 task 返回 `pending`，因此现有 scheduler 和 retry fence 会生成其下一个 attempt，而无需第二套 retry mechanism。等待 review 的 task 不能被 cancelled 或 deleted，因为这会丢弃其未解决的 completed attempt；participant-reviewed attempt 在其配置 reviewer 已 left 或 failed 后不能进入 review。后续 routing 或 stall Consumer 拥有 reviewer 在 task 已进入 review 后变得不可用时的恢复。[持久 task-attempt 决策](2026-08-28-durable-task-attempt-leases.zh.md)仍是 attempt ownership 的权威；[原生 multi-agent work-system 提案](../../proposed/architecture/2026-08-27-native-multi-agent-work-system.zh.md)仍拥有 reviewer routing、stall、quiescence 和 Team completion。

## Verification

[Scheduler 组合测试](../../../../packages/team/team-scheduler-dag/tests/composition.spec.ts) 使用真实 Hub、consult adapter、directed view provider 和 scheduler，为已完成的 worker attempt 创建 review channel。Request 保留准确的 reviewer、attempt、revision 和 result。获授权的 response 会完成 accepted task，或为 rework task 分配新 attempt；两条路径都保留已完成的 attempt 和唯一的 review decision，不重复创建 consult channel。

core schema 会拒绝无效 route、history、reason 和 lifecycle combination。Hub 测试覆盖 no-review direct completion、准确 reviewer enforcement、accepted 与 rework decision、attempt-two reassignment、错误 journal/checkpoint decision 和 restart recovery。Team task-report composition 证明返回 phase 遵循 frozen route。
