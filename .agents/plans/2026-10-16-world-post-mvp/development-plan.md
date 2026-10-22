# 世界模拟 MVP 之后的开发计划

日期：2026-10-16。本计划落实[Post-MVP 设计](design.md)，覆盖原 P1–P5，**不把 MVP 真实模型评测或剩余验收列为后续功能**。这些基线责任仍见[独立收尾计划](../2026-10-16-world-mvp-finalization/development-plan.md)。本计划中的“已具备”只指可复用契约，不宣称整个 MVP 已正式通过；设计与独立原型可提前，生产能力发布须建立在相关基线可靠的前提上。

## 1 交付顺序与依赖

推荐先做 F0、A1、B1、D1：固定后续边界，改善创作体验，取得长期运行数据，并让完整运行可迁移。A2/A3 增加领域深度；B2/B3 依据测量推进长期运行；C1–C3 提升认知与环境模型；D2 提供可比较实验。P5 的 E1/E2 独立决定是否启动。

| 包 | 阶段/用户结果 | 前置 | 相对规模 | 退出产物 |
|---|---|---|---|---|
| F0 | 横向契约与工作负载基线 | 现有公开服务和领域定义 | 中 | 版本/权限/来源/API 约束、固定基准、阶段验收样本 |
| A1 | P1 图形化场景创作 | F0 | 大 | 图/表单/源码同一草稿，CAS/对比，运行变更预览 |
| A2 | P1 Persona 审阅与 offer | F0；完整图形接线可后补 A1 | 大 | 草稿审核、候选人/offer 协商和真实接受、原身份录用 |
| A3 | P1 日历与治理深度 | F0；可与 A2 独立 | 大 | 例外/班次、组合委员会、制度影响审计 |
| B1 | P2 测量与可重建索引 | F0 | 中到大 | 增长曲线、稳定分页、索引重建/发布、成本观测 |
| B2 | P2 引用保护归档 | B1、D1 的完整引用/恢复证明 | 大 | pin/闭包、归档读回、故障可重试，无引用丢失 |
| B3 | P2 自动驻留与局部热变更 | B1 和现有生命周期故障基线 | 特大 | 有界自动策略、精确 footprint/gate、全 run 回退 |
| C1 | P3 输入受限生成助手 | F0；可接 A2 的审核 UI | 大 | 独立身份/scope、持久生成结果、预算与泄漏验证 |
| C2 | P3 多领域规划 | C1、B1 的测量和现有 registry | 大，按需要启动 | 并行计划、单提交者、冲突/公平/子预算 |
| C3 | P3 环境模型与人物演化 | F0；评估可复用 C1 | 大 | 一个可替换环境模型、状态演化、留出集比较 |
| D1 | P4 完整备份与离线迁移 | F0、既有 checkpoint 引用所有者 | 特大 | 新主机空存储恢复、缺版本拒绝、原包保留 |
| D2 | P4 分支、比较与因果检索 | D1、B1；可接 C3 质量指标 | 大 | 新可写命名空间、授权历史继承、有界对比/因果查询 |
| E1 | P5 真实外部适配器，可选 | 独立真实用户授权设计、明确业务需求 | 独立估算 | 一个有限动作的测试环境与恢复对账证明 |
| E2 | P5 联邦/分片，可选 | B1/B3 测得瓶颈、D1/D2 的引用/身份机制 | 独立估算 | 跨 run 消息、唯一所有权、因果与故障协议 |

共有 14 个工作包，其中 E1/E2 可不实施。相对规模反映跨 owner 与故障矩阵复杂性，不是工期承诺。F0 后根据实际目标规模、团队容量与第一条纵向链实测估算；不把 14 个包平均切成等长迭代。P4 备份可提前，不必等待所有 P2/P3 结束；归档必须等完整引用和恢复机制成立。

## 2 F0 可复用契约和基准

**责任：Simulation/产品/测试所有者。** 读取当前 domain registry、Native mutation、Team lifecycle、checkpoint、v1 compiler 和客户端原命令语义；固定这批输入版本。对每个新能力确认模型可见数据、授权来源、持久所有者、纯投影、跨 owner IO 和失败状态。

建立公司扩张、研究实验室与外部评审、协会排班三个非同构场景；分别产生岗位/offer、委员会/制度、日历/外部交互的长期历史。冻结 workload 规模和指标，用原始数据决定索引、休眠与热变更的优先级。将原设计 P1–P5 映射到 [checklist](checklist.md)，不更改 MVP 清单。

退出：每包有最小纵向用例和拒绝路径，初始基准可重复运行；已确认没有把图/备份/分支投影当业务真相。此包只固定真正需要的共享契约，不预先实现通用分布式框架。

## 3 P1 工作包

### A1 场景创作

落点：[WorldAuthorWorkbench](../../../packages/client/ui-simulation/src/client/WorldAuthorWorkbench.tsx)、[WorldOrganization](../../../packages/client/ui-simulation/src/client/WorldOrganization.tsx)、[scenario](../../../packages/simulation/simulation-scenario/README.md)、[产品](../../../packages/simulation/simulation-product/README.md)和 Client runtime。

实施顺序：草稿 revision/save/compare → typed draft commands → bounded graph query → 图形编辑与等价表格操作 → 运行 preview 原命令接线。先给单用户 CAS 和明确冲突视图，再考虑实时协同。键盘、列表替代、断网草稿、撤权和旧响应失效随功能实现。

退出：图/表单/JSON/YAML 往返无支持字段丢失；坏引用/环/容量错误在同一 compiler 拒绝；拖拽不直接改变运行；undo 不回滚已发生业务；大图只显示实际覆盖窗口。GUI 变更按项目规则录制真实流 GIF。

### A2 Persona 审阅和 offer

落点：`simulation` 严格 domain 定义、`simulation-local` 人员/资源 folds、`simulation-world` 组织模块、Product management 与 UI。先实现有限 PersonaDraft 与审核 revision，再实现 Vacancy/Application/Offer 状态机和条款 hash；最后把 accepted offer 接入已有 hire-existing/generate-and-hire。

为撤回/到期/接受竞赛、并行不兼容 offer、身份准备未知和费用预留编写两后端故障测试。候选人决定来自真实 Session，host fixture 不替它自动同意。循环薪酬先定义承诺和有限周期，再接日历；不将其藏在一次性费用里。

退出：同 offer 最多一次录用、金额和条款正确；准备中中断仍复用原 Persona/身份；审核变更作废旧批准；未知 IO 不按到期释放。P3 长文本生成不是这包前置。

### A3 日历、组合委员会和制度审计

落点：scenario compiler、Native calendar/governance/norm owners、WorldVotes/WorldGovernance/WorldTracks。分为 A3a 时间表达/例外/有限 recurrence，A3b ReviewRoute/代理规则，A3c 影响预览与因果审计。

冻结时区/歧义、occurrence key、改排班的未来边界；组合审批有明确顺序/AND/OR 和统一正文 hash。代理权限显式记录。制度冲突从已安装优先级或人工处理返回，不通过自由文本猜规则。

退出：重启不重复日历、历史任务不重定向、无效组合/循环/缺步骤拒绝；审计可追到真实票据和效果；已有承诺不被新制度静默重写。三个场景无需主 driver 分支。

## 4 P2 工作包

### B1 测量、成本与索引

落点：既有 benchmark scripts、Native inspection/query、Product 分页与 Client runtime。先补采样和原始样本，再实现确有测量价值的一到两类索引，不一开始换数据库。

建立 index manifest/prefix hash、增量更新、重建/校验/原子切换、读 revision 和授权 fence。失效回退有扫描预算。对照相同 workload 的查询/恢复/内存/维护比例，成本拆分 actor/director/生成/辅助调用；unknown 单独展示。

退出：索引删除后能从原记录重建，崩溃不发布半成品；分页无重复遗漏或越权存在性泄漏；性能目标达标且无代价隐藏。无改善证据就保留原执行路径。

### B2 引用保护归档

依赖 D1 先给出完整对象/附件/Session/Channel 引用清单和恢复证明。实现 RetentionPlan/pins → dry-run 影响预览 → 复制/校验 → 原子位置切换 → archive read/rebuild。物理清除另行受控，不作为首条路径默认动作。

退出：仍被 case/plan/checkpoint/context/cleanup/分支引用的记录永不缺失；复制中、切换前后、读回中故障可重试；坏 hash/丢分片明确失败；历史容量计数不偷偷归零。更新存储能力接口及 SDK/诊断，不能仅搬文件。

### B3 驻留、表示切换和局部 mutation

拆三条依赖递增子包：B3a 自动休眠/恢复策略，B3b 外部表示切换，B3c 有限类型的局部结构 mutation。B3a 先复用已有 canonical Session；B3b 显式 generation/义务/记忆映射；B3c 先做一个互不相交对象变更，证明 footprint 和跨 owner gate。

测量整个 run 暂停占比确实影响目标 workload 后才启动 B3c。保持单一 Native commit，稳定 gate 获取顺序，支持冲突/stale、取消/撤权、旧 writer、未知退休和热变更期间 checkpoint 的测试。不能确定范围时自动回退原维护路径并保留停止原因。

退出：无关角色在安全变更期间可继续，被影响角色不能越界；未知 writer 占用不提前释放；表示变化不改 cognition、不重复资产、不丢原 Session/引用。提升并发额度需另有证据，不只改配置上限。

## 5 P3 工作包

### C1 输入受限生成助手

定义 GenerationJob schema、来源/audience、实际输入/输出、状态和预算；通过现有 Team/Session/模型池准备独立助手。实现输出先持久化、再验证和 incorporate；将结果接回 A2 的审阅入口。

测试接受后崩溃不重新生成、取消/未知输出、同 scope 复用与跨 scope 拒绝、canary 输入和公开输出泄漏、辅助 token/费用计数。纯预检/读取不调用模型。

退出：助手无直接 world 写权；新 Persona/对白有来源和原生成结果；广权限 director 历史没有流入低权限生成上下文。全 scope 污染不可由“提示词约束”宣称修复。

### C2 多规划者

建立 PlannerAssignment、领域/scope/effect allowlist、期限/总预算与有限委派深度，复用 domain registry。先两个独立领域规划者，仍一个最终提交队列；验证无冲突和冲突两种 workload，再决定是否扩大数量。

退出：冲突只产生保留原件的 stale/后继计划，没有多写者；子任务不绕过总预算；慢规划者不会被无限饥饿；unload/cancel/recovery 保留所有已接受责任。没有测到吞吐或隔离收益时不默认每个角色都配一个助手。

### C3 环境与人物演化及长期评估

先选供需或交付时延中的一个环境模型，定义可检验状态、资源约束和实际抽样记录；再加受经历驱动的技能/关系版本事件。保持不可变 Persona 与岗位授权分离。实现模型替换只能显式新实验或可证明迁移。

建立固定与留出场景、对照策略、人工 rubric、隐私和事实一致性探针。报告成本、失败和停止原因，并把模型 judge 和人工判断分开。此包不是重新运行 MVP 的最小样本，而是用于持续比较这些新增机制。

退出：重放不重抽样，状态更新不能越权/改历史；至少一个替换环境模型无需改 driver；留出场景的改善有可审阅证据，不能只用单次“更像真人”的故事判定成功。

## 6 P4 工作包

### D1 完整备份与迁移

落点：Native checkpoint、Team checkpoint/restore、Storage/Session/Channel owner、Product 长操作和 SDK。先定义跨 owner cut/引用闭包与 bundle manifest；实现一致导出、hash 验证、隔离 staging 导入、新主机路径映射和 paused 登记，再加入明确支持的离线版本转换。

必须在空存储/不同目录的目标环境恢复，不依赖原机可访问文件。覆盖 Session 未物化、坏附件、丢通道、缺 reducer/provider、名称冲突、导出中断、导入登记前后退出；任何未知原现实效果不重发。

退出：完整备份保持业务/认知引用与原结果，credentials 不随包迁移，纯验证零模型；迁移不改原包、不能伪造证据；脱敏数据集清楚标注不能保证可写恢复。D1 通过后才给 B2 提供“可保护并读回历史”的前置证明。

### D2 分支、对比和因果检索

实现 quiescent cut → 原历史 provenance → 显式分支初始化 → 新可写身份/授权记忆 → paused 分支。先只支持模拟分支，未结真实效果拒绝或只读。新 run/Team/Participant/Session/Channel/op namespace 全部校验。

比较以 lineageKey、起点和变量差异对齐；因果查询使用真实事件引用并限深度/条数/字节和读者权限。集成 B1 索引及 C3 的适用指标；不复制一套独立统计真相。

退出：原运行与分支无法写入彼此的身份或通道，已记录历史不可改签名补 ID；继承记忆由新 Session 实际记录；对照明确非确定性和停止差异；未知因果边不被模型填造。自动 branch merge 暂不交付。

## 7 P5 可选立项

### E1 真实外部适配器

只有具体真实业务需求和真实用户授权责任明确后开始。第一份变更限一个可限制/幂等/查询的适配器和测试环境。定义真实 Grant、effect intent、幂等键、receipt、unknown、撤权、费用与补偿；先 mock/fault，再 provider 测试环境，再单独允许正式环境。

退出：模型或模拟委员会无法授真实权限；超时不盲目重发；replay/branch/import 默认禁用真实 effects；凭证留在 Host；无幂等/查询能力的未知结果必须人工处理。后续邮件/付款分别评审，不自动扩展 allowlist。

### E2 跨 run 联邦与分片

B1/B3 证明需要跨主机容量或独立隔离后，先用两个 run 做 durable 消息桥，固定 ownership generation、因果前置、原消息/receipt 和预算。之后才做一类跨区资源责任，再讨论对象迁移与分布式 checkpoint。

测试重复/乱序/丢包、网络分区、旧 owner 恢复、时钟阻塞、目标提交后回执丢失和协调者退出。保守时间推进优先；缺依赖显示阻塞，不擅自补事件。需要全局原子性时另选协议，不能称 saga 自动具备跨区事务。

退出：每个对象唯一有效 writer，无双花、未知状态不释放双方资源；checkpoint 包含在途消息；恢复不跨版本猜语义。没有实际需求时 E2 保持未启动，不因此认为本地产品不完整。

## 8 验证、发布与阶段完成

每包至少交付一条真实产品/Agent 或确定性领域纵向链、严格 parser/拒绝路径、原子/竞赛/进程恢复证据、公共 DTO/两 SDK、当前 README/子系统/Agent Note 与适用 runnable snapshot。UI 包同时交付真实浏览器、键盘/焦点/主题/窄屏和 GIF；持久格式变化同步各读取者和明确拒旧，不能只修一端。

按[项目验证选择规则](../../skills/dsh-pre-push-checks/SKILL.md)执行 owning tests、keyless、build/分发/SDK、typecheck/lint/doc-sync 和 diff 检查；未变化的证据核对输入后可复用。真实 provider、真实适配器、压力成本需独立冻结执行配置及预算，本次文档不触发任何调用。

| 阶段完成标志 | 可演示且可恢复的结果 |
|---|---|
| P1 | 非公司复杂组织从图形/表单创作，人物审阅和 offer 接受，排班和组合审批无 driver 分支 |
| P2 | 在声明目标 workload 下长期运行，查询/恢复有界、归档引用完整、局部变更有证明或清楚回退 |
| P3 | 生成/规划/环境/演化可替换且可评价，预算/隐私/事实不变量仍成立 |
| P4 | 完整运行能在新主机验证并暂停恢复，实验分支隔离、比较和因果引用可审阅 |
| P5 | 每条独立立项都满足真实授权或分区一致性证据；未立项不影响 P1–P4 完成 |

第一份建议实现变更为 F0 + A1 的单条“草稿 revision → 组织关系编辑 → 编译诊断 → 保存/冲突”路径，附等价表格操作；同时启动 B1 的基准记录。D1 先做完整引用清单与空存储恢复探针。不要用一个大 PR 同时修改图编辑、归档、模型规划和分布式协议。

## 9 本次文档交付

初始文档交付只新增 Post-MVP 设计、计划与 checklist，并在已有提案增加独立入口；原 MVP 设计、112 项清单和收尾计划保持独立。来源和静态核对 hash 见 [baseline](evidence/baseline.json)，初始文档检查结果见 [validation](evidence/validation.md)。F0 与 A1–A3 的后续实现、逐项勾选和验证见 [checklist](checklist.md) 及[最终验收](evidence/implementation/final-validation.md)。B01–B19、C01–C14 的实现与适用范围见 [B/C 集成证据](evidence/implementation/bc-integration.json)；C15/C16 的自动评估和人工评分缺口见 [C3 证据](evidence/implementation/c3.md)。2026-10-20 用户确认继续暂缓人工评分，两项保持未勾选。本次 D1/D2 实现与联合验证登记在原 checklist；用户确认 E1/E2 先完成本地测试实现，真实业务授权、provider 测试环境、部署需求及正式独立审查仍由 E01/E07/E08/E15 保留，不将本地故障验证宣称为生产交付。

2026-10-20 最终横向验收：H01–H07 完成，原清单 92/98 项勾选，条目文字、顺序和分母保持；[最终报告](evidence/final-acceptance/report.md)与[机器登记](evidence/final-acceptance/validation.json)区分本轮实测和输入匹配后复用的证据。用户在本次再次确认继续暂缓 C15/C16 人工评分；E01/E07/E08/E15 的可选生产资格仍缺证。P1/P2/P4 按既有支持范围验收，P3 机制交付不等于质量阶段全部通过，P5 仅本地协议交付；未将这些缺口标成完成。
