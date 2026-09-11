# WP03：显式频道摘要与可重建视图

主责：上下文程序员。负责 G02。前置：复用既有摘要持久化与权限机制并登记 C1 摘要约定；按用户最新优先级立即开发，不等待完整覆盖率。与 WP02 并行实现独立 Consumer；修改共同 manifest/view 代码时按 WP00 排队。

## 当前基础

[Hub summarizeChannel](../../../packages/team/team-hub/src/index.ts)与[生产 Consumer](../../../packages/team/team-channel-summary/src/index.ts)已在主工作区接通 canonical source、协调者工具和认证人类 API，包含确定性有界文本生成、来源 fingerprint 和全频道共享可见性校验。37 unit、JSON/SQLite 真实 Loader src/lib 与 Host/Client 构建已通过；摘要持久化机制由[现有决策](../../notes/implemented/architecture/2026-09-01-durable-channel-summaries.md)拥有。

当前首片拒绝图片与私密子集来源。后续须随 WP02 admission 使用历史 deliveryIntents 判定来源可见性，并完成策略、retention 和最终共同版本验收；尚未提供模型生成策略。下列规格作为完整交付的检查清单，已实现部分直接复用。

## 推荐实现

新增 team-channel-summary Consumer，注册 canonical source。提供显式 summarize 操作，输入只包含选定频道、范围/策略、期望 cursor 和幂等键；人类和 agent 分别通过当前 human/activation authority 发起，不能携带 raw sender。

先交付确定性、有界 extractive 实现和完整运行入口；若提供模型生成策略，摘要工作必须通过 Team-owned task/Participant 和 Session 日志执行。任何额外模型请求都记录确切输入、输出与用量，不在 projectView 或 Hub 锁内调用模型。

配置至少包含允许策略、最大来源 Envelope 数、最大来源字节、最大摘要字节、可处理历史跨度和是否允许模型生成。默认不自动总结每条消息；部署可另开显式阈值调度，并受同一预算和 authority 限制。

## 实现步骤

1. 定义 Consumer 请求、作用域、result 和 error；明确允许谁总结哪个可见范围。摘要不得包含调用者不可见 Envelope。
2. 用当前 page API 读取有界完整范围，保存有序 ids、起止 sequence、policy/version 和源内容 fingerprint。范围超过限制明确拒绝或由调用方分段。
3. 在锁外生成候选摘要；提交时让 Hub 再校验范围、visibility、cursor、proof 和 idempotency。并发新消息不自动扩大原范围。
4. 添加 coordinator 或 human 的显式调用入口，并复用现有 tool/API owner，避免重复工具名。模型工具的结果只返回摘要 id、覆盖范围、简短结果。
5. summarized-window 只选择 durable summary 与未覆盖后缀；team/channel-view 固定确切内容，不在后续请求时重新计算摘要。
6. 与 WP02 的频道退休、WP13 的 compaction 测试连接；retention 不得删除仍被 view/causation/summary 需要的来源。

## 验收

| 场景 | 预期 |
|---|---|
| 显式调用实际 Consumer | canonical source 被注册，Hub 可合法提交 summary |
| 同 key/同载荷重试 | 返回同一 summary，不重复生成已完成任务 |
| 同 key/异载荷 | 拒绝，不覆盖已有摘要 |
| 其他参与者的隐藏消息 | 无法进入摘要输入或结果 |
| 生成期间新 Envelope | 来源范围不漂移，冲突按约定重读 |
| 生成后提交前崩溃 | 重启可重用任务结果或重新生成，业务摘要幂等 |
| policy/adapter retire | 不启用新工作，已接纳 lease 按既有规则结算 |
| source 已 compacted | 只有足够 provenance/checkpoint 可证明时继续，否则 typed error |
| Session replay | 内容与第一次 admitted view 完全相同，无额外未日志化请求 |

## 验证与交接

复用[summary authority 测试](../../../packages/team/team-hub/tests/channel-summary-authority.spec.ts)、[channel-view 快照](../../../examples/headless-agent/tests/team-channel-view.snapshot.ts)，新增真实 Consumer 的 runnable-example 场景。若新增模型策略，还需 keyed 运行和产物断言；未实现模型策略时不能声称模型摘要已可用。

交接 C1 摘要接口、配置默认值、权限错误、来源保留条件和场景。建议两片提交：确定性端到端 Consumer；可选 Team-owned 模型策略。主提案要求的显式摘要入口与 provenance 不以可选模型策略为前提。
