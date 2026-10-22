# F0 输入、责任与验收边界

本登记只覆盖 Post-MVP F0/A1/A2/A3；原 MVP 及其四个待验收项不计入本 checklist，原清单保持不变。B–E 仅冻结纵向契约及拒绝路径，不据此宣称已实现。

## 所有权

Native 日志按顺序提交世界事实；Team/Session 保留真实 actor、实际模型输入输出和身份准备责任。Product 草稿日志保留用户来源、原定义、parent revision 与 saveId，不写 Native。图、列表、影响预览、索引、审计均为纯投影。公开请求从认证 lease 获取用户，不从 JSON 接受自报身份。读取后复核授权；异步旧结果失效。

新增对象按已安装 domain 的 schema/version 读取，未知必需版本拒绝；不可恢复的批准、接受或收件证据不能补默认值。取消关闭未来准入，不能删除已接受义务。结果未知保留原 command/payload 和资源占用；重试查询原件，不新造身份。草稿使用独立不可变 revision，与运行事实生命周期分离；布局不进入定义。生成和备份不授予写世界或现实权限。

| 工作包 | 新增对象与持久 owner | 最小纵向链 | 依赖与拒绝路径 |
|---|---|---|---|
| F0 | 本登记与固定原始测量，仓库证据 | 固定输入→运行→原始样本 | 不同版本/输入不得冒充同次运行；分场景复用须保留原 manifest，并证明该场景实际依赖和环境相同 |
| A1 | ScenarioDraftRevision，Product 专属日志 | 保存→两标签 CAS 冲突→读取祖先→图编辑预检 | F0；旧 parent 不覆盖，未知字段/环/容量拒绝 |
| A2 | PersonaDraft/Vacancy/Application/OfferRevision，Native domain result | 原角色申请→报价→候选人接受→原身份录用 | F0；冒名/旧 hash/过期/重复占岗拒绝；未知准备保留责任 |
| A3 | CalendarRule/ReviewRoute/Delegation/Norm，Native | 有限排班→唤醒；真实 Resolution→组合批准→制度 | F0；无限 recurrence/旧正文/循环/撤销代理拒绝 |
| B1 | IndexManifest，派生索引 owner | 固定历史→构建→原子发布→分页→删除重建 | F0；旧 generation、越权计数与无限扫描拒绝 |
| B2 | RetentionPlan/pins/archive map，归档 owner | 引用闭包→复制→校验→切换→原 hash 读回 | B1/D1；活跃引用不可删，缺片段失败；删除独立操作 |
| B3 | ResidencyPolicy/RepresentationGeneration/MutationFootprint，Native/Team | 一对象 fencing→清点义务→原子切换 | B1；未知 writer 保持 charged，未知 footprint 回退全 run |
| C1 | GenerationJob，Native + 独立 Session | 固定获准输入→生成→持久输出→审核接受 | F0/A2；跨 scope Session 拒绝；取消不抹已接受调用 |
| C2 | PlannerAssignment，Native + 各规划 Session | 两计划并行→单提交者 revalidate→冲突后继 | C1/B1；stale 不覆盖，总预算/委派深度拒绝 |
| C3 | EnvironmentModel/PersonStateVersion/EvaluationSuite，Native/证据 | 已记录采样→重放→经历驱动状态→留出比较 | F0；重放不重抽，技能不授权限，无迁移开新实验 |
| D1 | BackupManifest/MigrationPlan，备份 owner | 一致 cut→完整复制→校验→空存储 staging→paused | F0；坏 hash/缺实现/不可恢复证据拒绝，原包不改 |
| D2 | ExperimentBranch/CausalIndex，Native/派生索引 | cut→新命名空间→授权继承→有界比较 | D1/B1；复用可写身份、未结真实效果、猜测因果拒绝 |
| E1 | AdapterGrant/RealEffect，Host adapter owner | 真实用户授权→intent→有限测试动作→receipt | 独立立项；模拟批准不能授真实权限，unknown 不自动重发 |
| E2 | ownership generation/inbox/outbox，唯一分区 owner | 两 run 消息→去重→receipt→故障恢复 | B1/B3/D1/D2 测得需要后立项；双 writer/缺因果前置拒绝 |

三场景输入为 examples/simulation-company/scenarios/world-company-v1.json、world-laboratory-v1.json、world-association-v1.json，分别强调组织扩张、研究/外部评审和协会治理排班；都由同一 v1 compiler/domain registry 处理，不在 driver 按场景名分支。输入 hash、硬件和初始测量记录单独保存在 f0-baseline.json 及基准输出目录。模型策略为 scripted/keyless；其 token/cost 不能作为真实模型费用基准。首轮固定并发 2、resident 2、actor 4、认知 operation 32、world event 256、batch 16、15 秒执行 horizon、60 秒超时，JSON/SQLite 各运行一次并冷恢复。后续长期规模优化必须保留此输入及原始样本，再另行登记更大 workload，不用此次小样本宣布性能改善。

## 长期基线的场景范围

长期 workload 每场景、每后端固定 32 轮，warm 进程结束后另启 cold 进程；场景/后端顺序执行，并发 1、模型并发 2。每批 manifest 保存硬件、Node、部署预算、轮数和输入 inventory，实际构造的定义另存原始目录。它与上述三份模板的静态编译验收分别记录。

| 场景 | 实际输入与不变的执行所有者 | 每轮可观察结果 | 冷恢复范围 |
|---|---|---|---|
| 公司扩张 | 既有 v1 deployment 定义扩为 32 名独立候选人，原 SimulationWorldDriver 与招聘领域 | 独立申请/接受、一个新 offer/任职、原身份不变及一次性费用守恒 | Native/Team checkpoint，比较结果、资源、关系及身份绑定 |
| 实验室评审 | canonical Native/Team/Session 治理 fixture，两个委员会与固定组合路线 | 三个真实 Session 投票记录和一个新制度，保留实际批准来源 | Native governance/norm 日志重放；不宣称完整 Team 备份 |
| 协会排班 | 协会 v1 模板及有限排班，原 SimulationWorldDriver 与外部交互领域 | 原岗位收件人唤醒、一个独立外部裁决，保留 occurrence | Native/Team checkpoint，比较外部结果和日历 occurrence |

公司 resident 上限 3，其他场景为 2；活跃人数、resident、未释放 writer、历史 Participant/Activation 与每轮耗时/RSS 均保留原始值。公司与协会的 token/cost 来自 scripted fixture；实验室无推理调用，不补造费用样本。RSS 是轮末观测值，维护暂停占比尚未测量；这些限制不作为 B 阶段性能改善证据。
