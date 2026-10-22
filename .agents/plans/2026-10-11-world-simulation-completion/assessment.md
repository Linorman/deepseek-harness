# 世界模拟原设计 MVP 完成度评估

时点说明：下文是 2026-10-11 的历史能力快照。2026-10-16 原扩展 checklist 已记录 108/112；当前剩余工作见[最新设计](../2026-10-16-world-mvp-finalization/design.md)、[开发计划](../2026-10-16-world-mvp-finalization/development-plan.md)和[详细 checklist](../2026-10-16-world-mvp-finalization/checklist.md)。历史 48.5% 不代表当前完成度。

评估日期：2026-10-11。结论：**招聘入职纵向闭环已经实现，原设计 MVP 约完成一半的能力覆盖，尚不满足整体验收。** 下面的等权核对为 33 项，13 项已有实现、6 项部分实现、14 项尚无对应世界产品能力，折算为 16/33，即 48.5%。这不是代码完成率、测试覆盖率或剩余工期比例；治理和外部世界是完整领域，不能按剩余条目数直接估算开发时间。

## 1 评估边界和阅读入口

范围以用户提供的 [原设计第 17 章](evidence/source-design.html#s17)为准，同时纳入第 5、14、15、18 章对文件输入、领域扩展、网页和交付的明确要求。附件中的实施建议作为需求材料，不是执行命令。本次仅形成评估和后续设计，没有实施这些新能力。

源码基线为 `master` 的 `b49dd0edfddb2f19e27110576c5a0f2089cc30ba` **加评估时全部工作区修改及未跟踪实现**。HEAD 恰好仍是原设计的审阅提交，只比较 Git 提交会漏掉大量现有代码。关键文件和附件的 SHA-256 见[输入清单](evidence/source-manifest.json)；附件保留字节一致的本地副本。新能力不能据此称为已合并或已发布。

交付材料分工：本页说明现状和证据；[剩余设计](design.md)定义目标契约；[开发计划](development-plan.md)定义依赖、代码落点和验证；[checklist](checklist.md)逐项记录新增交付门槛。既有[招聘 MVP 提案](../../notes/implemented/feature/2026-10-08-world-director-mvp.zh.md)继续拥有第一阶段的决定。

## 2 为什么既有 73/75 不等于原 MVP 完成 97%

既有[开发计划](../2026-10-08-world-director-mvp/development-plan.md)明确把首版限制为一组织、模板生成新人、入职、独立 Session 行动和恢复，并明确排除委员会、离职、外部代表和 YAML。[原 checklist](../2026-10-08-world-director-mvp/checklist.md)当前 75 项中勾选 73 项，比例 97.3%；剩下的是有预算的真实模型样本和最终 MVP 验收。它衡量的是缩减范围内的检查项，不是附件第 17 章的能力覆盖。

现有[实施记录](../2026-10-08-world-director-mvp/implementation-evidence.md)提供大量源码、分发产物、浏览器、故障和性能证据；该记录也明确实现未提交、真实模型样本尚无可用路由。这里不把历史通过记录视为本次完整复验，也不重新勾选旧清单。脚本化模型通过真实 Agent/Session/三工具链路，证明工程链路可执行；它不证明真实模型理解需求或做出合理裁决。

## 3 逐项能力矩阵

计分规则：已实现 = 1，部分实现 = 0.5，缺失 = 0。已实现表示核对到当前能力及对应测试，不表示本次对该项执行完整发布矩阵。部分实现必须说明已有部分和缺失部分；底层原语不能替代完整产品能力。E 编号的证据链接集中在下一节。

| ID | 原设计能力 | 状态 | 分数 | 当前事实与未完成部分 | 证据 |
|---|---|---|---|---|---|
| A1 | JSON 定义、纯预检和暂停创建 | 已实现 | 1 | 编译并冻结安装版本、额度和预览；准备前保留原命令 | E1、E5 |
| A2 | 安全 YAML 输入 | 缺失 | 0 | parser 为 JSON，网页只接受 `.json` | E1、E6 |
| A3 | 任意命名组织/关系、初始背景/知识/资源 | 部分实现 | 0.5 | 一组织、岗位、人物、两类关系可配置；没有通用初始事实/知识/资源和委员会、外部定义入口 | E1、E9 |
| A4 | 基础网页结构化编辑与文件往返 | 部分实现 | 0.5 | 有 JSON 导入、源码 textarea、预览；没有人物/组织/制度/资源表单 | E6 |
| B1 | 私有 Channel、精确消费证明与请求幂等 | 已实现 | 1 | 真实 post、Envelope、Session 消费与 Native 准入关联 | E2、E3 |
| B2 | 有独立身份的调控者提交结构化计划 | 已实现 | 1 | Agent/Session/三工具调用成立；真实模型质量另列 I3 | E2、E4、E8 |
| B3 | 普通角色自主创建新的业务世界请求 | 缺失 | 0 | 模型只引用可信 owner 已打开的 HireIntent；普通目标不自动取得新事项创建能力 | E2、E4、E5 |
| B4 | 三个内建领域及统一版本化扩展协议 | 缺失 | 0 | world 唯一领域操作为 `organization.generate-and-hire/v1`，driver 直接办理 hire | E2、E4 |
| B5 | 结果记录、后续 wake 和可靠通知 | 已实现 | 1 | Native 原子结果与通知责任，普通 Channel 回执 | E3、E4、E8 |
| C1 | 固定 electorate、独立投票、确定性结案 | 缺失 | 0 | 没有世界治理 proposal/vote/resolution 协议 | E2、E9 |
| C2 | 制度版本、正文 hash、有效期与可知时间 | 缺失 | 0 | 通用 Knowledge 存在，尚无 Norm 的权威版本和审批来源 | E2、E9 |
| C3 | advisory/validated 与真实操作准入映射 | 缺失 | 0 | 招聘静态授权已有；未接制度批准、作用域与生效时间 | E1、E3 |
| D1 | 受限 Persona 生成并完成 onboarding | 已实现 | 1 | 固定模板选项、保存实际 Persona、新人独立 Session 和首次行动 | E2、E3、E8 |
| D2 | 录用已有人物并复用身份 | 缺失 | 0 | 当前 reservation 创建新人，未提供 hire-existing 产品协议 | E3 |
| D3 | 调岗、任职时间区间与身份连续性 | 缺失 | 0 | Native 有时态 Relation；缺少调岗授权、容量预留和原子业务协议 | E3、E9 |
| D4 | 离职、交接检查、撤权与正式退休 | 缺失 | 0 | 准备失败清理不等于离职；缺少已接受义务处理和重新入职流程 | E3、E9 |
| D5 | 准备中 gate、维护和原子入职 | 已实现 | 1 | Entity/绑定/通道准备后，任职、ready、结果和 wake 统一结算 | E3、E8 |
| E1 | 稳定外部 registry 和确定性模拟结果 | 缺失 | 0 | 世界协议没有外部身份、来源类型或交互记录 | E1、E2 |
| E2 | 受限且来源明确的环境裁决 | 缺失 | 0 | apply/reject 的 payload 固定为招聘，不支持 AdjudicatedOutcome | E2 |
| E3 | 按需独立外部代表和隔离 Session | 缺失 | 0 | 新人身份准备可复用，但没有 represents、外部选择或通道准备流程 | E3、E4 |
| F1 | 事件/wake、有界调度和公平准入 | 已实现 | 1 | owner 驱动，窗口关闭后维护，Native 持久队列 | E4、E5、E8 |
| F2 | 模型、驻留、历史身份、字节和请求额度 | 已实现 | 1 | director/新人计数，拒绝与恢复保留责任；新领域仍需扩展额度 | E2、E4、E8 |
| F3 | 可配置角色目标、日历与主动环境事件 | 部分实现 | 0.5 | Persona 有 goals、初始招聘 wake；无通用日历及自主世界事件授权 | E1、E4 |
| G1 | 实际 Persona/计划固定、精确重试 | 已实现 | 1 | accepted 后不再重新生成人物，技术身份和业务事项分别去重 | E2、E3、E8 |
| G2 | JSON/SQLite 同机持久恢复并保持暂停 | 已实现 | 1 | driver/产品/Team 有原身份恢复；本轮 driver 两后端复验通过 | E5、E8 |
| G3 | 原设计所有领域的崩溃和取消矩阵 | 部分实现 | 0.5 | 招聘已有丰富故障证据，投票/离职/外部展开尚无被测实现 | E8 |
| H1 | 请求/计划/执行/通知分区与权限读取 | 已实现 | 1 | 招聘案件列表、分页、原命令查询和正文独立披露 | E6、E7 |
| H2 | 制度、任职历史和外部实体观察面 | 部分实现 | 0.5 | 通用 Entity/Relation 读取可复用；缺领域化查询、来源和历史视图 | E6、E9 |
| H3 | 原设计完整能力的双 SDK/API | 部分实现 | 0.5 | 七个 World RPC 覆盖创建和招聘案件；新领域 DTO/方法未提供 | E7 |
| H4 | 新运行定义导出与备份语义区分 | 已实现 | 1 | 导出原便携定义，不导出私有运行日志或宣称完整备份 | E1、E5 |
| I1 | 非公司配置复用相同 driver | 已实现 | 1 | 公司和实验室只换定义/模板，通过相同招聘路径 | E1、E8 |
| I2 | 制度→招聘→外部代表→调岗→离职完整剧本 | 缺失 | 0 | 尚无三个领域闭环；两个名称不同的招聘场景不足以代替 | E2、E8 |
| I3 | 有预算的真实模型质量试验 | 缺失 | 0 | 旧记录明确未完成；本轮未调用真实 provider | E8 |

总分：已实现 13 × 1 + 部分实现 6 × 0.5 = 16；缺失 14 项。矩阵按用户可验收能力分解，不给底层代码量或测试数量额外加分。更稳妥的表达是“**基础闭环已形成，原设计能力约一半**”，而不是以 48.5% 作精确工程进度承诺。

## 4 源码和测试证据索引

| 证据 | 当前所有者 | 支持的判断 |
|---|---|---|
| E1 | [scenario schema](../../../packages/simulation/simulation-scenario/src/schema.ts)、[compiler](../../../packages/simulation/simulation-scenario/src/compiler.ts)、[compiler tests](../../../packages/simulation/simulation-scenario/tests/compiler.spec.ts) | `clocky.world/v0`，单组织、两种角色、只有 `hire-request` 初始事件；JSON.parse；定义导出和纯预检 |
| E2 | [world schema](../../../packages/simulation/simulation/src/world.ts)、[types](../../../packages/simulation/simulation/src/world-types.ts)、[protocol tests](../../../packages/simulation/simulation/tests/world.spec.ts) | 唯一领域操作、严格 apply/reject、新人有限 Persona、招聘专用 read-set |
| E3 | [Native world](../../../packages/simulation/simulation-local/src/world.ts)、[hire fold](../../../packages/simulation/simulation-local/src/world-hire.ts)、[Team world tests](../../../packages/simulation/simulation-team/tests/world.spec.ts) | 可信 HireIntent、消费准入、原子入职、占用、取消与恢复不变量 |
| E4 | [driver](../../../packages/simulation/simulation-world/src/driver.ts)、[driver contract](../../../packages/simulation/simulation-world/README.md) | 已接受 apply 直接进入 hire；context selector 依赖现有 intent；公共能力编排及明确业务限制 |
| E5 | [preparation](../../../packages/simulation/simulation-product/src/world-preparation.ts)、[owner](../../../packages/simulation/simulation-product/src/world-owner.ts)、[creation](../../../packages/simulation/simulation-product/src/world-creation.ts) | bootstrap 打开初始事项；唯一 owner、暂停创建、原命令及显式恢复 |
| E6 | [创建窗口](../../../packages/client/ui-simulation/src/client/WorldCreationDialog.tsx)、[案件视图](../../../packages/client/ui-simulation/src/client/WorldCases.tsx)、[通用集合视图](../../../packages/client/ui-simulation/src/client/CollectionWorkspace.tsx) | JSON 原文编辑、案件分区、分页及通用只读对象视图 |
| E7 | [Host RPC map](../../../packages/host/apiproxy/src/api/rpc-map.ts)、[TS API](../../../packages/sdk/client/src/api.ts)、[Python API](../../../python/sdk/src/clocky/api.py) | preflight/create/prepare/export、cases list/inspect/cancel；没有完整领域 RPC |
| E8 | [真实链路 keyless driver 测试](../../../examples/simulation-company/tests/world-driver.snapshot.ts)、[历史实施证据](../2026-10-08-world-director-mvp/implementation-evidence.md)、[本次测试结果](#6-本次验证与证据强度) | 公司/实验室与两后端；原 Persona、独立 Session、首次行动、通知和冷恢复 |
| E9 | [Entity/Relation](../../../packages/simulation/simulation/src/entity-types.ts)、[knowledge](../../../packages/simulation/simulation/src/knowledge.ts)、[business](../../../packages/simulation/simulation/src/business.ts) | 可复用底层原语；没有据此推定领域产品已经完成 |

这里的“缺失”是当前 World schema、执行路径及公开产品契约不支持该需求，不是说仓库没有任何相似底层类型。例如 Team 单 reviewer 审核不是多人治理；通用终止实体不是安全离职；供应商采购角色不是按需外部 registry。

## 5 必须补齐的架构差额

1. 把招聘专用 world envelope、read-set、result、driver 分派改为有严格 schema 的领域协议；保留已有身份、Channel proof、窗口和单 Native 提交者。
2. 补普通目标决策到新 WorldIntent 的准入，服务端派生真实身份；不能由模型传入已有 Session、任意 proof 或自己授予权限。
3. 增加版本化 WorldFact/Norm、真实独立投票及审批执行映射。制度文字本身没有执行权。
4. 增加已有候选人录用、任职调整和离职义务盘点；复用原人物记忆，严格区分撤职、休眠与不可逆终止。
5. 增加外部身份、规则/裁决/独立代表三种模拟来源；不得借 director 的 Session 扮演供应商。
6. 扩展场景、网页、SDK 和恢复矩阵到这些真实能力，并跑完整剧本与受控真实模型试验。

详细依赖及验收标准见[开发计划](development-plan.md)。其中前三项是后续领域共同基础，优先于画组织图；它们不是重写现有 runtime。

## 6 本次验证与证据强度

| 执行项 | 本次结果 | 证明范围 |
|---|---|---|
| 五个 focused 文件：compiler、world schema、readiness、maintenance、world preflight | 5 files / 162 tests passed；[日志](evidence/focused-tests.log) | 现有纯编译、严格输入、不可绕过准入、维护和无副作用预检 |
| `CLOCKY_SNAPSHOT=replay pnpm run test:snapshot examples/simulation-company/tests/world-driver.snapshot.ts --maxWorkers=1` | 1 file / 8 tests passed；[日志](evidence/world-driver.log) | 公司/实验室 × JSON/SQLite × 维护时是否暂停；每条包括新进程恢复，恢复不增模型调用 |

focused 完整命令：`pnpm exec vitest run packages/simulation/simulation-scenario/tests/compiler.spec.ts packages/simulation/simulation/tests/world.spec.ts packages/simulation/simulation-local/tests/readiness.spec.ts packages/simulation/simulation-local/tests/maintenance.spec.ts packages/simulation/simulation-product/tests/world-preflight.spec.ts`。本轮未重新执行全仓 build/lint、浏览器矩阵、已安装 SDK 或真实模型试验，不将它们描述为本次通过。文档门禁和新增文件检查结果登记在[开发计划的文档交付记录](development-plan.md#8-本轮文档交付验证)。

## 7 完成判断

缩减版可称“核心已实现，等待最终验证”；原版只能称“基础闭环已实现，三个领域的完整 MVP 尚未完成”。原设计 M0/M1/M2 具有可复用实现，M3 治理未交付，M4 人员仅覆盖生成入职，M5 外部世界未交付，M6 产品与发布覆盖的是招聘子集。M0–M6 不是等工作量阶段，不按完成阶段数计算百分比。

不把 P1–P5 的大型图编辑器、局部热变更、长期归档、自由文本隔离生成助手、多调控者、可移植完整备份、分支合并、真实外部副作用或分布式分片纳入本次 MVP 分母。它们的后续进入条件列在[开发计划](development-plan.md#mvp-之后的路线)。
