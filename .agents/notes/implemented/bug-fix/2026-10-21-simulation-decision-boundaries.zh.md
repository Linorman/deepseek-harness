# Agent Note: 明确 Simulation 决策边界

Status: implemented

[English](2026-10-21-simulation-decision-boundaries.md) | 中文

## Problem

恢复的角色保留先前工具结果。泛化唤醒可能被理解为总结上一次提交，导致新决策一直未提交，直到截止时间。反复确认也会生成更多唤醒而不推进工作。同时，工作收尾后的空闲驱动器与预算阻塞运行，需要不同于“尚未观察到驱动器工作”的解释。不透明的联合类型校验错误还会使模型反复猜测缺失字段，直到决策超时。未获请求方授权报价维度与单位或币种不匹配，需要不同的修正指引。

## Decision

[决策输入](../../../../packages/simulation/simulation-team/src/input.ts)标明当前输入身份，并明确要求观察和提交本次决策。先前提交不能满足当前决策；选择不产生效果时仍需暂存空提案列表。输入保持为持久化 user message，因此新增指令可从 Session 重建。重试验证继续比较精确消息内容。

[World 预设](../../../../apps/cli/config/agent-presets/simulation-world/agent.cordis.yml)要求角色交流新增信息、必要问题或变更提案，而不是确认对方的确认。它不选择业务结果，也不合成空提交。

[状态组件](../../../../packages/client/ui-simulation/src/client/RunStatus.tsx)在停止原因可用时，用已观察原因解释未工作的驱动器。[工作区](../../../../packages/client/ui-simulation/src/client/Workspace.tsx)将 stalled 和 failed 运行列入待处理条目，即使驱动器只是返回等待结果而未抛出异常。

[暂存预检](../../../../packages/simulation/simulation-team/src/preflight.ts)将唯一匹配的 `kind` 分支展开为有界嵌套字段诊断。有歧义时保留原联合类型诊断。输出只包含 schema 路径、类型和声明的允许值，不回显提交正文。缺少报价授权时，诊断指出 `request.input.quoteScope` 并引导选择允许的非报价结果，避免猜测币种。两类诊断均不改变 Native 准入，也不修补提案。

## Alternatives considered

**将最终文字响应视为空决策。** 这会虚构模型意图，掩盖遗漏的通知或业务效果。

**增加预算以容纳重复对话。** 更大额度不能区分新工作与反复确认。

**将所有未工作的驱动器视为未观察到。** 工作收尾后的空闲和预算耗尽均是已观察状态，不是缺少证据。

**只返回外层联合类型失败。** 模型无法定位所选操作变体的缺失字段，无关分支会消耗其决策期限。

## Consequences

指令增强决策间的区分，不削弱 Native 的提交、截止时间或预算约束，也不保证模型遵守。精确控制消息契约发生变化；不会重写或静默重新解释已消费输入。

## Verification

模型观察与恢复测试固定消息及其精确重试身份。无密钥 World 驱动场景覆盖公司、实验室、新人物参与和冷恢复。状态与工作区组件测试覆盖空闲原因及 stalled/failed 待处理条目。真实 WebUI 测试使用 `llmapi/deepseek-flash`；独立案例仍需兼容的环境接入及自身验收证据。

裁决暂存还比较动作请求 ID 与准备好的 resolve 上下文。先前请求可能保留在 Session 历史中，因此不匹配在提交前成为可修正工具错误，避免本可预防的永久 Native 提交拒绝。Native 继续验证完整接受决策。World 测试在两种后端覆盖修正与提交。

每次同步发送请求的权限检查，用同一个独立 Native 快照核对作用域、任务和报告；异步工作之后仍重新取得快照。这避免在同一次未变化的准入检查中反复复制完整长程历史，不改变独立快照 API。

驱动器异常会使前一成功批次的结果失效。Company 与 World owner 清除该结果，避免提供方失败继续显示先前的 `work-limit` 或重试期限。恢复仍需显式执行，提供方诊断不通过公开控制泄露。Owner 测试覆盖先完成有界批次、随后失败的路径。

裁决 `report-preflight` 可运行场景拒绝不完整报价，核对模型实际可见的字段诊断，提交修正后的替换，并在 JSON 和 SQLite 上验证冷恢复。单元测试覆盖展开后的额度、有歧义的联合类型及缺少报价授权。
