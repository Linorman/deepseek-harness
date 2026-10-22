# Agent Note: World 裁决 schema 与规划耗尽

Status: implemented

[English](2026-10-21-world-resolution-schema-diagnostics.md) | 中文

## Problem

调控者上下文提供操作身份及业务事实，但这些事实没有定义 apply payload 的可接受结构。模型可能反复提交无效招聘选择，却无法得知缺失字段。随后超时消耗剩余规划次数，而持久化运行阶段仍为 running。

## Decision

[World driver](../../../../packages/simulation/simulation-world/src/driver.ts)在每个新的裁决上下文请求中捕获必填的 `world-resolution-schema` 块，其 `planSchema` 来自原安装 handler。Native 在模型派发前记录这些分区，覆盖 Channel 送达与场景驱动案件。schema 计入完整上下文额度并随 Session 正常重放。重放不会在旧 view 中重新生成 schema，否则会改变其哈希并使原消费凭证失效。

严格解析错误保留类别及完整 cause，同时返回最多八条有界字段诊断。被拒绝的 payload 可在同一决策内修正，不能提交业务效果。[浏览器状态所有者](../../../../packages/client/ui-simulation/src/client/RunStatus.tsx)在摘要中展示规划耗尽；调度说明补证／超时尝试已计费，且重新开始或恢复检查点不会重置上限。

## Alternatives considered

增加额度或期限只能推迟 payload 未明所导致的失败。改写旧 view 或删除已计费尝试会改变保留的模型输入或绕过原预算。创建修正后的新运行能同时保留历史与冻结额度。

## Consequences

裁决请求增加 schema Token。上下文过大时仍按既有规则拒绝，不会静默省略 schema。运行时及日志格式不变。既有耗尽案件不能仅因软件提供了更完整的指令就恢复执行。

## Verification

[无密钥 driver 场景](../../../../examples/simulation-company/tests/world-driver.snapshot.ts)在 JSON 与 SQLite 上提交无效招聘选择，读取字段错误，修正后只提交一次招聘，再在新进程中无推理恢复。解析器测试覆盖嵌套字段缺失、未知键及有界诊断。浏览器组件测试在既有状态／控制所有者中覆盖可见的耗尽原因与禁用调度。
