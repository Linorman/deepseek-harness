# Agent Note: 有界 Simulation 任务推进

Status: implemented

[English](2026-10-01-simulation-task-progression.md) | 中文

## Problem

已受理决策可能因场景要求另一操作而使真实任务仍未完成。reviewer 也可能将 completed attempt 返回 pending。复用首个决策或其终态结果无法履行这些责任，还可能将旧 attempt 与新工作混在一起。

## Decision

[executor](../../../../packages/simulation/simulation-product/src/task-executor.ts) 使用既有 Native 有序决策关联。在当前到期效果已推进、但场景完成证据仍缺失时，受信任 `nextDecision` 选择等待、阻塞或再次认知。它读取冻结事实，不能获得额外任务权限。新决策在执行前保留精确前驱、原因、认知策略与规范任务说明。重试恢复最后已记录关联，不再次运行 selector 来替换已记录决策。`maxControlSteps` 限制单批次，`maxDecisionsPerAttempt` 限制一个 attempt 内的认知步数，默认一。Native 模型、上下文、writer 与任务检查仍控制准入。

精确规范审核将最新 completed attempt 返回 pending 时，允许使用新 ordinal 和身份创建下一 attempt。原结果保持不可变。取消、依赖、剩余尝试次数与来源／交互检查仍是前提。普通等待、失败结果及待审核不能授权新 attempt。writer 物理退休继续使用独立配置的既有恢复策略。

选择留在受信任场景消费者中，无需新持久协议：Native 日志已记录全部选定决策与输入。默认公司模板保留单步／无需审核的契约。安装的采购方审核变体显式启用报告认知及行政审核；公开创建仍不接受 selector 或额外执行权限。

安装的 `task-workflow/1` 场景通过不可变部署步骤选择顺序确定性报告任务，在已准备 topology 内独立指定创建者、执行者、接收者和审核人。纯策略只接受已记录任务创建、报告或空确认；报告完成检查唯一 attempt 所属精确操作及匹配的接收者持久 receipt。行政审核从该步骤推导审核人，不依赖公司角色。同一来源的不同精确任务创建可使用不同执行路由；wildcard／精确路由重叠或精确路由重复时拒绝。模型驱动工作流步骤在配置阶段拒绝，因为效果应用后的完成检查无法限制模型产生有效但无关的世界操作。

已完成的报告任务不会丢弃已受理的未来输入。存在待处理 ingress 时，driver 继续使用精确十进制 tick 推进至最早的待处理原生事件，再为选定实体持久记录空确认。暂停运行只在显式恢复调度后消费输入。重试原已消费输入保留 receipt 和 decision，不创建另一报告、任务或资源效果。

## Alternatives considered

**反复执行首个决策直至完成。** 这会重复已受理效果，并丢失重建新模型输入所需的持久前驱。

**将完成证据缺失视为推理权限。** 等待可能是未来送达、审核或外部证据；只有明确的受信任选择才能准入另一次有界认知。

**rework 后复用 completed attempt。** 旧结果不可变，复用其身份会绕过 Team 尝试次数与审核约束。

## Consequences

场景作者必须共同定义有效后续决策及完成条件。等待和阻塞仍明确停止，不增加认知；超过配置决策上限的请求阻塞。已记录后继可跨响应丢失恢复，不增加效果或计算。新审核 attempt 通过既有任务决策路径获得当前规范说明。

rework 不授予重复已兑现转移的权限。Native continuation 仍要求原已退休 writer 的证据。任意 topology、其他效果类型及新增场景完整进程退出／浏览器矩阵仍是独立工作。已安装的采购方审核场景将一次库存转移与报告返工分开，使用[受限审核权限](../architecture/2026-10-01-simulation-task-review-authority.zh.md)。

## Verification

[推进回归](../../../../packages/simulation/simulation-product/tests/task-executor-progression.spec.ts)验证 JSON／SQLite 双决策完成、关联／执行响应丢失、等待／阻塞／决策上限，以及尝试耗尽／仍有次数时的真实规范 rework。[Loader snapshot](../../../../examples/simulation-company/tests/task-executor.snapshot.ts)在两种存储上验证一个真实 attempt 中的两个有序确定性决策，以及 rework 后两个经过审核的 attempt，含已记录输入、精确库存效果、不可变旧结果与完整最终检查点。既有模型和确定性单步 Loader 路径继续覆盖。这些检查不证明覆盖率百分比或待完成的完整故障矩阵。

推进测试还模拟已记录决策的效果结果或接收者回执暂不可见。执行器先等待而不选择新认知步骤，证据可见后继续原 attempt。决策数现在统一取自规范化的已记录关联列表。

[工作流回归](../../../../packages/simulation/simulation-product/tests/task-scenario.spec.ts)验证 JSON／SQLite 不同执行路由的顺序报告任务、供应方审核、错误审核人拒绝、rework 反馈、无库存转移或模型请求，以及模型／可执行配置拒绝。[行政回归](../../../../packages/simulation/simulation-product/tests/task-scenario-administration.spec.ts)在两种存储上验证运行所属审核、暂停意图、精确持久重试和无执行的冷读取。

[场景 driver 边界回归](../../../../packages/simulation/simulation-product/tests/task-scenario-driver-edges.spec.ts)使用已准备的原生 run，拒绝不完整的检查点投影，在开启回包丢失后恢复精确的创建与后续窗口，重放已提交决策而不重复任务、关闭已取消窗口而不重复认知，并在保留原任务窗口时拒绝变更执行路由。创建身份已受理却没有任务操作、记录的是其他原生效果或任务 outbox 事件已取消时，场景停止。有效任务创建等待规范回执；driver 在选中任务步骤后沿流程传递该回执，不再于执行后重复读取。测试还覆盖驻留容量、普通任务停止、审核、管理暂停、未来输入排序及送达输入等待接收方容量。

[未来输入回归](../../../../packages/simulation/simulation-product/tests/workflow-ingress.spec.ts)验证 JSON／SQLite 工作流完成后向新增 auditor 送达输入、暂停准入后显式依次恢复到两个未来 tick（终点为 `9007199254740993`）、最早事件先处理、精确消费各 receipt／decision／正文、任务／报告／资源效果不变，以及无模型推理的幂等输入重试。
