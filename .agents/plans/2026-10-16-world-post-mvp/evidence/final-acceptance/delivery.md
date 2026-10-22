# H06/H07 文档与阶段交付核验

2026-10-20。独立审计核对 owner README、子系统、双语 Agent Note、runnable snapshot 和历史证据 hash；主验收补接当前 UI 与最终门禁。完整清单和原始核对结果见 [delivery.json](delivery.json)，当前契约/源码及构建产物由 [contracts.json](contracts.json) 负责。

## 文档和可执行样本

六个直接 owner 的 README、中文对应和配对记录均存在且配对 hash 一致：[Simulation](../../../../../packages/simulation/simulation/README.md)、[Local](../../../../../packages/simulation/simulation-local/README.md)、[Team](../../../../../packages/simulation/simulation-team/README.md)、[Product](../../../../../packages/simulation/simulation-product/README.md)、[Scenario](../../../../../packages/simulation/simulation-scenario/README.md)、[World](../../../../../packages/simulation/simulation-world/README.md)。公共类型和行为由[模拟子系统](../../../../../docs/subsystems/simulation.md)及中文对应承接，当前输入与后续修复的说明保持一致。

| 工作包 | 决策说明与可执行证据 |
|---|---|
| F0、A1/A2 | [创作版本与 offer](../../../../notes/implemented/feature/2026-10-17-world-author-revisions-and-offers.md)及中文对应；当前浏览器见 [UI 验收](ui.md)，领域与故障样本见原 A2/A3 证据 |
| A3 | [日历和组合审查](../../../../notes/implemented/feature/2026-10-16-world-calendar-review-routes.md)及中文对应；[日历时间快照](../../../../../examples/simulation-company/tests/world-calendar-time.snapshot.ts)、真实治理 HTTP 流程 |
| B1/B2 | 固定原始 workload、[引用归档](../../../../notes/implemented/architecture/2026-10-19-world-reference-archive.md)及中文对应；[归档/空存储恢复快照](../../../../../examples/simulation-company/tests/world-archive.snapshot.ts) |
| B3 | [闲置驻留](../../../../notes/implemented/architecture/2026-10-19-simulation-idle-residency.md)、[表示切换](../../../../notes/implemented/architecture/2026-10-19-memoryless-representation-switch.md)、[局部修改](../../../../notes/implemented/architecture/2026-10-19-local-object-mutation.md)及中文对应；owner/真实 Loader、已冻结维护测量和故障矩阵 |
| C1/C2 | [生成与规划](../../../../notes/implemented/architecture/2026-10-19-world-generation-planners.md)及中文对应；[生成快照](../../../../../examples/simulation-company/tests/world-generation.snapshot.ts)、原 Session 输入与子树额度回归 |
| C3 | [环境与人物演化](../../../../notes/implemented/architecture/2026-10-19-world-environment-evolution.md)及中文对应；真实两后端 domain 执行、环境 runnable 与独立预登记资源评价 |
| D1/D2 | Team/Product owner 备份说明、[实验分支](../../../../notes/implemented/architecture/2026-10-20-world-experiments.md)及中文对应；[分支快照](../../../../../examples/simulation-company/tests/world-experiments.snapshot.ts)、空存储/源离线/SIGKILL 矩阵 |
| 本地 E1/E2 | [效果沙箱与邮箱](../../../../notes/implemented/architecture/2026-10-20-world-effect-sandbox-mailbox.md)、[联邦所有权](../../../../notes/implemented/architecture/2026-10-20-world-federation-ownership.md)及中文对应；[本地效果快照](../../../../../examples/simulation-company/tests/world-real-effect-sandbox.snapshot.ts)、双 run 故障协议；不具备真实接入/生产资格 |

没有为本次测试断言增强另建 Agent Note：它未改变产品行为，新的验收原件记录实际覆盖。最终 `doc-sync` 结果由[总验收记录](validation.json)登记。

## 旧证据与当前输入

较早的 A、B/C manifest 存在源码变化，不能整体称为当前输入全匹配。变化按后续修复证据接续：当前 D/E 两份 manifest 合并后 1613 个源码输入匹配；归档 `archive.ts` 对应后续 `de-review`，其测试对应后续广域 manifest，`de-review` 的实际 D 聚焦复验又包含该归档文件。原 B/C 审查的归档 hash 因此已由后续证据补接，并非仍待开发的修复。本次没有修改归档源码。

长期性能 37 份原件的 SHA-256 与字节数逐一匹配，只复用其原 workload 和原测量时点结论，不声称当前所有后续功能均已重跑长期性能。C3 最新登记的 7 个源码 hash 匹配，真实 CLI `verify` 成功复核 24 次试验、5376 个样本、零自动约束失败；[日志](delivery-c3-verify.log)保留。人工评分继续暂缓，model judge 未执行。

## 阶段判断

H06 以当前 owner 文档、配对、快照及最终门禁为准；H07 保持原 98 个条目及文字、顺序和分母，不将 P5 可选缺口算作通过。原始失败和跳过仍保留在各自 manifest 中，不改写为整套通过。

P1/P2/P4 在既有有限支持范围内验收；P3 机制交付而人工质量评价未完成；P5 仅本地协议验证。用户于本次验收再次明确暂缓 C15/C16；E01/E07/E08/E15 的真实授权、provider 测试环境、部署必要性及正式审查继续缺证。最终 92/98 与六项保留的逐项说明见[总报告](report.md)，这些保留项不被新增条目或分母调整隐藏。
