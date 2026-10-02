# 实现与验证记录

本文保存截至 2026-10-01 的历史批次记录，供 [实施计划](implementation-plan.md) 的开发 checklist 追溯。它不维护当前进度；旧记录中的“尚未完成”“当前 lib”和测试数量仅描述该批次，不推翻实施计划中有后续证据的状态，也不证明最终工作树通过。

记录按责任分组：实现记录保留技术范围，分项验证保留源码／测试定位、结果及限制。历史测试数不能相加为总覆盖率；不同批次的来源构建、环境和未验证范围不可互相替代。文档整理本身不认证产品状态；新增批次在对应条目中明确标注实际执行的验证。

## A–E 完整验收补充：当前构建与维护复验

2026-10-01 本轮 `pnpm run build` 通过，日志位于 `.tmp-simulation-plan/ae/build-current.log`。新增 Host 浏览器程序归入 `tsconfig.host.json` 并从客户端项目排除；早期漏注册导致的编译失败已修复，没有通过修改 vendor 或降低 TypeScript 约束绕过。

`pnpm run test` 对 maintenance、company-owner、checkpoint-diagnostics、administration-clock-budget、task-control、simulation-team lifecycle 及 native windows／dispatch／tokens 九文件执行 481 项：479 通过，两个 lifecycle 旧契约失败正在修正并重新执行；这一批不能作为全通过证据。新的真实时钟／共享 permit 四项和行政取消三项均已通过。

`CLOCKY_SNAPSHOT=replay pnpm run test:snapshot examples/simulation-company/tests/checkpoint-corruption.snapshot.ts examples/simulation-company/tests/product-maintenance-recovery.snapshot.ts` 两文件 10 项通过（`.tmp-simulation-plan/ae/d-maintenance-snapshot-final.log`）。JSON／SQLite 各覆盖行政 accepted、native-begin、native-complete、terminal 四处真实进程退出；独立新 Loader 对账原检查点，保持当前事实。另两项真实 Session header 字节损坏在新进程中拒绝、保留原损坏字节，精确修复后零模型恢复，明确继续才完成原待处理效果。

九文件原生复验在两项旧契约修正后 481／481 通过（`.tmp-simulation-plan/ae/d-final-native-revised.log`）：Simulation Team 普通 human 修改明确拒绝，Native 受理仍重新核对当前 participant；来源移动保留结构化 checkpoint diagnosis 及底层 cause，不退回旧异常外形。

E08 报告工作流 `task-workflow-fault.snapshot.ts` 22 项 record 与 replay 均通过（`.tmp/e08-task-workflow-fault-replay.log`），正式 golden 保存在同目录 `__snapshots__`。JSON／SQLite 各包含正常基线和 created、reserved、assigned、input、submitted、window、effect、result、settled、observed 十处不同进程退出；实际 scheduler／executor 完成两个任务，三 actor／两频道拓扑和原报告不重复。原报告 continuation 仅接受已退休前驱及记录过的空提案确认。另 `execution-checkpoint-concurrency.spec.ts` 四项 source 检查通过，真实 execution-link／recipient delivery 挂起期间不发布新 complete manifest，释放后保留三 Session／两频道及单次报告。

`simulation-administration-acceptance.snapshot.ts` 的实际 deadline/budget 用例 JSON 通过（`.tmp-simulation-plan/ae/admin-budget-browser-current.log` 中 1 passed、SQLite 初次读取等待失败），SQLite 单项修正为等待完整 metadata 响应后通过（`.tmp-simulation-plan/ae/admin-budget-browser-sqlite.log`，1 passed、3 未选）。两后端完整证据为 `.tmp-simulation-plan/ae/admin-budget-browser/<backend>/deadline-budget-evidence.json` 及每后端 16 组未知计费截图／实测 JSON。实际 external adapter 只脚本化流响应；真实 product owner、reservation、paused deadline、模型池和第二次预算拒绝没有被替换。Native time 在暂停全过程保持 `0`，startedAt/deadline/expiredAt 独立记录；partial usage 7/2 的 unknown 预留为 10000，清理前 active1/1、清理后0。图表分别展示 run 预算与 Host 模型池，不把预留冒充已知消费。新 restore cleanup 诊断 source 回归单项已通过（`.tmp-simulation-plan/ae/restore-cleanup-diagnosis.log`），Web 还需下一构建。

当前包含恢复 cleanup 诊断的完整构建通过（`.tmp-simulation-plan/ae/build-final-web.log`）。`pnpm run doc-sync` 本批 28 项通过、唯一 config catalog stale；`gen-config-catalog` 后 `verify-config-catalog` 通过（`.tmp-simulation-plan/ae/config-catalog-current.log`）。这是一轮门禁加单项修复复验，不写为同一 aggregate 29／29。Cordis API catalog 生成后对应 check、persistence/client catalog、390 对类型映射、export JSDoc、scoped events、文档预算及三组文档配对均通过。行政／run-status／workflow-ingress 与 Host 两对应文件当前五文件 32 项通过（`.tmp-simulation-plan/ae/d-api-boundary-final.log`）；Native metrics 三项通过（`.tmp-simulation-plan/ae/d-boundary-admission.log`）。没有使用覆盖率或更改阈值代替本轮功能验证。

C06 生命周期在新 build-final-web 构建 JSON／SQLite 两项通过（agent runner44980，5.46 秒）：真正延迟 host.describe、读取中切模块、断开真实 WebSocket、required product service 退休和重新启用；读取不新增 Native owner／模型，完整 snapshot 不变，没有重复 workspace。独立进程只读 Loader 三文件在 source／built-lib 各六项通过（lib64548，3.45 秒），包含不同进程持锁到释放后的 owner 变化、当前来源授权及 Team 撤权。旧 inline snapshot 只更新已有正式 metrics/rules/policy 公开字段，revision15等断言保留，并使用独立 replay 验证。其完整页面矩阵随后执行，未用这八项结果关闭全部 C06。

行政维护 `CLOCKY_SNAPSHOT=replay pnpm run test:web:built apps/web/tests/simulation-administration-acceptance.snapshot.ts -t "keeps initial-checkpoint"` 当前构建最终 2／2 通过（`.tmp-simulation-plan/ae/admin-browser-current.log`，53.76 秒）。两后端各五类弹窗 ×16语言／主题／尺寸／原生缩放共160组截图/JSON；随后真正 hold 初始 checkpoint 与采集、直接 HTTP 合法请求绕过拒绝、未实体化 Session 的真实读取 IO 失败、原请求安全 diagnosis、成功 cut 不变、临时恢复 connection.close 失败及 owner保留、明确新恢复完成、新旧认证分别成功／401、全流程模型调用零。规范证据保存 `.tmp-simulation-plan/ae/admin-browser/<backend>/administration-evidence.json` 与 `recovery-cleanup-unconfirmed.json`。早期失败来自测试在终态后盲点点击消失的 query按钮及将 aria-label 当正文；修正按实际可见状态读取，没有改产品授权。故障注入从新运行不会经过的 getPersistenceReference 改到实际 isUnmaterialized，仍验证精确 Session／Team source 和 private redaction。

最终收尾批次：`build-complete-ae.log` 完整 build通过，含全部新测试程序的严格Host/client编译；两处新增fixture类型错误已修正（native zoom literal1|2、SDK比较原Native context.runId而不是ProductRunId）。`doc-sync-complete.log` 本次aggregate **29 passed/0failed**（47.12秒），不是此前28项加单项的拼接；1110双语配对也单独通过。最后TaskSDK身份修正后的实际fixture两后端replay **2/2通过**（`sdk-native-identity-final.log`，15.64秒）。

Team完整 `CLOCKY_SNAPSHOT=replay pnpm run test:web:built apps/web/tests/team-` **11文件16项全通过**（`team-full-final.log`，147.12秒）；canonical-parent真实approval通过Loader insert＋agent/created standing工具贡献＋production ApprovalService产生持久pending，其只读UI不提供approve动作，当前API拒绝处理并保留同source，四种locale/theme各desktop/short/narrow/native200通过，原parentcancel真正停止child。

行政扩展文件当前 **4/4通过**（`admin-all-final.log`，58.88秒），补齐exact original trigger focus、real reduced-motion/no running animation、composition中不写/结束后Native单次ingress，以及实际foreign/2完整checkpoint的产品拒绝。冷原query会把有界requests页刷新回首，独立保留的原command仍显示安全version diagnosis，Nativeowner未close、snapshot不变、model0。版本两项Native检查通过。原行政/maintenance/独立process restart旧三文件 **8/8当前构建通过**（`d-full-browser-final.log`，147.03秒）。

E08新增报告工作流22进程故障record/replay、旧attempt/rework/maxAttempts、10实际取消/入窗/Token/compaction准入、4并发checkpoint、三种履约和两SDK真实Session originalview/header decode全部通过；审核/取消两后端共64呈现条件四Web用例通过，真实身份退休在reload前清私有draft、旧cookie合法tasks.list401、新认证同原task/空draft的两项通过。完整范围与逐条来源由 `acceptance-simulation-execution.md` 保存。

本节早期批次的待执行范围由上述最终实际结果与专用验收文档补齐；当前完成状态仅由plan维护。全仓F/G门禁不由本轮A–E定向验收认证。

## 阅读索引

| 当前工作 | 历史记录 |
|---|---|
| A/B：Team 功能与授权 | [Team](#ab-team) |
| C：读取／知识／来源 | [读取](#c-simulation-读取)、[产品集成](#cd-产品集成) |
| D：创建／调度／恢复 | [行政](#d-simulation-行政)、[产品集成](#cd-产品集成) |
| E：自动任务／审核 | [自动任务](#e-自动任务) |
| F：内部拆分 | [职责拆分](#f-职责拆分) |
| 最终门禁 | [阶段门禁](#g-阶段门禁)、[失败与复验](#失败与复验记录) |
| 最初问题定位 | [初始审查基线](#初始审查基线) |


## 2026-10-01 · 模板预检与报告工作流

D06a 的 [配置解析](../../packages/simulation/simulation-product/src/creation-preflight.ts) 与 [行政服务](../../packages/simulation/simulation-product/src/administration.ts) 共享部署 allowlist 和 immutable spec 解析。`preflight()` 返回获准字段的精确额度／版本／共享模型上限或有界字段问题，不分配 run／command、不写原生日志、不预占 permit。新创建重复当前权限、provider、preset 与容量检查；精确原请求重试继续返回原配置／结果。JSON／SQLite 对照检查预检前后原日志与 run 目录不变，覆盖超安全整数 tick 保存、配置改写后的原额度及安全 provider 错误。`pnpm exec vitest run packages/simulation/simulation-product/tests/administration.spec.ts packages/simulation/simulation-product/tests/creation-book.spec.ts packages/simulation/simulation-product/tests/creation-store.spec.ts --coverage.enabled=false` 28 项通过；产品 tsc 与对应源文件 lint 通过。

Host `simulation.runs.preflight`、SDK `simulation/runs-preflight`、TS `preflightSimulation` 及 Python `preflight_simulation` 使用无 commandId 的获准输入。Host／TS client／server 的四个定向 Simulation 文件 105 项通过，Python SDK 全套 230 项通过。未运行覆盖率，不代表全部 Web、全仓门禁或最终构建已通过。

E07a 的 [报告场景配置](../../packages/simulation/simulation-product/src/task-scenario-config.ts)／[driver](../../packages/simulation/simulation-product/src/task-scenario-driver.ts)／[完成策略](../../packages/simulation/simulation-product/src/task-scenario-policies.ts) 复用原生任务 executor，受信任步骤选择 source／executor／recipient／reviewer。完成须有本 attempt 的精确授权报告和双方 receipt；supplier 审核、返工反馈和同来源不同任务精确路由通过 JSON／SQLite 生产路径验证。模型认知未具备场景专属原生准入，因此该新工作流只允许确定性步骤；未知可执行字段在 schema 拒绝。现有公司模型路径保留。通用拓扑、独立进程中断、完整新增故障／交互矩阵和 Web 闭环仍待验证。

新场景 [浏览器用例](../../apps/web/tests/simulation-task-workflow.snapshot.ts) 使用本轮 `pnpm run build` 产物与真实 Loader、Host carrier、原生任务 executor，JSON／SQLite 两项通过（46.96s）。覆盖 supplier 审核／返工、响应丢失后原请求查询、冻结反馈、暂停批准、继续第二步骤、报告 receipt、零 token 额度／占用／保留与零模型调用；独立 Team 权限拒绝不创建新任务或修改世界。外部模型使用 keyless fixture，仅新的确定性流程证明零推理，不代表真实 provider 或通用拓扑。

D07a [行政请求分页／原重试](../../packages/simulation/simulation-product/src/administration.ts) 返回同 run 的已受理／终态 receipt，不含原表单正文。续页绑定当前认证、run、limit 及独立行政日志 revision；无关 run 的新请求不退休当前游标，Native world revision 不用于判断请求页过期。原重试仅接受 runId／commandId，Host 使用原保留输入；终态不再次启动，未知／跨 run／他人选择拒绝且不分配身份。冷审核／外部操作授权保留显式 restore 前置条件。新后端 [requests 测试](../../packages/simulation/simulation-product/tests/requests.spec.ts) 10 项通过，Host／TS SDK 的请求恢复及关联测试 107 项、Python 全套 232 项通过。Web 用 [持久原请求](../../packages/client/ui-simulation/src/client/PersistentRequests.tsx) 重新发现原请求；raw drafts 和旧认证下的 runtime commands 仍按认证规则清除。独立进程退出验证尚待执行。

整套 `pnpm run test:gui` 344 个文件、4382 项断言通过（1 项跳过），此批次执行早于新增持久请求入口；新增入口另有组件／runtime 定向测试，不据此认定更新后全套已复核。`pnpm run doc-sync` 首次 28／29 通过，仅新源文件 JSDoc 失败，修正后 `verify-export-jsdoc` 单项通过；新请求 API 的最终完整 doc-sync 尚待执行。全仓 `lint:contracts-ready` 连续十多分钟占用近全部 CPU 后终止，保留为未完成；不能以定向 lint 通过关闭 G03。高负载并行和串行 Simulation 产品测试曾触及原 5 秒上限；停止全仓 lint 后旧行为测试全部通过，新 requests 测试的多余 undefined 参数断言已修正，最终产品复验仍待完成。创建浏览器批次因测试选择 100000 token 额度而达到真实预算停滞，保留生产准入不变，将该完整场景用例的配置改为模板内 500000 后待复验。

最终模板／流程复验使用生成 API catalog 后的 `pnpm run build`：`CLOCKY_SNAPSHOT=replay pnpm run test:web:built apps/web/tests/simulation-administration.snapshot.ts apps/web/tests/simulation-task-workflow.snapshot.ts apps/web/tests/simulation-maintenance.snapshot.ts` 三个文件、8 项全部通过（84.65s）。公司模板采用可完成该脚本场景的 500000 token 区间额度，保留原预算准入；四种创建／执行组合覆盖表单预检、原额度、原响应丢失、重新认证清理及完成。维护复验继续核对检查点／恢复与原记录。新 [独立进程浏览器用例](../../apps/web/tests/simulation-process-restart.snapshot.ts) JSON／SQLite 两项通过（67.09s）；每个 backend 使用四个独立 Node PID，在创建受理、Native 完整检查点与规范审核提交三个点 SIGKILL 并等待退出，复用持久根／端口，旧 cookie 401，重新认证并沿 UI 发现／查询／明确重试原 commandId。冷审核先明确 restore；原报告／attempt／库存／检查点数量保持，最终暂停，Model.stream 入口为零。首次 JSON 用例等待审核条目过早，Native 正确拒绝未完成 attempt；改为等待“此尝试可以审核”证据后通过，未放宽生产规则。

最终 `pnpm exec vitest run packages/simulation/simulation-product --fileParallelism=false` 33 个文件、310 项全部通过（86.71s），保持原测试时限和断言。更新后的 `pnpm run test:gui` 347 个文件、4394 项通过（1 项跳过，44.81s）；`pnpm run doc-sync` 29／29 通过（43.54s）；相关源文件 lint、严格 UI 静态审计及 `git diff --check` 通过。全仓 lint 仍因长时间满载后主动停止而未完成，不以这些检查关闭 G03；真实外部模型、跨 Host、全部尺寸／语言／主题／键盘和维护故障矩阵仍未证明。上述证据不覆盖随后开发中的独立 actor／频道拓扑。

E07c 的 [单一拓扑解析](../../packages/simulation/simulation-product/src/scenario-topology.ts) 对额外 actor／频道及完整成员集合校验，准备、路由、原创建保存、容量和 ingress 共用结果。所有 actor 继承同一受信任部署配置，频道不接受额外 grant／provider／能力。JSON／SQLite 新拓扑测试验证第三独立 reviewer、准确 audit 报告、3 个 Session／2 个频道完整检查点、部署改名后原拓扑不变、cold restore 和未经授权 reviewer 拒绝；局部 prepare 投递失败只继续原身份。`pnpm exec vitest run packages/simulation/simulation-product --fileParallelism=false` 35 个文件、317 项全部通过（90.36s），相关源文件 lint、导出 JSDoc 通过。`pnpm run build` 集成通过；初次 TypeScript 拒绝测试向 readonly config.templates 赋值，改为测试自有可变配置而未削弱生产 readonly 类型。

最终 [报告浏览器用例](../../apps/web/tests/simulation-task-workflow.snapshot.ts) 4 项通过（12.13s）：原双实体及新三实体／audit 频道，均使用 JSON／SQLite。真实表单以 maxEntities2 预检拒绝实际 3 个 actor，不分配 run；maxEntities3／零 token 创建后，独立审核人／报告 channel 与双方 receipt 一致，冒用 buyer／supplier 审核拒绝且规范任务不变。第三实体出现在授权单目标 ingress。Python SDK 全套 233 项通过（8.94s），ingress 目标上限与 Host 同为 32，exact32／oversize33 及额外 authorityGrant 拒绝已覆盖。

E07d／D08a 的 [原生输入回归](../../packages/simulation/simulation-product/tests/workflow-ingress.spec.ts) 两项通过：工作流完成后，暂停时未来 auditor 输入保持 pending；显式继续在 `9007199254740993` 消费，decision.ingressId、原 receipt 与冻结中文正文对应，任务／报告／资源／模型不增加，原输入重试不增加 decision 或改变暂停。最终 [独立进程浏览器用例](../../apps/web/tests/simulation-process-restart.snapshot.ts) 两项通过（70.63s），已替换为三实体／两频道并保留每个 backend 的三次 SIGKILL。复验完整拓扑恢复与原受理身份后，真实 UI 在超安全整数 tick 提交／继续／消费输入，刷新后准确显示十进制值和 tick unit；暂停后的同输入重试在已处理响应丢失后通过原查询对账，payload 两次完全相同，driver／inFlight／决策／任务／报告／库存及模型流入口不变。测试显式等待当前可审核证据和稳定终态 CommandRecord，截图来自同一运行最终状态；只读 helper 提供观测，不产生业务结果。

拓扑阶段 `pnpm run doc-sync` 29／29 通过（48.89s）。本轮不执行覆盖率冲刺或 UI 美化；完整中英／主题／缩放／键盘、跨 Host、真实外部模型和全部并发／权限故障矩阵仍由 plan 保留。开始确认文案区分会推理的模型策略与无推理的确定性报告，避免对零预算模板作模型请求承诺。

本轮收尾复核：最终 `pnpm run build` 通过；相关所有者源码／新浏览器测试 lint 通过（报告浏览器测试的格式问题已机械修正）；`pnpm run doc-sync` 29／29 通过（74.89s）。与文档构建同时运行的 GUI 批次出现原 `api-proxy-teams.spec.ts` 默认本地拓扑 fetch 场景 5 秒超时；保留原时限，单独复验 619ms 通过，再独立运行整套 `pnpm run test:gui`：347 文件、4394 项通过、1 项跳过（35.83s）。最后公司 Web 创建／控制四种组合再次通过（15.51s）。全仓 lint 仍保留未完成，不将定向检查或本批次通过提升为完整矩阵／覆盖率通过；用户工作树原有改动未清理，未创建提交、推送或 PR。

## 2026-10-01 · A–E 剩余验收实施批次

本批次目标为关闭 A04、B09–B11、C06、D07–D08 与 E08 全范围，尚未完成。逐项证据映射位于 [Team](acceptance-team.md)、[Simulation 读取](acceptance-simulation-read.md)、[行政／时间预算](acceptance-simulation-administration.md)、[执行](acceptance-simulation-execution.md)，完成状态仍只维护于 plan。浏览器矩阵使用隔离 profile 的真实 Chromium `tabs.setZoom`／`getZoom=2`，已实测物理 1440 对应 720 CSS 视口和 DPR2；不使用 CSS zoom 或仅改变 DPR 代替原生 200%。

D08b [真实时钟／permit 测试](../../packages/simulation/simulation-product/tests/administration-clock-budget.spec.ts) JSON／SQLite 四项通过。三 run 竞争全局两个 permit，全部 paused/time 不推进时各 absolute deadline 仍取消对应 decision；前两个流 abort 后等待 cleanup，active 保持 2，第三排队请求最终按自己的 deadline 取消且不生成第三模型调用。各 deadline 独立，测试须等三 decision 都 timeout 后才能认定 queued=0。cleanup 完成后许可归零，partial usage 7/2 记 unknown 并保留 10000 占用，而非确切消耗 9；各 run 额度独立。区间 token 上限 10000 实际只允许一个请求，下一预留产生持久 SIM_BUDGET_LIMIT，旧 running 原请求不重推理，新继续拒绝。结合 Native tokens 测试 14 项通过，原时限未放宽。

行政 [真实进程 checkpoint 维护／损坏回归](../../examples/simulation-company/tests/product-maintenance-recovery.snapshot.ts) 与 [Session header 篡改](../../examples/simulation-company/tests/checkpoint-corruption.snapshot.ts) 两文件十项通过：四个真实退出位置保留原 cut／当前事实；实际损坏字节在恢复拒绝后不被修复或覆写，精确修复后不重推理。对应 D07 浏览器禁用／未知结果／权限和清理矩阵尚待本批次执行。

完整 E08 暴露报告已送达后缺少安全续接及 Simulation 专属任务取消两个功能缺口。原生 reportContinuation 和取消 fence 正在实施，Native journal 46、行政 journal 2；只允许从同 run／原 task source／actor／Session／已退休 attempt 的精确上下文、原报告及 canonical receipts 恢复，不以安全阻塞缩小合法恢复范围。取消通过 Core／Hub／Simulation 专属 proof，不开放普通 Team 写入口。产品／Host／SDK／Web 输入仅包含原 operation、准确 revision、显式 nullable attempt fence 和原 command 身份，未知结果保留原请求，不再次分配 ID。产品 [取消测试](../../packages/simulation/simulation-product/tests/task-control.spec.ts) 三项与 UI [原取消输入测试](../../packages/client/ui-simulation/tests/task-controls.client.spec.tsx) 四项通过；真实故障／浏览器与 SDK 完整快照仍待最终集成。

## A/B Team

<details>
<summary>实现范围记录（46 条）</summary>

- A：离页负责人在名称未加载时仍显示已分配。

- A：已选的离页或缺失依赖可显示、移除并提交完整集合。

- A：空产物／工作流保留模块、空态与刷新入口；读取失败与成功空结果分开。

- A：已知 Team 权限拒绝按明确类别返回，不统一映射为内部错误。

- B：依赖选择器独立提供有界服务端搜索、分页与取消状态；Host、TS／Python 查询协议已扩展。

- B 待处理排序：Hub 写入不可变任务 `createdAt`，校验首次 journal 时间、后续 revision 与检查点生命周期；创建重试／编辑不改时间。Team journal/checkpoint format 38，拒绝旧格式。

- B 待处理读取：Core/Hub 提供完整总量、固定优先级、revision 续页与字节额度；Host 在 IO 前后校验直接／规范父团队读取权限。runtime 为预览／完整列表独立保留页面，取消旧请求并处理断线／权限失效。

- B 待处理导航：概览独立读取 Team 预览与权威总量，失败仍可查看全部；待处理模块独立分页，失败保留内容与过期提示，URL 重载恢复模块，任务／团队阻塞精确定位检查页。

- B 人工请求详情与有界草稿：`team.action.inspect` 在 IO 前后鉴权，返回当前请求／处理状态，已处理请求只读。runtime 拒绝过期 Team／答复事实及旧代际响应。表单须核对当前请求；关闭、模块／Team 切换、后退／重连保留输入及同 payload 重试身份，容量拒绝保留旧输入，丢弃须确认；重载／离开有提示，账号／权限替换清除内存草稿。真实提问工具、两种响应丢失、重试、凭据轮换与 390px 已验证。

- B 任务表单草稿：创建／编辑／审核／整合按 Team、操作、任务隔离保存全部原始字段、初始 revision 与创建重试身份，共用已有数量／UTF-8 额度。关闭、模块／Team 切换、后退／重连保留输入；丢弃须确认，提交确认后清理，页面离开有保护，账号／权限清理已接入。恢复先读取精确任务，不自动更新旧 revision。真实 Host 验证编辑恢复、重新确认及创建成功但响应丢失后的同 key 重试，仅创建一个任务。

- B 精确依赖状态：Core／Hub 按任务 ID 返回标题、revision、生命周期及保留的删除 tombstone，不区分未知／跨 Team ID。offset 绑定输入向量，固定 Team revision，输入／完整响应均有字节额度。Host 在 provider IO 前后鉴权；runtime 按配置容量／批量原子读取，隔离替换、撤销与旧响应。

- B 冲突字段与删除依赖：逐项比较当前／待提交名称、完整说明、精确依赖列表；过期事实先刷新，保留草稿并明确核对当前 revision。删除／不可用依赖保留已选且可移除，未核对或未移除禁止提交，不自动改写依赖。

- B 更新受理身份：`commandId`、规范化输入、精确作者、原 expected／applied revision、受理时间原子落盘；同作者／payload 重试不追加 revision，其他 payload 拒绝。终态命令数／私有结果字节有配置上限；后续任务推进、JSON／SQLite 检查点恢复保留原 metadata。

- B 更新结果查询：Host `team.task.update.result`、SDK `team/task-update-result` 在 provider IO 前后鉴权，含失败；TS／Python client 校验精确原身份。runtime 丢弃取消、Team／授权代际替换后的旧响应，以已受理 revision 保持旧任务字段过期。`not-found` 仅表示当前未找到，不自动重发或判为失败。

- B 受理后响应丢失恢复：更新前保存完整原 payload／command ID，关闭保留，重开可明确查询／重试精确原请求。组件验证后来编辑不改变原重试；确认原更新后保留新字段，核对当前 revision 才创建新 ID。当前构建真实 Host 验证落盘后丢弃响应、重开查询且只更新一次，桌面／390px 截图已检查；完整生命周期矩阵未完成。

- B 更新终态拒绝：权限／policy 通过后，既有任务 fold 识别版本不匹配、工作流归属、活动执行、无效编辑，先追加原拒绝再返回确定错误，不改任务字段／revision。条件改变仍保留同 ID 原拒绝，其他 payload 不得复用 ID；追加失败不声称拒绝，检查点失败保留已写入拒绝。JSON／SQLite、历史恢复及伪造拒绝 record 已验证。

- B 拒绝表单修正：确定错误或精确查询确认拒绝后，保留全部字段／原提交输入；相同语义／revision、仅改空白均不能创建新 ID。修改字段或明确核对新任务版本后可重新提交，关闭重开保留修正输入。依赖拒绝定位已选依赖字段并显示相邻错误；过期／身份不匹配结果不能清除原输入。实际 Host fetch／当前 lib 浏览器验证拒绝响应丢失、查询、390px、关闭重开、修正后单次更新及原拒绝可查。

- B 写入前未知结果：真实浏览器在请求送达前断开；查询 `not-found` 不判为失败、不另建 ID，保留后来输入，明确重试原 payload／ID 只执行一次。确认原受理、核对当前 revision 后才用新 ID 提交后来输入；真实任务 revision 与两份说明分别验证。

- B 不可编辑阶段草稿入口：任务摘要独立提供精确 Team／task 的保留编辑入口，覆盖执行／取消／删除状态，不借用新编辑菜单。当前 Team 操作资格独立限制提交／原请求重试；规范父团队只读、终态 Team、无管理回调仍可查询原结果。

- B 人工审核调度：active human reviewer 无需 Agent activation，不误判为无可执行成员。

- B：Host 按当前授权、provider、调度器与生命周期计算任务能力；表单据此禁用，失败保留输入，提交重新鉴权。

- B：成员参与资格／执行就绪度分开；观察真实 route/provider、容量、运行所有者与恢复责任。

- B：部署执行配置目录／选择器；选择不启动执行，撤销／不匹配配置不能登记。

- B：有界身份解析，名称缓存按连接、主体代际、Team/成员隔离；权限失效清理，旧响应不覆盖新上下文。

- B：任务／概览／尝试／频道成员引用可打开详情、复制完整 ID；剪贴板失败不报成功，离线提示名称未验证。

- B：身份查询／成员详情路径检查授权，含读取中撤销；普通网络失败保留可用旧内容。

- B：全 Team 任务搜索／状态筛选使用独立有界 Host 查询；明确提交、即时清除／焦点恢复、IME 防误提交、URL 重载恢复、分页失败保留均已验证。

- B：深链读取等待连接握手完成；延迟握手保留工作流选择，断线取消旧恢复并保留 URL。

- B：规范父任务 reservation 授权 child Team 只读检查，支持名称／就绪度／成员详情／深链恢复；不继承修改、取消、恢复或同意权限。

- B：选中 Team 的 15 条读取路径（元数据、成员绑定、任务／工作流、集合、人工事项、审计、静止状态）在存储调用前鉴权、返回前复查。

- B：Host 取消遇已知清理进度结果，查询原持久取消 key 并重新鉴权，返回受理状态／当前 phase；无意图或无关错误不报成功。

- B：Web Team 目录按当前主体过滤，只返回有界摘要，隐藏 grant、goal budget 正文与物理扫描计数；加密游标绑定主体／凭据代际，过期保留页面且须显式回首页恢复。

- B：原始频道读取／等待、产物字节在 provider IO 前后复查授权；频道拒绝不暴露查询所得 Team 身份，撤销不返回已读内容。

- B：Team Session 列表／搜索、历史、模型元数据、图片按当前成员或规范父团队权限过滤，检查精确持久成员／Session 绑定；header 不能自授访问，读取中撤销不返回正文。

- B：Mux／Host Session 帧保留发出时归属，Team／频道数据帧送达前逐次鉴权；HTTP／WebSocket 传递完整认证上下文，认证／binder 退役结束空闲订阅，数量／字节超限终止积压流。

- B：已知 Team 撤权清理对应 Team／Session 内容、投影及持有 fiber；Host 授权 scope 替换清理全部 Session 状态，旧列表响应不能重新发布。

- B：仅有 `parentSession` 的后代沿持久 header 祖先链解析 Team 权限；缺失／循环链在正文 IO 前拒绝，列表保留派生 Team 身份供撤权清理；显式 Team header 仍须自身绑定。

- B：工作区响应／广播过滤当前不可读 Session／归档引用，已知不可读引用禁止重排／归档；撤权／主体替换清理引用缓存，旧列表／修改回执／后到帧不能恢复。

- B：Session ZIP 根／后代／媒体分别在 IO 前后鉴权，每个压缩输出块复查；认证／source 退役取消生产，完成／取消清理 reader，失败不暴露 backend 诊断。

- B：事件队列上限含等待鉴权帧；等待中超限，持有帧／剩余积压均不送达。

- B：七类归属 Session 的 remote 转发事件按当前权限送达；请求结算、package 公布／撤回携带生产者派生的所属 Session，无关联缓存或公共事件回退。

- B：明确 HTTP 访问拒绝、产品拒绝、WebSocket 认证退役清理 Session／Team／工作区业务缓存及首次输入草稿；握手完成、授权重置后才分发该代际帧，旧代际帧不能回写；普通断线保留可读旧内容。

- B：SDK Team 目录复用主体 reader、安全摘要、加密续页；TS／Python 协议移除 grant、goal budget 正文与物理扫描计数。

- B：SDK 选中 Team 的成员、任务／工作流、审计、静止状态、产物、原始频道读取／等待，在 provider IO 前后复查直接／规范父团队权限，含失败；selection 标记只读来源，不继承修改权限。

- B：SDK 通知队列含等待鉴权／输出排空帧，字节按完整 JSON-RPC 包装、换行、UTF-8 计算；超限取消排空等待、释放运行时并退出。11 项队列回归及模块每文件 100% 覆盖率通过。

- B：SDK 管理通知按当前直接／规范父团队权限送达；Session 流验证持久成员绑定／祖先链，远程 activation 只用精确已发布 Agent 的来源／接纳主体。回归覆盖空闲凭据／provider 退役、旧代际响应、帧数／字节超限、完整最终通知送达；当前构建 JSON-RPC／真实 Web 工作区场景通过。

</details>

<details>
<summary>分项验证与源码定位（23 条）</summary>

### A、依赖编辑与有界查询

源码／测试：[组件回归](../../packages/client/ui-team/tests/task-workspace.client.spec.tsx)、[集合浏览器场景](../../apps/web/tests/team-collections.snapshot.ts)、[独立查询测试](../../packages/client/runtime/tests/task-query.client.spec.ts)

当前构建上的 keyless 集合浏览器场景通过，包括离页依赖编辑、空模块、分页失败保留及窄屏

### 能力感知表单

源码／测试：[能力浏览器场景](../../apps/web/tests/team-capabilities.snapshot.ts)、[能力观察测试](../../packages/client/runtime/tests/task-capabilities.client.spec.ts)

默认配置、读取失败、输入保留及实际 shared 任务创建已验证

### 就绪度、执行配置与身份

源码／测试：[真实调度与身份浏览器场景](../../apps/web/tests/team-member-readiness.snapshot.ts)、[配置注册测试](../../packages/core/team/tests/execution-profiles.spec.ts)、[身份缓存测试](../../packages/client/runtime/tests/identity-resolver.client.spec.ts)

已验证真实 activation/attempt 与任务报告、离页名称、详情、复制和断线恢复；不能据此宣称 Simulation executor 已完成

### 成员详情授权与复制

源码／测试：[Host Team API 测试](../../packages/host/apiproxy/tests/api-proxy-teams.spec.ts)、[详情组件测试](../../packages/client/ui-team/tests/member-detail.client.spec.tsx)

未授权主体、读取途中撤销、剪贴板拒绝与成功均有回归

### 全 Team 搜索与深链握手

源码／测试：[主表](../../packages/client/ui-team/src/client/TaskWorkspace.tsx)、[查询 owner](../../packages/client/runtime/src/client/teams/task-query.ts)、[集合浏览器场景](../../apps/web/tests/team-collections.snapshot.ts)、[连接时序回归](../../packages/client/ui-team/tests/apply.client.spec.tsx)

94 项定向测试通过；查询 owner 定向覆盖率 100%；当前构建上的真实 Host/keyless 集合场景通过，覆盖搜索重载、IME、清除焦点、读取失败与延迟握手后的工作流恢复

### 父/子 Team 授权读取

源码／测试：[JSON/SQLite 委派测试](../../packages/team/team-hub/tests/task-delegation.spec.ts)、[Host 路径矩阵](../../packages/host/apiproxy/tests/api-proxy-teams.spec.ts)、[精确字节测试](../../packages/team/team-hub/tests/selection.spec.ts)

218 项相关 provider/Host/TeamRun 定向测试通过；新增 Host 矩阵及取消对账收尾后该 Host 文件 61 项通过。覆盖逐次鉴权、跨主体／未认证拒绝、原目标 fingerprint、撤销、缺失／私有 Team 同义拒绝及服务端修改隔离

### 子 Team 导航回归

源码／测试：[真实 Host 场景](../../apps/web/tests/team-child-navigation.snapshot.ts)

当前构建的真实 Host/keyless 场景通过；真实 child activation/model 从生产路径启动，仅替换外部模型流。验证只读进入、重载、成员详情、服务器拒绝父主体的 child 修改、390px 窄屏、导航不增加推理以及父／子取消收尾。集合场景也通过

### 目录与原始读取隔离

源码／测试：[Host 回归](../../packages/host/apiproxy/tests/api-proxy-teams.spec.ts)、[目录与 cipher 测试](../../packages/team/team-hub/tests/product-directory.spec.ts)、[reader 生命周期](../../packages/team/team-human-actor/tests/human-actor.spec.ts)

118 项 provider/Host/reader 定向测试通过；目录模块每文件覆盖率 100%；相关 client/Host 174 项通过；完整 GUI 4101 项通过，1 项按既定条件跳过。当前构建的频道、集合与 child 导航共 6 个真实 Host/keyless 场景通过

### Team Session 与订阅隔离

源码／测试：[Host 读取与队列回归](../../packages/host/apiproxy/tests/api-proxy-teams.spec.ts)、[fetch 载体回归](../../packages/host/apiproxy/tests/fetch-carrier.spec.ts)、[WebSocket 回归](../../packages/client/connection/tests/websocket-downlink.host.spec.ts)、[Session runtime 回归](../../packages/client/runtime/tests/sessions-service.client.spec.ts)

Host／reader／配置 119 项、载体／连接 72 项、相关 client runtime 143 项通过。覆盖双主体、假 header、IO 撤销、排队过滤、空闲退役、数量与字节超限、Team 清理及主体替换后旧响应；真实 HTTP 和 WebSocket 调用上下文均已验证

### Team Session 真实页面流程

源码／测试：[工作区浏览器场景](../../apps/web/tests/team-workspace.snapshot.ts)、[child 导航](../../apps/web/tests/team-child-navigation.snapshot.ts)、[频道场景](../../apps/web/tests/team-channel.snapshot.ts)

当前构建的 6 个真实 Host/keyless 场景通过。工作区场景验证成员 Session 读取与返回、任务更新通知和失败重读、协调会话发送／流式回复、返回后的输入保留、URL 与全 Team 搜索保留、中英／明暗和窄屏；等效缩放截图不替代真实 200% 浏览器缩放验收

### 工作区引用、Session 祖先与 ZIP

源码／测试：[真实 Hub 授权测试](../../packages/host/apiproxy/tests/api-proxy-teams.spec.ts)、[ZIP 流测试](../../packages/host/apiproxy/tests/session-export.spec.ts)、[工作区缓存回归](../../packages/client/runtime/tests/workspaces-service.client.spec.ts)、[真实页面下载](../../apps/web/tests/team-workspace.snapshot.ts)

5 文件 160 项定向测试通过，另 1 项等待鉴权期间超限测试通过。完整 GUI 4117 项通过，1 项跳过；当前构建 6 个真实 Host/keyless 浏览器场景通过，含认证 ZIP 下载。覆盖双主体过滤、修改响应、后代／媒体、根与附件 IO 撤销、缺失／循环祖先、旧基线／回执／帧隔离，以及合法请求取消和压缩背压

### remote 转发与认证退役

源码／测试：[真实 Hub 事件矩阵](../../packages/host/apiproxy/tests/api-proxy-teams.spec.ts)、[控制器握手](../../packages/client/connection/tests/connection.client.spec.ts)、[WebSocket 退役](../../packages/client/connection/tests/websocket-downlink.host.spec.ts)、[客户端清理](../../packages/client/runtime/tests/client-apply.client.spec.ts)、[凭据轮换浏览器流程](../../apps/web/tests/team-workspace.snapshot.ts)

16 文件 361 项定向测试和完整 GUI 4122 项通过，1 项 GUI 跳过。当前构建 child／频道 5 个场景及工作区 1 个场景通过；工作区调用实际本地 provider 轮换凭据，验证旧内容消失、认证后授权重读恢复，且不新增模型调用。七种转发事件双主体矩阵和生产者归属字段已验证

### SDK 目录与管理读取

源码／测试：[真实 Hub reader](../../packages/sdk/server/tests/product-reads.spec.ts)、[SDK 参数／媒体](../../packages/sdk/server/tests/server.spec.ts)、[共享产物投影](../../packages/sdk/server/tests/artifact-projection.spec.ts)、[真实 JSON-RPC 场景](../../examples/jsonrpc-agent/tests/sdk.snapshot.ts)、[Python 回归](../../python/sdk/tests/test_client.py)

SDK server/client/protocol 13 文件 241 项通过；Host／SDK reader 与媒体 86 项通过；Python 51 项通过；新增产物投影 2 项、每文件覆盖率 100%。当前构建的 GUI 4122 项和 6 个 Web 场景通过，1 项 GUI 按条件跳过；真实 JSON-RPC Team-final keyless 场景通过，安全目录和 selection 不新增模型请求。SDK 通知的独立证据见下一行

### SDK 通知、连接退役与最终结果

源码／测试：[真实 Hub 通知矩阵](../../packages/sdk/server/tests/product-notifications.spec.ts)、[队列回归](../../packages/sdk/server/tests/notification-queue.spec.ts)、[远程 epoch](../../packages/sdk/server/tests/activation.spec.ts)、[实际插件退出](../../packages/sdk/server/tests/plugin-apply.spec.ts)、[凭据 lease](../../packages/core/product-principal/tests/registry.spec.ts)

14 文件 137 项定向测试通过；通知队列和主体注册表每文件覆盖率 100%。当前构建的 Team-final JSON-RPC keyless 场景通过，完整通知保持原快照，并验证重新握手；真实 Web 工作区场景通过，覆盖凭据轮换、内容清理、重新授权且不新增模型调用。完整 GUI 4122 项通过，1 项按既定条件跳过；构建、改动文件 lint、`doc-sync` 29 项、`hygiene` 15 项通过

### 待处理排序的任务时间基础

源码／测试：[首次／不可变时间回归](../../packages/team/team-hub/tests/fold.spec.ts)、[真实集合浏览器场景](../../apps/web/tests/team-collections.snapshot.ts)、[持久格式](../../packages/team/team-hub/src/types.ts)

Core/Hub 76 文件 1271 项通过；Team／workspace／SDK 2666 项通过，另 2 个并行时超时用例按原命令单独复查通过。GUI 4122 项通过，1 项按既定条件跳过。当前构建的集合浏览器场景通过，覆盖创建时间、幂等重试和 UI 编辑后时间不变；类型检查、构建、改动源码 lint、`doc-sync` 29 项与 `hygiene` 15 项通过。未实现待处理列表或入口，不代表 B 待处理子项完成

### Team 待处理读取与 runtime

源码／测试：[完整投影](../../packages/core/team/tests/attention.spec.ts)、[JSON/SQLite 分页](../../packages/team/team-hub/tests/attention.spec.ts)、[Host 鉴权](../../packages/host/apiproxy/tests/api-proxy-teams.spec.ts)、[请求生命周期](../../packages/client/runtime/tests/attention-query.client.spec.ts)

20 文件 457 项集成测试通过；3 文件 21 项覆盖率测试通过，投影与读取器每文件覆盖率 100%。GUI 4137 项通过、1 项既定条件跳过；当前构建的真实 Loader 集合浏览器场景验证新 RPC 与 selection 总量一致。构建、类型、改动源码 lint、`doc-sync` 与 `hygiene` 通过。未替换概览 UI、未实现查看全部或人工事项详情，不代表整个待处理子项完成

### Team 待处理页面与人工审核等待

源码／测试：[页面组件](../../packages/client/ui-team/tests/team-attention.client.spec.tsx)、[实际 worker/report 浏览器流程](../../apps/web/tests/team-attention.snapshot.ts)、[调度器](../../packages/team/team-scheduler-dag/src/index.ts)

18 文件 153 项组件/runtime 测试通过，调度器 118 项通过。完整 GUI 4141 项通过、1 项既定跳过；另 1 项并行运行超时的 Host 场景按原命令单独复查通过。真实 Host/keyless 场景覆盖两个实际审核结果、预览失败入口、分页／重载、精确任务定位、390px、中英／明暗、reduced-motion 与键盘刷新。构建、类型、改动文件 lint、`doc-sync` 29 项、`hygiene` 15 项与 strict premium 静态审计通过；专用人工事项表单和真实 200% 缩放尚未验收

### 当前人工请求详情与答复

源码／测试：[表单](../../packages/client/ui-team/tests/team-action-dialog.client.spec.tsx)、[请求读取器](../../packages/client/runtime/tests/action-inspector.client.spec.ts)、[两种后端](../../packages/team/team-hub/tests/durable-human-action-replay.spec.ts)、[真实提问浏览器流程](../../apps/web/tests/team-action.snapshot.ts)

最终 23 文件 269 项定向测试通过；关键模块覆盖率检查 31 项通过，投影／读取器每文件覆盖率 100%。GUI 4157 项通过、1 项既定跳过，另 1 项并行超时的既有 Host 用例按原命令单独复查通过。当前构建两个真实 Host/keyless 场景通过，覆盖答复正文、草稿／重试身份、后退／重连、实际答复落盘后响应丢失、凭据轮换和 390px。构建、类型、改动源码 lint、`doc-sync` 29 项、`hygiene` 15 项、source-output 和 strict premium 静态审计通过；完整权限／视觉矩阵仍未验收

### 任务表单草稿生命周期

源码／测试：[表单与存储测试](../../packages/client/ui-team/tests/task-draft.client.spec.tsx)、[共享额度](../../packages/client/ui-team/src/client/workspace-store.ts)、[真实 Host 浏览器流程](../../apps/web/tests/team-task-draft.snapshot.ts)

新增 7 项生命周期测试通过，草稿模块每文件覆盖率 100%；完整 GUI 在 `--maxWorkers=4` 下 313 文件 4166 项通过、1 项既定跳过，原断言／5 秒测试时限保留。未限制并发的首次完整 GUI 有一项既有 Host 场景超时。当前构建的真实 Host 场景通过，含编辑／创建、模块／Team／历史、重连、响应丢失后的原创建身份、当前 revision 确认、原生离开警告、凭据轮换、390px 和零任务 attempt／模型请求。构建、类型、改动源码 lint、JSDoc、source-output、`doc-sync` 29 项、`hygiene` 15 项与 strict premium 静态审计通过；完整字段冲突比较与任务更新不确定结果仍未完成

### 精确依赖引用与冲突核对

源码／测试：[Core 投影](../../packages/core/team/tests/task-references.spec.ts)、[JSON／SQLite](../../packages/team/team-hub/tests/task-references.spec.ts)、[runtime](../../packages/client/runtime/tests/task-references.client.spec.ts)、[三字段组件](../../packages/client/ui-team/tests/task-conflict.client.spec.tsx)、[真实 Host 场景](../../apps/web/tests/team-task-draft.snapshot.ts)

4 文件 60 项定向测试与覆盖率通过，两个新投影／读取模块每文件 100%；Core/runtime/表单 97 项及 Host 鉴权 3 项通过，消费者／连接／schema 最终 125 项通过。完整 GUI 315 文件 4182 项通过、1 项既定跳过（4 workers）。当前构建浏览器验证完整比较、原始输入保留、具体删除 ID、禁止提交、390px 和用户明确移除后保存；检查截图已阅读。构建、类型、改动源码 lint、JSDoc、source-output、`doc-sync` 29 项、`hygiene` 15 项、strict premium 审计通过。更新持久 command 及全矩阵仍未完成

### 更新原受理与响应丢失恢复

源码／测试：[JSON／SQLite 与 durable 输入](../../packages/team/team-hub/tests/task-update.spec.ts)、[Core 协议](../../packages/core/team/tests/task-update.spec.ts)、[runtime 代际与最低 revision](../../packages/client/runtime/tests/team-tasks.client.spec.ts)、[保留新编辑](../../packages/client/ui-team/tests/task-draft.client.spec.tsx)、[Host 鉴权](../../packages/host/apiproxy/tests/api-proxy-teams.spec.ts)、[SDK 鉴权](../../packages/sdk/server/tests/product-reads.spec.ts)、[真实 Host 流程](../../apps/web/tests/team-task-draft.snapshot.ts)

receipt helper 定向 10 项测试及每文件 100% 覆盖率通过；最终 Core／Hub／SDK reader 14 项、消费者／授权 315 项和 runtime 70 项通过，Python SDK 52 项通过。完整 GUI 最终 315 文件 4191 项通过、1 项既定跳过（4 workers）；此前并行构建时既有 full-fetch 用例触发 5 秒超时，原时限／断言下单独复查及完整复查通过。当前 lib 构建的浏览器与 SDK team-final 两个 keyless 场景通过；补充最低 revision 后再次运行浏览器通过，桌面／390px 不确定结果截图已检查。构建、类型、定向源码／测试 lint、`doc-sync` 29 项、`hygiene` 15 项、source-output 与 strict premium 审计通过。全仓 lint 仍有其他文件错误；明确拒绝、不可编辑阶段入口及完整矩阵尚未完成

### 更新终态拒绝与修正提交

源码／测试：[Core／Hub 结果](../../packages/team/team-hub/tests/task-update.spec.ts)、[表单](../../packages/client/ui-team/tests/task-draft.client.spec.tsx)、[管理 IO 代际](../../packages/client/runtime/tests/team-tasks.client.spec.ts)、[实际 Host fetch](../../packages/host/apiproxy/tests/api-proxy-teams.spec.ts)、[当前 lib 浏览器](../../apps/web/tests/team-task-draft.snapshot.ts)

完整 Core／Hub 82 文件 1307 项通过，最终相关 109 项和消费者／Host／SDK 275 项通过，Python 52 项通过。19 项 receipt helper 与 16 项草稿测试分别验证每文件 100% 定向覆盖率；并行覆盖率输出冲突已用独立目录修复。完整 GUI 两次均为 315 文件 4203 项通过、1 项既定跳过（4 workers），最后一次包含相邻字段错误布局；最终相关测试也通过。当前 lib 真实浏览器两次通过，覆盖已写入拒绝的丢失响应、保留／关闭重开、修正、原拒绝不复活，以及未送达请求的原 payload 重试和后来编辑的再次核对；390px 相邻依赖错误截图已检查。构建、类型、定向 lint、`doc-sync` 29 项、`hygiene` 15 项、source-output 与 strict premium 审计通过；完整恢复入口和授权／视觉矩阵仍未完成

### 不可编辑阶段保留入口

源码／测试：[任务摘要](../../packages/client/ui-team/tests/task-workspace.client.spec.tsx)、[只读页面](../../packages/client/ui-team/tests/task-draft-entry.client.spec.tsx)、[原结果表单](../../packages/client/ui-team/tests/task-draft.client.spec.tsx)、[当前 lib 浏览器](../../apps/web/tests/team-task-draft.snapshot.ts)

3 文件 35 项定向回归通过；完整 GUI 316 文件 4212 项通过、1 项既定跳过（4 workers）。构建／类型、定向 lint、`doc-sync` 29 项、`hygiene` 15 项、source-output 与 strict premium 审计通过。当前 lib 的真实 Host 场景验证更新受理后丢失响应，再删除任务，显式刷新、独立打开草稿、保留说明、390px、禁止新编辑、查询确认与任务 revision 不变；截图已检查。被测试类型错误阻断构建期间启动的旧产物运行不计为通过证据。完整 grant／父团队／视觉浏览器矩阵仍未完成

</details>

## C Simulation 读取

<details>
<summary>实现范围记录（13 条）</summary>

- C Web 冻结来源面板与 Team 权限失效：上下文引用打开精确 sourceIndex，URL 重载／后退保留来源，定位与原文分页独立。runtime 持有唯一来源页，已知 Team 撤权（含规范父团队依赖）立即清正文并拒绝旧响应；配置的结算后轮询检查无通知的成员资格变化，不改原命令授权。来源续页绑定冻结决策版本，活动世界推进不重置历史原文，显式 expectedRevision 仍按当前观察校验。627 项相关回归、19 项最终来源／观察／路由专项、完整构建／最终 client 构建、11 个真实浏览器场景通过；JSON／SQLite 证明来源链接、定位、续页、运行推进、重载、390px、实际 Team 撤权与零模型回合。完整语言／主题／键盘／权限交互矩阵仍单独保留。

- C 冻结 Team Envelope 来源 API：Host／TS／Python 按保留决策的 sourceIndex 选择引用，不接受任意 Team／频道。实体 sources grant 与当前 Team 人工读取资格分别检查，成功／失败 IO 后复查；无权不暴露目标存在性。定位一次只读有界频道页，找到后按精确序号读取 Unicode 文本分片；来源、位置、revision、凭据与策略绑定续页，未知 payload 不透传，共用惰性分片和完整响应额度。357 项相关验证、54 项 Python、源码及当前 lib 的 JSON／SQLite 真实 Loader 读取通过，含默认删节、分步定位、撤权、世界不变；Web 来源面板及独立 Team 权限失效见独立完成子项。

- C Web 记录浏览与文件导出：runtime 独立持有元数据／原文分页，类型筛选与精确序号进入 URL，上下文 run-event 引用可直达原文。独立导出 owner 按固定 revision／策略重建全部匹配记录，限制完整 UTF-8 文件和数据页，结束前复查权限／总数；撤权、断线、换运行／类型、取消及不完整分片不生成文件，卸载排空读取。修复续页新增 expectedRevision 被误当筛选变化的问题。620 项相关回归、13 项最终导出专项、完整构建／最终 client 构建／Host 类型检查、9 个真实浏览器场景通过；其中记录场景在 JSON／SQLite 验证实际下载内容、取消、失败保留／重试、重载、390px 及原文撤权，窄屏原文续页补验通过。未扩展 UI 美化、覆盖率或非 run-event 来源读取。

- C 原始 run 日志读取与 SDK：原生只读观察显式返回已验证日志，产品／Host／TS／Python 支持精确序号、kind 筛选、revision／策略绑定分页和原始 JSON 文本分片。普通目录权限只读元数据，独立 `recordReaders` 授予自有运行的完整历史正文；撤销拒绝在途原文及旧游标，完整包装计入字节额度，分片惰性生成。333 项 Simulation 相关验证、1249 项传输／客户端验证、53 项 Python、完整构建、源码／当前 lib 各 4 个真实 Loader／SDK stdio 场景通过，JSON／SQLite 均保持运行事实和模型调用不变。Web 记录页及文件导出见独立完成子项，其他来源记录未完成。

- C 当前／精确已选知识与报告来源原文：Host／Web／TS／Python 的独立知识分区复用共享原生时间／当前受众／传递前提投影；决策精确引用限定原选择，旧版本不替换成最新版本。`content` 独立授予 context／knowledge／sources，报告原文核对保留通信／持久送达事实。策略或受众 revision 变化清正文并拒绝晚到旧响应，保留历史上下文权限语义。355 项定向（两 worker）、GUI 4286 项（1 既定跳过）、52 项 Python、当前 lib 三个真实浏览器、源码／lib 各两个 SDK stdio 场景通过，模型次数和浏览后的世界事实不变；原始事件／其他来源及导出仍未完成。

- C 运行／正文策略失效通知：Host／Web／TS／Python 提供有界长轮询，游标绑定主体／凭据／run／策略及服务生命周期，世界 revision 与读取策略独立。`context-readers` 贡献的撤销／恢复改变正文代际并唤醒等待，不卸载目录、行政 owner 或页面。runtime 清旧正文、取消并拒绝晚到旧标签响应；世界推进只标记页面过期，原命令、草稿及选择保留。328 项定向（两 worker）、GUI 4283 项（1 既定跳过）、51 项 Python、当前构建三个浏览器场景、源码／lib 各两项 SDK stdio 验证通过；实际策略撤销保持世界及模型次数不变，并保留后来输入草稿。

- C 实体关系与冻结决策上下文：Host／TS／Python／Web 共享独立分区，关系保留原半开时间区间，冻结上下文保留原投影／版本／来源。正文须有部署配置的主体／实体 grant，默认删节；纯文本按 Unicode 边界拆片，不支持的块不返回 payload，完整包装和续页受额度／观察 revision／凭据／服务生命周期约束。319 项定向、50 项 Python、三项实际 Host 浏览器、源码／当前 lib 各两项 SDK stdio 场景通过，查看不改变世界或推理数；不含当前知识／来源原文、事件导出或自动策略失效通知。

- C Web 集合筛选与详情分页：四集合状态／实体认知筛选进入有界 Host 查询及 URL，关联实体／决策跳转，展示操作结果／依赖／真实时间、上下文计量及绑定元数据；发布尝试／检查点来源独立续页，读取失败保留内容，切换运行取消恢复来源旧请求。定向 30 项、GUI 4275 项（1 既定跳过）、当前 lib 三个真实 Host 浏览器场景通过，含 JSON／SQLite、筛选重载／后退、实际发布尝试、失败重读、来源分页及 390px 控件可用；不包含实体关系／私有正文／事件导出。

- C 只读历史：Storage 定义有界、分离的日志观察，由 JSON 原子文件／SQLite 读事务实现；Simulation registry/provider 独立解析检查现有历史，保持 writer ownership／phase／revision，不回退 open／create／restore。区分本 provider／其他 owner／未持有／不可确认；拒绝错误 spec／medium、损坏／不完整历史、超额。SQLite WAL／SHM 仅作读取辅助，不是业务写入；此项不代表产品目录／授权 API 完成。

- C 只读产品目录／Host：opt-in 持久登记绑定不可变 provider/run spec 与所属认证主体，重启复用原身份／时间；加密分页绑定查询、目录 revision、凭据代际、服务生命周期。公开 DTO 删节私有配置／知识／路径，保留精确模拟时间；详情 IO 前后鉴权，不打开执行所有者。独立有界读取准入、卸载排空、provider 缺失／重挂载、完整响应字节限额已实现；不含 Web 页面／行政操作／SDK 管理。

- C 分区元数据／精确对象详情：`simulation.collections.list` 提供实体／决策／操作／检查点筛选页与权威总量；`simulation.objects.inspect` 提供精确 section，attempt／检查点引用独立分页。续页绑定运行 revision、集合／对象、筛选及凭据，过期明确要求刷新；完整外层包装计入额度。slot／epoch／时间保持精确十进制，私有正文／诊断删节；效果、发布、输入持久化、receipt、任务创建与历史送达失败分别表示，检查点完成不声称当前来源已验证。

- C Web 初始读取：独立仿真入口、运行目录、元数据模块及实体分页／精确详情已接入；真实 Host 验证 URL 重载、390px 与浏览不改变世界事实。runtime 保存有界业务响应，普通断线保留，认证替换／拒绝清理；读取替换、取消回调和状态观察回调不能发送或发布旧请求。完整功能／授权及视觉矩阵仍未完成。

- C SDK 产品读取：SDK 共用已认证产品目录、运行概览、四类有界集合及精确对象 section；TS／Python 校验精确 run／集合／对象／section／revision，保留十进制字符串，拒绝私有字段及跨集合参数。读取不 open／restore／drive，认证替换后旧响应拒绝。

</details>

<details>
<summary>分项验证与源码定位（8 条）</summary>

### C 知识／已送达报告来源

源码／测试：[共享原生可见性](../../packages/simulation/simulation/src/knowledge-query.ts)、[有界知识投影](../../packages/simulation/simulation-product/src/knowledge-details.ts)、[精确版本／撤销](../../packages/simulation/simulation-product/tests/knowledge.spec.ts)、[Web 知识页](../../packages/client/ui-simulation/src/client/KnowledgeDetails.tsx)、[真实来源授权](../../apps/web/tests/simulation-maintenance.snapshot.ts)

355 项定向、GUI 4286 项（1 既定跳过）、52 项 Python 通过。源码／当前 lib SDK 各两场景验证缺省删节与不相关精确引用缺失；当前 lib 三个实际浏览器验证原生报告记录、知识／来源权限分离、撤销／恢复与后来草稿保留。Native JSON／SQLite 证明原冻结版本不替换、当前撤销拒绝历史检索、精确 Unicode 分片及世界不变；既有深前提撤销回归沿用共享规则。完整构建、doc-sync 29 项、定向 lint、strict premium、源输出及 whitespace 通过；完整事件／其他原始来源及导出仍未完成

### C 有界失效／独立正文策略

源码／测试：[Host 等待](../../packages/simulation/simulation-product/src/index.ts)、[独立策略插件](../../packages/simulation/simulation-product/src/context-readers.ts)、[客户端观察](../../packages/client/runtime/src/client/simulations/observer.ts)、[旧响应回归](../../packages/client/runtime/tests/simulation-observation.client.spec.ts)、[实际策略撤销](../../apps/web/tests/simulation-maintenance.snapshot.ts)

328 项定向、GUI 4283 项（1 既定跳过）、51 项 Python 通过。当前 lib 的三个浏览器场景、源码／lib 的 SDK stdio 各两项通过；真实 Loader 撤销／重挂策略贡献后正文自动删节／恢复，目录、世界／模型次数和后续草稿保持。完整构建、doc-sync 29 项、定向 lint、strict premium、源输出及 whitespace 通过；hygiene 为 14 通过、1 失败，失败为当前根 AGENTS 文案不匹配 rescope 固定编辑，未修改用户指令或 vendored 文件来绕过

### C 关系／冻结上下文分区

源码／测试：[授权读取](../../packages/simulation/simulation-product/src/index.ts)、[冻结投影](../../packages/simulation/simulation-product/src/context-details.ts)、[安全及时间回归](../../packages/simulation/simulation-product/tests/context-and-relations.spec.ts)、[Web 分区](../../packages/client/ui-simulation/src/client/ContextAndRelations.tsx)、[真实 SDK](../../examples/simulation-company/tests/sdk-maintenance.snapshot.ts)

319 项定向、GUI 4279 项（1 既定跳过）、50 项 Python 通过。实际 JSON／SQLite browser 与只读目录共三场景验证关系分页／深链、获准生产正文、独立上下文分页及世界／模型计数不变；源码／当前 lib 的 stdio 各两场景验证默认删节、空关系及跨页选取。完整构建、doc-sync 29 项、定向 lint、strict premium、源输出及双语配对通过。默认所有正文删节，独立 grant 只覆盖所属运行的指定实体历史上下文；当前知识／来源原文和自动策略失效仍未完成。检查点读取曾先返回受理状态，浏览器验证现持续查询同一原命令至终态

### C Web 元数据筛选／独立详情分页

源码／测试：[查看选择](../../packages/client/ui-simulation/src/client/selection.ts)、[详情](../../packages/client/ui-simulation/src/client/ObjectDetails.tsx)、[组件回归](../../packages/client/ui-simulation/tests/object-details.client.spec.tsx)、[浏览器读取](../../apps/web/tests/simulation-workspace.snapshot.ts)、[生产来源分页](../../apps/web/tests/simulation-maintenance.snapshot.ts)

30 项定向回归与 GUI 4275 项通过，1 项既定跳过；当前构建三项真实 Host 浏览器流程通过，覆盖筛选空结果／URL 重载／后退、精确时间、实际 publication attempt、读取响应丢失后保留及刷新、决策／操作关联与完整检查点来源分页。JSON／SQLite 的世界 snapshot 和模型请求次数保持不变；390px 的返回、刷新及独立分页控件均在视口内。完整构建、定向 lint、strict premium、doc-sync 29 项、源码输出及 whitespace 通过。没有扩展覆盖率目标；私有正文／事件导出和完整矩阵仍未完成

### Simulation 只读历史基础

源码／测试：[存储额度与一致性](../../packages/storage/storage/tests/readonly-log.spec.ts)、[JSON reader](../../packages/storage/storage-json/tests/readonly-log.spec.ts)、[SQLite reader](../../packages/storage/storage-sqlite/tests/readonly-log.spec.ts)、[原生检查](../../packages/simulation/simulation-local/tests/inspection.spec.ts)、[真实 Loader snapshot](../../examples/headless-agent/tests/simulation-readonly.snapshot.ts)

Storage／Simulation 65 文件 1234 项通过；三个只读存储模块的定向覆盖率均为 100%。Simulation-local 41 文件 405 项通过，源／当前 lib 两种启动下的 JSON／SQLite 多进程 snapshot 各 2 项通过，证明另一个 owner 持有和释放后均可检查相同历史且不重开执行。构建、类型、定向 lint、`hygiene` 15 项与 source-output 检查通过。SQLite 的 WAL／SHM 辅助文件按官方语义允许，业务数据库／owner 文件、phase 和 revision 不变。新方法签名、配置与事件图已生成并配对；该基础不等于产品目录、ACL、唯一产品 owner 或公开 Web／SDK 读取层

### Simulation 只读产品目录／Host

源码／测试：[目录与授权测试](../../packages/simulation/simulation-product/tests/product.spec.ts)、[目录恢复](../../packages/simulation/simulation-product/tests/recovery.spec.ts)、[fetch 接入](../../packages/host/apiproxy/tests/api-proxy-simulations.spec.ts)、[生产凭据 Loader snapshot](../../examples/headless-agent/tests/simulation-product.snapshot.ts)

23 项定向回归、产品包每文件 100% 覆盖率、79 项相关 fetch／bundle 回归、完整 `pnpm run build` 及 source／当前 lib 的 JSON／SQLite 双进程场景通过。`pnpm run doc-sync` 29 项、定向 lint 和 whitespace 检查通过。`hygiene` 首轮 13 项通过，修复 manifest 文件清单与 knip 动态入口后，其余两个检查分别通过；publint 与 NodeNext 声明消费再次通过。原生 writer 持有／释放时精确观察，产品 reader 重启复用登记，读取不推理；Web 页面、分区详情和 SDK 管理尚未实现

### Simulation 分区元数据／精确 section

源码／测试：[集合与状态](../../packages/simulation/simulation-product/tests/collections.spec.ts)、[包装／选择器校验](../../packages/simulation/simulation-product/tests/collection-bounds.spec.ts)、[共享 Host 适配器](../../packages/host/apiproxy/src/simulation-product-api.ts)、[Loader 读取](../../examples/headless-agent/tests/simulation-product.snapshot.ts)

37 项定向回归，产品包／Host 适配器每文件 100% 覆盖率；相邻 fetch／原生 registry 共 77 项通过。完整构建、Client 编译、定向 lint、source／当前 lib JSON／SQLite 实际决策／资源转移读取、`hygiene` 15 项、`doc-sync` 29 项通过。知识／模型正文删节，当前来源验证未执行；关系、事件记录／导出、Web 页面及 SDK 未完成

### Simulation Web 初始读取

源码／测试：[客户端响应 owner](../../packages/client/runtime/tests/simulation-runtime.client.spec.ts)、[URL 视图状态](../../packages/client/ui-simulation/tests/store.client.spec.ts)、[真实 Host 浏览器](../../apps/web/tests/simulation-workspace.snapshot.ts)

当前 lib 真实 Host 主流程通过，验证两行目录、实体分页、精确十进制时间、实体详情 URL 重载、390px 及未改变原生 snapshot；相关客户端 17 文件 97 项通过，随后 runtime 6 项验证取消回调替换、清理依赖时的新选择及授权退休期间阻止重启读取。完整读写、授权、键盘／语言／视觉矩阵仍未完成

</details>

## C/D 产品集成

<details>
<summary>实现范围记录（5 条）</summary>

- C／D 运行目录状态、预算与跨模块控制：Host／TS／Python 对当前目录的精确有序 ID 批量读取，行数、输入和完整响应受限；单运行损坏显示不可用，凭据退役拒绝整批，读取不接管运行或推理。Native 的预算／驻留准入与公开指标共用算法，精确模拟时间、保留 token 占用／未知用量、待决策／外部操作与恢复槽位不混同 Host 实时共享模型池。目录显示场景／规则／策略版本、调度阻塞及在途工作；各模块共享控制头部，未知值不显示零。runtime 保留失败后的过期观察，切页／运行／主体及同步取消回调均隔离旧读取；单一正文滚动容器修复窄屏审核／输入不可达。最终构建、360 项定向客户端、90 项协议／Host／SDK、26 项 Native／产品状态专项、60 项 Python，以及当前 lib 的 JSON／SQLite SDK 两项通过；本次构建的六个真实浏览器文件共 11 个场景通过，含在途暂停跨六模块、实际共享 permit、目录批量刷新失败重读、390px 审核、输入、检查点与冷恢复。完整交互矩阵仍独立保留。

- C／D Simulation 关联 Team／任务／频道／精确 Session 导航与只读隔离：共享布局服务提供同文档读取链接及前进／后退，移除继承的写表单，保留私有草稿及原命令；历史 Session 核对原参与者／Session，不替换当前绑定。权威目录／选择标记来自原生不可变规则，Team 与 Session 隐藏普通执行、发送、修改及回答控件，Host／Hub 独立拒绝绕过仿真 owner 的人工写。修复无 coordinator Team 无法检查及退休无 cwd 的 Team Session 无法列出／读取：只读检查允许缺协调者，普通 open／start／resume 保留 bound 前提；冷记录仍在 IO 前后校验 Team 权限、持久 binding 及返回 header 归属，不放开普通无位置日志或通用 Agent 恢复。完整构建、增量类型检查、定向 lint、29 个 doc-sync 门禁通过；本轮 11 个真实浏览器场景通过，最终 lib 的 JSON／SQLite 维护场景另验证独立 Team 权限拒绝、退休 actor 记录、390px 精确深链、无输入框、返回及后来输入草稿保留，世界／模型次数不因浏览改变。4326 项 GUI（1 既定跳过）、141 项读取／权限、76 项无 coordinator runtime 及 36 项相关消费方回归有各自证据；全视觉矩阵、跨 Host／真实外部模型及公司审核场景仍单独保留。

- C／D 构建错误分类：Host／SDK 通过共享公开 code 识别跨独立入口的产品 Error；实际 lib 验证同 ID 不同 payload 明确 invalid，不误报 internal。未知诊断仍删节，分类器定向覆盖率 100%。

- C／D Web 原操作 owner：runtime 独立保留六类完整原命令及已知 receipt，捕获编写授权版本，原查询／明确重试不分配新身份；视图切换与普通断线保留，认证替换／退役清理，取消及晚到响应不能回写。配置数量／完整 UTF-8 额度包含临时结果／错误预留，超额保留原输入；未解决记录不能释放。读取及命令两个 owner 定向达到每文件 100% 覆盖率，纳入默认覆盖率范围。

- C／D Web 组合中的模型隔离：公司 preset 使用完整 Simulation persona，不继承编码部署的未拥有 cwd；role 在最终装配后过滤后来登记的 actor 自有 Team 工具，原生分发独立拒绝超出决策权限的工具声明且不消耗模型／token 准入，执行 guard 保留。真实 Web snapshot 固定 persona 并验证三工具及实际库存结果，独立查看权限不因行政控制拒绝而失效。

</details>

<details>
<summary>分项验证与源码定位（3 条）</summary>

### C／D 状态观察与安全指标

源码／测试：[共享 Native 算法](../../packages/simulation/simulation/src/metrics.ts)、[有界状态读取](../../packages/simulation/simulation-product/tests/run-statuses.spec.ts)、[共享模型池](../../packages/simulation/simulation-product/tests/model-pool.spec.ts)、[runtime 取消窗口](../../packages/client/runtime/tests/simulation-runtime.client.spec.ts)、[Web 状态组件](../../packages/client/ui-simulation/src/client/RunStatus.tsx)、[实际 Web 流程](../../apps/web/tests/simulation-administration.snapshot.ts)

当前 Native／产品、Host／SDK／Python及真实 stdio 读取已验证；最终客户端 35 文件 360 项与六个当前构建 Browser 文件 11 场景通过。首轮窄屏维护／审核因头部压缩正文失败，修复真实滚动布局后按原点击复验通过；未用 force click 或增加超时绕过。NodeNext 274 声明、constraints、publint、runtime closure、定向 lint 和源输出检查通过。源树中 92 个未跟踪编译残留已核对对应 TypeScript 与 source map，完整移入项目内备份后源输出门禁为零；没有删除源代码。预算指标包含保留占用，不能解释为完全已知的结算成本；未验证全视觉或性能矩阵。

### C／D Web 创建、控制与模型隔离

源码／测试：[runtime 回归](../../packages/client/runtime/tests/simulation-administration.client.spec.ts)、[读取回归](../../packages/client/runtime/tests/simulation-runtime.client.spec.ts)、[表单回归](../../packages/client/ui-simulation/tests/administration.client.spec.tsx)、[原生能力拒绝](../../packages/simulation/simulation-team/tests/lifecycle.spec.ts)、[真实浏览器流程](../../apps/web/tests/simulation-administration.snapshot.ts)

命令／读取 35 项、两个模块每文件 100%；组件／runtime 42 项、角色 4 项及每文件 100%；相邻 Simulation／SDK／Host 836 项通过，完整 GUI 4263 项通过、1 项既定跳过。当前构建真实 JSON／SQLite 创建／控制及只读查看共 3 个浏览器场景通过，含响应丢失、原重试、准确预算、在途暂停、实际库存、模型 persona／三工具、390px、重载及凭据轮换；预期凭据退役重连警告单独验证，其他 console error／告警拒绝。源码原生控制／维护／SDK 6 项及 Python 211 项通过。源码及当前 lib 的原生控制／维护／SDK 各 6 项通过；最终 build／client 与 web 构建、定向 lint、doc-sync 29 项、hygiene 15 项、NodeNext 274 声明、source-output、whitespace 及 strict premium 静态审计通过。截图已检查，390px 等待侧栏折叠后验证；此项不代表 Web 维护、自动任务或全目标完成

### C／D SDK 产品操作

源码／测试：[SDK 分发回归](../../packages/sdk/server/tests/simulation.spec.ts)、[TS 客户端回归](../../packages/sdk/client/tests/simulation.spec.ts)、[Python 回归](../../python/sdk/tests/test_simulation.py)、[真实 SDK 场景](../../examples/simulation-company/tests/sdk-product.snapshot.ts)、[跨入口错误分类](../../packages/simulation/simulation-product/tests/errors.spec.ts)

36 项定向 TS 回归、18 项 Python 回归通过；三个新增模块每文件 100% 覆盖；JSON／SQLite 源码与当前 lib 场景通过。SDK／Simulation 的 400 项与 Host 的 7 项 TS 回归、Python SDK 的 182 项回归通过；本机 macOS arm64 发行载体重建、runtime closure、constraints、publint、build、NodeNext（274 个声明 API）和 doc-sync（29 项）通过。Host 构建产物的 14 项创建／中断恢复场景通过；其他平台及整体功能仍未验收

</details>

## D Simulation 行政

<details>
<summary>实现范围记录（18 条）</summary>

- D 未知操作的产品对账与授权重试：Native format 45 保留精确原授权、受理时间、尝试次数及原 outbox 额度；同 ID 异载荷／陈旧首次次数拒绝，冷热重试不再追加额度。产品先持久保存原命令，按当前主体与维护队列复查权限，未确认的原结果可查询／精确重试；授权不发布、不推理或恢复调度，明确继续才按原目标身份对账。Host／TS／Python／Web 已贯通，元数据区分已确认结果与尚不需人工授权的 pending／in-flight 阶段。Web 提供有界未知操作预览及精确跳转，按运行／操作保留共享额度内的原因草稿、原命令和后来编辑，关闭／后退不覆盖原输入；失败修改与原查询独立。相关 Native／产品回归、93 项协议／Host／SDK、64 项 Python、109 项客户端、源码及当前 lib 各两项实际 JSON／SQLite SDK 场景通过；本次构建两项真实浏览器证明原回执及授权响应丢失后的恢复、390px 草稿、授权／查询零推理、原决策／模型预留／Session 输入身份不变、唯一 Envelope 与单次库存效果。检查点／恢复诊断见下一项，完整中断和交互矩阵仍保留。

- D 检查点／恢复的安全失败定位：规则检查和实际 IO 保留有限阶段／类别及规范 run／Team／频道／Session／实体／检查点引用；频道和 Session 携带精确 Team 绑定，正文仍独立鉴权。Native 失败记录及产品终态日志保存原诊断，清理未确认与主错误并列，不从 provider 文本推断类别，不公开私有路径或载荷；精确查询／冷重放不改变原失败或成功锚点。浏览器用纯视图显示诊断及精确只读导航。纯 wire 解析器与具有共享身份的错误类分开，构建门禁只允许解析器内联。168 项所属回归、61 项检查点生命周期专项、17 项 wire 纯度验证及实际两种后端 Browser 通过；实机触发 Session 引用读取失败，核对来源、私有错误隐藏和重挂行政服务后的同一原诊断，四项既有维护／审核 Browser 回归也通过。完整构建、NodeNext 274 声明、定向 lint、constraints、publint、runtime closure、源输出及文档门禁通过；全范围验收仍未完成。

- D 公司准备基础：生产模块核对未启动的 paused 拓扑，仅补做缺失 Team／实体／参与者／频道／资源，复用持久 reservation，发布初始完整检查点后排空临时 connection；准备不激活 actor、不推理。相同在途调用合并，已有事实不匹配拒绝，失败检查点保持原终态。真实 JSON／SQLite 进程中断及初始 manifest 恢复已验证；此项不包含公开创建命令、产品目录意图或场景 driver。

- D 公司采购 driver 基础：生产 `SimulationCompanyDriver` 在初始检查点之后，以有界合并批次完成请求／接受／库存转移／明确结果／已交付报告确认；通知及 ingress wake 独立处理。先驻留再冻结单 actor 窗口，沿用原生 permit／预算／工具；暂停保留 submitted 窗口，未提交的结束回合持久取消，排空等待已准入工作。真实模型工具链、单驻留、live 响应重试、三个进程中断点及冷恢复已验证；不含产品模板目录、唯一 owner 或后台 timer。

- D 创建命令／持久准备基础：显式 administration 插件提供已认证 Host catalog／create／prepare／request；严格部署模板、原请求／完整解析结果先落盘再登记／原生 IO，保留原身份和终态，独立新准备建立自己的检查点。JSON／SQLite 创建及六处进程中断后对账、等待者退役、容量／字节／追加失败／卸载责任已验证；启动和读取不打开运行或推理。此项不包含 SDK／Web 创建表单、调度 owner、后台管理、ingress 或公开 checkpoint／restore。

- D SDK 创建／准备／原结果查询：TS／Python 公开接口复用行政 owner、原日志、命令身份及权限；未部署明确 unavailable，`not-found` 不判为失败。真实 stdio／Loader 的 JSON、SQLite 源码与本次 lib 场景均验证单一身份、暂停、无推理、分页、重启查询／重试与独立再次准备检查点；不包含 SDK 调度、ingress 或恢复。

- D 已持有运行的调度 owner：成功准备后保留一个产品 owner；开始才挂接规范 Team connection，单一 timer 推进有界采购批次。按配置间隔／退避及原生真实重试期限推进；未知、恢复、阻塞和完成等待明确处理。暂停关闭后续准入，独立保留在途工作及停止原因；卸载取消受支持连接工作，排空模型／管理后释放 run，未确认关闭保留责任。此项不含冷 owner 接管／恢复或自动 TeamTask executor。

- D Host 调度控制／原结果查询：`simulation.runs.control/manage` 与 `simulation.management.get` 复用认证及原生持久有序管理身份；精确重试不撤销后来暂停，未知结果可查询。TS fetch 校验 run／管理 ID／原 phase；当前模型／实际 in-process provider、准备进度及检查点参与允许性，写入重查。冷读取及历史重试不 open／infer，新冷请求要求恢复；同 ID 冲突、原生终态追加丢失、回调后撤权和原生属性名 ID 均有回归。

- D 准备与调度共用队列：原准备失败保留，新成功准备使用自己的完整检查点作为启动依据；已挂接 scheduler 不被再次准备替换。真实源码／lib 的 JSON、SQLite 流程验证推理中暂停、原请求重试、新请求继续、库存转移、限定工具及冷重启只读查询；不代表已接入 Web 创建／控制表单或 SDK 调度。

- D Host 完整检查点与冷 owner 恢复：checkpoint／restore 命令在原生 IO 前写入原请求账本，复用原身份和不可变结果。采集关闭调度准入，取消／排空受支持推理，退休 actor 并发布原生完整 manifest，成功仍暂停；失败保留最近成功记录。恢复先核对兼容完整依据，复查 Run／Team／Channel／Session 与当前后缀，再退休旧 writer、建立暂停 owner，不回滚也不推理。原终态重试只返回历史结果，新恢复命令重新验证；未确认清理保留责任。

- D Host 单实体人工输入／消费查询：source 由认证主体派生，只允许 buyer／supplier，精确原 ID／payload 重试，不广播、不改变权限或调度 phase。原生 receipt 区分分配与 pending／claimed／consumed／cancelled，关联 decision，公开结果删节正文／主体；冷查询及原重试不 open／infer，新冷输入要求恢复。运行中的已完成采购可按精确模拟时间处理未来输入，暂停仍须明确开始。

- D 维护中断恢复矩阵：JSON／SQLite 真实 Host／Loader 流程覆盖产品受理、原生开始、原生完成和产品终态追加四处进程退出；重启后验证原检查点／后缀并完成原命令，保持库存及输入，退休旧 writer，无模型重放。相应源码及 lib 场景、原请求冲突／丢失结果、撤权、并发维护、清理不确定性均有证据；此项不代表跨 Host／真实外部模型验收。

- D SDK 调度与维护：TypeScript／Python 公开控制观察、开始／暂停、原管理结果查询、完整检查点、冷恢复、单实体输入及消费查询，复用行政 owner／原日志和认证 lease。严格核对原 phase、命令类型、恢复 checkpoint、输入目标／精确时间；不自动重试或另建身份。真实源码及当前 lib 的 JSON／SQLite stdio 验证消费关联决策、暂停后旧开始重试、完整采集、冷查询不持有 owner、旧依据／当前后缀恢复且不推理。

- D Web 模板创建与草稿：已安装模板选择、名称／精确库存、字段错误和 IME 防误提交；原输入与原创建身份在关闭／切换／断线保留，不写 localStorage 或 URL。响应丢失后查询／重试原请求，只登记同一运行；后来输入独立保留，放弃须确认且保留未解决原操作，重载有保护。真实 JSON／SQLite 浏览器验证首次暂停／检查点、不推理及凭据轮换清理。

- D Web 开始／暂停与原结果：Host 返回模型、每次请求预留 token、模拟区间额度、驻留及主机共享并发摘要，UI 确认后明确开始。后台轮询不禁用有效旧控件，写入重查；同语义未知意图先查询／原重试，暂停独立显示在途收尾，更新 revision 提示概览旧计数需刷新。真实生产 actor／工具／库存流程及桌面／390px 已验证；检查点／恢复／输入表单及完整矩阵仍未完成。

- D Web 维护允许性与时间依据：Host 从原生所有权、队列／日志容量、运行阶段和原 checkpoint 计算采集／恢复／准备／输入提示，返回获准目标、精确时钟上限和兼容完整恢复依据。原生 checkpoint 原子记录真实 publishedAt，精确重试与冷重放不改；run journal format 43，拒绝旧格式。SDK 严格 DTO 同步，未知结果不覆盖已知不可变终态。

- D Web 完整检查点／冷 owner 恢复：确认对象及暂停／排空／退休后果；恢复显示原检查点 ID、真实发布时间、前缀／当前 revision 和独立有界来源引用，读取引用不验证或取 writer。采集／恢复未知结果经原操作入口查询／原重试。真实 JSON／SQLite 浏览器在 Loader 禁用／重挂载行政 owner 后保持库存／输入／决策及模型调用数，返回 paused，不回滚；此项不等同独立 Host 进程退出 UI 矩阵。

- D Web 单实体输入／准备对账：只选择 Host 获准实体及规范精确 tick，不广播或增加权限；按运行隔离的正文／目标／时间／原选择在关闭、模块切换和重连保留，共享数量／UTF-8 额度拒绝不替换输入。专用保留入口可在新操作不可用时打开，放弃保留未知原选择，收到原回执后只清理未改变字段。界面区分分配／pending／claimed／consumed／cancelled 与关联 decision。真实 JSON／SQLite 浏览器验证受理后响应丢失、后来编辑、原消费、冷恢复后新输入和暂停不推理；新准备在原拓扑发布独立检查点，保留较早原结果。

</details>

<details>
<summary>分项验证与源码定位（8 条）</summary>

### D 原未知操作重试与失败定位

源码／测试：[Native 原授权](../../packages/simulation/simulation/src/outbox-retry.ts)、[产品命令](../../packages/simulation/simulation-product/tests/operation-retry.spec.ts)、[诊断持久化](../../packages/simulation/simulation-product/tests/checkpoint-diagnostics.spec.ts)、[安全诊断](../../packages/simulation/simulation/src/checkpoint-diagnostics.ts)、[实际 SDK](../../examples/simulation-company/tests/sdk-operation-retry.snapshot.ts)、[实际 Web](../../apps/web/tests/simulation-operation-retry.snapshot.ts)

SDK 源码／lib 各两个 JSON／SQLite stdio 场景通过；当前构建新 Web 两项及既有维护／审核四项通过。原目标 WAL 已落盘但回执丢失，原授权响应再丢失后仍按原 key 查询／重试；新预算与明确继续分开，目标只有一个 Envelope／一次库存转移。浏览器核对原 sender 决策及所有关联 tokenReservation 的 epoch／Session／provider／model／sessionSequence，以及持久 context-view 输入／模型请求 header；同一决策的多个合法 observe／stage／submit 模型步骤不被误判为重播。真实 Session IO 故障显示精确安全诊断，原结果冷查询保留；没有用字符串解析暴露 provider 错误。构建首次拒绝共享错误类入口进入浏览器，拆出纯 wire schema 并验证 Native 服务／错误类仍被 gate 拒绝后通过。单一 root unknown-list 页与有界草稿不替代完整语言／权限／进程退出矩阵。

### D Web 维护与原生发布时刻

源码／测试：[Host 提示投影](../../packages/simulation/simulation-product/tests/maintenance-control.spec.ts)、[原生发布回归](../../packages/simulation/simulation-local/tests/checkpoints.spec.ts)、[表单生命周期](../../packages/client/ui-simulation/tests/maintenance-dialog.client.spec.tsx)、[真实维护浏览器](../../apps/web/tests/simulation-maintenance.snapshot.ts)

新投影、原生 fold、读取／原命令模块分别达到每文件 100%；JSON／SQLite 原生发布时间重试／冷重放及 parser 拒绝已验证。相邻 native／产品／SDK 606 项、完整 GUI 4267 项通过、1 项既定跳过，Python SDK 211 项通过。当前构建 2 个真实浏览器维护场景通过，含受理后响应丢失、原查询、later draft、消费 decision、新准备、完整采集和同 Host 内冷 owner 恢复。源码／lib 维护／SDK 各 4 项通过；doc-sync 29 项、hygiene 15 项已通过，最终 build、定向 lint、源码输出和 whitespace 检查通过，桌面／390px 真实截图已核对；复用全局 clocky-resize-none 规则，strict premium 静态检查通过。完整 UI 进程退出矩阵及全目标仍未完成

### D SDK 调度／维护与原结果

源码／测试：[协议](../../packages/sdk/protocol/src/simulation.ts)、[SDK 分发](../../packages/sdk/server/tests/simulation.spec.ts)、[TS client](../../packages/sdk/client/tests/simulation.spec.ts)、[Python client](../../python/sdk/tests/test_simulation.py)、[真实 stdio 场景](../../examples/simulation-company/tests/sdk-maintenance.snapshot.ts)

定向 TS 65 项、Python SDK 211 项和相邻 SDK／行政／Host 501 项通过。新增协议与分发两个模块分别达到每文件 100% 覆盖率。JSON／SQLite 源码维护 2 项及当前 lib 维护／创建 4 项通过；build、定向 lint、NodeNext 274 声明、runtime closure、constraints、publint、doc-sync 29 项及 whitespace 通过。全 TS client 文件覆盖率检查的 205 项断言通过，但既有 Team／凭据分支使 client.ts（95.57% 行）、api.ts（99.20% 行）未达 100%；此失败保留，不代表整体覆盖率或最终验收通过。Web 行政与自动任务 executor 仍未完成

### D 检查点／恢复／输入

源码／测试：[维护实现](../../packages/simulation/simulation-product/src/administration.ts)、[维护回归](../../packages/simulation/simulation-product/tests/maintenance.spec.ts)、[Host 回归](../../packages/host/apiproxy/tests/simulation-maintenance.spec.ts)、[真实维护流程](../../examples/simulation-company/tests/product-maintenance.snapshot.ts)、[进程退出矩阵](../../examples/simulation-company/tests/product-maintenance-recovery.snapshot.ts)

159 项定向回归对五个受影响模块达到每文件 100%。JSON／SQLite 源码维护及四点中断矩阵共 10 项通过；当前 lib 维护、调度与 SDK 共 14 项通过。相邻回归 1250 项通过；6 项旧 500ms 等待失败修为有界状态等待后，受影响 40 项通过。Python SDK 183 项、build、改动 lint、NodeNext 274 声明、runtime closure、constraints、publint、doc-sync 29 项及 whitespace 通过。完整 UI／SDK 与整体目标仍未验收

### D 产品后台调度与 Host 控制

源码／测试：[owner 实现](../../packages/simulation/simulation-product/src/company-owner.ts)、[调度回归](../../packages/simulation/simulation-product/tests/company-owner.spec.ts)、[Host 回归](../../packages/host/apiproxy/tests/simulation-control.spec.ts)、[真实控制流程](../../examples/simulation-company/tests/product-control.snapshot.ts)

174 项相关回归通过；53 项定向回归对 owner／control schema／管理读取三个新增模块达到每文件 100%。源码及当前 lib 的 JSON／SQLite 控制流程通过；本次 lib 控制、创建中断恢复、SDK 场景共 18 项通过。build、改动文件 lint、NodeNext 274 声明、runtime closure、constraints、publint、doc-sync 29 项及 whitespace 通过；Web／SDK 调度控件、冷恢复及整体功能尚未验收

### 公司场景准备与初始检查点

源码／测试：[生产准备](../../packages/simulation/simulation-product/src/company-preparation.ts)、[原生 owner 测试](../../packages/simulation/simulation-product/tests/company-preparation.spec.ts)、[Loader 中断恢复](../../examples/simulation-company/tests/product-preparation.snapshot.ts)

产品／Host 7 文件 43 项通过，相关源文件每文件 100% 定向覆盖率；source／当前 lib 的 JSON／SQLite 各 14 个 keyless 场景通过。六个提交点中断后对账相同原生 run，精确身份与两名参与者保持、零 actor／模型调用、完成重试不写入、初始 manifest 验证后恢复 paused。完整构建与 Host／Client 编译、定向 lint、`doc-sync` 29 项、`hygiene` 15 项、source-output 与 whitespace 检查通过；产品命令／目录／driver 不在此验收范围

### 公司采购 driver

源码／测试：[生产模块](../../packages/simulation/simulation-product/src/company-driver.ts)、[控制与失败路径](../../packages/simulation/simulation-product/tests/company-driver.spec.ts)、[真实 Loader 模型流程](../../examples/simulation-company/tests/product-driver.snapshot.ts)

33 项控制回归通过；产品／Host 合计 8 文件 76 项通过，相关源文件每文件 100% 定向覆盖率。Source／当前 lib 的 JSON／SQLite 各 10 个 keyless 场景通过：完整采购、单驻留、提交／接受／效果三处进程中断与冷后缀恢复、完成重试不推理。验证真实已准入模型指令、三个 scoped 工具、私有 profile 删节、精确时间、库存／承诺／交付及 input wake。完整构建、Host 编译、定向 lint、`doc-sync` 29 项、`hygiene` 15 项与 source-output 检查通过；公开模板／命令、唯一 owner、后台生命周期与 E 自动任务仍未完成

### 公司持久创建／准备命令

源码／测试：[行政 owner](../../packages/simulation/simulation-product/src/administration.ts)、[原结果／容量／生命周期](../../packages/simulation/simulation-product/tests/administration.spec.ts)、[日志恢复](../../packages/simulation/simulation-product/tests/creation-store.spec.ts)、[真实 Loader 中断](../../examples/simulation-company/tests/product-administration.snapshot.ts)

产品／Host 12 文件 102 项通过，产品包与共享分发模块每文件定向覆盖率 100%。Source／当前 lib JSON／SQLite 各 14 个 keyless 场景通过，覆盖六个提交点退出、原身份／目录恢复、初始完整检查点、零模型调用及完成重试不写入。Client 连接 11 文件 130 项与 Simulation runtime 6 项通过；完整构建、Host／Client 编译、定向 lint、`doc-sync` 29 项通过。`hygiene` 首轮 14 项通过；动态测试入口登记后 knip 单独补跑通过。公开 DTO 响应身份替换拒绝，原失败保持，新准备不另建 run，未确认退役保留句柄／日志；SDK／Web 创建和其余行政闭环仍未完成

</details>

## E 自动任务

<details>
<summary>实现范围记录（15 条）</summary>

- E 采购审核场景与 Web／SDK 行政闭环：部署模板可固定 buyer 审核角色，目录公布 review 模式，浏览器不选择任意执行配置。首次任务分开执行库存转移／持久报告，返工用新 attempt 及已记录反馈修订报告；在途效果或接收回执未对账时禁止后续认知，库存仍只转移一次。Native／Hub 专用审核 proof 在锁内及策略 IO 前后校验原创建、完成尝试、reviewer、生命周期与当前调用授权；Team journal／checkpoint 40 保留原审核命令，同 key 不改 payload，旧命令不审核新尝试。产品 owner 先保存原意图，精确查询／重试处理未知结果；只返回固定已核验转移／本尝试报告事实，不公开私有任务正文，暂停审核不推理，running 在原终态落盘后继续。Web 保留按运行／操作／attempt 隔离、共享数量／UTF-8 额度的草稿；权限不足保留独立查看及输入，真实认证退役清理，原失败须修改语义或确认新 revision。完整 build、定向 lint、29 个 doc-sync 门禁及 362 项产品／Host／SDK、75 项最终 UI／runtime 定向、57 项 Python、14 项 Native 审核及 7 项 Core schema 回归通过；真实 SDK stdio／Loader 的源码及当前 lib 各两个 JSON／SQLite 场景、8 项既有 executor lib 场景通过；8 个实际浏览器场景复验及最终两种后端的 390px 审核草稿／重试／暂停批准／检查点／冷恢复／明确继续通过，证明两尝试、一库存转移和暂停／冷查询零推理。通用场景／reviewer 目录及完整新增进程退出矩阵仍未完成。

- E 有界多步骤与 rework 尝试承接：受信任 executor 配置限制每 attempt 的认知次数，同步场景策略明确选择等待、阻塞或后续决策；后续决策记录 predecessor，原输入／策略及响应丢失身份保留。仅 canonical reviewer 对精确已完成 attempt 的 rework 产生新 ordinal attempt，重新检查依赖、取消与 maxAttempts，旧结果不覆盖新尝试。263 项产品回归、8 项真实 Loader 源码场景及当前 lib 8 项场景通过，JSON／SQLite 均证明双决策实际库存效果、两 attempt 审核及最终完成。默认公司产品模板单步且无审核；采购方审核变体及 Web／SDK 行政闭环见独立完成项；通用 reviewer 路由与新增场景完整进程退出矩阵仍未完成；不扩展已兑现 transfer 的 continuation 权限。

- E 来源与精确尝试对账：规范 Team reader 核对 Simulation 创建者、原 key 和已受理创建回执；对账与检查点复用同一投影。原生日志保留创建操作及实际 participant／activation／attempt／结果，拒绝无关任务和错误执行者；completed／review 须有完成尝试，精确已知重试不追加记录。JSON／SQLite 重启与创建／完成后进程终止已验证；此项不包含自动分配或生产 executor。

- E 分配前执行关联／专用 proof：Run 原子保留原创建、task revision、entity／participant／Session、writer epoch／activation／reservation、attempt／ordinal 与 lease 时长；Hub 专用方法在 task 锁内及 policy IO 前后复查来源／当前授权，保留原能力、工作区、预算及尝试约束，不授予频道权限。原响应丢失按同一目标 attempt 对账，查询／重试不生成第二次尝试；分配零推理。

- E 物理退休／检查点基础：Hub 将尝试退休证据与 controller quiescence 原子配对，逻辑 offline 不视作完成；未完成 Simulation lease 保留 SIM_WRITER_RETIRED 失败，原生记录在已受理关闭清理期间可结算。安全淘汰跳过未决任务 owner，采集排空分配、退休并校验目标／controller 引用。JSON／SQLite 在关联写入、Hub 分配及原生观察三处进程中断后保留同一任务、按实际次数退休旧 epoch，再显式建立新 attempt；此项不包含任务输入、模型／确定性执行及世界效果完成。

- E 已记录任务输入／专用启动／实际认知：attempt 原子保留多个有序 decision、前驱、原因、规范说明及精确输入回执，并用 run 所有索引关联。输入作为必需 context-view 内容记录及计费，Session 队列刷新后 Hub 以专用 proof 在锁内／policy IO 前后校验原来源与 lease，再唤醒真实模型；模型／工具准入复查当前任务及说明。同 decision 重试不重复推理，实际操作应用改变库存，task 保持 running 而不误报完成。native format 43，Team format 39；自动调度仍未完成。

- E 场景完成谓词／专用结果结算：effect 注册有版本、同步、有界的场景规则；固定策略后等待 actor 空闲，Native 独立验证原 attempt 的已受理 decision／输入／epoch 与已应用操作，通信另须接收者持久化。不可变终态意图先于 Hub 结算落盘，专用 proof 在锁内／policy IO 前后复查来源和当前 writer，复用结果、审核、取消与预算检查。原响应丢失及策略移除后按同一结果对账，不重复推理／世界效果；冲突原终态保留中断，关闭或撤权不能完成任务。源码与当前 lib 的 JSON／SQLite 实际模型／库存完成场景通过；自动 executor 及完整进程退出矩阵仍未完成。

- E 确定性任务认知：attempt 关联固定模型／精确策略版本，Native 拒绝认知替换或未选择策略的结果，并在冷重放保留选择。maintenance 锁内记录完整 context-view 与精确已消费输入，刷新 Session 后通过共用专用启动路径开始实际 task，再进行有界纯计算。策略结果沿用普通决策／世界操作／完成检查；原重试不重算，不创建模型 turn 或请求。源码及当前 lib 的 JSON／SQLite 场景验证原输入、实际 attempt、库存转移与完成，模型调用为零。native format 43；此项不代表自动任务选择／生产 executor 已完成。

- E 显式交互关联／条件履约：选定交互、规范 pending task 与原 attempt 在一条 Native 追加中原子关联，核对接受状态、开放承诺、指定执行者及原创建回执；后续尝试不能变更关联，普通任务不能事后补关联。模型必需 context 保留交互 ID／原 revision 与预留来源，重放验证来源及文本。分配 proof 在 policy IO 前后重查开放责任；完成先保留实际 Team 结果，再在窗口关闭／审核满足后对账较新事实。取消或已兑现承诺不回写，队列内条件再次防止取消竞态；仅 task-completed 由任务完成兑现，其他规则保留独立证据。JSON／SQLite 实际源码及 lib 的三策略／模型关联场景通过；生产自动选择／executor、旧尝试响应与新尝试／rework 交错矩阵及完整故障矩阵仍未完成。

- E 公司产品后台接入：受信任 `driver.tasks` 配置选择模型／确定性任务认知、lease、尝试次数与恢复策略；生产行政 owner 注册场景策略并沿用单一后台 timer／维护准入。采购由一次真实 `task/create`、Hub 分配、已记录输入、受限认知、实际库存效果及完成结算产生一个任务和一次转移；没有测试 start／settle helper，创建和浏览仍零推理。

- E 已兑现转移的 continuation：Native 请求显式记录 `obligation`／`continuation`。后者只接受同一 task／assignee／Session 的已物理退休旧 attempt 对应完整兑现转移证据，新 epoch 记录输入及无提案确认；新世界提案、替换证据、无退休／输入、旧 epoch、取消或无关承诺均拒绝。旧失败记录及已关闭业务事实不改写。native journal format 44，拒绝早期格式。

- E 公司进程退出恢复：JSON／SQLite、模型／确定性四种组合在创建目标落盘、关联预留、分配、输入、决策、世界效果、结果意图、Hub 结算及 Native 完成观察九处真实进程退出后，经原完整检查点／当前后缀恢复 paused，再显式开始完成。源码与当前 lib 各 40 项场景通过，固定单任务、单库存转移、实际 attempt／退休数及最终完整检查点；已确认目标结果不再推理任务。

- E 模式目录与 Web／SDK：Host 公开 `cognition-only`／`automatic-tasks`，TS schema 和 Python DTO 精确校验；创建表单复用 locale／控件按 Host 结果显示模式，不按插件或成员猜测。当前 lib 真实 Web 四项验证两模式、JSON／SQLite、原创建重试、暂停／恢复及实际 task 完成；新增中英组件及 Python mode 回归通过，桌面／390px 模式截图已检查。

- E 支撑模块拒绝／撤销覆盖：补齐原注册 proof owner 的缺失来源／attempt／输入／结果、writer 释放、启动 proof 序列化及调用后撤销回归，以及采集时创建回执与另一操作不匹配的拒绝路径。`task-transport` 与 `target-references` 联同 executor 在 586 项定向验证中语句／分支／函数／行均达到每文件 100%；不声称完整包覆盖率或最终验收通过。

- E 有界自动 executor 基础：生产 `SimulationTaskExecutor` 按受信任来源实体路由选择已受理创建回执，串联依赖检查、驻留、稳定 attempt 分配、已记录任务输入、模型／确定性认知、当前到期世界效果与证据结算。精确重试不重复 attempt／效果／推理，配置漂移拒绝；暂停、审核、失败、未知结果及退休 writer 分别停止。显式交互关联的完成对账及较新显式 attempt 已验证。42 项回归、新模块每文件 100%、真实 Loader 的源码／当前 lib JSON／SQLite 模型与确定性场景均通过；尚未接入产品后台 scheduler／catalog 自动模式，退休后自动重试、未来效果推进及完整进程退出矩阵仍未完成。

</details>

<details>
<summary>分项验证与源码定位（10 条）</summary>

### E 审核／返工产品闭环

源码／测试：[Native 权限](../../packages/simulation/simulation-team/tests/task-review.spec.ts)、[实际公司场景](../../packages/simulation/simulation-product/tests/company-reviewed-driver.spec.ts)、[持久产品命令](../../packages/simulation/simulation-product/tests/task-review.spec.ts)、[Web 场景](../../apps/web/tests/simulation-task-review.snapshot.ts)、[SDK stdio](../../examples/simulation-company/tests/sdk-review.snapshot.ts)

原响应／原查询丢失、同 key 重试、后来原因及窄屏输入保持、已用尝试／旧审核隔离、固定场景证据与撤权、暂停批准、冷查询／恢复及唯一库存转移均有实际证据。新增场景的完整进程退出、跨 Host 与真实外部模型矩阵仍待独立验收。

### E 公司自动任务／原效果 continuation

源码／测试：[生产场景与策略](../../packages/simulation/simulation-product/src/company-task-policies.ts)、[后台及拒绝回归](../../packages/simulation/simulation-product/tests/company-tasks.spec.ts)、[真实进程退出](../../examples/simulation-company/tests/product-task.snapshot.ts)、[Web 模式与执行](../../apps/web/tests/simulation-administration.snapshot.ts)

601 项定向验证通过，任务 schema／Native fold／executor／公司 driver／场景策略五模块均每文件 statements／branches／functions／lines 100%。源码／当前 lib 产品任务各 40 项正常及九点进程退出通过；相邻任务源码 14 项通过。当前 lib Web 四项、完整 GUI 4269 项（1 既定跳过）、Python 仿真 49 项通过。最后完整 build、hygiene 15 项、strict premium 静态审计、source-output、typecheck及 whitespace 已通过；最终 doc-sync／定向 lint 见当前日志。新协议拒绝旧 native format；仍不代表通用任务场景、完整 UI 故障矩阵或全目标完成

### E 支撑模块拒绝／撤销覆盖

源码／测试：[proof producer](../../packages/simulation/simulation-team/src/task-transport.ts)、[目标引用](../../packages/simulation/simulation-team/src/target-references.ts)、[精确拒绝回归](../../packages/simulation/simulation-team/tests/task-authority.spec.ts)

9 项新增回归通过，联合所属 lifecycle／restore／channel 及 executor 的 586 项验证通过；两个支撑模块语句／分支／函数／行分别达到 100%。未初始化关联字典与未知 attempt 均不生成 proof；缺失输入／结果、释放 writer 及不匹配目标均在执行前拒绝。定向 lint、最后 Host 构建及 doc-sync 通过；完整包覆盖率／自动产品模式验收仍未完成

### E 有界自动 executor

源码／测试：[生产模块](../../packages/simulation/simulation-product/src/task-executor.ts)、[停止／重试回归](../../packages/simulation/simulation-product/tests/task-executor.spec.ts)、[真实自动场景](../../examples/simulation-company/tests/task-executor.snapshot.ts)

42 项定向回归，新模块语句／分支／函数／行均 100%；创建关联、Hub 分配、认知及结算四处响应丢失重试保留原身份。暂停准入、依赖、writer 退休、配置变化、显式 interaction、较新原 attempt、失败及未分配／已分配取消停止已验证；源码自动／完成／关联 14 项及当前 lib 自动 4 项通过，模型场景实际只提供三个 scoped 工具，库存由 2／0 变为 1／1，确定性场景零模型调用。相邻产品／Team 875 项通过；当前定向覆盖 586 项对 executor、task authority 与目标引用三个模块均达到每文件 100%。完整 build、最后 Host 构建、hygiene 15 项、doc-sync 29 项、定向 lint、source-output 与 whitespace 检查通过；产品后台接入、退休后自动重试、未来效果与完整故障矩阵尚未完成

### E 任务来源与精确尝试

源码／测试：[原生对账](../../packages/simulation/simulation-local/tests/task-evidence.spec.ts)、[规范 Team 生命周期](../../packages/simulation/simulation-team/tests/lifecycle.spec.ts)、[真实 Loader 重启](../../examples/simulation-company/tests/knowledge.snapshot.ts)

48 文件 1053 项相邻原生／Team 回归与 364 项定向测试通过；任务证据 schema 与两处实现 statements／branches／functions／lines 均 100%，追加精确重试／世界履约回归 40 项通过。当前 source／lib 启动各 4 项 JSON／SQLite 创建／完成后进程终止 snapshot 通过，固定来源与实际尝试关联。完整构建、Host 重建、改动文件 lint、`doc-sync` 29 项及 `hygiene` 15 项通过；任务示例仍使用分配／完成 helper，不证明自动 executor

### E 持久分配／controller 退休

源码／测试：[原生关联](../../packages/simulation/simulation-local/tests/task-execution.spec.ts)、[真实连接](../../packages/simulation/simulation-team/tests/lifecycle.spec.ts)、[原子退休重放](../../packages/team/team-hub/tests/durable-workspace-replay.spec.ts)、[真实 Loader 断点](../../examples/simulation-company/tests/task-assignment.snapshot.ts)

140 文件 2665 项核心／Hub／controller／TeamRun／原生回归通过；四个新增模块 statements／branches／functions／lines 均 100%。JSON／SQLite source／当前 lib 各 8 项正常／三处进程中断场景通过，固定实际 task／attempt 数及零模型调用。完整 build、改动文件 lint、doc-sync 29 项、hygiene 15 项及源码输出／whitespace 通过；后续引用拒绝用例另有定向证据。native／Team journal／Team checkpoint format 39，拒绝旧格式。支撑模块扩大覆盖的补齐见本节对应子项；该场景不证明自动模型任务执行

### E 任务输入／专用启动

源码／测试：[原生关联及索引](../../packages/simulation/simulation-local/tests/task-execution.spec.ts)、[真实模型／权限回归](../../packages/simulation/simulation-team/tests/lifecycle.spec.ts)、[Loader 任务认知](../../examples/simulation-company/tests/task-decision.snapshot.ts)

376 项定向测试，三个关联／任务决策模块每文件 statements／branches／functions／lines 均 100%；130 文件 2392 项相邻 Core／Hub／原生回归通过。source 任务认知／分配共 10 项及最终认知 2 项、当前 lib 认知 2 项通过，固定任务上下文、真实启动、原重试零额外推理、提交时效果 pending／应用后库存变化，以及 task 不误完成。完整 build、改动文件 lint、doc-sync 29 项、hygiene 15 项、默认 provider 拒绝及 source-output／whitespace 通过；lib 模型曾因参数属性语法失败，已换为外部脚本模型并实机复验。完整 E 仍未完成；支撑模块覆盖补齐见本节对应子项

### E 场景结果与完成结算

源码／测试：[Native 证据与冷重放](../../packages/simulation/simulation-local/tests/task-completion.spec.ts)、[权限／中断／原响应](../../packages/simulation/simulation-team/tests/lifecycle.spec.ts)、[真实完成场景](../../examples/simulation-company/tests/task-completion.snapshot.ts)

465 项定向测试及三个核心结算模块每文件 100% 覆盖率通过；另补 policy-await 撤权回归。源码与当前 lib 的 JSON／SQLite 实际模型／库存完成场景通过；原结果先落盘，丢失目标响应及移除策略后原重试不推理，不同终态保持中断。完整 build、改动文件 lint、doc-sync 29 项、hygiene 15 项与 whitespace 通过。有界 executor 与显式交互关联已由本节对应子项验证；产品后台接入和完整完成进程退出矩阵仍未完成

### E 确定性任务执行

源码／测试：[Native 认知选择与重放](../../packages/simulation/simulation-local/tests/task-execution.spec.ts)、[共用启动／纯策略／完成](../../packages/simulation/simulation-team/tests/lifecycle.spec.ts)、[真实纯任务场景](../../examples/simulation-company/tests/task-deterministic.snapshot.ts)

391 项定向测试及四个任务模块每文件 100% 覆盖率通过；最后 cancellation fence 调整后完整 lifecycle 370 项再次通过。源码及 lib 的分配／认知／完成／纯任务共 14 项分别通过，最终纯任务 2 项分别复验通过，Model 请求为零。完整 build、定向 lint、doc-sync 29 项、hygiene 15 项通过。固定代码后的 Core／Hub／Simulation 扩大回归 132 文件 2408 项通过，包含 JSON／SQLite 104 个现有进程恢复场景；此前版本混用／编译中断的结果不计为有效证据。此矩阵不替代自动 executor 的新增任务完成故障矩阵

### E 原子交互关联／条件履约

源码／测试：[Native 关联／跨尝试／原来源](../../packages/simulation/simulation-local/tests/task-interaction.spec.ts)、[实际 Hub／审核／取消竞态](../../packages/simulation/simulation-team/tests/lifecycle.spec.ts)、[三策略及实际模型场景](../../examples/simulation-company/tests/task-interaction.snapshot.ts)

45 文件 836 项定向测试通过；六个任务／上下文模块每文件 statements／branches／functions／lines 均 100%。源码与当前 lib 的 JSON／SQLite 各 8 个关联场景通过，覆盖三种履约规则、实际模型 2 次调用及纯策略零推理；任务输入同时保留原预留与决策来源。完整 build、定向 lint、doc-sync 29 项、hygiene 15 项及 whitespace 通过。最终 Core／Hub／Simulation 扩大回归 133 文件 2437 项通过，含既有 JSON／SQLite 104 个进程恢复场景；原有四类任务场景源码／lib 各 14 项复验通过。有界 executor 已由本节对应子项验证；产品后台接入、旧尝试与新尝试／rework 交错及新增完整进程退出矩阵未完成

</details>

## F 职责拆分

<details>
<summary>实现范围记录（4 条）</summary>

- F 产物字节窗口与纯视图：runtime 独立持有精确 Team／artifact 的唯一读取窗口，React 只消费状态、预览与下载；同目标刷新失败／普通断线保留已获准字节，换目标／Team／主体／撤权及卸载清理并拒绝晚到响应。取消监听器和发布订阅不能重开已退役窗口；返回身份及 base64 字节数核对后才发布，保留原文本预览与下载额度。最终 360 项定向客户端包含该 owner 的八项生命周期／拒绝验证，构建、Host／Client 类型与定向 lint 通过；当前构建的真实 Loader／Host／local provider 浏览器验证 100 字节 Unicode 下载、物理对象缺失后的内容保留与明确重试、换 Team 清理及旧引用读取拒绝。fixture 用实际 worker 模型阻塞屏障和公开 runtime setup 结算保留产物，只证明字节读取，不声明完整模型发布工具链。审计职责拆分仍未完成。

- F 成员详情业务页移到 runtime：单一有界 capability 窗口负责分页、revision 核对、取消、断线保留与重连验证；Team／授权替换及卸载清理，React 仅持有选择和剪贴板反馈。删除旧无消费者的 `inspectMember` 客户端入口。755 项 runtime／Team UI 验证、完整构建及最终 client 增量构建通过；当前 lib 真实 Host 浏览器验证离页负责人、复制、断线保留、断线新开窗口、重连重读、390px 刷新及 Escape 关闭。未扩展视觉美化或覆盖率验收。

- F 局部抽取：Host／SDK 共用任务历史、工作区丢失、工作流结果的私有产物投影，保留原 provider 快照；新投影模块定向覆盖率 100%。

- F 局部抽取：共享观察器、授权错误分类、成员引用控件；F 的其余职责拆分／性能验收未完成。

</details>

<details>
<summary>分项验证与源码定位（1 条）</summary>

### F 产物读取与视图拆分

源码／测试：[runtime 字节 owner](../../packages/client/runtime/src/client/teams/artifact-inspector.ts)、[取消／身份／字节验证](../../packages/client/runtime/tests/artifact-inspector.client.spec.ts)、[纯视图](../../packages/client/ui-team/src/client/ArtifactsWorkspace.tsx)、[实际 provider 与下载](../../apps/web/tests/team-artifact.snapshot.ts)

当前构建的独立 Browser 一项通过，连同本轮六文件 11 项共 12 个场景；真实 provider 缺失为普通失败，已获准字节和下载保持，恢复物理对象后明确读取成功，另一 Team 不可读取原引用。最初 fixture 在 worker 文本回合自动终态后试图再次结算，被 Hub 正确拒绝；改为实际模型 stream 的确定性阻塞屏障后，由公开 runtime proof 在原 running attempt 保存／结算，没有修改生产授权或结果算法。最终 Host 类型、定向 lint、whitespace 和 360 项客户端回归通过；非完整模型发布流程、审计迁移及全交互矩阵仍未完成。

</details>

## G 阶段门禁

<details>
<summary>分项验证与源码定位（1 条）</summary>

### 阶段性构建与文档检查

源码／测试：包级 README、implemented Agent Notes、仓库检查脚本

remote／认证退役收尾的构建、GUI 4122 项、`doc-sync` 29 项、`hygiene` 15 项、改动文件 lint 与 whitespace 检查通过；另有 1 项 GUI 测试按既定条件跳过，不替代完整浏览器矩阵

</details>

## 失败与复验记录

2026-09-30 失效通知批次在默认并发扩大回归时出现 13 项失败，包含准备／5 秒超时及一个比较 Cordis proxy 身份的测试误用；后者改为核对目录事实。维持原测试时限、以两 worker 完整复验 328 项通过。`hygiene` 的 `vendor rescope` 仍拒绝 `root-agents-vendored-name-contract` 固定编辑：当前 AGENTS 文案为部分／移动状态，其他 14 项通过；此项保留为最终门禁 gap。

2026-09-30 上下文批次的扩大回归曾在与构建并行期间出现六项 5 秒超时，涉及 `company-driver`、`company-owner`、`company-task-policies`、`company-tasks` 与 `maintenance`。构建与其他验证完成后，未改测试超时或生产代码，原 319 项命令独立复验全部通过；并行构建期间的失败不计为通过证据。

2026-09-30 元数据批次验证期间，`pnpm run test:web:built -- <files>` 的参数分隔未按预期过滤，触发全量 Web 套件；观察到 `approval-composer.e2e.ts`、`image-display.snapshot.ts`、`steering.e2e.ts` 失败后中止。图片场景包含 fixture 缺少 `dynamicCordisRunner/inventory`／`syncInspectManifest` 的诊断；这些失败未在本批修复或确认原因。随后使用直接 `pnpm exec vitest run --config vitest.web.config.ts <files>`，最终当前构建的三项 Simulation 场景通过；不能据此声明全量 Web 通过。

## 初始审查基线

日期：2026-09-28，实施前。

本节保留实施前的审查记录；当前状态见 [实施计划](implementation-plan.md#0-当前完成情况)。审查对象为含未提交修改和未跟踪 Simulation 文件的工作区，不是仅某个已提交版本。以下证据不认证后续实现。

| 观察 | 权威定位 | 证据与结论边界 |
|---|---|---|
| 离页 owner 被当未分配 | [TaskWorkspace](../../packages/client/ui-team/src/client/TaskWorkspace.tsx)、[TeamOverview](../../packages/client/ui-team/src/client/TeamOverview.tsx) 的 participantName/owner lookup | 实际组件渲染复现；名称缺失与 ownerId 缺失应分离 |
| 离页依赖没有移除控件 | [TeamTaskDialog](../../packages/client/ui-team/src/client/TeamTaskDialog.tsx) 的 blockedBy 与 unloadedDependency | 实际组件提交仍保留该依赖 |
| 空产物页不渲染内容区 | [TeamPage](../../packages/client/ui-team/src/client/TeamPage.tsx) 的 artifacts 条件 | 实际组件缺少 section、空态和刷新 |
| 默认权限与表单不一致 | [DEFAULT_HUMAN_AUTHORITY_GRANT](../../packages/team/team-run/src/index.ts)、[表单](../../packages/client/ui-team/src/client/TeamTaskDialog.tsx)、[API 错误映射](../../packages/host/apiproxy/src/api-proxy.ts) | API/Hub 组合复现非 shared 与非空 scopes 拒绝，并映射 internal；不是越权漏洞 |
| 自定义成员无执行路由 | [Web routes 配置](../../packages/bundle/web-app/cordis.patch.yml)、[placement](../../packages/team/team-placement-default/src/index.ts) | custom role、定向任务、空 routes 组合无 activation；不否定内置 worker pool 的正常按需启动 |
| Simulation 尚无产品管理接入 | [registry](../../packages/simulation/simulation/src/index.ts)、[示例配置](../../examples/simulation-company/cordis.yml)、[SDK 事件处理](../../packages/sdk/client/src/api.ts) | 事件校验、独立示例不等于 Web 管理 API |
| 仿真任务完成由 helper 构造 | [task-scenario](../../examples/simulation-company/tests/task-scenario.ts)、[普通 client 的隔离](../../packages/team/team-agent-client/src/index.ts) | 证明任务创建/对账，不证明生产自动执行；原 scope 见 [底层计划](../../.agents/plans/2026-09-18-durable-simulation-coordination/development-plan.md) |

当次执行结果如下。测试通过说明覆盖到的行为符合断言；并不消除以上未覆盖缺陷。

| 命令/范围 | 结果 |
|---|---|
| `pnpm exec vitest run packages/client/ui-team/tests packages/client/runtime/tests/team-*.client.spec.ts` | 21 文件，204 测试通过 |
| `pnpm exec vitest run packages/team/team-run/tests/team-run.spec.ts packages/team/team-scheduler-dag/tests packages/host/apiproxy/tests/api-proxy-teams.spec.ts` | 7 文件，283 测试通过 |
| `pnpm exec vitest run packages/simulation packages/core/session/tests/simulation-context.spec.ts packages/team/team-hub/tests/durable-simulation-task-creator.spec.ts --maxWorkers=4` | 51 文件，1096 测试通过 |
| 下方三个 Simulation snapshot | 3 文件，44 测试通过，覆盖 JSON/SQLite、真实 Loader、公司场景及 checkpoint/启动恢复 |
| `.tmp` 中本轮临时组件/API 复现 | 3 个组件用例与 2 个 API 用例确认上述问题；它们不是已修复回归 |

```sh
CLOCKY_SNAPSHOT=replay pnpm exec vitest run --config vitest.snapshot.config.ts \
  examples/simulation-company/tests/company.snapshot.ts \
  examples/simulation-company/tests/checkpoint-restore.snapshot.ts \
  examples/simulation-company/tests/checkpoint-startup.snapshot.ts --maxWorkers=2
```

临时复现位于仓库 `.tmp/ui-team-audit/` 与 `.tmp/team-audit/`，用于当次调查，不作为长期文档的唯一依据。A/B 实现时必须将相应行为迁入正式测试 owner。首次 API 复现预期业务错误失败，由此确认了 internal 映射问题；调整为验证实际错误行为后的 2 项复现通过不表示该映射合理。

初始审查当时未验证浏览器视觉、built artifacts、真实付费模型、跨 Host 部署或性能指标。后续状态与未覆盖范围见 [实施计划](implementation-plan.md#0-当前完成情况)。没有发现高置信底层严重缺陷不等于穷尽所有错误。浏览器工具选择遵循执行时适用的工具与技能规则。
