# 世界调控者 MVP 开发计划

本计划落实[设计评估与 MVP 提案](../../notes/implemented/feature/2026-10-08-world-director-mvp.zh.md)，规划日期为 2026-10-08，源码基线为 `b49dd0edfddb2f19e27110576c5a0f2089cc30ba`。设计提案拥有协议与取舍；本计划拥有实施顺序、工作包和证据；[checklist](checklist.md)用于验收。当前工作区的实现与验证范围见下表和实施证据；包名、RPC 与测试以当前源码为准，工作包完成不等同于 MVP 最终验收。

## 1. 交付目标与状态

交付“导入组织 → 暂停创建 → 显式运行 → 成员申请增员 → 调控者决策 → 新人准备/入职/首次行动 → 进程退出后恢复”的完整产品路径。公司和实验室共用 driver。首版只支持受模板约束的新人物生成与入职，不实施委员会、离职、外部代表或 YAML。

| 工作包 | 当前状态 | 前置条件 | 完成证据 |
|---|---|---|---|
| W0 协议与生命周期探针 | 待验收 | 设计已可评审 | readiness、维护、请求/计划/结果/取消及消费授权有真实链路和两后端恢复证据；技术幂等、入职业务去重及严格协议原项均已验收；全部 W0 checklist 原项已勾选，实现仍在工作区未提交，待最终统一验收 |
| W1 场景编译与暂停创建 | 待验收 | W0 的身份、readiness 与格式决定 | 纯编译、暂停 bootstrap、原产品命令和已认证 fetch 已接通；双场景/两后端、60 项源码及分发恢复验证、原命令/预览拒绝与完整 build/doc-sync 已通过；实现仍在工作区未提交，待最终统一验收 |
| W2 请求交付与调控者计划 | 待验收 | W0、W1 | 原请求/消费/apply-reject/未接受计划/版本来源及关键 read-set stale 原项已验收；有界后继计划在双场景×双后端新进程恢复中验证 plan-budget 与零额外推理；资料不足新申请的原案关联、真实双场景×双后端闭环及 stream 55 拒旧已完成；world 通知拒绝组合及完整前案关联已有真实证据，W2 全部 checklist 原项已勾选；实现未提交，待最终统一验收 |
| W3 入职执行、维护和恢复 | 待验收 | W2 | 全身份、原子入职、取消清理及产品调度/恢复 owner 已接通；stream 54，双场景/双后端产品源码/分发各 20 项验证强杀及显式继续，原维护/容量/半准备/暂停/提交前重验、F1–F6/F8/checkpoint/冷回放项已勾选；F1/F2 已补双场景×双后端产品强杀原请求/原 Envelope 复用；F5 append 前后及第三进程复用已收口；F7 provider 未确认退休/真实卸载/迟到回调已在双场景×双后端强杀与冷恢复验证，F1–F8 原项已勾选；compiler/model/template/checkpoint 版本及新增 Channel/Session/原通知证据的 28 个冷恢复拒绝路径在两场景两后端源码/分发验证；W3 原项全部勾选，实现仍在未提交工作区；已认证案件取消在两场景/两后端源码与分发各 12 项中验证原命令、精确清理和提交竞赛 |
| W4 有界调度与双场景 | 待验收 | W3 | 通用 simulation-world driver 在公司/实验室、JSON/SQLite 的源码/分发各 8 项中走完请求、入职、新人行动、通知、维护暂停及新进程冷恢复；原上下文/隐私第 1–6 项已勾选，产品 owner 已接入；精确额度和持久 token/context/microstep 停止已在两后端 16 driver/10 产品/分发 26 项及双场景 Web 8 项验证；普通决策模型池拒绝已在真实竞争流、Session 缺证据、SIGKILL 和新进程显式继续的源码/分发各 24 项验证；辅助 compaction 的规范请求指纹、取消/wake、原控制与强杀/冷继续在源码 16 项验证；历史 Activation 的真实已确认/未确认启动清理与收件/公平 ticket 责任在两场景两后端源码 24 个路径、分发 24 项验证；stream 59 的真实请求/计划字节与授权拒绝、普通 Envelope 字节和持续竞争公平性源码/分发各 36 项通过；公平/预算/维护原项已勾选；请求历史总数和 World 消息原件重试的源码/分发各 12 项通过；resident/未释放 writer 的真实目标准入和SIGKILL后恢复源码/分发各 8 项通过；全套资源综合项及停止分类/暂停原项达到完整范围，W4 全部 checklist 原项已勾选，实现未提交，待最终统一验收 |
| W5 产品入口与两端 SDK | 待验收 | W1；写入与完整验收依赖 W2–W4 | 原产品创建与唯一 World owner 的已认证 start/pause/checkpoint/restore/ingress 已联通，两端 parser 同步停止原因；案件列表/四分区/取消与两端 SDK 已接通，独立正文/Persona 授权及撤权迟到读取有实际路径证据；JSON 导入/暂停创建/显式调度/四分区已有双场景×双后端真实浏览器 4 项证据，导入闭环、预览和四分区原项已勾选；两真实案件的 revision/查询/披露策略分页及独立正文授权已在产品源码/分发各4项、Client/UI24项与真实两场景×两后端浏览器4项验证，分页原项已勾选；失败/拒绝/容量/维护/空状态/未知及顶部刷新在两场景两后端真实16项验证，状态原项已勾；World创建四方法及严格未知事件同步两端SDK，source各4及compiled-TS/installed-wheel分发8项冷恢复通过，SDK两原项已勾；创建/cancel真实HTTP deadline、原payload/query-first、双击/刷新/shared第二tab在额外4创建+4取消验证，原命令项已勾；流中用户暂停/原取消/冷Loader浏览导出0模型0writable owner及显式恢复4项通过，撤权/迟到响应/断网4项通过；键盘、浅深主题、390px、减少动效四组完整验证，W5原项全部勾选；实现未提交，待最终统一验收；当前未创建GUI PR，真实模型GIF在未来GUI PR时仍必需 |
| W6 综合验收与发布说明 | 进行中 | W0–W5 | 真实产品 keyless 闭环已验证；原采购/公司/消息 proof/身份/窗口/checkpoint 的源码/分发 86 项相关回归已完成并勾选，原 1 秒窗口故障快照按两种合法时序保留相同未知责任；W5全部原项与四组原始测量已有验证证据，待最终统一验收；综合focused/snapshot/typecheck/lint/build/doc-sync及产物检查通过，严格输入/文档/范围审计已完成；当前73/75，仅真实模型样本缺可用路由及依赖它的MVP最终完成项未勾选 |

状态只使用未开始、进行中、待验收、已验收、延期。只有对应退出条件全部满足，并记录提交、命令、结果和产物位置，才能改为已验收。设计文档完成不代表任何工作包已验收。checklist 保持原条目、内容和粒度，不新增、拆分、删除或改写验收项；只有完整满足原条目后才改变其勾选状态，局部证据保存在实施证据中。

## 2. 依赖和变更边界

关键路径是 W0 → W1 → W2 → W3 → W4 → W6。W5 的 DTO/只读页面可以在 W1/W2 契约固定后开发，最终验收仍等待 W4。W0 未证明 Native 与 activation owner 不可绕过的准入之前，不启动整套产品页面实现。

按可独立验证的责任拆分 PR（Pull Request）；依赖分支使用仓库的原生 GitHub stack 流程。每份变更带自己的行为测试、schema/协议消费者和文档，不能把测试与恢复统一推到 W6。浏览器安全类型不得依赖 Host 实现；编排不得导入本地 provider 私有类。

可以保留一个实验性、默认不暴露的产品能力开关，但不得借此跳过 Native 授权或持久格式校验。若 W0 发现设计的硬边界无法实现，先修订设计与工作量，不加入旁路、临时 system sender 或双写 world 数据库。

## 3. 工作包

### W0：协议和不可绕过的准入

**产物：** 冻结最小 operation/event/readiness/maintenance/错误联合；确认日志升级落点；提供一条实际三工具 → Native 接受 → 私有 Channel 的探针及直接激活拒绝测试。探针使用最小夹具，不提前实现 UI、通用领域注册表或全部场景编译器。

主要落点为 [simulation 定义](../../../packages/simulation/simulation/src/business.ts)、[Native journal](../../../packages/simulation/simulation-local/src/journal.ts)、[writers](../../../packages/simulation/simulation-local/src/writers.ts)、[模型接入](../../../packages/simulation/simulation-team/src/model.ts)和[传输证明](../../../packages/simulation/simulation-team/src/transport.ts)。沿 Simulation 的 activationLifecycleOwner 路径追踪直接控制器、冷替换与恢复；仅在普通 driver 拦截不算完成。

明确技术 ID 与 HireIntent 的派生规则、单逻辑请求展开的索引/限额、原计划与后继计划关系、case 取消与入职线性化点。Native 所有结构提交采用一次可验证的原子批次，外部 IO 不占用 run 写队列。

退出条件：普通角色伪造 director、旧 epoch、未消费输入、准备中 Entity 直接启动均被拒绝；标准 `communication/post` 仍通过精确 proof；调控者提交返回时没有等待依赖当前窗口关闭的准备工作。补出真实调用关系和测试，不能只交接口定义。

当前调用关系：`tool-simulation → simulation-team/modelAccess → SimulationWriterLease.submitDecision → LocalSimulationRun.acceptDecision → acceptanceRecords → Native append`。`modelAccess` 检查真实 Agent、epoch、精确 context-view 与 Session consumed 状态；既有普通 Native submit 不要求该路径，新增 world 操作必须在 Native 单独验证持久消费证据。交付由 `transport.scopeFor` 校验原 operation、正文、binding、fingerprint、依赖与到期，再由 `delivery.receive` 固定 Envelope 与 Session 持久输入；持久输入不等于已消费。请求展开必须先于 operation/index/依赖/fingerprint 和消息额度计算，重放使用冻结映射。

readiness 子项采用 journal stream 47，通用 SQLite 表结构与 Session format 不变。可信底层创建显式选择 ready/preparing；产品公司创建使用 preparing，身份/通道准备后显式完成 ready。`entity/readiness` 仅允许暂停、无窗口、无在途 Decision、writer 已停止时结算 preparing；abandoned 不可逆。Native writer、决策、调度和 task execution 与 Team lifecycle owner 共同执行准入。恢复的退休能力保持独立，不能以 readiness 拒绝阻塞清理。Native/Team 持久维护补充已实现，维护引入时 journal stream 为 48：begin 关闭新执行，Team 复用 checkpoint collector 排空并退休后 quiesce，finish 保持暂停。请求/计划与消费证明引入时使用 journal stream 49；stream 50 增加严格结果与原取消命令回执，拒绝/取消和结果 wake 原子保存，并有新进程恢复证据。stream 51 在 root reservation 保留严格创建限额；stream 52 增加入职 reservation/提交、准备中取消与执行失效记录；stream 53 增加精确外部清理证据与原子取消结算；stream 54 增加安全结果/首次行动上下文及精确消费授权；stream 55 增加资料不足新申请的原案关联约束；stream 56 增加精确普通决策模型池拒绝、原子取消与 wake 归还；stream 57 增加辅助 compaction 拒绝及原请求指纹；stream 58 增加 Activation 历史拒绝和原 startup 清理责任；stream 59 增加请求/计划字节与授权拒绝记录；当前 stream 60 增加严格暂停决策记录并拒绝旧 stream。coldReplace 前置拒绝及 preparing 恢复准入专项已完成；Team 清理 owner 已对账原 Channel/membership/Session，未知 IO 保留责任；产品 owner 已接通 case 维护、入职、已认证取消与原命令恢复，浏览器工作区已有双场景、双后端与交互验证证据，整体仍待最终统一验收。


### W1：场景编译和可恢复的暂停创建

**产物：** 纯 `simulation-scenario` 包、严格 JSON parser、字段诊断、冻结解析结果、与采购基础独立的创建路径、公司与实验室初始定义。

产品层复用原命令日志、创建状态与授权；参照[当前准备入口](../../../packages/simulation/simulation-product/src/company-preparation.ts)拆出可复用的身份准备责任，保留采购实现回归。首次版本仅支持设计约定的一组织、岗位、人物、模板与初始事件，不把未知字段当作自由扩展。

编译器单独验证引用、任职约束、容量和已安装模型；服务端把模板/模型 allowlist 与底层 Native/Team 历史限额合并到解析结果。创建时按原 hash 复核预检，后续重试使用已接受的解析结果。初始 director 由可信 bootstrap 创建，不调用尚未存在的自身生成。

退出条件：无 buyer/supplier 的场景完成暂停创建，推理调用计数为零；预检无存储写入和身份分配；在每次身份/通道准备前后中断都能用同一 commandId 继续；变更 payload 拒绝。导出定义再次预检保留语义且不含私有运行日志、凭证或宿主路径。

### W2：请求、私有交付和真实调控者

**产物：** WorldRequest/WorldPlan/HireIntent 持久类型、director 执行绑定、请求展开与交付映射、授权 context-view、同意/拒绝计划和案件只读投影。

新增 `simulation-world` 的最小编排，通过现有 Session/Agent 与三工具驱动 director；模板选择和 Persona 的实际字段作为计划保留。普通角色不能提交 resolve，director 不能调用未知操作或扩大自己的权限。通知只索引请求，正文与业务授权均从各自所有者验证。

退出条件：请求未到期、错误 Envelope、复制 requestId、错误 hash、未持久收件输入都不能驱动计划；重复投递不创建第二 case；`stage` 后退出不被认作 accepted；已 accepted Persona 不因重试而改变。无关 revision 变化不误判冲突，关键 read-set 变化保留 stale 计划并受重规划预算限制。

### W3：入职原子性、维护、取消与冷恢复

**产物：** 持久 reservation/maintenance 状态机、Native readiness、岗位容量准入、幂等 identity preparation、原子入职、case 取消、结果 wake 和 checkpoint 扩展。

复用 [Participant preparation](../../../packages/simulation/simulation-team/src/participants.ts)、[Channel preparation](../../../packages/simulation/simulation-team/src/channels.ts)、[checkpoint](../../../packages/simulation/simulation-team/src/checkpoint.ts)和[restore](../../../packages/simulation/simulation-team/src/restore.ts)；不得调用只接受未开始历史的 company bootstrap 来办理运行中入职。当前暂停限制继续存在，由 owner 正式进入维护来满足。

工作可拆为 W3-a（Native reservation/readiness/原子提交）、W3-b（维护与 Team 对账）、W3-c（取消/进程退出/checkpoint）。每个子包以关闭入口或完整前置条件保护尚未完成的路径，不能让半准备人物提前运行。

退出条件：所有 F1–F8 故障点在 JSON/SQLite 上通过；同一事项最多一次任职，Persona/Entity/Participant/Session/Channel 保持稳定；取消先赢则永不入职，提交先赢则报告已提交；未知退休/准备结果保留责任与容量。直接 API、控制器恢复和迟到回调不能绕过 gate。冷恢复不调用生成模型且保持暂停。

### W4：事件驱动与双场景证明

**产物：** 通用 world driver、新人首次行动、结果通知、有界轮转、预算/容量停止原因，以及公司和实验室的 keyless runnable-example。

所有调度使用 Native wake/queue/window，不在 React 生命周期或未记录定时器中保存业务进度。请求、维护、通知与新人行动共同参与限额；director 和普通成员都能在有限批次获得运行机会。预留、迟到 IO、未确认 writer 退休仍被统计。

退出条件：两个场景只改定义和模板就完成闭环；新增领域标签不需要新增 driver 分支；公司中 observer 的私有信念不进入 director 或新人上下文；第二次申请在岗位满员时失败；无事件返回 idle，无资源返回具体阻塞原因；暂停/预算耗尽不忙循环，恢复不越过原始停止条件。

### W5：产品、Client runtime 和 SDK

**产物：** JSON 导入/预检/暂停创建/定义导出、案件分页与检查器、原命令查询重试、取消、现有启动暂停恢复联通，以及 TypeScript/Python SDK。

主要落点为 [simulation-product](../../../packages/simulation/simulation-product/README.zh.md)、[Client runtime](../../../packages/client/runtime/README.zh.md)、[ui-simulation](../../../packages/client/ui-simulation/README.zh.md)、[TypeScript SDK](../../../packages/sdk/client/README.zh.md)与[Python SDK](../../../python/README.zh.md)。先固定受版本控制的 DTO/parser，再做 Host handler 与客户端；不要让 UI 直接解析 Native 内部快照。

界面用现有组件和设计规范，显示真实错误、空状态、加载、断网陈旧、权限撤销、准备中与结果未知；敏感 body 分权限读。必须保持请求/计划/执行/通知四组状态，提交中禁用重复提交，HTTP 超时保留原 commandId。此工作包实施时加载适用 UI 技能；GUI PR 附真实 server/model flow 的 GIF。

退出条件：从浏览器完成一次成功、一次容量拒绝、一次结果未知后查询恢复和一次取消；刷新、后退、开第二标签不创建第二个 owner 或开始推理。两端 SDK 从分发构建产物验证新 RPC/事件解析和显式恢复；授权撤销不能由迟到读取重新发布敏感内容。

### W6：综合验收和范围声明

**产物：** 完整 [checklist](checklist.md)证据、真实模型小样本试验记录、测试规模与原始测量、用户说明、架构/子系统/目录及双语文档更新。

先完成 keyless 与故障测试，再做明确额度的真实模型试验：至少包含两类有效需求、一类缺字段和一类越权需求，记录输入、计划、拒绝原因、模型版本、token 与人工判断，不把小样本成功率包装成质量保证。试验失败应区分协议缺陷、模板能力和模型质量；不能绕过不变量来提高演示成功率。

退出条件：W0–W5 均已验收，无重复业务效果、越权写入、隐私泄漏、失踪的恢复责任或采购回归。明确哪些功能仍在后续路线；只有全部本版接受标准成立，才能把本提案转为 implemented，并依 note 规范移除已完成计划段落、保留决策与验证边界。

## 4. 必须执行的故障矩阵

每个检查点使用真实持久后端与可控屏障；关键跨所有者阶段必须额外用子进程强制退出验证，不能全部以 mock 抛异常代替。测试断言原记录和跨日志引用，不只检查返回值。

| 编号 | 注入位置 | 核心断言 |
|---|---|---|
| F1 | 请求接受后、通信发布前 | 原 request/operation/依赖保留，后续只交付一次业务申请 |
| F2 | Channel 提交后、Native receipt 保存前 | 同 key 查询/重试返回原 Envelope，director 只有一个 case |
| F3 | plan accepted 后、reservation 前 | Persona 内容与 hash 不变；不再次请求生成模型 |
| F4 | Participant 创建后、binding/Channel 确认前 | 复用全部预留身份；preparing 人物通过直接 controller 仍不能行动 |
| F5 | 入职 batch 的持久 append 前后 | 任职/ready/result/wake 为零份或一整份；不得部分成功 |
| F6 | committed 后、通知前或通知回复丢失 | 世界效果不重复，通知继续使用原身份；新人仅有一份任职 |
| F7 | writer 退休超时、插件关闭、旧 callback 返回 | 未证实停止不释放占用；旧 epoch 无法写入；不虚构完全停稳 |
| F8 | 取消与 reserve/prepare/commit 竞争 | 只有一个终态获胜；未知 IO 保留清理责任，已提交不得删除 |

## 5. 验证与证据记录

实施前和每次发布前按 [dsh-pre-push-checks](../../skills/dsh-pre-push-checks/SKILL.md)为实际 diff 选择检查。对应包的 Vitest 覆盖新拒绝路径和关系不变量；新增模型/产品行为必须有 keyless runnable-example snapshot。新增 Session/SDK 事件同时验证 TypeScript 和 Python 消费者；源码测试和构建产物测试分开。

主要命令类别是 `pnpm run test <focused filters>`、`pnpm run test:snapshot`、`pnpm run typecheck`、`pnpm run lint`、`pnpm run build` 和 `pnpm run doc-sync`。具体 filter 必须使用实际新增测试路径；本文不把拟议测试当作已经存在。构建产物场景先满足声明的 build 前置条件。CI 承担平台矩阵，不无理由重复跑 Windows Wine。

每个工作包记录：提交 SHA、实际命令、通过/失败及原因、持久 backend、脚本化/真实模型、原始日志路径、检查清单项、遗留风险。临时数据、崩溃现场、日志、截图与 GIF 全部放项目内，敏感真实模型输入不进 Git。

## 6. 规模、估算与后续阶段

初步估算按一名熟悉本仓库的开发者、可复用现有组件且不返工底层架构计算：W0 为 3–5 人日，W1 为 4–6，W2 为 4–6，W3 为 6–10，W4 为 4–6，W5 为 4–6，W6 为 4–6，总计 29–45 人日，不含排队评审与外部阻塞。这是规划假设，不是交付承诺；W0 后按实际生命周期改动重新估算。W3 是最高风险与最大不确定性来源。

首个验收只宣称设计中明确的小场景规模。W4/W6 记录实体/历史消息量、backend、硬件、版本、模型等待与本地执行时间、冷恢复耗时和常驻占用；获得数据后再制定扩大规模的 SLO。不以 resident 数量代表总历史容量。

| 后续增量 | 启动条件 | 独立验收主题 |
|---|---|---|
| P1 治理与制度 | MVP 单次业务提交及来源链可靠 | 固定正文 hash 的投票/结案；advisory/validated 分离；第二领域检验注册接口是否必要 |
| P2 任职变更 | 已有待办/承诺清点与取消证据 | 调岗、离职、交接、已接受义务保留；需要时新增维护原语 |
| P3 外部世界 | 人物生成与独立上下文稳定 | 稳定外部身份、按需代表、未知事实与既有事实约束、不重复资产 |
| P4 创作与规模 | 有实际使用和测量依据 | 安全 YAML、编辑器、受限生成助手、索引、局部维护和更大规模 |

真实联网副作用、分布式分片和多世界合并单独立项，不是上述本地模拟版本的隐含依赖。

### 2026-10-11 审查修复

已确认并修复三条异常路径：预留身份前失效的计划允许有剩余额度时显式新 start；World 创建以明确未受理错误允许新意图重新预检；纯空白场景描述在创建受理前返回字段诊断。原 75 项 checklist 正文和勾选粒度不变，当前仍为 73/75。历史门禁结果保留于实施证据，本次变更的综合门禁需独立复验；真实模型样本和最终 MVP 验收仍未完成，亦未发布。
