# World Director driver

[English](README.md) | 中文

`RepresentationWorldExecution` 通过普通 Native 队列提交有限的无记忆表示切换。精确实现 pin 选择已注册处理器，不增加主驱动分支、新 Session 或模型调用。中断的回调保留原请求，先对账再重试。actor 表示保留原规范 Session，只能通过 Team 驻留机制休眠。


裁决输入包含必填的 `world-resolution-schema` 块，提供从精确安装的执行 handler 派生的 `planSchema`，以及指令 `For an apply resolution, resolution.payload must satisfy planSchema.`。driver 在 Native 记录 Channel 送达或场景驱动裁决之前，将这些内容捕获到既有上下文请求中，重复定义使用本地 JSON Schema 引用，完整 schema 计入上下文额度。重放保留原记录的分区，不会向历史 view 添加新 schema。

dispatcher 在执行或对账回调前，先持久记录原计划已准入。未确认回调保持 `outcome-unknown`，原 provider 对账前拒绝新的执行回调。类型化 readiness 拒绝保留对应案件的阻塞，不执行 IO；重复同一观察不追加记录。业务结果独立于回调清理和通知。对账先检查原 provider 的 Native 责任；已准入但尚未预留任何责任的回调直接结案，不重新发送 IO。 准入持久化期间记录的新 pause，在回调 IO 前再次核验。

Driver 在等待 resident IO 和提名步骤后重新检查调度 phase，再分配下一个决策窗口。新持久 pause 返回 paused；无关 provider IO 失败仍拒绝。

在运行中的边界，活动决策窗口结算后、下一次 drive 或推进时钟前，dispatcher 持有每个原操作 pin 的 lease，每个控制步骤最多准入一次确定性领域转换。治理投票 provider 通过 Native 结算已满足条件的原票，即使 director 尚未生成确认计划。Native 在资格检查与结案间共享同一票数规则，并在写队列内重新核验运行 phase、窗口已结算及提前结案资格。暂停读取、恢复和对账都不结案。回调 dispose（资源释放）关闭新准入并等待已准入边界完成。投票执行使用 `clocky.governance.vote/native/5`、generation `4`，request/plan parser 使用 `schema/3`。旧 pin 仍要求准确原实现，不会别名到此 provider。

在 `simulationTeams` 之后安装 `@clocky/clocky-simulation-world/providers`，即可提供独立的 `simulationWorldExecutions` 工厂服务。同一内建 catalog 同时提供恢复元数据和实际 run-bound handler；product 目录重载不会重复安装。扩展通过自己的 `ctx.effect()` 注册实际 `WorldExecutionProvider`。工厂的四个 strict payload parser 必须与 Native 声明为相同对象，并匹配原 schema/artifact/generation pin。`handlers()` 补齐所有冻结的必需操作并核验工厂输出；显式测试 adapter 保留自身行为，但共享同一合同。Driver 构造也拒绝不完整的 handler manifest。工厂移除关闭新的恢复/绑定准入；run-bound dispatcher effects 继续拥有回调退休和未结算的 Native 责任。

activation-history-limit 表示冻结历史满额且清理已确认。未确认 startup 仍为 recovery-required 并计占用，直到原责任对账。两类停止均保留原交付责任或已预留的 fair ticket/wake；被拒绝启动不创建规划窗口或模型调用。

辅助 compaction 的池拒绝采用相同 model-pool-capacity 观察和显式继续规则。拒绝事务归还当前未提交的自有 wake；冷恢复不重新分发旧请求，也不重复原业务效果。

`model-pool-capacity` 来自 Native 保留的拒绝，包括尚未到达 provider 的 director 或新人尝试。另一运行释放许可不会推进已停止的运行。显式新调度意图用新决策和已记录上下文重试归还的 wake；旧尝试仍计入冻结规划上限。

`SimulationWorldDriver` 通过公开 Native 与 Team 能力编排原 `ResolvedWorldScenario`。调用者提供独占、已准备/恢复的 run、规范连接、保留的 checkpoint/lifecycle owner 、生命周期信号、执行注册所属的 Cordis effect scope 及显式执行 handler 集合。构造及暂停态 `advance()` 不激活角色、不推理。公司与实验室定义使用同一 driver。

`advance()` 共享一次已接受的有限批次，由原 `maxDriveSteps` 限制。Native wake/queue/window 记录拥有选择与进度；上下文包含角色自己的 Persona、当前任职与组织公开信息，以及 Native 授权的请求/结果来源。accepted apply 计划预留身份、进入停稳维护、对账 Participant/Channel 准备，再原子提交任职。只有原运行阶段、管理历史和取消历史均未变化时，driver 才恢复运行；退休/暂停变化保留责任。`drain()` 等待已接受工作。`reconcile()` 仅在暂停态结算已保留的准备或取消责任，包括原维护尚未开始的已撤回联系；不推理、不恢复运行。

结果决策通过普通通信提交 Native 冻结的安全通知。新人在独立 Session 中消费自己的首次 wake，并通过原招聘者通道自我介绍。`idle` 表示没有待处理事件或决策，不代表所有角色理解了结果。驻留、传输、维护、容量、授权与 stale 计划阻塞原因独立呈现。`plan-budget` 保留原案件及已准备的规划尝试，包括没有 accepted 计划的尝试。达到冻结限额后，重复推进和冷恢复均不能打开新的规划窗口；可信 owner 必须处理原案件。只读 UI 调用方不得创建执行连接。

额度停止区分岗位、实体、历史身份、通道容量、记录字节及申请/命令数量。Native 预算、必需上下文和 microstep 阻塞分别保留为 `budget-limit`、`context-limit`、`microstep-limit`，Agent 因准入失败未提交也不覆盖为 driver 故障。转发事实仅选择实体与重试时间，传输结果不能覆盖已分类原因。重复推进阻塞状态不推理、不追加进度。

身份预留前失效的计划仍可进行有界重规划。有剩余规划额度时，产品 owner 可通过显式新调度意图继续；读取、暂停对账及已完成 start 的重试都不触发调度。已有维护责任须先结算；此前计划失效不会使 `plan-budget` 自动变为可恢复。

招聘执行由调用者通过 `ctx.effect()` 注册的精确 schema/artifact/generation handler 提供。dispatcher 在 IO 前比对原 Native 计划，并在未知准备和未完成维护期间保留原实现 lease，包括已提交招聘但维护收尾未完成的情况。卸载立即关闭新执行并排空已接受回调；未结 Native 责任通过 Cordis cleanup 日志报告 `SIM_WORLD_IMPLEMENTATION_UNAVAILABLE`，保留原 lease，对账仍可结算原责任而不替换 IO。Native provider 提供显式 parser/reducer catalog；World bootstrap 与回放要求完整原操作 manifest，每个 owner 的 lease 保留原纯策略。同一 driver 已通过真实工具、私有投递、Native Relation 原子效果和冷恢复运行独立注册的会议室预约测试领域。测试使用 v0 compiler 产物上的受信 composition，不增加 v1 作者输入或 UI。

只有匹配 `simulationWorldGoalSchema` 的已记录 Native 调度器 wake 才选择普通目标上下文；通信 Envelope 不因文本而成为新目标。Native 在推理前冻结当前任职与已安装操作授权，有权成员可提出未预建 HireIntent 的新 business key。已接受 schema/实现 pin 和请求者来源与私有 post 同次保留在 Native acceptance 中。

`ExistingHireWorldExecution` 将原接受的已有候选人请求交给通用 Native mutation。它不进行 Participant、Channel 或模型准备 IO。缺少委员会批准时计划保留等待，driver 可服务其他工作。原领域提供入职 actor；Native 将首次 wake 与结果原子提交，该 actor 使用保留的 director Channel 和原 Session。生成新人继续使用其独立保留的准备及维护义务。

`PersonnelWorldExecution` 在原 pin 下显式安装调岗或离职执行。它先预留再进行停稳 IO，取得 canonical 持锁来源 cut，提交未改写的原计划，随后完成维护。暂停对账不恢复运行、不推理。requested 与 actual 模拟生效时间独立；错过严格时刻返回 `stale-time`，未来时刻返回 `waiting-effective-time`，未清偿职责返回 `handoff-required`。调岗只能取得场景预先声明的目标岗位权限。取消或管理意图变化阻止自动恢复。产品 v1 编写声明人员权限；认证管理预览保留原任职、生效时刻意图与交接义务。[故障 runner](../../../examples/simulation-company/tests/world-r06.snapshot.ts)在两个后端验证原人事身份、任职、退休和取消责任跨 SIGKILL 与新进程恢复保持不变。

人员交接未完成时，原预留和任职 fence 保持。精确终态 task 观察只能清偿原 task target；由 owner 显式取消也不会将其债务改指另一人。原维护 owner 必须结算后才可恢复自动调度。类型化未确认 controller／owner 停止返回 retirement-unknown，保留 writer 和预留责任，不授权替代 writer。Native 拒绝隐藏 fenced 职责的生命周期变更，且仅在确认停稳后记录取消结算。

未来人员计划等待其原已接受 execution-time 边界。在精确模拟安全时刻，driver 通过原 Native／Team owner 提交未改写的计划。错过严格时刻时，在预留或 IO 前返回 stale-time，保留原请求、计划、context 与 decision slots。重复 blocked 批次不 append、不推理；修改请求时刻必须提交新的已授权请求，不能重写冻结原件。

人员执行在预留和提交边界对账取消。取消在预留前获胜时，原 cancelled result 决定后续行为。若在停稳后、持锁提交即将进入 Native 时取消先赢，迟到 proof 不能发布 mutation；adapter 结算原 pending 取消或保留其已取消结果，随后仅完成原已确认维护。已提交结果保持权威，后续取消返回 already-committed。取消历史改变时不自动恢复运行。

`ExternalWorldExecution` 按精确 schema/artifact/generation pin 安装模拟库存查询，将已接受的确认交给 Native mutation owner；driver 没有外部领域分支。规则执行不调用模型或网络，普通调控者和请求者决策沿用共享额度。产品 v1 编写通过与 JSON、安全 YAML 相同的 compiler 提供有限外部身份、可用性及调控者裁决策略。调控者裁决保留原决策与来源；规则执行保持确定性。同一[故障 runner](../../../examples/simulation-company/tests/world-r06.snapshot.ts)在两个后端验证原外部预留、结果和通知责任跨进程丢失保持不变。

`ExternalActorWorldExecution` 使用原已接受有限 Persona、冻结模型路由与 Native generation，先停稳原维护 owner，再对账精确分配的 Participant／私有 Channel，经 Native 提交后才完成维护。新的 pause/cancel 历史阻止自动恢复。请求者真实结果决策联系 ready 代表，代表通过自身普通三工具决策及 canonical sender proof 回复。已记录代表身份仅使用外部主体公开描述和自身 Persona，不使用 director Session 或主组织上下文。已接受的 reuse 计划等待原 generation ready，再预留并确认该调用者的精确私有 Channel，最后执行 Native 联系提交。同一调用者重试复用原 Channel，另一调用者通过独立 Channel 共用代表 Person/Session。创建与复用返回相同的 typed 额度、权限和 stale-plan 停止原因；未知 IO 失败仍抛出并保留责任。准备中代表取消在完成同一维护前，先通过原 canonical 清理来源对账。迟到准备/提交回执不能发布已取消的表示。已撤回联系独立于代表退役，对账冻结维护及精确 canonical Channel 证明。另一个原有调用者事项保持未结时保留会话；独占通道清理仅关闭该 Channel。已取消联系继续保留实现责任，直到同一维护结束。未知 IO 拒绝，不替换身份或恢复调度。完整外部故障矩阵仍未验收。

<a id="finite-persona-review-and-hiring-market"></a>

## 有限 Persona 审阅与招聘市场

场景显式安装 `organization.hiring-market/v1` 及其录用操作。`hiring-market` 命令将有限 Persona 草稿、岗位需求、候选人独立申请与不可变 offer revision 保存在 Native 结果中。草稿编辑最多使用十六个 revision，保留原作者与前版 hash，记录当前人工或 actor 修订者，并使旧审核失效；接受后固定原模板选择。这类场景中的生成录用必须使用相同的已接受草稿正文及精确 `personaDraft` ID/revision/hash；原 plan 与出生 profile 保留该不可变来源引用。查看与人工审核不推理，也不暴露私有 Session 内容。

候选人需要当前显式 `eligible-for-hire` 关系及作用域内的市场操作授权。这允许尚未任职的人作出市场决策，但不授予组织知识访问权或其他操作权限。offer 保留原既有人物或已审核生成候选人的录用 plan、候选人、岗位需求、费用、批准、截止时间与条款 hash。送达不等于接受；只有原候选人自身决策可以接受或拒绝。市场场景拒绝直接人工 `hire-existing` 管理，雇主必须保留自身 actor 决策。雇主还价创建新 revision；旧版、冒名、逾期与不兼容接受在 Native 提交时拒绝。

岗位需求固定 `on-proposal` 或 `on-acceptance` 预留策略。前者在发出 offer 时原子预留原费用与岗位，且有效期不得超过原 hold；后者在候选人接受时预留。两种策略都不能用预留代替候选人同意。生成候选人在 offer 前已持有独立准备身份及其费用责任。后续到期或案件取消不能释放已接受义务。录用复用同一个 Person 与 Session，原费用只结算一次，重试保留原身份。该契约不实现循环薪酬：`compensation: one-time-only` 不能推导未来工资。Product 的有界 `hiring-market` 读取族提供审核与 offer 履历；案件和 Persona 内容权限保持独立。已认证用户的 `hiring-market` 管理仅接受有限草稿或审核命令，记录用户来源，不伪造候选人决策。

审核后的生成先在原准备维护中确认独立 ready Person、原 Participant／Session 与候选人市场权限。其自身 Session 申请并接受精确已送达 offer 后，另一个提交维护才发布任职和付款。拒绝、撤回或显式到期会取消原工作事项并释放未接受费用，同时保留独立人物与历史出生额度。未知准备 IO 保留原身份和资金直到 canonical 对账；进程恢复继续原 owner，不重新生成 Persona，也不推定候选人同意。

有界 World 的普通消息上下文记录 `world-message-route`，包含原投递操作、发送者 Entity ID、Participant ID 和原通道。回复使用 `replyTarget.entityId`，信封中的 Participant ID 不是模拟收件地址。新重试上下文包含上次拒绝的代码、哈希和次数，并明确尚无消息副作用。保留的 submitted、accepted 或 cancelled 窗口直接接纳或关闭，不会重新分发原模型输入。

## 可选河港案例

`@clocky/clocky-simulation-world/harbor` 将固定版本的 `test-cases/harbor-society-365` 原始裁判注册为独立领域。配置 `sourceDirectory`、每个运行的私有存储 `root` 和已有 Simulation `provider`，在 Simulation 与 World execution 服务之后加载。`createHarborInstallation(catalog)` 返回兼容的目录及创作定义，供 WebUI 检查并创建暂停运行。部署提供真实模型路由、足够的 Team/上下文额度，并为保留历史显式配置 Native 的 `inspectionMaxEntries`/`inspectionMaxBytes`；默认 Web profile 不启用此适配器。

新安装选择 `harbor.execute/v3`，使用第 3 代 schema 与实现。Director 明确选择载荷为 `{forwardOriginal:true}` 的 apply 计划，Host 原样提交已绑定的角色请求。此流程保留真实模型选择和 Native 上下文消费证明，不要求模型转抄长业务载荷。provider 同时为已有运行保留精确的 v1 和 v2 解析器：其已消费上下文证明依赖原始 schema。不同版本不互相别名。V2 接受裁判生成的订单与借贷标识，不缩短合法的 100 字符报价 ID。

原始角色各自拥有独立 Session，只接收自己的已记录案例视图。创始人代表其在案例中实际创建的角色；这些新增角色不获得独立 Session。发起者选择日期、后续决策机会、检查点记忆和最终报告。技术 director 原样转交角色请求。调度串行完成交易并刷新私有观察。显式唤醒批次的全部选定角色完成决策后才交回发起者；其他已结算交互的响应与发起者决策交替安排。适配器不选择业务动作。根据回执统计的进度只提供事实上下文，不能替代原始审计。

原始 CLI 验证资源、视图时效及接受条件。Native `committed` 表示回执已持久记录；`payload.ok` 区分案例效果接受与裁判拒绝。输入身份和缓存回执用于中断对账，避免重复已接受效果。原始清单校验失败、日志丢失、观察倒退及子进程结果不明都会显式失败。案例子进程不接收 provider 凭据。案例输出属于配置的 root，恢复时必须与 Native、Team 日志一起保留。只有原始审计报告机械完成，`finish` 才能成功。

[Loader 场景](../../../examples/simulation-company/tests/harbor-scenario.ts) 使用真实独立 Session、原始裁判和脚本模型响应，覆盖新进程恢复。真实模型验收还要求原始 365 日覆盖与审计；此短测试通过不代表完整案例完成。

Native 领域为停止控制提供纯 `harbor-day` 时钟解释器，只读取已记录的公开观测和已提交裁判回执，包含尚未刷新到公开视图的回执；观测缺失或操作版本不匹配时不提供保护证明。日期推进和延迟消息投递计入最远日期，财务到期日保留履约责任而不推进执行时间。解释器自身不安装停止目标、不执行或改写动作。

Harbor Native domain 从已记录的 request/result 证据提供精确版本的纯业务摘要。Native committed 且裁判 `ok=false` 表达为执行被拒绝；裁判接受时，若没有独立领域证据，行动是否达成仍为 unknown。已授权的记录 overview 将业务主体、公司、组织及成员关系计数与技术角色/Session 区分，新生主体仍由创始者代表。当前 Harbor 协议没有独立联盟或雇佣关系模型，因此这些计数为 not-applicable。摘要读取不调用案例 CLI，也不获取执行 lease；目标 context 不可用或未授权时逐字段明确返回状态。 计数要求原始 `publishedAtNativeSequence` 覆盖相同 domain/operation/target 的全部后续结果，且不存在未确认的外部执行。来源记录真实发布 sequence、裁判 revision/day 及 profile 代次。缺失、过期、未来或未确认的证据明确返回 unknown 原因；旧公开 audit 不代替当前计数。

Harbor 对账只读取保留的原始输入、回执和固定 manifest，不初始化、不解锁或重新派发裁判命令。回执缺失时保留 `outcome-unknown`，不推定成功或重试权限。新派发在裁判变更前立即复核 Native 停止约束；能够证明尚未派发的拒绝以暂停处理，不虚构外部效果，派发后的失败则保留对账责任。

## Model Experience

### 角色上下文与决策

#### What the model sees

每份选中视图均通过 `simulation/context-view` 记录。identity 只含该角色 profile 与组织公开信息；authority 包含其任职与相关容量使用量。Native 追加精确请求/规划或结果/首次行动事实。普通收件消息沿规范 Team 投递进入。driver 拥有的指令为：

##### Verbatim decision instructions

```markdown
Use simulation_observe, simulation_stage and simulation_submit. Submit only actions allowed by the recorded context. An ordinary message may conclude with no further effects.
```

##### Verbatim commitment instructions

```markdown
Accepted effects remain pending until Native execution. A submitted plan is not employment; notify only recorded results.
```

#### Token effect

只有选中的真实 Agent 决策会推理。director、招聘者与新人的调用计入同一 Native token/decision 限额与 Team 模型池。身份准备及回放不推理；上下文字节预算可拒绝必需内容。纯入口 `./required-context` 为运行时和预检构造相同的固定身份、权限及责任 block。无分配的初始度量不包含后续 input/goals、system/tools 及动态领域/历史 block；这些内容仍为未知，不按空值计价。

#### KV Cache effect

每个角色跨驻留变化保留自己的规范 Session。替换旧当前视图会改变该请求前缀；已接受的工具/消息历史继续追加。新人不继承其他角色 Session 或旧通道历史。



## Known Limitations and Deferred Work

- 治理支持已安装的全票通过与绝对阈值规则。结案既不使 Norm 生效，也不证明 Session 已消费公告；不支持任意投票策略脚本。
- 身份准备后发生 stale 计划时，保留未结算维护责任；可信产品 owner 必须处理或取消后，普通调度才能继续。
- 产品调度 owner 根据原创建提供显式已认证启动/暂停与恢复。driver 自身不发现/打开 run、不发布页面，也不拥有浏览器/SDK 控制。

暂停下的外部对账也选择已保存但尚未开始维护的原代表 reservation。它使用该预留冻结的维护请求，准备精确规范身份并提交原已接受 Persona，不调用推理。没有未完成维护的 committed 或 abandoned reservation 不会重新开放。

`ExternalMediatedWorldExecution` 只执行原已接受裁决。事实、报告、失败和延迟结果使用 Native mutation owner；有限代表准备复用普通外部角色的规范预留、维护及拓扑 owner。固定调控者通过原请求者控制 Channel 发送安全结果，真正 ready 的代表接收请求者独立的首次联系。暂停对账只完成已保留的准备责任，并保持明确的暂停意图。执行和冷对账不进行新的裁决推理或真实外部 IO。

场景主动环境请求要求原有限日历和显式选择支持的领域。每次实际 occurrence 记录可用的 director wake 或独立 `maxRequests` 额度耗尽。Native 从原来源派生 trigger、稳定 business key、作用域和目标；复制 ID、角色文本和任意 wake 都不能授予权限。已接受案件保存实际 Director Decision/binding/epoch 与 trigger，`notificationOperationId` 为 null。请求、规划和结果观察分别消费有因果来源的 Native 上下文，经相同 Agent 工具和共享公平队列执行，不创建发给自己的 Channel/Envelope。普通请求保留真实私有通知及收件消费证据。拒绝或取消的场景案件仍占额度，每次 occurrence 只准入一个业务身份。延迟环境后果消费原持久 leaf 和结果 wake。Native stream 102 拒绝早期格式；compiler 9 保留独立场景额度及声明的已安装能力。

只有明确的 Native revision 冲突在运行时转为有界协调重试，或在已记录暂停后转为 paused 停止。原 ticket、wake 和已接受效果保持；无关 IO/上下文失败仍抛出。

director context 仅包含已验证、未撤回、audience 包含该 director 且属于当前请求的 planner 输出。精确输出作为 required context block 保留 generation 和 Session 来源。director 显式选择 `generationJobId`；助手不能提交 mutation。就绪 Native 计划按接受序号执行，暂时阻塞的计划会跳过，但保留其原责任。

已注册的 `organization/rename-object/1` 执行 provider 对普通展示对象使用仅 Native 所有的局部准入。未知或重叠读取以及不支持此能力的 provider 沿用现有有界 canonical 维护收集器。取消保留未完成维护，协调复用原计划/结果；不会将此操作扩大为任意 profile 编辑。

`compileWorldExperimentRuntime` 为已经完成 seed 的 paused 分支重新编译 driver 元数据。v1 输入携带原 catalog；身份遵循实际分支 lineage，资源及 Native 限额来自目标，以新的定义 hash 和 catalog generation 标识输出。当前额外角色使用其实际不可变 Persona，以及 provider、preset、model 和 capabilities 相符的原 runtime profile。driver 元数据没有初始 goal/calendar/director event，也不重复 fact/knowledge seed。实际 Native seed 对自身初始化数据保留独立 commitment。安装要求与目标 Native spec 及 World 定义精确一致；不支持的投影被拒绝。旧 v0 还必须提供原完整 catalog。编译不调用模型或外部服务，生成的元数据绝不能再次执行普通场景初始化。

V3 角色和裁判的冻结上下文包含通过 schema 校验的暂存格式示例，展示 `after`、`action.kind` 和转发计划的 `resolution.kind`。示例不会自动执行；v1/v2 上下文保留原有表示。
