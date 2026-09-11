# Agent Note: Agent Client recovery and accepted-operation settlement

Status: implemented

[English](2026-09-05-agent-client-recovery-settlement.md) | 中文

## Problem

恢复出的 workspace handle 在持久 activation 和 Agent-root publication 完成前就已拥有 cleanup 责任。若 commit 失败后丢失该 handle，provider resource 就失去了 live release owner。Disposal timeout 也不会终止已接纳的 operation；提前撤销 proof source 或丢弃 pending promise，会中断持久确认，或让 activation disposal 过早完成。

重复 channel claim 可能以不同的对象键顺序编码相同的 JSON-owned view。比较序列化文本会拒绝这种有效 retry，即使 content 与 provenance 都没有改变。

## Decision

[Agent Client](../../../../packages/team/team-agent-client/README.zh.md) 将 workspace proof source、lease 和 release promise 保留到已接纳工作结算。关闭会立即停止新 delivery，并拒绝 pending pre-step barrier。Timeout 表示关闭尚未完成，最终 cleanup 仍附着在 settlement promise 上。Allocation 的终态 record 会移除 root exposure，但不会结算尚未完成的 provider operation。Preparation、reservation、materialization、restoration 或 activation 在关闭后才返回时，会完成 abandon/release，而不会发布新的 Agent root。

若 restoration 已返回 handle，但 activation 或 root publication 失败，client 会执行 unpublished-allocation cleanup：记录 release intent、释放准确 handle、确认 release。物理 release 失败时记录 preservation；确认失败时保留 release intent。原始失败和 cleanup 失败都会保持可观察。

Channel-view retry 按结构比较字段值和有序 content，复用已保存的 Session event 与 pending inbox message。持久 inbox claim 后进入 model step，才能证明此前已消费；未运行的 claim、被取消的 input 或继承的 fork seed，都不能证明当前 Agent 已消费该输入。

内部检查遵循各自 owner：已发布 allocation 与 snapshot 共享私有 map key，Session 的 channel-view projection 始终生成 user message，startup 在 recovery 首次 yield 前验证本地依赖。这些事实不会替代对持久 allocation reference、claim provenance 或 provider failure 的检查。

## Alternatives considered

**Timeout 到期就撤销 authority。** 拒绝，因为已接纳工作仍可能需要准确的 proof source。Dispose 后重新创建 source 会掩盖中断，并可能泄漏 registration。

**Activation 失败后保留所有已恢复 handle。** 拒绝，因为 client 已拥有它们的 release capability。Preservation 用于记录 cleanup 失败，不能替代对 unpublished handle 的 cleanup 尝试。

**Allocation 到达终态就丢弃 release promise。** 拒绝，因为其他 owner 可能在本进程仍等待 provider operation 时发布 preservation。Activation settlement 必须独立保留并等待该 promise。

**比较序列化 JSON 文本。** 拒绝，因为对象键顺序不代表 content 或 provenance 改变。结构比较仍会拒绝字段值或数组顺序变化。

## Consequences

调用方的关闭等待仍然有界，未完成的 backend 工作则保留结算所需 authority。Recovery 失败会阻止 model admission，而不会回退到 Session root。Cleanup 失败保持显式，并能依据持久 allocation state 重试。

[Shared-root 决策](../architecture/2026-08-28-shared-team-workspace-root.zh.md)与[detached-worktree 决策](../architecture/2026-08-28-detached-team-worktree-allocation.zh.md)继续有效：它们拥有 provider allocation 与 release policy。本记录拥有 consumer 的 handle 和 promise 生命周期。

## Verification

Package test 使用真实 Session 和 Inbox log 验证 persistence barrier、claim/step replay、fork seed、cancellation、view 改变拒绝及对象键重排。JSON-backed Hub test 覆盖 restore/activation failure、unpublished-root cleanup、release-confirmation reconciliation、timeout 后的晚到完成、每个异步 setup 阶段的关闭、其他 owner 的并发 preservation、多个 allocation、依赖退休和有界 usage failure。没有新增 coverage exclusion。
