# Agent Note: World driver 队列 revision 竞争

Status: implemented

[English](2026-10-13-world-driver-revision-collisions.md) | 中文

## 问题

World 调度在异步 Team 工作及进入 Native 写队列前读取 Native 状态。真实用户暂停可以在该读取与 `openWindow()` 准入之间提交。原 revision 必须拒绝，但把正常并发结果归类为调度器失败，会阻止后续显式开始并误报有效暂停。无关 provider 失败也可能在暂停时返回，因此仅凭当前 phase 不能分类异常。

## 决策

Native 抛出公开的 [SimulationRevisionConflictError](../../../../packages/simulation/simulation/src/revision.ts)，携带原 expected 与 actual cursor。原 revision 比较、队列顺序及持久记录不变。[World driver](../../../../packages/simulation/simulation-world/src/driver.ts) 只处理该类型：已暂停的 run 返回 paused；运行中的 run 返回有界 coordination limit，由现有调度 owner 重新求值。不接受旧 window。原公平队列 ticket、wake、计划正文及效果均保留，生产性调度仍由显式 start 控制。

其他 provider、上下文、身份和 schema 异常即使遇到另一 owner 已记录暂停也继续抛出。这扩展了[持久模拟提案](../../proposed/architecture/2026-09-17-durable-simulation-coordination.zh.md)的管理并发约束；该提案更广的 ownership、outbox 和未完成协调决策仍有独立价值，保持 active。没有 active implemented note 拥有这一精确异常分类；没有笔记被替代或归档。

## 考虑过的替代方案

**忽略 revision。** 这会接受已不具准入权限的原快照输入，旁路 Native 并发约束。

**匹配异常文本，或在暂停时吞掉全部失败。** 这把无关失败误判为成功暂停，并让正确性依赖文案。

**在内部无限重试。** 重复管理写入可能独占调度；返回现有有界 coordination 停止保留调用者的批次和队列策略。

## 影响

运行中的无关并发写入在下一有界批次重新求值。暂停竞争不把 Product owner 标成 failed，也不擦除已接受工作。该异常只增加运行时分类，不改变 journal 格式、持久来源证据或 Session 协议。

## 验证

[Driver 测试](../../../../packages/simulation/simulation-world/tests/driver-revision.spec.ts)使用真实 JSON/SQLite Native 队列、精确 cursor 冲突、原未来 wake 和零模型派发；还要求已记录暂停后无关 IO 失败继续抛出。[浏览器测试](../../../../apps/web/tests/world-director-events-authoring.snapshot.ts)保留原作者台/预检/创建/开始流程，并在真实场景提交后的准入处设置固定断点：实际 UI 暂停先提交，原 `openWindow()` 调用拒绝，调度排空且不追加推理，实际 HTTP control 视图保持 paused 和健康 driver。原间歇失败及 stack 保留在完成证据中。
