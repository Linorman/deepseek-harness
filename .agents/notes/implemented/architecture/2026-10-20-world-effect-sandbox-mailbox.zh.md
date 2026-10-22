# Agent Note: World 效果沙箱与跨 run 邮箱

Status: implemented

[English](2026-10-20-world-effect-sandbox-mailbox.md) | 中文

## Problem

模拟批准不提供真实用户授权，传输结果不明也无法证明效果或跨 run 消息是否已被接受。在考虑可选的真实 provider 或分布式 World 执行前，恢复必须保留原始责任。

## Decision

[Product owner](../../../../packages/simulation/simulation-product/README.zh.md)提供独立、显式启用的 Host 服务。效果沙箱在 IO 前持久化已认证用户的明确授权及发送状态；未知结果继续占用容量，仅查询原键。适配器拥有本地持久测试 sink，不启用外部 provider。

邮箱保存 outbox/inbox 原件和绑定 hash 的回执。业务身份是源 run、generation 和本地消息 ID 的 JSON 元组；回执位置限定在源作用域内，避免披露其他 peer 的流量。首条日志固定 principal/peer 策略，边界事件保留已认证作者。在接受和重放时验证 peer 权限、generation、源顺序及同一来源的因果引用；其他 peer 的私密消息不能满足或泄漏前置条件。持久化源边界禁止更早的发送；目标时间只推进到所有 peer 已覆盖的承诺之内。永久故障停止推进。邮箱接受不修改 Native 业务事实。已认证的 `syncNativeClock` 通过不可序列化的 Host 权限提交邮箱 cut；Native 保存精确邮箱序号和完整原始归档前缀 SHA-256；drive、决策 wake 收集和调度重放执行其排他上限和永久停止项。零冻结初始消费，缺少 peer 承诺时也不能推进到零。同一个纯时钟/停止投影器供实时事实和 checkpoint 前缀验证使用。

## Alternatives considered

盲目重试效果可能重复未知结果。把模拟投票当成 Grant 混淆模型权限与 Host 权限。把消息计数当作资源结算，或把邮箱快照集合当成分布式 checkpoint，都属于缺少协议的原子性声明。

## Consequences

[测试](../../../../packages/simulation/simulation-product/tests/external-effect.spec.ts)覆盖 JSON/SQLite 的有限授权和未知结果；[Loader fixture](../../../../packages/simulation/simulation-product/tests/fixtures/external-effect/cordis.yml)通过真实凭证 lease 证明新进程对账。[邮箱测试](../../../../packages/simulation/simulation-product/tests/federation-mailbox.spec.ts)覆盖回执丢失、因果阻塞和保守时间。补偿是需要新明确 Grant 的独立效果，不能重写其已确认来源。实时提交与重放共享的校验器禁止跨效果复用 Grant 身份，恢复失败时关闭发送准入。真实 provider 验证、独立安全审查及分布式需求测量仍是独立验收责任。
