# Agent Note：Team 快照 workspace 元数据

Status: implemented

[English](2026-08-31-team-snapshot-workspace-metadata.md) | 中文

## 问题

Team workspace runtime 现在会在 task-assignment message 中加入 `Workspace root` 行，使 worker 能定位自己的执行面。无 key 的 headless TeamRun 快照 fixture 仍按旧的、要求 `Attempt` 行位于文本末尾的形式解析 assignment。因此 worker 无法恢复任务，也不会发出 `team_task_report`，协调器一直等待到 loader 超时。SDK 快照契约也只列出已有 Team 工具，而组装后的 catalog 已暴露 goal、message、heartbeat 和 review 控制。

## 决策

将 `Attempt` 之后的元数据视为可向前兼容的 fixture 输入：确定性 adapter 提取 task 与 attempt 标识时不再要求匹配到文本末尾。fixture 仍要求稳定的 `Task` 与 `Attempt` 行，只忽略明确追加的 workspace 元数据。SDK 快照的 required-argument 映射现在包含组装 catalog 暴露的全部 Team 控制，包括 `team_message`、`team_task_heartbeat` 和 `team_task_review`。

通过仓库 refresh 模式刷新无 key ACP 快照，使 pinned prompt/schema sidecar 与 replay transcript 描述当前 Team catalog。本次迁移不录制 live model，也不改变 runtime 行为。

## 曾考虑的替代方案

**从 runtime assignment 中移除 workspace 行。** 拒绝，因为 worker 需要显式的、对模型可见的 workspace 位置，以支持 shared 和 isolated 执行面。

**让 fixture adapter 精确匹配完整 assignment 文本。** 拒绝，因为再增加一个合法 assignment 元数据行就会不必要地破坏确定性测试，而测试实际只需要保护稳定标识。

**放宽所有 snapshot 断言。** 拒绝，因为只有 assignment parser 需要对尾部追加内容前向兼容；request header、tool schema 和持久日志仍保持精确比较。

## 后果

headless TeamRun delegation snapshot 现在证明 worker 能消费带 workspace 元数据的 assignment，并完成持久化 task 生命周期。后续在稳定标识之后追加合法 assignment 元数据不会使该 fixture 失效。快照 sidecar 现在固定完整的当前 Team 工具面，因此 catalog 增加工具时会产生明确、可评审的 refresh，而不是误导性的 replay 失败。

## 验证

- `pnpm run test:snapshot` 通过（14 个文件、91 个测试、跳过 2 个），包含两个 headless TeamRun 流程、ACP replay 与 SDK replay。
- `pnpm run test:e2e` 通过（31 个文件、120 个测试；跳过 24 个文件、63 个测试）。
