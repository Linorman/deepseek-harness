# Team 改进实施记录

目标：落实审查报告中的运行可靠性、工具交接与 Agent 引导改进，全程不使用 subagent。保留其他 UI 工作区修改，不发布或提交到远端。

## 实施范围

- R1：连续续跑保留任务关联、预算和重复事件去重；补充未 report 的有限处理。
- R2：wake 恢复、review 与新任务分配都获得有界进展机会。
- R3：review 频道创建与重试的 durable 幂等身份。
- M1/M4：wait 保留工作证据、产物、验证和精确终止原因。
- M2：返工换 worker 的新输入保留最近审查依据。
- M3/M5：workflow 模型参数可构造；watch 指引与实际返回值一致。
- Prompt：依实际收益委派、明确交接与完成条件，避免重复策略。
- Link：核实永久失败的分类与恢复触发，再实施有证据的改进。
- 测试：修复审查发现的旧断言与场景组装，加入真实 Loader/keyless 组合与必要 SDK 快照；运行相关包测试、类型、lint、文档门禁。
- 文档：更新中英 README、相关 Agent Note、生成目录与审查实施状态。

## 当前进展

已实现 R1/R2/R3、M1/M2/M3/M4/M5 的首轮代码、有限未报告提醒和 Link 永久失败暂停。运行回归 104 项通过，跨 Agent Client/TeamRun/任务工具/Link 的检查 397 项通过；新增恢复回归 59 项通过。类型构建已通过一次，后续改动仍需最终复查。

真实 Loader 场景已修复 human inbox 缺项。新增连续截断与未报告场景正在调试；首次脚本模型用 user message 计数，组合输入后无法识别，已改用已输出 assistant 片段确定脚本阶段。文档和 Agent Note 已更新草稿，生成目录、双语配对、最终 lint 与 SDK 检查尚未完成。

新增 Agent Note 的 supersession 检查保留 task-outcome reporting、deterministic scheduler、Team Link registry、exact task cancellation 四项 active 决策；它们仍拥有独立的授权、租约和生命周期规则，无完整替代，不归档。

还需检查 workspace observer 把 .clocky runtime 文件计入 changed_paths 的实际影响；该现象在完整 wait 结果中暴露。只有完整范围完成并有当前证据时才结束目标。


## 追加验证发现

- 真实跨 worker 返工已通过：新 worker 首次请求获得前次结果与审查理由，持久 attempt 记录确认参与者不同。
- 默认 review 的 metadata-only 视图无法给 reviewer 提供正文；已改用包含 payload 的有界 recent-window 视图。
- 已停止且未作决定的 reviewer 不再让 task/workflow wait 或阻塞式 task watch 无期限等待；已有持久响应仍由 scheduler 恢复，不伪造审查结论。
- 发布 assignment 期间 task 提前推进可使 scheduler 自有 proof 失效；已加入有限重试，持续无效时仍拒绝并清理每个未提交 wake 频道。
- 已从模型实际可见的 workflow schema 示例执行两阶段任务，并检查后继任务读取前驱实际写出的文件。
- Python SDK 105 项通过；修复的是过期测试组装及显式启动下缺少配置/凭据的 fixture，没有改变 SDK 认证策略。
- 同工作区还在并行修改子 Team / activation 预算。隔离验证按本次审查范围选择代码，保留这些并行修改，不将其计入本次实现的完工声明。


最终落实状态和验证边界见[实施结果](RESULTS.md)。上面的过程记录保留当时的检查状态，不代表仍有相同故障。
