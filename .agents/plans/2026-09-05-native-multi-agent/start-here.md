# 程序员分派入口：Native multi-agent 继续开发

当前 gap 设计与开发入口见[2026-09-08 gap closure 报告](../2026-09-08-native-multi-agent-gap-closure/gap-design.md)和[执行计划](../2026-09-08-native-multi-agent-gap-closure/development-plan.md)；本页以下内容保留为 2026-09-06 的历史分派状态。

更新时间：2026-09-06。本文供项目负责人安排人员和交付顺序；每位程序员拿到自己的工作包后可以独立推进。完整范围仍是[33 项验收映射](acceptance-map.md)，按 15 个工作包组织。33 是需求追踪数，不是 33 个尚未写过代码的功能，也不代表还需要 33 个 PR。

## 先做什么

**当前按用户 2026-09-06 的新要求优先实现功能。** A 负责 WP02 频道 admission，B 在完成 WP03 摘要后推进 WP06 工作区观察，C 负责 WP04 单任务取消；Root 集成生产切片并完成受影响 SDK 验证。停止以覆盖率测试片代替功能交付；每个功能仍需真实入口和必要验证，最终 P0/发行签收要求保留。

优先把已有基础的频道、摘要、取消和工作区观察做成实际可运行功能；每个切片修复它直接触及的恢复与终止问题。已有 Team/Hub/Session、认证、协议租约、final admission 和工作区基础继续使用。当前代码与尚未集成的实现见[接手状态](current-state.md)，不能只看旧提案中的问题描述重写一遍。

每个接手人按顺序读：[总计划](overview.md) → [共享接口约定](contracts.md) → 自己的工作包 → 包内链接的源码和 owning Note。每次交付使用[交接模板](handoff-template.md)，记录实际代码版本、命令和未完成项。

当前 HEAD 不包含整个实际开发基线。集成人先按 WP00 保存并确认有关修改，给每位程序员同一个可复现版本；独立 worktree 中的现有补丁应作为待审查输入移交。不得让接手人从裸 master 猜测缺失文件，也不得整树覆盖、提交或清理用户的其他修改。

## 第一轮可直接分派

当前三位 High 程序员与 Root 集成人并行，已完成切片直接复用。

| 接手角色 | 当前任务文档 | 独占实现范围 | 下一份可验收产物 |
|---|---|---|---|
| A：协议程序员 | [WP02 频道](wp02-channels.md) | invitation/ack、Local/WS、频道 Consumer | required endpoint 确认后 active，带固定历史 recipients 的真实交付 |
| B：工作区程序员 | [WP06 变化观察](wp06-workspace-observation.md) | shared provider、allocation observation | artifact 关闭时仍记录有界文件变化，publish/release 可恢复 |
| C：调度程序员 | [WP04 任务取消与 placement](wp04-scheduling.md) | exact task cancellation、scheduler/Link/TeamRun | 普通任务完整取消先合入，再接 workflow 取消和 placement |
| Root：集成人 | [WP00 集成](wp00-integration.md) | 共享类型/版本、三方合入、SDK 与组合证据 | 同一源码上可运行的组合，随后分派 child、human inbox 与产品 UI |

各 owner 只改自己登记的方法，Core/Hub/AgentClient/TeamRun 共享文件按 C0–C7 和 dirty baseline 三方集成。P0 尚未完成的职责仍由[生命周期加固](p0-01-lifecycle-hardening.md)、[Hub 验证](p0-02-hub-validation.md)、[组合故障验证](p0-03-assembled-verification.md)及[最终集成](p0-04-integration-gate.md)追踪，但不代替功能开发。

P0 放行需 AUTH、LIFE、LEASE、VIEW、GATE 五项都具有当前代码证据。包内测试通过或一份 coverage 100% 不能单独放行。缺远程硬终止能力不在本轮伪造完成；P0 对无法证明的旧 epoch 必须给出明确 stall，实际跨主机监督由 WP07 承接。

## 接续功能开发

| 开发线 | 工作文档 | 第一片实现与后续交接 |
|---|---|---|
| 协议 | [WP02 频道](wp02-channels.md) | direct v4 的纯协议和 wire/schema；随后 admission、真实 ack 和默认组合切换 |
| 上下文 | [WP03 摘要](wp03-summaries.md) | 首片已集成；接入 admission 的历史可见性并完成剩余策略验收 |
| 调度 | [WP04 placement 与任务](wp04-scheduling.md) | 普通单任务取消先交付；随后 workflow 取消、placement、排名、模板和远程组合 |
| 工作区 | [WP06 变化观察](wp06-workspace-observation.md) | provider 观察与 Team 事实；随后审计、integration 和恢复 |
| 远程 | [WP07 supervisor](wp07-remote-supervision.md) | 同主机证明能力复用与完整 seam；随后真实跨主机 fence 和 sandbox loss |
| Human/API | [WP08 inbox 与人工操作](wp08-human-delivery.md) | principal inbox 和 sink/receipt；随后重启回答、权限撤销与 display |
| 客户端状态 | [WP09 状态与分页](wp09-ui-state.md) | 唯一权威 selection、page/mutation 层；向两个 UI 包交付稳定 props |

以上七条线在相应接口确定后可以并行，不要求七位程序员都同时启动。人数不足时保持每包的主责和验收不变，将同一人所负责的包顺序执行；不要通过同时改共享文件制造表面并行。

## 后续组合与发行

| 工作文档 | 启动条件 | 完整交付 |
|---|---|---|
| [WP05 子 Team](wp05-child-teams.md) | WP04 execution、WP02 service admission、WP08 sink 约定 | 创建/绑定 saga、result/charge、取消归档、tool/API/两 SDK |
| [WP10 成员/频道 UI](wp10-ui-members-channels.md) | WP09 状态、WP02 协议、WP08 human authority | 实际成员与频道操作、错误恢复、真实服务 GIF |
| [WP11 任务/审阅 UI](wp11-ui-tasks-review.md) | WP09 状态、WP04 task、WP08 action | DAG、取消、人工审阅、integration；再接 child/remote |
| [WP12 legacy 退出](wp12-legacy-cutover.md) | 每项替代行为已有验收 | 源码、组合、catalog、依赖和包内实际退出；显式 compat 可运行 |
| [WP13 系统与性能](wp13-system-verification.md) | 测试设计立即开始，执行跟随对应功能 | 真实模型、跨主机、浏览器、性能预算及完整故障矩阵 |
| [WP14 发行与文档](wp14-release.md) | 对应功能、cutover 与系统验收完成 | 同一候选提交的双 SDK、全仓、三平台包消费与文档收敛 |

功能依赖链是 task/频道/human 基础 → child 与产品操作 → legacy cutover。P0、系统矩阵与发行验证并行准备，在最终候选版本汇合。跨主机、浏览器和性能环境由 WP13 提前盘点。

## 负责人如何验收

每个工作包分成能从真实入口运行的最小切片。交接必须回答：触发什么操作、写入什么持久事实、拒绝什么非法操作、失败后谁继续收尾、如何证明重试不重复执行。仅有类型、占位 provider、成功 mock 或 UI 截图均不足以关闭工作包。

每个切片先完成本包及受影响消费者的验证。跨包格式变化同时更新 parser、fold、Host、TS/Python 和 fixture；GUI 变更随片提交真实服务 GIF。最终全仓与发行验证由 WP14 绑定同一候选提交，不能累加不同分支的历史通过结果。

工期由接手人在第一片实际跑通后估算，报告剩余场景、环境依赖和风险。持久化与生命周期问题由对应 owner 处理；UI 可基于已有稳定 API 独立推进，按真实依赖安排联调。
