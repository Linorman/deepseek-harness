# Agent Note: 私有创作版本与独立接受的录用邀约

Status: implemented

[English](2026-10-17-world-author-revisions-and-offers.md) | 中文

## Problem

可移植定义不等于运行中的世界，本地编辑历史也无法安全裁决并发保存。同样，邀约送达或人物设定通过审核，并不能证明候选人接受了条款。将这些投影当作授权，会覆盖编辑或在缺少独立决定时录用人物。

## Decision

Product 所有者在独立版本日志中保留私有创作版本。保存记录原保存 ID、认证作者、父版本与完整定义。单一串行队列比较父版本，append 成功后才发布；冲突返回双方文档。精确重试恢复原保存。append 结果未知时关闭所有者准入直到重放；有界的不可变祖先不会被静默驱逐。缺失与其他主体文档 ID 返回相同读取结果。

图形与等价键盘控件使用封闭命令，并沿用源码导入的 v1 编译器。Host 检查引用、环、有限模板选择与容量后，编辑器才接纳候选定义。各视图共享完整定义，布局与视图选择不成为 Native 事实。Undo 仅修改本地草稿，已提交创建保持锁定。只读创作与预检不分配模型或运行身份。已有运行的编辑使用独立审核的原命令。

人物草稿、岗位需求、申请和邀约版本以已提交的 Native 领域结果作为持久所有者。有限人物版本保留来源、hash 与审核状态；编辑作废旧审核，已接受内容不可变。认证用户审核记录用户来源，不冒充 actor。候选人申请与回应要求真实 canonical Decision/Session、显式市场范围及相同条款 hash；仅送达不能提交接受。

每个岗位需求固定在报价或接受时预留原岗位与一次性费用；对应转换在同一次 Native append 中完成预留。已有录用执行必须消费该精确接受记录；竞争邀约、旧版本和不同条款不能替代它。身份准备结果未知时保留原身份与义务。取消和到期不释放已接受责任，也不重复收费。循环薪酬不受支持，不能从一次性金额推导。Product 投影分别验证 case 与 Persona 内容权限，完整私密详情受完整响应字节额度约束。

## Alternatives considered

Last-write-wins 会静默丢失并发定义。将私密正文存入浏览器存储会使其寿命超过凭证撤销；显式 Host 保存与内存编辑保留现有隐私边界。对运行使用任意 JSON patch 会绕过领域校验，且不能表达补偿。将邀约送达或 Host fixture 当候选人同意，会伪造独立 actor 决定。独立可变市场表会重复现有 Native 结果历史。

## Consequences

草稿历史有独立格式版本和保留额度；耗尽时需要显式所有者决定，而非隐藏删除。图形显示有界窗口，不将不完整窗口称为整个世界。浏览器刷新后可按 ID 重新打开已保存草稿。未知保存与日历提交保留原 payload 供精确重试。

[键盘控件决策](2026-10-15-world-authoring-keyboard-controls.zh.md) 继续负责焦点、引用建议和源码编辑行为，未被取代。较广的[视觉层提案](../../proposed/feature/2026-10-04-swarm-and-world-visual-layer.zh.md) 仍适用于其他可视模块。[有限日历与组合治理](2026-10-16-world-calendar-review-routes.zh.md) 负责日历、代理与 ReviewRoute 持久语义。

## Testing

[草稿存储测试](../../../../packages/simulation/simulation-product/tests/draft-store.spec.ts) 使用真实 JSON/SQLite 日志验证并发 CAS、冷恢复重试、未知 append 恢复、隐私和额度。[图命令测试](../../../../packages/simulation/simulation-scenario/tests/draft-commands.spec.ts) 使用共享编译器。[组件测试](../../../../packages/client/ui-simulation/tests/world-post-mvp-author.client.spec.tsx) 验证未知保存与显式冲突处理不丢本地编辑；[浏览器测试](../../../../apps/web/tests/world-post-mvp-author.snapshot.ts) 走真实 HTTP 与两个独立标签页。工作包命令与原始产物在[原有 checklist](../../../plans/2026-10-16-world-post-mvp/checklist.md) 登记。

F0 的[基线记录器](../../../../scripts/world-post-mvp-baseline.py) 在每批顺序 workload 前冻结输入，并同时保留失败进程和成功样本。[验收集合校验器](../../../../scripts/world-post-mvp-acceptance.py) 根据原始输出和当前输入 hash 验证公司、实验室、协会在 JSON/SQLite 上完整的 warm/cold 矩阵。不同批次保留各自 manifest；仅能通过明确的字节级反向还原，证明某项修改与另一个场景无关后复用其证据。轮次缺失、冷恢复失败或无法解释的源码漂移不能判为基线完成。复用已证明独立的样本可避免重复无关长期 workload，同时保留不同批次的真实来源。

创作日志版本 2 在每个原 CAS 保存中将展示坐标、惰性模板元数据与定义分开保留。布局不进入编译或 Native 事实。冲突比较最多展示 128 个变更路径，每值最多 160 字符，并报告省略数，保留双方完整文档。图窗口报告投影时点与省略关系。

`clocky.world-template/v1` 包保留完整定义、明确许可证/声明及署名、精确域实现 generation、运行配置/模板引用及策略版本。未知可执行字段和不完整依赖清单被拒绝。Product 在预检与创建时检查安装 pin。明确解除锁定会开始新模板，不改写原模板包。
