# 世界模拟 MVP 之后的产品与架构设计

日期：2026-10-16。**本设计讨论 MVP 以外的能力，不讨论 MVP 剩余验收。** 范围取自[原设计第 18.2 节 P1–P5](../2026-10-11-world-simulation-completion/evidence/source-design.html#s18)：作者体验与领域深度、长期运行、认知与模拟质量、实验与可移植性，以及可选的真实外部接入和分布式。当前 MVP 的真实模型评测等收尾仍由[独立计划](../2026-10-16-world-mvp-finalization/design.md)负责，不加入本文的工作量与 checklist。

本文件定义后续目标、数据和执行契约；[开发计划](development-plan.md)定义工作包及依赖；[详细 checklist](checklist.md)定义可验收结果。所有新增对象/API 名称均是拟议契约，不表示当前已导出。P1–P4 构成本地模拟产品的扩展路线；P5 两条分支分别立项，不是完成 P1–P4 的前提。

## 1 从现有基础增加什么

| 已有基础 | 本次扩展差额 | 不能混淆 |
|---|---|---|
| v1 JSON/YAML、结构化表单、基础组织/制度/外部检查器 | 图形化创作、变更对比、可审阅 Persona 草稿、配置复用 | 有基础表单不等于图形创作完成；也不重新开发已有导入入口 |
| 模板生成/录用、调岗离职、固定委员会治理、有限日历 | 候选人/offer、协商接受、复杂日历、委员会组合与制度影响审计 | 不重复 MVP 的 hire-existing 或基础投票 |
| 维护暂停、驻留/休眠、稳定外部代表 | 有测量依据的局部结构变更、自动驻留策略、表示方式演进 | 现有休眠不代表可安全改变表示或抹去历史身份 |
| 完整日志、同机 checkpoint、已知引用校验 | 可重建索引、引用保护归档、独立主机备份/恢复 | 场景导出和同机 checkpoint 都不是便携完整备份 |
| 单 director、有限 Persona、simulated rule/actor/mediated | 受限生成助手、多规划者、可替换环境模型、状态演化与质量实验 | 多模型规划仍不等于多个最终提交者 |
| 单 run/canonical Team、simulated-only | 经真实用户授权的适配器、跨 run 协调与可选分片 | 模拟批准不提供现实凭证或跨 run 写权 |

基础契约分别见 [scenario](../../../packages/simulation/simulation-scenario/README.md)、[world](../../../packages/simulation/simulation-world/README.md)、[Team/checkpoint](../../../packages/simulation/simulation-team/README.md)、[产品](../../../packages/simulation/simulation-product/README.md)。这些是可复用的所有者，后续设计不建立第二份世界真相。

## 2 跨阶段架构决定

1. 世界事实、业务结果和派生调度仍由 Native 顺序提交；多个认知规划者只提交候选计划。只有 P5 分片真正立项时才讨论多个分区的提交顺序。
2. 模型可见输入必须能从 Session 日志重建；新生成器、环境模型和规划助手都保留实际输入、实际输出、版本和预算归属。
3. 人物、任职、认知 Session、驻留和外部表示是不同生命周期。离职、休眠或归档不能自动改变 cognition、擦除记忆或释放未知 writer。
4. 图形、搜索索引、比较报告、缓存和摘要是投影。拖拽、迁移、归档和分支均不能直接覆盖业务状态。
5. 新能力按 domain schema/implementation version 安装并冻结；缺失实现拒绝可写恢复。新配置默认值通过 owner 的 resolve 显式固定。
6. 增量采用现有 capability 服务定义/提供者/消费者结构，先在原包内形成清晰模块；职责独立演化、有第二消费者或独立部署需求时再拆包。

## 3 P1 作者体验与领域深度

### 3.1 场景创作与组织图

新增 ScenarioDraftRevision，记录草稿身份、父 revision、标准化定义、修改者和保存版本。草稿属于产品创作状态，不是运行事实。图、表单、JSON/YAML 是同一草稿的视图；格式切换保留所有受支持字段，未知扩展显式只读或拒绝，不能悄悄删除。

组织画布支持创建单位/岗位、关联成员、移动层级、调整容量和关系。每个动作先转换为类型化 draft command，经同一 compiler 验证身份、引用、环、容量和授权。拖拽的线只是预览；提交成功后显示新的 revision。undo/redo 只影响未提交的草稿，运行中已提交命令的“撤销”必须是独立补偿命令。

编辑模式清楚区分“创建新实验的模板”和“修改当前运行”。后者继续 preview → 固定原 command → submit/query，展示受影响任职、资源和义务；没有合法运行命令的编辑只能另存新场景，不生成任意 JSON patch。

有界图查询返回 revision、模拟时点、已覆盖节点/边、遗漏计数或继续 cursor；搜索与逐层展开不会宣称整张图已加载。布局状态与业务定义分开保存；列表/表格提供与画布等价的键盘操作。沿用[现有视觉层提案](../../notes/proposed/feature/2026-10-04-swarm-and-world-visual-layer.md)，实施时核对项目 DESIGN/UX 规范，不新增另一套视觉语言。

共享编辑第一版采用 revision CAS：保存 stale 时展示冲突字段和两侧来源，不静默 last-write-wins；实时多人 CRDT 不作为首个交付依赖。模板包固定领域/模板/策略依赖和许可元数据，导入只安装允许的数据定义，不执行附带代码。

### 3.2 可审阅 Persona 草稿

PersonaDraft 保留模板版本、有限字段选择、获准来源、目标岗位、生成者/模型/策略版本、正文 hash 和状态。阶段为 draft → reviewed → accepted 或 rejected/expired；修改字段创建新 revision，使旧审核失效。accepted 的出生内容随 plan 固定，后续技能变化通过演化事件表达，不改写原始 Persona。

P1 先复用已有有限模板生成，加入人工审阅、对比和退回原因；P3 再接开放式受限生成助手。预检和查看草稿不推理；重新生成是独立明确的有预算操作。审核者能看到自己有权读取的依据，不能因审核获得所有角色的私有 Session。

### 3.3 候选人市场与 offer

新增 Vacancy、CandidateApplication、OfferRevision 和 Acceptance。岗位需求定义能力、人数、有效期与资源约束；申请人与 HR 都用真实 actor 决策参与。offer 冻结候选人、岗位、金额/单位、条款、批准引用、有效时间和 revision。有限状态为 proposed → delivered → accepted/declined/withdrawn/expired；counteroffer 创建后继 revision，不覆盖旧条款。

录用需要候选人对同一条款 hash 的明确接受和雇主当前授权；通信 delivered 不等于接受。旧 revision、冒名、过期接受拒绝；撤回、接受和截止在同一 Native 顺序中决定先后，业务提交最多一次。一个人不能通过同时接受两个不兼容的 offer 绕过任职约束。

岗位和一次性费用预留分“发 offer 时是否占用”与“接受后 commit”两级策略，创建 vacancy 时冻结。未清理的身份/IO 或已接受义务仍保留占用，不能按 offer 到期盲目释放。长期薪酬独立表达为有期间和资金来源的履约承诺/日历结算，不把一次录用金额视为无限未来工资。此阶段默认模拟市场，不投递真实招聘信息。

### 3.4 丰富日历和工作安排

CalendarRule 扩为工作日/班次、例外日、有限 recurrence、事件优先级和岗位/人物接收者。所有可执行 occurrence 先编译成规范模拟时间；使用现实日期表达时固定 timezone 数据版本与歧义选择，不依赖宿主当前时区。无界 recurrence 由 horizon 与最大 occurrence 数截断，每次仅生成有限后继。

ruleRevision + occurrenceKey 保证去重。改排班只改变未接受的未来 occurrence，历史、已消费 wake 和已接受任务保持原引用；补发/跳过采用新事件。岗位收件人在触发时冻结；调岗不能重定向已经发出的消息。时间、房间、设备等稀缺资源由专用 owner 定义单位/排他规则，不仅添加一个任意 resource kind。

### 3.5 多委员会与制度审计

基础委员会及投票已属于 MVP。后续新增 ReviewRoute：按固定顺序或 AND/OR 组合引用多个委员会的明确 Resolution；每步固定 electorate、门槛、正文 hash 和期限，流程也有版本/hash。重复 approver、缺失步骤、循环依赖、把旧正文批准拼到新制度等全部拒绝。

委托/代理投票若安装则显式保存原委托人、受托人、范围、有效期和可撤销条件；默认不从身份或关系名推断代理权。委员会变动采用提案创建时确定的失效/冻结策略，不能事后为通过而更换规则。

制度影响预览列出受影响的新操作、未来日历和已有义务；既有承诺默认不追溯修改。制度间冲突必须由已安装优先级/适用范围规则解决，或返回 unresolved-policy-conflict 交给人处理。审计提供 Norm→Resolution→Vote→Decision→生效/通知的因果链以及未完成步骤，不把会议纪要当授权。

## 4 P2 长期运行与效率

### 4.1 先定义目标工作负载

基准至少覆盖人员 churn、治理版本增长、稳定供应商重复交互、普通消息与结构变更混合、冷恢复和查询分页。固定 actor/历史/消息规模、运行长度、并发、模型策略、硬件、source/lib 与存储后端；分别报告活跃人数、resident、未释放 writer、历史身份/日志量、p50/p95/p99、峰值内存、维护暂停占比和 token/cost。

支持规模和改善目标必须在优化前登记，保留原始样本；没有测量不得宣布全量 snapshot/Object.values 一定是瓶颈。长期历史上限和当前驻留上限分开，不通过删除历史或提高默认额度制造吞吐提升。

### 4.2 可重建索引与有界读取

新增按 run/object/revision/time、case 状态、资源/任务义务和因果引用的索引。IndexManifest 保存 schema/version、源日志前缀 hash/cursor 和 build 状态；先在临时位置构建，校验后原子发布。崩溃时旧索引保持可读，新索引可丢弃重建，权威日志不受影响。

查询绑定同一 revision/reader generation，跨页不能混入不同快照。索引缺失/落后时只允许受预算的回退扫描或显式 index-building，不能无限扫描阻塞整个 run。涉及授权的索引仅存必要引用或受保护分区；搜索建议和计数也不能泄漏不可读对象的存在。

### 4.3 引用保护归档

新增 RetentionPlan 与显式 pins，覆盖 checkpoint、未完成 case/plan、审批依据、Session context、outbox/cleanup、实验/分支和备份。跨 Native/Team/Channel/Session 计算引用闭包；仍被需要的记录不得删除。归档状态为 planned → copying → verified → switched；物理删除是独立受控阶段，不与首次归档绑定。

归档保留原身份、内容 hash、位置映射和可读取证明。恢复或检查历史引用时可以从 archive owner 读回；缺片段/坏 hash 明确失败，不能返回空历史。索引重建和归档转换可重试，重启不会重复删除或丢失 pins。归档不代表修改原历史计数或突破 Team 历史容量；若需释放历史额度，要单独定义新的准入语义与版本，不能隐藏重置。

### 4.4 自动驻留与外部表示演进

已有休眠/稳定代表复用可以继续使用；新增策略决定何时激活、休眠、再利用及升级表示，依据闲置模拟时间、任务/通道责任、预期交互和预算。状态和策略选择可审计，未知 writer 退休仍 charged，不因 UI 隐藏或 idle timer 直接释放。

单纯休眠保留 Person/Session、外部身份和表示 generation。表示升级/降级则是独立 mutation：先 fencing 旧表示的新工作，清点义务，保存必要事实/记忆映射，准备新表示，再原子切换 generation。旧结果保留其来源；不修改 Entity.cognition 或重铸库存。无法证明摘要覆盖后续认知需要时，只允许保留原 Session 的休眠，不降级为无记忆规则。

### 4.5 局部结构变更

从全 run 维护逐步开放有限 mutation 类型，不直接删除 paused 检查。MutationFootprint 显式包含实体/任职/资源/通道/权限的读写集合与相关 epoch；先只允许影响互不重叠且所有 owner 可 fencing 的变更。Native 保持最终顺序提交，模型规划可并行。

局部 gate 关闭被影响对象的新准入并等待其既有写者/任务完成，允许无关角色继续；需要多个 owner gate 时按稳定顺序获取，失败释放未提交占用，不能互相等待死锁。提交时重验 read-set、authority generation、依赖和预算。全局制度变更、未知 footprint 或 provider 不支持局部停用时回退全 run 维护，并显示原因。并发率只在 fault/竞赛测试后提升，现有 maxPendingMutations=1 不无证放宽。

## 5 P3 认知与模拟质量

### 5.1 输入受限的生成助手

GenerationJob 固定目的、获准输入引用与实际字节、输出 schema、目标 audience、预算、模型/提示/策略版本和原 job ID。助手有独立 Entity/Participant/Session；任何可重用 Session 只能在相同获准可见范围内使用，不把“换 system prompt”当隐私清空。

流程为 accepted → generating → output-retained → validated → incorporated，或 rejected/cancelled/unknown。实际输出先持久化，再由原 requester/director 根据硬规则接受；assistant 没有 world 写权。对低权限输出的自由文本只能由从未见过高权限数据的执行上下文生成，并经过 schema/来源检查；失败输出保留供审计，不能无预算无限重生成。

P1 Persona 审核可接收该输出，但审核不能扩大助手的读取范围。新模型输入通过 Session 事件记录，所有调用进入统一模型池和费用/token 预算。角色摘要、外部对白与解释分别有独立 purpose，不能一份全知摘要到处发布。

### 5.2 领域规划者与最终提交

PlannerAssignment 绑定 domain、scope、可提议 effects、输入披露、期限、最大尝试和预算。治理、市场、人口等助手可以并行读各自快照并产出不可变 plan；一个 Native 提交者按明确队列次序 revalidate/commit。相互冲突计划标 stale 或等待，保留 supersedes 与公平服务信息，不允许 last-write-wins。

委派链有最大深度、子 job 数和总预算；所有子任务费用计入父实验/run，取消父任务关闭后续子准入但保留已接受责任。没有待办的规划者休眠；新增“调控者”不能创建无事件的无限自对话。主 director 对任务分派的选择和收到的结果都记录，供因果重建。

### 5.3 可替换环境模型

EnvironmentModel 定义版本、支持的事件/effect schema、状态、输入来源、模拟步长、随机抽样及资源 source/sink 上界。首批选一个可验证的供需/交付时延模型，先以确定性实现建立基准，再比较随机或模型裁决，不一次实现全部经济学。

每次采样保存实际结果及参数/种子/实现版本；重放用原结果，不重新抽样。切换实现需显式新 generation 和状态映射，已有报价、合同、库存与承诺不能被新模型覆盖。没有可证明状态迁移时从新实验开始，而非运行中热替换。未知现实信息仍标 unknown/simulated，不冒充真实测量。

### 5.4 人物技能与关系演化

PersonStateVersion 记录技能/倾向/关系变化、原值/新值、触发的经历、有效时刻与来源。不可变出生 Persona 保留；当前职责/权限继续由任职和 policy 决定，不因“技能提升”自动授予工具或宿主权限。

变化采用安装规则或受限提案，字段范围、单周期上限、证据和 audience 均可验证。谣言、角色信念、关系感受与世界事实分开；一个角色的印象不自动成为对方的事实。已固定 context 不回填新人物状态。

### 5.5 长期质量评价

这部分是对认知机制的持续比较，不重复 MVP 的最低真实模型验收。EvaluationSuite 固定场景、允许干预、指标与评分版本，对比单 director/多规划者、环境规则、生成策略和模型配置。评估事实一致性、隐私、约束违例、目标达成、因果合理性、角色差异、人工可信度及成本。

训练/调参场景与留出集分离；报告所有失败、预算停止和分布差异，不能只选好看的故事。自动 judge 只能辅助，保留人类可复核证据与 judge 本身版本/偏差。新模型更换不承诺相同 seed 重现相同输出；已记录轨迹重放与重新实验分开。

## 6 P4 实验与可移植性

### 6.1 一致且可移植的备份

BackupManifest 记录 bundle/version、Native/Team/Channel/Session 的一致 cut、所需领域实现/模型模板元数据、内容 hash、跨日志引用和附件清单。先暂停新准入并对账在途责任，再使用各 owner 的保护读视图复制；单纯复制 live SQLite 文件或打包 YAML 不构成备份。

导出阶段为 preparing → copying → verifying → completed/failed，临时包校验后才发布。明确区分无损私密备份与脱敏数据集：脱敏可能删除恢复所需证据，不标成可写恢复包。凭证、主机路径、认证 token 不进入可移植定义；原 Session 正文可能含秘密，完整备份需相应权限与加密/存储策略，密钥不随包导出。

导入先在隔离 staging 校验版本、全部 hash、引用闭包、实现依赖、名称冲突和容量，再原子登记为 paused。目标主机通过受控路由映射重新提供已允许 provider；缺实现或凭证时允许检查但拒绝可写运行。只读校验和导入不调用模型、不重新执行已发生外部效果。

### 6.2 显式离线迁移

MigrationPlan 固定 source/target 格式、转换器版本、输入 hash、可证明映射、丢失项和输出预览。转换发生在新副本，原 bundle 保留；验证语义与引用后才发布新包。需要但无法从原记录恢复的批准、Persona、sender 或收件证据必须拒绝，不能补默认成功值。

每种支持的版本对有正例和拒绝例，不承诺任意历史自动升级。未知必需事件继续失败；允许只读原始查看时明确不完整。迁移完成不自动 start，且不得跨越 adapter authority 改写现实权限。

### 6.3 分支实验与身份隔离

ExperimentBranch 绑定父 run、不可变 cut、差异参数、初始上下文策略、模型/领域版本和预算。分支必须分配新 run、Team、Participant、Session、Channel、writer epoch 及所有可写 operation namespace；稳定世界对象可保留单独的 lineageKey 供比较，绝不复用原可写身份。

不能直接修改历史日志中的 ID 后继续相信原签名/proof。父历史以不可变 provenance 导入或只读引用；新分支由明确的 branch-init 事件建立事实种子与授权记忆，新 Session 记录实际继承内容和来源。选择“完整继承可授权记忆”“只继承公开事实”等策略时明确语义差异；缺少必要私密数据的脱敏分支不能称为原世界等价恢复。

分支只支持从可验证的 quiescent cut 开始，未决真实外部责任需要先结清或将分支设为 simulated/read-only。默认关闭真实适配器。自动合并两条演化历史不在 P4 首版；需要合并时逐对象业务命令审核，不把两个日志直接拼接。

### 6.4 比较和因果检索

比较以同一初始定义/cut、显式差异和 lineageKey 对齐，区分事实/资源/人员/制度、行为质量、费用及时间。不同模型导致的非确定性和不同终止条件单独说明；没有对照设计不能把相关性写成因果结论。

CausalIndex 保存事件→决策→计划→效果→通知→后续观察的真实引用，来源缺失则显示 unknown，不由聊天摘要推造边。查询按权限和有界深度展开；可导出可审阅的证据包。索引仍可重建，可与 P2 共用查询底座，不能引入另一套可独立修改的事实。

## 7 P5 可选能力

### 7.1 真实外部适配器

独立于模拟领域安装 ExternalAdapterDefinition，声明可执行动作、目标 allowlist、schema/version、幂等/查询/撤销能力、费用上限和凭证 owner。AdapterGrant 由真实用户对明确动作、目标、额度、有效期和环境授予；模拟 CEO、委员会或 director 的批准不能创建 Grant。

RealEffect 状态为 proposed → user-authorized → reserved → dispatched → confirmed 或 outcome-unknown/failed；可取消仅在适配器真实支持的阶段。intent、幂等键与授权快照在 IO 前保存，回执核对实际目标和结果。网络超时不等于未执行；无幂等/查询能力时禁止自动重发，进入人工对账。补偿是另一项明确外部动作，不宣称任意现实效果可回滚。

首个适配器选可限制、可查询、具幂等语义的动作，在测试环境证明权限撤销、回执丢失、限额和恢复后再开启正式环境；邮件、付款等更强后果各自立项。凭证仅由 Host 持有，不进入模型/场景导出。分支、replay 和检查默认不能执行真实 effects。P5 的设计文档不授权任何真实发送或调用。

### 7.2 跨 run 联邦与分片

启动条件是 P2 已测得单机容量、隔离或独立部署需求确有必要。第一阶段只做明确拥有者的跨 run 消息协议，不先迁移全部对象。每个对象有唯一可写 home partition 和 ownership generation；消息有全局业务 ID、源/目标范围、源序号、因果前置、版本和 receipt。

接收使用 durable inbox/outbox、幂等去重和来源授权，保留未知投递，不以重试次数推断成功。跨区资源转移用源端持久预留、目标确认和明确 settlement/补偿，不能声称普通两个 append 是原子事务；不允许未知状态下双边都自由花费。若确需全局原子性，需另行选择并证明支持分区故障的协议。

模拟时间先采用保守同步/明确边界事件：缺因果前置或依赖分区落后时阻塞，而不是猜测未来；分区故障、晚到消息和永久不可达有显式停止状态。ownership 迁移需要旧 owner fencing、状态 cut 和新 generation；网络分区不能产生两个有效 writer。

分布式 checkpoint 必须包含各区 cut 与在途消息责任；仅收集每区最新 snapshot 不构成一致备份。跨区权限/审计/预算和引用检查独立测试。时钟、去重、恢复与业务所有权证明完成前，不把增加多个 Team 或进程标成“分布式完成”。

## 8 产品 API 与横向契约

| 能力面 | 拟议接口责任 | 准入和语义 |
|---|---|---|
| 草稿与画布 | drafts.read/save/compare、graph.query、commands.preview | revision CAS；只读/预览不运行模型，运行变更仍用原命令 |
| 人事与制度 | offers.propose/respond、review-routes.inspect、norms.impact | 真实 actor/用户来源分开，严格条款 hash 和原批准 |
| 长期运行 | retention.preview/execute、residency.policy、maintenance.status | 归档不是删除；策略不能绕过旧 writer/义务 |
| 认知 | generation.request/inspect、planners.assign/inspect、evaluation.report | 明确预算、独立 scope、实际日志，不向浏览器暴露 runtime proof |
| 备份与实验 | backup.create/verify/import、migration.preview、branches.create、compare.query | 原输入/回执幂等；新命名空间；只读默认；恢复需显式 start |
| 外部与联邦 | adapters.preview/authorize/query、federation.inspect | Host 权限、真实用户 grant、因果/未知状态；不由场景自授 |

接口名实施时按既有 RPC 风格统一，不直接作为当前可调用 API。新增 DTO/parser/required events 同步 Host、Client runtime、TS/Python SDK 和分发样本。所有长操作使用 commandId + original payload、可查询进度及明确 retry/cancel 语义；浏览器超时、刷新、多标签不得另起业务。

任何导出/搜索/审阅都独立检查内容权限；授权撤销让旧 cursor、异步结果和缓存失效，普通断网只标 stale。操作预览说明不可逆后果和阻塞，界面不暴露无关实现细节。性能和无障碍测试覆盖大窗口、键盘替代、窄屏/主题/减少动效，不把动画当数据完整性证明。

## 9 验证与默认取舍

| 跨阶段风险 | 验证要求 | 默认决定 |
|---|---|---|
| 长期历史增长 | 原始工作负载、恢复/查询曲线、引用闭包 | 先索引测量，再归档；不静默删历史 |
| 热变更竞赛 | 两后端、窗口/任务/撤权/取消/退休的屏障与进程故障 | 无证明就回退全 run 维护 |
| 认知泄漏 | 实际 Session 输入检查、canary、权限撤销和人工质量评估 | 输入隔离；不靠 prompt 忘记秘密 |
| 迁移与分支损坏 | 新主机空存储恢复、全部引用校验、坏版本/坏片段拒绝 | 原包不改，新可写身份，replay 零 IO |
| 真实效果重复 | 幂等、回执丢失、撤权/限额、恢复与人工对账 | unknown 不重发，真实用户授权独立 |
| 多规划/多分区冲突 | stale/公平/所有权 fencing、重排/重复/丢包 | P3 单提交者，P5 逐对象唯一 owner |

每阶段都可单独交付，不用等待 P5。后续真正需要新增资源模型、执行协议或安全边界时写独立 Agent Note，保留替代方案与拒绝路径。本文不改变已存在的 MVP 范围和验收条件。
