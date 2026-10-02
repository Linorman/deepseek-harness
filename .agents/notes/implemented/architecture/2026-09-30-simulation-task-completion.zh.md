# Agent Note: 基于证据的 Simulation 任务结算

Status: implemented

[English](2026-09-30-simulation-task-completion.md) | 中文

## Problem

任务模型提交只保留拟执行的世界操作。此时完成 Team attempt，可能在库存变化或接收者持久化前报告成功；响应丢失也可能重复推理或选择不同结果。

## Decision

由 effect 注册的版本化场景策略同步评估冻结且脱离原对象的世界及原尝试视图，不进行 IO。[完成 producer](../../../../packages/simulation/simulation-team/src/task-completion.ts) 固定策略版本并等待 actor 空闲。Native 在 Team 结算前记录不可变结果意图；普通结果的证据须来自当前 attempt 已记录输入及 epoch 对应的已受理决策，且操作已应用；通信还须接收者持久化证据。completed 结果必须含非空证据。策略终态不包括调度器释放及 lease 过期。Native journal format 46 拒绝早期格式。

runtime-only 结算 proof 绑定已受理结果、原创建来源、精确 attempt 与 live writer epoch。Hub 在 policy IO 前后重查 proof，保留普通审核、结果、预算及取消语义。目标回执独立于 Native 结果意图。策略移除或响应丢失后，精确重试复用已受理意图，不重复计算、推理或世界效果。原 attempt 的冲突终态保留为中断；连接退休不能将意图变为 completed 回执。

[有界任务 executor](../../../../packages/simulation/simulation-product/src/task-executor.ts) 按受信任来源实体及可选精确操作路由选择已受理创建回执。它拥有一个合并的串行批次，经过规范读取、驻留、稳定 attempt reservation、已记录输入、scoped 认知、到期效果及完成。重试须核对路由、认知和完成策略版本。已解析 `retry` 策略默认拒绝自动替换，也可在物理退休后允许效果前替换，或以已对账冻结事实调用安装的纯场景恢复函数。取消及剩余尝试次数仍是权威。

对于已兑现转移，Native 仅在全部承诺证据来自同一任务、assignee 和规范 Session 的已物理退休旧 attempt 时允许 `continuation`。新输入及无提案确认使用新 epoch，新的世界提案被拒绝。完成在独立核对确认后保留原操作证据；已关闭交互／承诺及旧失败 attempt 不变。这样既避免未知结果导致再次转移库存，也允许原任务完成。[公司 driver](../../../../packages/simulation/simulation-product/src/company-driver.ts)提供有限场景策略、已配置产品 timer 和未来效果推进。

[认知决策](2026-09-30-simulation-task-cognition.zh.md) 仍负责任务输入与启动。[产品提案](../../proposed/architecture/2026-09-28-web-team-simulation-product-integration.zh.md) 仍负责完整产品验收矩阵及新增任务场景。两者均为局部扩展，没有被完整取代。

已送达报告的 `reportContinuation` 选择原退休 attempt、创建操作与 prepared context 指纹。Native 验证同一运行、任务、执行者、participant 与 Session、较旧 epoch、最新退休前序、已受理报告决策及精确持久接收回执。中断的确认可继续指向同一原报告；新的返工 attempt 不能借用历史完成。selector 通过现有 context／Session 事件记录于 required task input。新受理的无提案确认将原报告作为完成证据，不重新发布。Session format 保持 `0`；native journal format `46` 记录这些任务关系并拒绝旧存储格式。

任务认知在执行前打开精确单 slot 有序窗口。暂停保留已提交提案；冷恢复只在 writer 已物理退休后取消它们。取消先持久化规范意图及原生任务 fence，再停止 actor 或等待已受理工作。fence 后拒绝输入、新模型 token 准入、未受理窗口提案及新的完成。已受理效果保留原身份并仍可对账；取消不回滚发布或资源转移。检查点采集排空取消及报告交付后，才发布包含全部 actor／频道责任的记录。

## Alternatives considered

**提交或发布时完成。** 两者均不证明世界效果已应用或接收者 Session 已持久化。

**结算响应丢失后重新评估策略。** 替换策略或后来的世界状态可能改变原终态意图。

**将结果意图当作履约。** 审核与交互策略分别负责证据；任务完成本身不能兑现 transfer-policy 承诺。

## Consequences

场景策略选择完成证据，Native 验证其来源。行政结果受理不请求模型或改变上下文。已受理意图可在目标中断后保留，不声称执行成功。[交互关联决策](2026-09-30-simulation-task-interaction-link.zh.md)负责显式关联及条件履约对账。已支持转移及已送达报告恢复；其他效果形式需要各自基于来源证据的 continuation 规则。

提示词或完成策略本身不能授权报告恢复：替代模型可能重复发布，过期策略也可能选取无关历史证据。因此 Native 准入及结果 fold 独立验证已记录 selector。不支持或不匹配的报告明确停止，不选择新效果。

## Verification

真实源码及 built-lib 的 JSON／SQLite Loader 场景通过实际受限模型工具提交库存转移，应用前等待，应用后结算原 attempt，并在策略移除后对账丢失的响应。自动 executor 场景通过生产方法选择并完成任务，覆盖模型／确定性认知和结算响应丢失。Native 测试拒绝未发布、未应用、无关及接收者未确认的证据，冷重放保留结果意图。生命周期测试覆盖忙碌 actor、固定策略版本、并发合并、冲突终态与关闭退休。真实产品任务组合在 JSON／SQLite 上验证模型／确定性认知、后台调度、完整检查点及九个跨所有者进程退出点。直接生产路径测试拒绝 continuation 重复提案及替换结果证据。这些检查不代表全部新增场景或浏览器失败／恢复矩阵已完成。

[三 actor 进程矩阵](../../../../examples/simulation-company/tests/task-workflow-fault.snapshot.ts) 在 JSON／SQLite 上 record 并 replay 22 项真实 Loader／scheduler／executor 用例，包括已提交窗口、已送达报告、结果受理及对账。[报告恢复](../../../../packages/simulation/simulation-product/tests/report-continuation.spec.ts)、[取消](../../../../packages/simulation/simulation-product/tests/task-cancellation.spec.ts)、[并发采集](../../../../packages/simulation/simulation-product/tests/execution-checkpoint-concurrency.spec.ts)及[返工 fencing](../../../../packages/simulation/simulation-product/tests/report-rework-fencing.spec.ts)覆盖精确来源拒绝、物理退休及旧结果不可变。TS 与 Python SDK 组合跨实际 Server 重启检查已记录恢复输入；独立 explicit／transfer／task-completed 组合验证履约权威。[执行验收记录](../../../../design/webui-team-simulation-2026-09-28/acceptance-simulation-execution.md)保留当前浏览器验证及剩余范围。
