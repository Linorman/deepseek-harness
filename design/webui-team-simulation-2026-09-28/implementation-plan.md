# 实施与验收计划

状态：实施中，整体未验收。状态核对日期：2026-10-01。本文是开发 checklist 与当前进度的唯一维护位置；[产品设计](design.md) 定义需求，[API 与运行时设计](api-and-runtime.md) 定义技术约束，[验证记录](verification-records.md) 保存历史实现与测试证据。

## 0. 当前完成情况

**A–E 已完成本轮功能与对应验收；整体项目仍有 F/G 后续工作。** 本轮优先 simulation Web 接入、真实运行和失败恢复；必要的权限、状态和可操作性随功能交付，未开展额外 UI 美化或覆盖率追逐。最终证据见各阶段验收文档及验证记录。

| 工作包 | 当前结论 | 剩余工作入口 |
|---|---|---|
| A · Team 正确性 | 最终构建缺陷回归与真实浏览器集成通过 | A01–A04 完成 |
| B · Team 能力与就绪度 | 权限、冲突、原请求、真实执行及交互矩阵通过 | B01–B11 完成 |
| C · Simulation 读取 | Web／Host／SDK、来源／导出、权限及生命周期矩阵通过 | C01–C06 完成 |
| D · Simulation 行政操作 | 原请求、真实维护／恢复、独立进程与时间／预算矩阵通过 | D01–D08 完成 |
| E · 自动任务 | 生产执行、报告拓扑、审核／取消、真实故障及SDK镜像通过 | E01–E08 完成 |
| F · 职责与性能 | 部分职责已拆分，性能测量未开始 | F03–F05 |
| 整体交付 | 尚未完成，局部通过不能替代最终验收 | G01–G04 |

### 状态使用规则

- `[x]`：该条明确限定的范围已有实现与验证记录；不代表整个阶段完成。
- `[ ] 待开发`：尚缺实现；`[ ] 部分完成`：已有基础，但仍缺列出的能力；`[ ] 待验证`：需要补测或最终复核；`[ ] 未开始`：尚无工作证据。
- 本次状态来自原实施记录的整理，不是重新执行产品测试的结果。历史记录中“当前 lib”“尚未实现”等措辞只适用于记录所在批次；最新剩余范围以本页 checklist 为准。
- 不按勾选数量推算完成百分比。只对有证据的有限子项勾选；没有证据的行为不得因为相邻场景通过而关闭。

## 1. 实施顺序与依赖

A/B 可独立交付；C → D → E 依次建立读取、运行和自动任务能力。D 依赖产品授权、持久目录与明确的 driver 模型／工具范围；E 依赖 D，且所有跨所有者责任必须纳入恢复。F 的纯拆分可在相应回归具备后穿插，性能优化必须先测量，不同时重写多个权威提交机制。

以下 ID 用于领取工作、提交说明及验收关联。需求编号 T1–T7、S1–S6 对应 [产品设计](design.md)。每个工作包后的证据链接保留已通过范围；关闭未完成项时，按第 8 节补充新证据。

### A. Team 正确性

需求：T1–T3、T4 的错误语义。证据：[Team 实现与验证](verification-records.md#ab-team)。

- [x] **A01 · 负责人显示**：名称未加载或负责人不在成员页时仍显示已分配，不因分页改变归属。
- [x] **A02 · 离页依赖**：已选离页／缺失依赖可展示、移除，并提交完整集合。
- [x] **A03 · 空态与权限错误**：空产物／工作流保留框架和刷新入口；成功空结果与失败分开，已知权限拒绝不映射为内部错误。
- [x] **A04 · 最终集成**。当前完整构建Team十一文件十六项keyless浏览器通过，结合runtime／组件／API完整覆盖第3节负责人、依赖、空态、权限和导航缺陷；保持原授权。见[Team完整证据](acceptance-team.md)。

### B. Team 能力、编辑与授权

需求：T1–T7、通用草稿／读取隔离。前置：A 的状态反馈与错误语义。证据：[Team 实现与验证](verification-records.md#ab-team)。

- [x] **B01 · 身份与成员详情**：有界身份解析、按连接／主体代际／Team 隔离的缓存、详情／复制、离线反馈及撤权清理已有验证。
- [x] **B02 · 能力与就绪度**：Host 计算任务能力及真实 route／provider／容量／恢复责任；表单说明禁用原因，成员资格与执行状态分开，部署执行配置可选择；人工 reviewer 不要求 Agent activation。
- [x] **B03 · 依赖与冲突**：独立服务端搜索／分页、精确任务引用／删除状态、字段差异、草稿保留及用户确认最新 revision 已接入。
- [x] **B04 · 更新与未知结果**：成功／拒绝账本、原命令查询／幂等重试、写入前后响应丢失、后来编辑保留、拒绝修正及不可编辑阶段保留入口已有验证。
- [x] **B05 · 待处理与人工答复**：不可变创建时间、权威总数／固定排序、有界预览／完整列表、精确事项检查、人工答复草稿与重试已有验证。
- [x] **B06 · 搜索与导航**：全 Team 搜索／状态筛选、URL 恢复、握手等待、IME、清除／焦点及分页失败保留已有验证。
- [x] **B07 · Web 授权链路**：目录、选中 Team、原始频道／产物、Session／祖先／工作区／ZIP、订阅及 remote 转发按当前权限读取或送达；规范父 Team 只读来源、读取中撤权、认证退役和旧响应隔离已有验证。
- [x] **B08 · SDK 与草稿**：SDK 目录／管理读取、通知队列额度和退役清理已有验证；任务／人工事项的有界草稿、原命令、离开保护及授权清理已有验证。
- [x] **B09 · 冲突与更新矩阵**。完整拒绝、持久grant／凭据退休、规范父Team只读、未知原结果、读失败重试和同／新revision确认已由API／Hub／runtime／UI与当前实际浏览器验证；中英／明暗／长错误／尺寸／原生缩放通过，not-found和普通网络错误保持未知。见Team证据。
- [x] **B10 · 待处理权限矩阵**。权威Team全集、问题原回复、持久grant及凭据退休、真实child ApprovalService pending的canonical-parent只读／无批准动作和API处理拒绝已通过；包含全部语言／主题／尺寸／原生200%条件，不用global inbox预览代替Team集合。
- [x] **B11 · Team阶段验收**。第3、5节默认profile form→API、实际自定义provider/activation/attempt、route缺失、provider退休、容量及未确认writer、独立草稿与读取、键盘／焦点／IME／语义／对比度均有source及当前构建十一文件十六项通过证据；共享Loader生命周期与本插件独立apply/disposal一并核对。见Team完整证据。

### C. Simulation 读取

需求：S2、S4 的知识读取、S6、只读导航。证据：[读取记录](verification-records.md#c-simulation-读取)、[Web／SDK 集成记录](verification-records.md#cd-产品集成)。

- [x] **C01 · 历史与产品目录**：JSON／SQLite 有界只读历史、持久目录、所有权观察、授权分页及 Host／TS／Python 读取已有验证；不 open／restore 或推理。
- [x] **C02 · 页面与元数据**：仿真入口、目录状态／预算、四类集合筛选、精确对象与独立详情分页、URL 恢复、真实／精确模拟时间已有验证。
- [x] **C03 · 关系与知识来源**：实体关系、冻结上下文、当前／精确已选知识、已送达报告及 Team Envelope 来源读取已有验证；正文独立授权、默认删节。
- [x] **C04 · 记录与失效通知**：原始 run 日志分页／分片、Web 有界导出、revision／正文策略失效通知、撤权清理及旧响应隔离已有验证。
- [x] **C05 · 关联只读导航**：Team／任务／频道／历史 Session 精确链接、无 coordinator 与退休冷记录读取、前进／后退及普通写入口隔离已有验证。
- [x] **C06 · 读取阶段验收**。第 4.1、5 节对应读取／权限矩阵已完成：本轮 Native/API/runtime117项、source/built-lib各六项真实Loader及当前构建Web八项；八类读页 ×两后端 ×16语言／主题／尺寸／原生200%条件共256截图、13296渲染样本。覆盖深链握手、断线重连、晚到响应、真实卸载重挂、分页失败、键盘／focus／aria、独立正文权限及跨对象拒绝；零模型／第二owner，完整snapshot不作公开DTO。见[完整证据](acceptance-simulation-read.md)。
- [x] **C06a · 真实读取生命周期与部署启停**：新构建 JSON／SQLite Web 验证握手前不读取、跨选择晚到响应隔离、真实断线重连及 product 失去 required service 后入口移除／深链未部署；重新启用无重复 workspace，snapshot 不变且零 Native open／模型调用。独立进程只读 Loader 场景在 source／built-lib 各六项通过；完整页面／权限呈现矩阵仍由 C06 保留。

### D. Simulation 行政闭环

需求：S1、S3、S4 的输入、S6。前置：C 与受限 driver。证据：[行政记录](verification-records.md#d-simulation-行政)、[Web／SDK 集成记录](verification-records.md#cd-产品集成)。

- [x] **D01 · 创建与准备**：公司模板目录、持久原命令、同一 run／Team／reservation 对账、字段错误、首次 paused 和初始完整检查点已贯通 Host／Web／TS／Python。
- [x] **D02 · 实际调度**：公司采购 driver、单一产品 owner／后台 timer、开始／暂停、预算与共享并发摘要、在途收尾、原管理结果查询及历史重试已有验证。
- [x] **D03 · 检查点与恢复**：采集关闭准入并排空／退休，失败保留最近成功记录；恢复验证当前后缀、处理旧 writer 并返回 paused，不回滚或重推理。后端四处维护中断与 Web 冷 owner 重挂载已有分项证据。
- [x] **D04 · 人工输入与草稿**：Host 获准单实体、精确 tick、receipt／消费 decision、明确新准备、有界草稿、原命令查询／重试及后来编辑保留已贯通 Web／SDK。
- [x] **D05 · 未知操作与失败定位**：原授权／原幂等身份重试、目标对账、检查点／恢复安全诊断、精确只读定位及诊断冷查询已有验证。
- [x] **D06 · 模板参数与预检**：后端、Web 与 SDK 已接入受信任模板的预算、实体／驻留及精确 tick 额度和无副作用预检；原配置持久保存，不开放任意 spec 或修改 Host 共享 permit。分项证据见 D06a–D06b。
- [x] **D06a · 后端预检与原配置**：部署 allowlist、实体／驻留／token／精确 tick 额度、字段问题、无副作用预检和不可变创建保存已完成。JSON／SQLite、provider／preset、当前容量和原请求验证通过；Host／TS／Python 接口测试通过。
- [x] **D06b · Web 额度表单与预检**：JSON／SQLite 的认知与自动任务四种真实 Web 流程验证字段错误、超安全整数输入、保存原额度、关闭／重开、响应丢失和撤权；检查配置零命令／零推理，显式开始完成生产执行。
- [x] **D07 · 完整维护矩阵**。第4.2十三项及行政§5验收通过：当前构建完整Web八项、新维护／预算四项、真实进程恢复与文件损坏十项及Native/API证据。覆盖独立Host退出、原请求、断线／凭据退休、采集准入、失败对象、未确认清理、真实版本拒绝；行政五类弹窗16种条件、IME零提交／结束后单次提交、原trigger焦点、reduced-motion和对比度通过。见[行政证据](acceptance-simulation-administration.md)。
- [x] **D07a · 重启后的持久原请求发现与精确重试**：有界 receipt-only 分页、独立 journal revision、授权游标、原身份重试与终态不变已接入 Host／Web／TS／Python。JSON／SQLite 后端与客户端权限／读取隔离验证通过；冷审核／外部重试仍须明确恢复 owner，不保留旧认证。
- [x] **D07b · 独立进程三处退出恢复**：JSON／SQLite 的真实 Node Host 在创建受理、检查点原生完成、审核原生完成后 SIGKILL，四个独立 PID 使用同根目录／端口。旧 cookie 拒绝，重新认证后 Web 发现／查询／明确重试原身份，恢复保持暂停，原报告／尝试／库存及检查点未重复；零模型流入口。
- [x] **D07c · Web 维护准入与未确认清理**：JSON／SQLite 验证初始完整 checkpoint 前不允许启动、采集期间页面及直接 API 拒绝 ingress／继续、采集失败保留成功记录与精确 Session 诊断、私有错误删节；真实恢复连接清理失败保留 Native owner、禁启动并显示 cleanup unconfirmed，新的明确恢复完成。凭据替换后旧 cookie 401、新认证读取持久原请求；五类弹窗全部 16 种语言／主题／尺寸／原生200%组合、键盘隔离／Escape和对比度通过。完整维护矩阵仍由 D07 保留。
- [x] **D08 · 时间与预算边界**。精确大tick显示／排序／未来消费、paused真实deadline、unknown usage与真实cleanup、Host共享permit／独立run区间、预算耗尽后原生拒绝及低实体／驻留准入均有本轮两后端行为证据。驻留限额1选择合法writer、跳过未绑定victim、预留writer要求recovery、禁止休眠入窗actor超额运行由Native生命周期／windows／dispatch证明；Web预算16条件与实际二次推理拒绝通过，不以数字展示代替准入。见D08a–D08c及行政证据。
- [x] **D08a · 精确未来 tick 与零模型预算**：三角色报告场景在零 token 额度下完整运行；超 Number 安全范围的时间在原生／SDK／Web 输入、分配、消费、显示及暂停后原查询／重试中保持精确，不转换为日期或增加模型推理。
- [x] **D08b · 产品 owner 的真实时钟与共享 permit**：JSON／SQLite 三个真实运行竞争全局两个模型许可，全部暂停后 absolute deadline 仍生效；取消信号到达但流清理未完成时不释放许可。队列取消不生成额外请求，partial usage 保留 unknown／预留计费，额度独立，区间耗尽真正拒绝下一推理与新继续。此项为产品 source-plane 证据，完整浏览器／剩余驻留矩阵仍由 D08 保留。
- [x] **D08c · Web 真实时限与未知计费**：JSON／SQLite 实际创建、开始、暂停和再次开始，确认暂停期间真实 deadline、物理清理前共享许可占用、清理后的 partial usage unknown／10000 保留计费及下一推理拒绝。预算区域在中英、明暗、桌面／短窗／窄屏和原生 200% 的全部 16 种条件测量通过；暂停未推进模拟时间。剩余驻留／完整边界仍由 D08 保留。

### E. 自动任务执行

需求：S5。前置：D 与完整跨所有者恢复责任。证据：[任务执行记录](verification-records.md#e-自动任务)。

- [x] **E01 · 来源与分配**：创建来源、持久 execution link、精确 attempt、scoped proof、controller 物理退休及检查点责任已有验证。
- [x] **E02 · 输入与认知**：任务输入先记录，专用启动与模型／确定性认知使用精确身份；原重试不重复推理，实际世界效果与任务完成状态分开。
- [x] **E03 · 结算与履约**：场景完成谓词、原结果意图、专用结算、显式 interaction、三种履约依据及取消／审核约束已有验证。
- [x] **E04 · 公司生产闭环**：有界 executor、产品后台及模式目录已接入 Web／SDK，真实生产路径完成任务；原效果 continuation、未来输入推进和九处进程退出恢复在 JSON／SQLite、模型／确定性组合已有证据。
- [x] **E05 · 多步骤与 rework**：有界后续决策、前驱关联、canonical reviewer 新 attempt、旧效果单次应用已有验证。
- [x] **E06 · 采购审核闭环**：固定 buyer 审核模板、持久原审核命令、Web／SDK 草稿／原结果、暂停批准与冷恢复已有验证。
- [x] **E07 · 受支持场景配置与 reviewer 路由**：公司模型任务与受信任确定性报告模板支持有界步骤、额外 actor／频道、同来源精确路由和独立审核者。准备、容量／ingress、原配置、完整检查点及冷恢复使用同一拓扑；不开放普通 Team 工具或任意外部副作用。新场景模型认知／其他世界效果仍是需要原生准入协议的后续独立扩展，目录明确仅支持确定性报告。
- [x] **E07a · 确定性多步骤报告与指定审核者**：受信任步骤配置、同来源多任务精确路由、recipient 持久报告完成、supplier 审核／返工和原尝试绑定已由 JSON／SQLite 生产 executor 验证；模型 cognition 和可执行场景字段在载入前拒绝。
- [x] **E07b · 新场景 Web 闭环**：JSON／SQLite 真实浏览器验证确定性模板、supplier 审核、返工、响应丢失后的原结果查询、暂停批准与第二步骤完成；零 token 预算、零推理及独立 Team 权限拒绝已核对。
- [x] **E07c · 独立拓扑与跨进程恢复**：总 actor／频道各最多 32，第三审核人／第二频道、未配置成员／自审核／任意能力拒绝、原拓扑不随部署变化、三 Session／两频道检查点和授权第三目标 ingress 已在 JSON／SQLite 后端、Web 与三次真实进程退出中验证。
- [x] **E07d · 完成后的未来输入推进**：报告工作流完成后仍按精确 tick 推进已受理 ingress，暂停保留 pending；显式继续在 `9007199254740993` 消费并保留 decision／冻结正文，原重试不新增决策、任务、报告、资源效果或模型调用。JSON／SQLite 原生与真实 Web 已核对。
- [x] **E08 · 完整执行矩阵**。第 4.3 对应新增场景的真实进程中断、旧／新 attempt与rework、审核／取消／maxAttempts、并发checkpoint和三履约策略已通过生产scheduler／executor验证。两SDK读取真实Session并校验原冻结输入／header；两后端审核／取消各16呈现条件、原命令unknown/query/retry、版本确认、IME、分页失败及真实身份退休／401通过。详见[完整证据](acceptance-simulation-execution.md)；不以本项关闭其他A–E阶段或全仓门禁。
- [x] **E08a · 报告工作流跨进程中断与原报告恢复**：JSON／SQLite × 正常路径及 created、reserved、assigned、input、submitted、window、effect、result、settled、observed 十处中断共 22 项完成 record／replay。实际三 actor、两频道、scheduler／executor 完成两个任务及原报告；已送达效果后的新 attempt 通过原报告 continuation，不重复发布、资源效果或模型调用。完整交错／取消／浏览器矩阵仍由 E08 保留。

### F. 职责拆分与性能

需求：产品设计第 6 节。前置：相应功能具备回归。证据：[重构记录](verification-records.md#f-职责拆分)。

- [x] **F01 · 共享内部模块**：观察器、授权错误分类、成员引用控件及私有产物投影已抽取。
- [x] **F02 · 业务窗口归属**：成员详情与产物字节窗口已移入 runtime，产物为纯视图；取消／撤权／晚到响应与下载已有专项验证。
- [ ] **F03 · 部分完成：剩余职责**。核对审计及其余 UI／runtime、TeamRun／API、Simulation 生命周期／准入／checkpoint／executor 的独立职责，保持唯一写队列、effect 清理与原恢复责任。
- [ ] **F04 · 未开始：性能基线**。按第 6 节固定设备、后端、构建、数据集及模型模式，重复测量并保存原始结果。
- [ ] **F05 · 未开始：有证据的热点优化**。依据 F04 选择热点，提供同条件前后结果与波动；保持恢复、授权、顺序、内存上界和业务输出，噪声内改善不计收益。

### G. 通用交互与最终验收

- [ ] **G01 · 待验证：通用交互**。逐项核对产品设计第 5 节：频道文本／附件／收件人／delivery、各表单草稿及原命令、导航历史、异步反馈、离开保护和授权清理。已有分项通过不关闭全部交互。
- [ ] **G02 · 待验证：视觉与可访问性**。按第 5 节完成中英、明暗、200% 缩放、桌面／短窗口／窄屏、键盘／焦点、对比度、屏幕阅读语义及 reduced-motion，完成必要视觉优化。
- [ ] **G03 · 待核对：未关闭门禁**。逐项复核 [第 7 节](#7-验证记录与未关闭问题) 的 lint、hygiene、全量 Web 及覆盖率记录；新证据记录明确范围，不以定向通过推定全量通过。
- [ ] **G04 · 待验证：整体交付**。关闭剩余范围，在最终构建和真实 Host 上完成端到端流程，记录源码／产物及 JSON／SQLite 证据；报告失败与未验证范围。真实外部模型、跨 Host 分别声明，不因此扩大首期交付承诺。

## 2. 工作分解与归属

| 工作包 | 主要现有落点 | 责任与限制 |
|---|---|---|
| 身份与任务编辑 | [ui-team](../../packages/client/ui-team/src/client/TeamPage.tsx)、[任务摘要](../../packages/client/ui-team/src/client/TaskWorkspace.tsx)、[任务表单](../../packages/client/ui-team/src/client/TeamTaskDialog.tsx) | 修复展示与草稿；不把成员分页当完整身份库 |
| 业务投影 | [Team client runtime](../../packages/client/runtime/src/client/teams/service.ts) | 有界读取、取消、缓存、冲突与重连；React 不自行订阅业务对象 |
| Team 产品能力 | [API handlers](../../packages/host/apiproxy/src/api-proxy.ts)、[TeamRun](../../packages/team/team-run/src/index.ts)、[placement](../../packages/team/team-placement-default/src/index.ts) | 计算可用操作/执行原因，复用当前认证与真实 provider |
| 仿真产品所有者 | [产品服务](../../packages/simulation/simulation-product/src/index.ts)、[本地 run](../../packages/simulation/simulation-local/src/run.ts)、[Team connection](../../packages/simulation/simulation-team/src/index.ts) | 所有权、目录、driver 与产品查询，不能制造第二份世界权威状态 |
| 协议与 SDK | [TypeScript SDK](../../packages/sdk/client/src/api.ts)、[Python SDK](../../python/sdk/src/clocky/api.py)、Host RPC definitions | 明确管理 API 新增范围；事件透传与行政 API 分别验证；沿用仓库生成机制 |
| 自动任务协议 | [Team Hub](../../packages/team/team-hub/src/index.ts)、Simulation executor 和其 schema | 在锁内校验精确 proof；不开放普通 agent-client 旁路 |
| Web 组装 | [Web bundle](../../packages/bundle/web-app/cordis.patch.yml)、client modules/slots、新增 opt-in 配置 | resolver manifests、运行依赖与 UI 能力闭包完整；不能只加菜单 |

新增规范类型落在其声明 owner，包级契约和限制更新到包 README；跨子系统语义更新相应 subsystem；生成目录由源代码生成，不在设计文档复制完整类型。若实现仍使用草案接口名，应在同次变更将其定稿并更新本文链接。

## 3. Team 回归矩阵

| 场景 | 验收断言 | 层级 |
|---|---|---|
| 已分配任务的负责人不在成员页 | 仍显示已分配；无姓名时保留身份，不显示未分配；翻页不改变归属 | runtime、组件、浏览器 |
| 负责人读取失败/已离开/不获准查看 | 区分未知、离开与未分配；同授权网络失败可保留，forbidden/主体变更清理缓存；可重试项有入口 | API、runtime、组件 |
| 已选依赖在其他页 | 显示并可移除；候选翻页与搜索不改变已选集合；提交完整集合 | 组件、浏览器 |
| 依赖 revision 冲突/循环/跨 Team | Host 拒绝；表单保留草稿并定位原因，用户重新确认 | Hub、API、浏览器 |
| 空产物/空工作流/空搜索 | 页面框架、准确空态、刷新或清除筛选入口保留 | 组件、浏览器 |
| 默认 human grant | 不提供可提交的非 shared/未授权 scope；绕过 UI 提交仍得到明确拒绝 | API、默认 profile 浏览器 |
| 能力读取失败/提交前权限变化 | 不猜默认值；保留输入；提交重新鉴权 | API、runtime、浏览器 |
| 自定义成员无 route | 允许登记但准确显示不能执行，定向任务显示阻塞原因 | placement、API、浏览器 |
| 有 route 的自定义成员 | 生产 scheduler 创建真实 activation/attempt；不是只检查 active | 集成、keyless snapshot |
| provider 移除/容量耗尽/旧 writer 未确认 | 无需 Team WAL 变化或整页刷新即可更新就绪度；原因独立；不重复启动 | 生命周期集成、runtime、浏览器 |
| 待处理总数大于当前预览 | 始终可进入 Team 专属列表；未加载不解释为无待处理 | runtime、组件、浏览器 |
| 模块/Team 切换、后退、读取竞态 | 保留符合约定的选择/草稿；旧响应不覆盖新对象 | runtime、浏览器 |
| 消息或任务创建响应丢失 | 原幂等身份查询/重试；不重复创建、发送或丢失草稿 | API、浏览器 |

## 4. Simulation API 与运行验收

### 4.1 读取和授权

- 列表、详情、订阅、下载和 SDK 读取逐次鉴权；随机 run/entity ID、跨 run 详情和伪造 ingress source 被拒绝。
- 读取不 open 第二个写 owner、不恢复、不切换 phase、不启动模型；只读历史损坏与另一进程持锁有不同错误。
- 页大小、字节上限、排序、过滤 token 与 revision 绑定有效；超限输入拒绝；断线/游标缺口刷新后得到一致授权视图。
- 管理员世界视图与实体知识视图分开，私有内容不因关联 Team 成员身份泄露；导出采用同样授权规则。
- 当前运行额度与主机共享 model permit 指标不混用；模拟时间大于 Number 安全整数范围仍精确显示和排序。

### 4.2 行政操作

| 场景 | 必须证明的行为 |
|---|---|
| 创建响应丢失/中途退出 | 同一 command 仍映射同一 runId、Team 与 reservation；无重复实体/频道 |
| 首个完整 checkpoint 之前崩溃 | 创建/准备对账只核对原身份并补做缺失步骤，不推理；完成初始 checkpoint 后才允许首次启动 |
| 重复 phase 请求 | 返回原管理结果；旧 running 请求不能撤销后来的 paused 请求；同时返回最新状态 |
| running 无可用工作或 driver 未配置 | 显示准确原因；缺 driver 的部署启动失败，不出现空转的成功承诺 |
| 暂停时模型仍在执行 | 页面说明仍有在途工作；基础设施超时不因暂停而停止 |
| ingress 重试/旧时间输入 | 同 ID 同 payload 返回原 receipt；改 payload 拒绝；实际分配时间与决策消费可追溯 |
| checkpoint 正在采集 | 新 ingress/继续调度按契约拒绝；浏览器断开后能查询原请求 |
| checkpoint 采集或发布失败 | 保留上一完整 manifest、明确失败对象；未确认 writer 不释放为可用容量 |
| restore 校验历史缺失/篡改/版本失配 | 拒绝执行与推理；暴露可公开诊断，不回退为新建运行 |
| restore 成功 | 验证当前保留后缀，返回 paused，不回滚世界、不重推理、不重复业务效果 |
| owner 冲突/Host unload | 不强拆锁；关闭新准入后排空，未确认关闭保留责任与恢复信息 |
| 模型流取消/未知 usage | permit 和预算按真实清理/落盘结算，不在请求取消时提前复用 |
| 候选实体数大于驻留容量 | 开窗前按策略选择有界候选并确保 active writer；不通过休眠已入窗 actor 超额运行 |

### 4.3 自动任务执行故障矩阵

自动模式的每个成功场景都经过真实 composition、scheduler/executor、交付与 attempt；使用脚本模型可以保证 keyless，但不能直接在测试主体里调用 task completion 假造结果。

| 中断/拒绝位置 | 恢复或错误断言 |
|---|---|
| 创建 outbox 目的端落盘后、源 receipt 前 | 对账同一任务，不再创建任务 |
| execution link 之后、assignment 前 | 保留同一关联，重试对应分配 |
| assignment 后、输入交付前 | 不分配第二个有效 attempt，待交付责任可恢复 |
| 输入落盘后、模型前 | 同 live writer 响应丢失沿用原身份；进程退出/writer 替换保留旧取消证据，重新承接 wake 并建立新决策身份；未落盘输入不得进模型 |
| 提案已提交、窗口未提交 | 按序接受或保留取消证据，恢复不自动接受提交态提案 |
| 世界效果已执行、任务结果回执前 | 复用已记录效果与 receipt，不重复扣款/发布/创建 |
| 任务结果已持久化、reconcile 前 | 从 Team 当前事实对账，精确更新允许的履约状态 |
| 无 interaction 或关联不满足对账条件 | 无关联只更新任务；错误执行者、未接受交互、未关闭窗口或不可对账承诺被明确处理，不按标题猜关系 |
| writer 替换或旧 attempt 迟到 | fencing 拒绝；旧 attempt 先收尾对账，新 attempt 受 maxAttempts 约束，不污染或绕过新尝试 |
| 任务 review/rework/cancel/超出 maxAttempts | 保留 Team 原有约束，解释为何不能完成或重试 |
| checkpoint 与执行关联/交付并发 | 采集包含所有未完成责任或明确失败，不发布不完整 manifest |

同时验证显式债权人确认、资源转移与 task-completed 三种履约依据，证明任务完成不会越权满足其他策略。未配置 executor 时界面与 API 明确只支持创建/对账。

## 5. 浏览器、视觉与可访问性验收

先通过真实 Loader 验证动态组装：slots 的 children 声明与 inject 依赖完整，查看 store 每次 apply 创建，卸载清理 effect/订阅，重新挂载不产生重复注册、状态共享或第二个 run owner。关闭 Simulation 功能后隐藏入口，已存在深链显示未部署状态；重新启用恢复可用导航，不隐式恢复执行。

使用当前工作区构建产物和真实 Host，无密钥脚本模型。先验证页面身份、非空、无框架错误与控制台健康，再沿实际用户流程记录截图；每张截图标记 viewport、locale、theme、数据状态和对应断言。未经本轮实机执行，不将旧截图标记为新实现的通过证据。

| 维度 | 最低覆盖 |
|---|---|
| 页面 | Team 概览/任务/成员/频道/产物；Simulation 列表、创建、概览、决策、操作、检查点与恢复 |
| 数据 | 空、单项、跨页、长名字/目标/ID、大错误、部分加载失败、权限失效 |
| 尺寸 | 常用桌面、短窗口、窄屏；200% 浏览器缩放作为产品验收项 |
| 输入 | 纯键盘、中文 IME、长文本、重复提交、关闭/返回、浏览器历史 |
| 状态 | loading、刷新、断线重连、冲突、未知结果、恢复失败、仍有在途工作的暂停 |
| 外观 | 中文/英文、浅色/深色、reduced-motion、焦点与语义色对比 |

验证 Modal 的命名、焦点隔离、Escape 和返回焦点；非模态 inspector 不陷阱焦点。屏幕阅读语义检查覆盖表头、状态播报、字段错误和 icon-only 控件。对比度以实际渲染测量，不能只凭 token 名称宣称合格。

端到端主路径：创建仿真 → 确认 paused 且无模型请求 → 开始调度 → 观察决策提交与业务效果 → 输入事件并追溯消费 → 暂停并检查在途状态 → 创建完整检查点 → 模拟进程退出 → 验证并恢复至 paused → 检查原结果与 receipt 未重复 → 显式继续。自动任务模式补充真实任务分配、执行、审核/完成和履约对账。

## 6. 性能验证与优化准入

以下规模用于探索，不是支持规模或服务等级承诺。先记录硬件、Node 版本、存储后端、构建方式、脚本/真实模型模式和数据生成参数，固定输入后重复测量并保存原始结果。

| 工作负载 | 探索梯度 | 主要指标 |
|---|---|---|
| Team 浏览 | 100 / 1,000 / 10,000 任务与多页成员 | 首屏/翻页延迟、响应字节、渲染时长、内存和请求数 |
| Simulation 历史 | 1,000 / 10,000 / 100,000 决策/事件，受配置上限约束 | commit 延迟、snapshot 复制成本、模型前准备耗时、事件循环延迟 |
| 实体与驻留 | 多实体、低驻留额度、共享模型并发上限 | 调度公平性、排队时长、额度占用、模型/actor 峰值 |
| 恢复 | 同样数据集的 JSON/SQLite | 打开/重放/校验/checkpoint 时间与峰值 RSS |
| 浏览器更新 | 频繁状态变化、历史阅读、多个订阅客户端 | 每秒通知与重读次数、传输字节、长任务、滚动稳定性 |

检查热点以全量 snapshot 复制、每次提交的全量通知、open decision 查找、重复名字解析和重连刷新为候选。先建立 CPU profile、分配/GC 和 wall-clock 证据，再选择精确读 API、可重建索引或合并通知；不通过减弱校验、删除日志或无界缓存获得表面速度。

每个优化提交给出同机同数据集的基线、改后结果、重复次数和波动范围。通过条件为选定热点在重复测量中稳定改善，且恢复、授权、顺序、内存上界和业务输出保持一致；若改善落在噪声范围内，不作为收益提交。绝对延迟目标依据首轮基线和目标设备确认，不在本设计中捏造数值。

## 7. 验证记录与未关闭问题

详细记录按 [Team](verification-records.md#ab-team)、[Simulation 读取](verification-records.md#c-simulation-读取)、[产品集成](verification-records.md#cd-产品集成)、[行政](verification-records.md#d-simulation-行政)、[自动任务](verification-records.md#e-自动任务) 和 [职责拆分](verification-records.md#f-职责拆分) 查询。[初始审查基线](verification-records.md#初始审查基线) 仅解释 2026-09-28 的问题来源，不认证后续实现。

以下记录需由 G03 逐项核对；本次未复跑，不认定故障仍存在，也不认定已解决：

| 历史问题 | 已有证据与关闭要求 |
|---|---|
| 全仓 lint | 有其他文件错误的记录；定向 lint 通过不足以关闭，需定位并复验相关范围及最终门禁 |
| hygiene / vendor rescope | 曾拒绝 `root-agents-vendored-name-contract` 固定编辑；其他批次存在 15 项通过记录，但未明确关闭该次问题，须核对适用工作树，不修改用户指令或 vendored 文件绕过 |
| 全量 Web | 曾观察 `approval-composer.e2e.ts`、`image-display.snapshot.ts`、`steering.e2e.ts` 失败后中止；图片 fixture 有 `dynamicCordisRunner/inventory`／`syncInspectManifest` 缺失诊断，原因未全部确认。后续定向 Simulation 通过不关闭全量失败 |
| TS client 文件覆盖率 | 205 项断言通过，但既有分支使 `client.ts` 行覆盖率 95.57%、`api.ts` 99.20%，未满足当次 100% 要求；按实际变更和适用门禁确认处理范围，不能宣称整体覆盖通过 |

并行构建期间的超时、测试误用等已有独立复验的记录见 [失败与复验](verification-records.md#失败与复验记录) 及对应分项验证。保留原测试时限和断言的复验结果可解释该批次，不自动证明最终构建通过。

## 8. 文档与交付检查

### 8.1 更新 checklist

领取工作时引用 A01–G04 中的具体 ID，核对需求和验收矩阵。实现与验证完成后，在验证记录的对应分组补充源码／测试定位、执行命令、构建或版本依据、后端／环境、结果及限制；再更新本页状态与核对日期。部分完成保持未勾选并写清剩余内容，后续失败重新打开对应项；不要把新一批执行流水追加到本文开头。

新增证据不能只记录“若干测试通过”。标明它覆盖哪条断言、哪些范围未验证；旧证据中的阶段限制由后续记录补充，不再复制为当前未完成状态。产品设计只维护需求，不保存进度或第二份 checklist。

### 8.2 每次实现的交付要求

按独立可验证改动拆分，纯重构与语义变化分开评审。每阶段同步行为、API、配置、中英文文案、对应文档和必要 Agent Note；GUI PR 按 [GIF 规范](../../.agents/skills/record-browser-gif/SKILL.md) 提供真实服务与模型流程演示。

按 [pre-push 规范](../../.agents/skills/dsh-pre-push-checks/SKILL.md) 选择相关检查，沿用 [客户端规则](../../packages/client/AGENTS.md) 和 [测试政策](../../docs/testing.md)。新模型、协议或用户可见行为增加 runnable-example keyless snapshot；agent-loop、Session 生命周期或 SessionEventMap 变化更新两个 SDK snapshot owner。浏览器使用本次构建，unit 通过不能代替 Web 验收。

文档修改运行 `pnpm run doc-sync`、链接／结构检查与 `git diff --check`。记录既有全仓失败，不因文档整理修改无关源码或生成目录。

### 8.3 最终报告

分别列出实现范围、通过项、明确失败、未验证范围和性能原始结果；测试、截图及 GIF 均须有可定位的执行证据。底层测试或某一阶段通过不等于新增产品 API、driver、executor 或整体交付通过。跨 Host、真实付费模型及其他平台的范围单独声明，不扩大首期承诺。
