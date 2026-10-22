# 本地模拟 run

[English](README.md) | 中文

`rawArchive()` 只读取已配置 run 命名空间中的固定 `simulation` 流，从存储元数据观察原始版本，不调用 Native 领域 parser 或可写 open。原始保留仍受 provider 的条目及完整字节额度约束，不宣称 Native 状态已验证或完成多存储检查点。

`controlObservation(checkpointId?)` 投影当前 owner 事实、准备/检查点元数据、数值恢复报价及最多 32 个目标，不复制历史世界正文，也不读取 journal。Product 控制读取使用该路径；关系计数扫描仍与当前状态规模有关。普通 SQLite 检查通过有界分页回放同一固定前缀，不再持有第二份完整 journal/index 数组；显式原始记录导出仍受总条目/字节上限约束。JSON 保持配置上限内的完整文档读取，不承诺流式处理。两个路径都提供已验证前缀摘要以绑定续页来源；没有引入新的权威投影基线。

已配置的停止目标以原始 Native 命令 revision 投影到必需的 authority 上下文中，通过已有 context-view 路径冻结和记录；后续更新不会改写已消费输入。调用者不能在自定义分节中提供停止事实。新准备的决策明确记录目标解除，完整上下文字节预算包含停止事实。

`recordDriverObservation()` 追加安全调度事实，不修改 Native phase。开始记录绑定 owner/batch，只有当前匹配批次才能成功或失败收尾。回放保留最近观察并拒绝过期回调。journal 版本 102 拒绝旧格式；历史事实不能证明当前存在实时 owner。

已安装的 `external/switch-representation/1` domain 仅切换无记忆的 `simulated-rule` 和 `director-mediated` 身份。它要求目标策略已安装、无待处理表示 IO 或延迟事件，且无 actor 代表历史。请求接受后关闭新交互准入；提交重验原 generation 与主体 revision，再追加实际映射，不改变原身份、资产或事实。认知降级被拒绝，通用实体创建/profile 命令不能伪造或覆盖切换历史。

治理提案请求必须使用 `expectedTime: null`、`evidence: []`。Native 自行冻结当前委员会成员与授权，调用者不能把授权关系引用复制到 evidence。向模型提供这些要求时，应将其保留在原上下文请求中：重放会派生领域 goal 材料，因此在相同实现 pin 下改变材料会使旧消费哈希失效。

新的 `world/request` 与 `world/resolve` 接受按最终 append 批次的 UTF-8 JSON 字节数核验原 `maxBytesPerRequest` 或 `maxBytesPerPlan`。检查包含 `runId`/`expectedRevision`、串行决策完成、展开后的操作 intent、排队/期限/定时/场景记录，以及末尾追加的招聘资金 scheduler 记录。窗口执行中的 finished/submitted 使用独立批次，此处只计量实际接受 append。已接受原件的精确重试不追加、不重复计费。拒绝不发布该批次的任何内容。投影验证仍核对内层业务记录；回放不会重新计算历史完整接受批次的字节数。

Native pause 和案件取消在 checkpoint cut draining 或 sealed 时仍可准入。持久写入使旧 reference 失效；生产写入和 running 准入保持关闭，过时 cut 不能发布。新 pause 可与 in-progress checkpoint 共存。

已提交生成与代表身份的 profile 保留原 accepted Persona。通用 `entity/profile` 不能替换该 profile：准入在 append 前拒绝，generated-hire replay 独立比较原 profile 与 accepted plan。Native stream 102 拒绝旧解释。World definition 初始化不消耗 evidence submission 字节；已有 evidence state 的实际变更仍对完整 evidence/scheduler batch 检查额度。

窗口 proposal 可能已具有成功的 Session stage/submit 证据和持久 inference 完成时间，随后才在最终 Native 接受时因字节超额被拒绝。`commitWindow()` 将受支持的 World 拒绝连同原 submission hash 保存为 `worldSubmissionBlock`，取消该 slot 但保留其 submission；全部 slot 终态时，在同一拒绝 append 中关闭窗口。此前已接受的 slot 仍保持提交。driver 报告 `stalled`/`world-byte-limit`；checkpoint 校验关联真实成功的 Session stage/submit 与 Native 拒绝，不伪造工具失败结果。

World 结构准入按原业务 intent 去重，为生成招聘、外部代表、人事预留、活跃 World 资金预留及未结 contact 共享一个 pending slot。`maxPendingMutations` 仅接受 `1`；业务完成但其 maintenance 未完成时不释放该槽位。准备或清理结果未知时保留责任。原 owner 的精确继续可使用自己的槽位，另一结构 owner 不能同时分配身份或资金。

出生用量包含生成招聘和新外部代表；外部代表还消耗外部展开额度。每项原预留在包含 `reservedAt`、首次 `prepared.time` 或终态 `result.time` 的 Native `budgetInterval` 中各计一次，包括取消结果。跨期仍未结的旧预留也占用当前周期。精确重试不新增计费，取消不退还其结算周期的额度。`maxBirthsPerInterval` 和 `maxExternalExpansionsPerInterval` 允许零；既有人物录用与 contact 复用不产生新出生。准入和回放使用同一保留证据。已记录模型上下文中的冻结 `worldLimits` 公开策略，但不授予变更权限。

Native stream 102 在原子应用前持久保留完整场景初始化输入。原 canonical Participant 和 Channel 必须全部确认；认知实体保持 preparing，直到 ready、世界定义、资源、事实、私有 belief、场景来源制度、模拟外部身份及初始日历事件一起提交。精确重试复用原责任记录和身份。初始化未结算时拒绝普通激活与写入。场景制度不伪造提案或投票；后续真实提案必须采用冻结委员会策略。只有完整 payload 与 prior bootstrap 来源匹配的初始事实才能与世界应用同序号。有限日历持久记录每次实际收件人，在触发时解析岗位任职，并至多排一个后继。普通目标 wake 不预建世界请求。

显式 `WorldDefinition.hiringFees` 与可移植 v1 的 `organization.hiringFees` 按录用操作及岗位声明一次性资金费用，包含既有收支账户、单位、数量、原授权和模拟预留期限。请求者在请求前读取获准费用条款；Native 从原请求者派生资金权限。共享资源台账扣除全部 active 承诺。生成招聘在 IO 前同批保存身份与资金；既有人物招聘保存原资金承诺，不分配新人物。提交同批结算支付、任职、结果及 wake 责任。普通资源工具不能结算 World owner 的 hold。身份 IO 未知时，资金保留至 canonical 清理确认；墙钟时间不推进模拟期限。原件重试不刷新价格、账户读集或到期时间，终态历史也不退还额度。

Journal 版本 98 以 `decision/world-blocked` 保留明确的请求/计划字节、请求总数、规划预算或 request/resolve 授权拒绝。Native 原子取消已消费但未接受的决策、归还原 wake 并关闭已结算窗口；只保存 schema 规范化的 proposal hash，原拒绝正文留在 Session，不能超过 Native 额度。同正文重试返回原拒绝且不追加，异正文拒绝。已接受效果及可修正的结果/首次行动工具错误不能变成此停止。保留的世界提交拒绝禁止后续运行准入，即使当前已暂停。JSON 与 SQLite 拒绝早期 stream；通用 SQLite 和 Session 格式不变。


记录的用户暂停通过 `SimulationDecisionPausedError` 关闭新推理准入。`cancelDecisionForPause()` 只取消同一 live writer 当前已准备、未接受的模型决策，归还原 wake，并原子关闭其余 slot 已结算的窗口。精确重试返回原暂停取消。已接受效果、确定性决策、陈旧或退休 writer 及无关失败不符合此条件。token 预留及已知/未知计费均保留。JSON 和 SQLite 要求 stream 102，拒绝更早的 stream；通用 SQLite 与 Session 格式不变。

日志保留严格 activation/history-blocked 事实。冻结历史拒绝保留原 fair selection/wake 及未知 startup 责任。后续 writer 预留和运行阶段转换均拒绝该已保留的硬上限。JSON 与 SQLite 拒绝更早的 stream；通用 SQLite 和 Session 格式保持不变。

日志保留严格 compaction/model-blocked 记录，不创建虚构决策。回放验证保留的 writer/binding 和取消决策关系；JSON 与 SQLite 拒绝更早的 stream。通用 SQLite 表结构和 Session 格式保持不变。

Journal 版本 98 增加严格 `decision/model-blocked` 所有权与拒绝证据，原子取消原未提交尝试并保留模型池停止。JSON 和 SQLite 拒绝更早的 stream；通用 SQLite 表结构和 Session 格式未变。

世界请求接受时冻结逻辑操作映射，并按展开后操作、消息及 UTF-8 字节计额；回放也按相同字节上限验证保留的批次。请求和完整计划属于同一日志，业务申请去重独立于 decision 身份。只有冻结的 director 持有精确 Native 选择上下文的消费证明，才可处理已交付案件；profile 标签不授予权限。拒绝结算关闭案件，apply 计划等待可信 owner 执行。拒绝结算还会原子保存结构化结果和安全的请求者 wake。可信 `cancelWorldCase()` 将原命令与计划结算串行排序，取消未接受的规划 slot 及过期 wake，保留唯一终态结果，不删除案件或计划。同命令重试返回原回执，变更案件会拒绝；已有拒绝返回 `already-resolved` 并保留原因。结果和取消回执属于同一日志，director 解释不进入通知 wake。准备中取消记录 `cancel-requested`，禁止提交且保留容量和维护责任；撤权新人的新私有通道预留会被拒绝。规范清理源须在 run 队列外排空并对账准确 Team 身份，`settleWorldHireCancellation()` 才会原子保留清理证据、将原 Entity 标记为 abandoned/terminated，并记录唯一取消结果与 wake。待处理命令保留原序号；最早命令作为取消来源，后续命令返回 already-resolved。未知结果保留占用。只有精确保留的 cleanup 才允许历史未完成 binding/Channel 不再阻塞后续运行或 checkpoint；身份始终不借给其他人。入职已提交则取消返回 `already-committed`，不会删除任职。

`world/request` 接受版本化的已安装 payload 与 business key，再在保留私有通知的同一 acceptance 批次中派生事项及真实 Decision/epoch/binding 来源。普通目标上下文要求当前任职和已消费操作授权；事项重试保留原目标与 payload。每个世界操作在 journal 保留已消费 schema/实现 generation pin，缺失或改变 pin 时拒绝回放。Native stream 102 拒绝不支持的更早格式，不补造缺失证据。 原已固定 `resultNotificationRole` 仅为结果 wake 选择请求者或冻结 director。Native 在事件 append、投影回放及已消费结果上下文中检查同一角色；领域上下文指定其他 speaker，或 Channel 不含两个精确 canonical 端点时拒绝。

`reserveWorldHire()` 只接受最新 accepted apply 计划，原子预留岗位额度及 Entity、Participant、Session、Relation 和两个私有 Channel 身份。`prepareWorldHire()` 要求原维护 owner 已证明停稳，先保存 preparing Entity 与完整规范 reservation，再由调用者执行 Team IO。`commitWorldHire()` 重验原 Persona、关键 read-set、授权、容量、binding 与通道确认，在一个 append 中保存任职、ready、结构化结果、首次行动及请求者 wake，并结算预留。精确重试复用原身份与结果；通用管理入口不得抢占预留或已放弃的身份。关键事实变化会追加 stale 阶段、原因及序号，保留原计划正文/hash/reads；append 失败不发布失效标记。准备后失效仍保留维护和容量责任。`SIM_WORLD_CONFLICT` 表示原件或前置条件冲突，`SIM_WORLD_LIMIT` 标识耗尽的岗位、历史身份/通道、字节或结构额度，包括出生、外部展开与共享 pending-mutation 槽位，`SIM_WORLD_INTEGRITY` 表示结构证据不一致；这些方法均不执行模型或外部 IO。

维护记录属于同一 Native journal。准入与回放均执行持久 owner 约束；停稳要求已证明的 writer 释放，不依赖等待时长。发布 IO 位于 run 队列之外，因此等待回复时仍能受理维护，但回复结算前不能提交停稳。运行时不变量检查 owner 唯一性、转换顺序及停稳与执行状态的关系。

Journal 版本 98 要求显式实体 readiness，并在同一权威日志中保留准备结果。JSON 与 SQLite 均拒绝旧 stream 版本；通用 SQLite 表结构未变。缺失 readiness 绝不等同于 ready。发布状态不变量拒绝未 ready 实体持有可准入 writer，但恢复仍可撤销并释放旧 writer。

unknown 外部结果在不变的 `outboxMaxAttempts` 上限下接受一个持久、精确的 `retryOutbox()` grant。运行内 grant 身份、原受理时间、reason 与已观察 attempt count 不可在重试时变更；相同历史 grant 返回原事实，不再追加额度。排队的调用方权限在 append 前与 IO 后重验。已提交响应丢失仍可用同一请求对账。grant 与查询不执行目标 IO 或推理，调度只能显式恢复。Native journal format 98 拒绝旧记录，不保留原四参数重试 API。

区间预算与驻留槽位准入复用 Simulation Definition 的 `budgetUsage()` 与 `simulationResidentSlots()` 共享投影。token bucket 与总和超出安全整数范围时拒绝，不进行舍入；reserved 与 unknown attempt 保留计费。产品状态读取使用同一权威算术，不打开 run 或执行恢复。

只读检查仅在请求 `includeRecords` 时返回原始 sequence／value 条目。JSON 与 SQLite 复用 snapshot 的完整验证、有 provider 额度限制的历史观察，不获取 writer 或创建缺失历史。公开这些私有原生条目前，消费者必须实施授权。

只读 `inspect()` 使用与 open 相同的 fold 和投影检查重放有界保留历史，不取得 run／coordinator ownership，不调用 create／restore。`inspectionMaxEntries` 默认 100000，`inspectionMaxBytes` 默认 16777216，两者均为可配置的正安全整数。错误 medium／spec、不完整或损坏历史及超额会拒绝。owner 观察区分本 provider、另一 coordinator、未持有和不可确认，不能授权接管。provider 卸载关闭检查准入，先排空已接纳 reader，再释放已有 run。此原生基础尚不登记产品目录或提供认证 Web API。

挂载 `clocky-simulation` 和本显式启用的提供方。配置必须包含 `name`、专用本地文件系统目录 `root`、`backend`（`json` 或 `sqlite`）以及正整数 `replayPageSize`。[Loader fixture（测试前置数据）](../../../examples/headless-agent/tests/fixtures/simulation/simulation-local/cordis.yml)是最小可执行组合。

`inspectEntity(id)` 返回独立的实体快照及同次观察的 run 身份和全局 revision，不复制无关历史。未知身份不包含实体；写入仍校验预期 revision 和权限。

待追加批次与重放页在连续实体变更之间复用私有实体字典；每条记录仍校验 schema、序号与因果关系，批次拒绝不会修改已发布投影。创建时记录精确的 run 配置，并从暂停状态开始。状态写入校验调用者观察到的 revision，按 run 串行化，追加到一个带版本的 Storage 日志，持久化完成后才发布独立投影。重开时先验证全部记录和配置，再返回句柄。非法格式、缺失前缀、后端变更与重复创建均拒绝。关闭时拒绝新写入、排空已接受操作，先释放存储，再释放协调器所有权；清理失败可重试。

每个 run 目录包含独立于 JSON 或 SQLite 日志的 `owner.sqlite` 数据库。覆盖整个存活期的 `BEGIN EXCLUSIVE` 事务在日志写入之间也会排斥另一个本地进程。操作系统在进程退出时释放锁；接管不使用过期时间或 PID 猜测。只要进程仍可能访问 run，就不得删除或替换所有权文件；所有协调器必须使用同一个规范化存储根目录。JSON 日志同样需要 SQLite 支持。专用模拟存储不提供破坏性保留清理 API。

日志记录决策 slot、已接受意图批次和原子本地结算。转移保持资源守恒，发布任何效果前校验完整读取集、权限、授权和最终余额。部分交付保留证据，取消不能抹掉这些效果。writer 撤销会取消开放 slot，已接受操作仍由 run 持有。 公平队列已认领的 wake 必须通过其预留分配进入窗口，手动决策或窗口不能换一个身份将其消费。重放在暴露投影前校验决策与意图的引用及指纹。 重放还拒绝跳过决策 slot／操作 index 顺序中较早未结算本地操作的记录；实时执行使用同一折叠检查。

日志保存精确调度键与分配计数器。回复过期、defer 唤醒和承诺违约定时事件与业务效果原子追加。消费事件在同一条目中推进模拟时间并记录后果。同刻后果进入下一 microstep。零时间链溢出时保留事件，并以 `SIM_MICROSTEP_LIMIT` 停滞；取消该事件后显式恢复即可解除停滞。真实传输 TTL 不作为业务期限。

日志版本 96 保留组织作用域关系、完整发布引用（run、Team、接收者与频道位置）、通信就绪与发布尝试；打开时拒绝更早的日志格式。任务对账保留已受理创建回执身份及精确执行者／尝试结果。fold 在派生履约前拒绝无关创建来源及其他交互 assignee 持有的尝试。目标 IO 在 run 队列之外执行，允许在发布进行期间撤销 writer。关闭会排空已受理派发，再释放存储。新尝试与派发前拒绝要求 run 正在运行、没有冻结决策窗口且全部前置操作已终结；已受理传输的完成结果仍可在暂停时记录。传输实现必须按操作 id/指纹原子去重；`publishAllowed` 为 false 时只能对账既有结果，不能重新发布。发布回执不证明接收者 Session 已持久化，也不代表业务接受。

`recordDeliveryFailure()` 保留精确 Hub 放弃投递记录并停滞，阻止时间继续前进，同时保留输入与 wake 责任。`resolveDeliveryFailure()` 要求已有持久输入、活跃 writer 的输入缺失证据或不可逆的实体终止；不会改变承诺或伪造回执。恢复运行仍需单独显式切换阶段。

根 Team 的预留与确认都是持久 run 事件。重试不能改变创建载荷；未确认的预留不能接受实体绑定或进入运行阶段。

仅用于检查重放状态的句柄可关闭而不退役历史 writer；一旦受理变更、恢复或注册退役所有者，关闭就必须等待 writer 完全停稳。准入前校验失败会释放 run 锁而不修改持久 writer 记录，允许原样修复来源后重试。

Native stream 102 安装已有候选人录用。准入要求原 canonical Team 中 ready/active 的认知人物、已确认的 director 私有 Channel、生效的 scoped `eligible-for-hire` 关系，以及申请人的当前任职与 `can-hire` 权限。任何 scope 的当前/未来任职均拒绝；保留已结束任职历史。容量包括未来占用和未结清的新人录用预留。commit 重验精确 reads 和当前委员会批准，拒绝另一个未结清结构录用，并原子记录一个任职、安全结果和入职 wake。不替换身份、cognition、profile 或 Session。

`run.inspectPersonnelObligations()` 是有界的纯 snapshot 读取。它盘点开放决策、operations/outboxes、任务准备及清理、interactions/commitments、资源、未来 wake、消息、相关关系及结构预留。原领域的人员 subject 能力关联事项，不猜 JSON 字段名。即使 Native 列表为空，仍需 canonical Team 覆盖。盘点不能 fence 任职、结算回执或释放 writer。

Native stream 102 增加精确人员预留和按原 intent 保存的任职 fence。受理离职即关闭新岗位工作；串行、window 和持久接受记录均拒绝旧岗位 generation。调岗在维护 IO 前预留。只有 Native 与外部职责已清偿，canonical Team／Channel 的 live cut 才能授权提交；未清偿职责保留 `handoff-required`。Native 从原 prefix 重建自己的清单，保存外部 cursor 向量／hash。任职关闭、预先声明的目标岗位授权、预留结算、result 和 wakes 在同一原子 append 中完成，身份与 Session 保持。明确退休在确认停稳后阻止新 writer；普通离职不 terminated Person。取消只能在维护 IO 前或已证明停稳后释放；未知清理保留责任。checkpoint 引用包含人员预留和历史 fence。

Native stream 102 保存原 run、operation、fingerprint、creator、task revision 与持锁来源 cursor 对应的终态 Team task 元数据。它只能清偿精确原 external task-target；attempt、清理、interaction 和资源仍有独立 owner。ready 记录将这些观察绑定到来源 hash，回放校验原 Native receipt。已提交的人事结果撤销全部已声明旧岗位授予，包括未来授予，不改写未来 Relation 历史。活动任职 fence 阻止通过生命周期变更跳过职责。已开始维护期间，取消保存 cancel-requested 和首个原命令，直至已证明停稳；结算保留原 assignment 与已接受效果，保存唯一取消 result／wake，只释放本预留。未结算的人事责任阻止完成维护。

Native stream 102 为每个实际已接受、声明 expectedTime 的 World intent 保存唯一 `world-execution-time` 边界。原 request 来源与精确分配的时钟 key 同属接受 append；完整 timed-request 字节和 pending-event 容量遵守原额度。来源校验绑定原 decision、epoch、canonical binding、operation fingerprint 与安装 pin。消费只推进模拟时钟，不创建 actor wake、不推理。完成或取消的 case 保持历史边界，不恢复执行权；冷回放不重新生成或重排它。

已安装的外部库存领域在原请求受理时原子保留 latent 身份，再在唯一 Native 日志中记录实际排序库存输入、策略版本、模拟和记录时间、mutation 及安全结果。同一 scope/key 不能转绑其他主体。缺失库存保持 unknown，不能变成零；资金和其他 owner 被排除。提交重验 owner-set 读项与操作授权，并独立核对结果是否等于规则实际输出。同一 mutation 的精确重试返回原结果，不重新求值或追加。checkpoint 对身份和交互记录保存指纹；可写重开验证原因果引用与历史输入 hash，不用当前余额替换历史。

Native stream 102 独立于任职预留保留外部代表分配与每个调用者的联系。在表示或联系提交前，重验精确 operation/plan/Persona、scoped 权限和 canonical binding/channel 回执。typed `external-representation` 读项在另一请求预留身份后使竞争的 create 计划过时；明确的 supersedes reuse 计划必须引用原身份/generation。准备未完成时阻止联系 IO。ready generation 为每个调用者保留一个私有 Channel，每个 case 保留一个安全结果/wake；精确重试复用原身份，不再 append。生成代表预留共用受保护 UUID、虚拟容量、不可变 preparing profile、readiness 和 Relation 守卫；展开不授予任职或转移资产。取消关闭后续准备/提交，并保留原 Person、容量、维护或未结联系责任，直到原清理 owner 结算。完整外部结果及联系 wake 的 append 批次必须满足原计划字节额度；拒绝保留原 preparing/联系责任，不提交业务效果。`onExternalRepresentativeCleanup()` 绑定原 canonical 拓扑 owner；`settleExternalRepresentativeCancellation()` 在 Native 队列外核验 Participant/Channel 终态和未物化 Session，再原子保留 abandoned readiness/生命周期、唯一取消结果与请求者 wake。已确认身份与 Channel 历史继续保留，撤销或未知证明不能释放责任。`onExternalContactCleanup()` 为每个调用者的联系撤回独立绑定 canonical owner。`settleExternalContactCancellation()` 保留另一个原有未结事项及其 Channel，或要求独占通道的终态/缺失证明，再原子记录最早取消结果与请求者 wake，不退役代表。append 时重验保留方身份/状态/序列与精确调用者/通道；保留证明不豁免未确认通道的 running 检查。即使保留方后来提交或取消，历史清理仍核验已观察 Channel 前缀。已取消会话 key 不能重开；明确新 case 获得新分配。待结联系取消阻止调度及维护结束。[故障 runner](../../../examples/simulation-company/tests/world-r06.snapshot.ts)在 JSON 与 SQLite 上验证原外部责任跨 SIGKILL 和新进程恢复保持不变。

岗位权限只来自原 World 定义。生成招聘、既有人物录用或调岗在实际任职及结果的同一 Native 业务记录中安装目标岗位声明的 Relation 与 operation grant；preparing 身份不获得岗位授权。安装核对原 accepted intent、plan、result 和 assignment；精确重试保留历史关系，不重新打开已结束的 grant。离职沿既有人事 owner 关闭原派生岗位关系。录用提交只索引已经确认的原 canonical 私有 director Channel，不建立第二通道或替换 Person/Session。Native 日志格式 96 拒绝所有更早格式。

World 准入对可信预建 intent 和普通 goal 请求统一执行 `maxRequests`。`maxRequestsPerActorPerInterval` 另按原 `Decision.time` 与 Native `budgetInterval`，跨领域统计同一真实 actor 的全部已接受请求。更换业务键不能重置额度；取消和拒绝不退还已接受请求，精确原件重试不重复计费。已记录 World 上下文只显示当前 actor 在决策 snapshot 的用量；接受时重验最新投影，重放核验每个 actor/周期组。超限模型提交沿用既有硬停止路径并保留 `SIM_WORLD_LIMIT/requests`，不会因墙钟流逝自动解除。未提交违规请求的运行可正常推进到下一模拟周期。

Native 还安装按需启用的招聘市场 reducer。已提交领域结果持有有限 Persona 审核与 offer 履历；已接受的既有人物 offer 在同一提交中复用守恒费用账本。Actor、截止时间及重试规则见[招聘市场](../simulation-world/README.zh.md#finite-persona-review-and-hiring-market)。

排队通信在最终接纳时再次校验。收件人或时间的类型化拒绝会原子取消尚未接纳的提案并归还唤醒；已结算窗口关闭后可创建新决策，无需恢复执行所有权。`messageRejection` 保留原提案哈希、代码及同一唤醒的重试次数。自动修正受不可变 `maxConflictRetries` 限制，耗尽时以 `SIM_MESSAGE_SUBMISSION_BLOCKED` 停止。无关存储错误仍会抛出，不会被误记为业务拒绝或发布部分副作用。历史记录保持原重放语义。

## Model Experience

### Run administration

#### What the model sees

不直接提供模型输入、不触发推理，也不改变 token 成本或 KV-cache。`simulation/committed` 向运行时观察者报告持久投影及对应日志尾游标。 事件对实时写入携带追加前 revision，初始重放时省略。invariant 据此检查每个新接受决策是否属于活动 writer epoch；重放按日志顺序检查历史权限。

#### Token effect

无直接 token 消耗。

#### KV Cache effect

不修改模型请求前缀。

### Native decision context

#### What the model sees

Native 仅为实际 actor 生成 required 业务上下文：本人活动 interaction/commitment，或原当前已消费 wake 关联的终态责任。覆盖明确为 active/current-wake，不是全部历史。安全 reply/execution/fulfillment 与 commitment evidence 保留原 ID/revision；task 正文和 provider 配置保持私密。actor-member routes 仅表示原 Native 已确认的成员关系，不代表 Hub 当前观察。完整 UTF-8 材料计入 required commitments 预算，overflow 不截断义务。准备拒绝已变化的 decision prefix，不把新业务状态冒充原 snapshot。Native stream 102 拒绝更早格式；既有 Session context-view 事件保留全部模型输入。 已接受请求材料向原请求者提供原载荷与收据状态，用于精确重试；普通获准世界背景仍按 actor 的读取策略选择。它不会重新核验候选人资格或披露 director 计划。未接受的 intent 仍需当前执行读集。

#### Token effect

required 业务与收据正文计入既有上下文字节/token 额度。投影本身不推理；显式执行的重试决策使用普通模型预算。

#### KV Cache effect

每个决策记录自己的 context-view 标识与所选正文。原请求内容在重试间保持稳定；历史 Session 视图不会改写。

## Known Limitations and Deferred Work

- 支持本地 create/open、快照、状态写入、Entity profile/生命周期和时态组织关系。运行状态不会启动调度器或模型。经授权的 Team 发布由 `simulation-team` 提供；驻留接收者投递在同一日志中保留 wake 与目标回执。分布式执行尚未实现。恢复重放保留的历史并核对已发布 manifest 的日志身份；跨所有者恢复由 `simulation-team` 负责。存储必须位于本地，且 SQLite 文件系统锁必须正常工作。

`managePhase()` 保留调用方指定的暂停／恢复请求 id、处理中状态及唯一终态。中断请求使用同一身份继续，变更载荷会被拒绝。重试已完成请求只返回历史结果，不改变当前阶段。失败的恢复请求保留失败原因和停滞状态；解决原因后应使用新 id。此接口只控制调度，不负责完整检查点所需的其他所有者排空和持久化。

`getPersistenceReference(expectedRevision)` 在 run 队列内读取实际日志描述、保留起点及完整状态指纹。预期 revision 和物理日志尾必须与投影一致。这是收集所需的读取接口，不是完整检查点或历史固定机制。

`acquireCheckpointCut(maxDrainRounds, signal?)` 阻止新的 run 写入和派发，排空已受理尝试与清理写入，然后要求调度已停止且 writer／窗口已释放。持有切点时只接受读取；释放是幂等的，不会恢复调度。取消获取会解除屏障，但不取消已受理工作。切点仅在当前进程有效，不固定其他所有者，也不发布检查点 manifest。

已完成检查点保留 `publishedAt`，即与 manifest 一起提交的真实发布时间。精确发布重试和冷重放保留该时刻；它独立于模拟时间，不代表当前来源已验证。

`failCheckpoint(id, error, diagnostic?)` 保留终态失败和可选的已验证公开诊断，不替换最近完整 manifest。精确终态重复请求返回原失败及诊断，JSON／SQLite 重放后亦如此。原生 `error` 仍属于须授权读取原始运行历史的私有内容；公开投影只能选取结构化阶段／类别／对象。

Checkpoint manifest 8 包含原 World 操作 pin、定义/投影 hash，以及精确的业务、事实/制度、治理、人员和外部 registry 引用。补证问题/回答修订及实际裁决/延迟责任有明确的内容承诺条目。事件使用原 adjudication sequence，hash 绑定阻塞/消费历史。Native stream 102 拒绝旧格式，不补齐缺失引用。摘要只保留 hash 和身份，私密正文留在原 Native 投影。发布在封闭切点重建完整引用向量，拒绝遗漏和变更。World 可写回放要求全部原 schema/实现/generation；改变安装的恢复在推理前失败。

`recordWorldFact()` 追加严格 text 事实版本，保留精确前驱、subject/scope、audience 与已存在的 run-event 引用。Native 派生 canonical owner、记录时钟和 sequence；新发布不能回填生效或可知时间。可知投影按明确 cursor 和模拟时刻选择获准版本，私密与不存在的请求事实均保持 unknown。每个已准备 World 上下文保留所选精确正文和来源，更正不重写旧 Decision。全部保留事实版本合计受 maxKnowledgeBytes 限制，归因 KB 写入保留原额度；完整查询超过 maxKnowledgePerQuery 即拒绝。belief、report 和 director 摘要不会自动发布事实。

已安装治理提案/投票请求与原 acceptance 原子保留贡献。提案冻结实际委员 binding、正文 hash、目标 Norm 版本、policy、quorum、阈值与 deadline；每票从精确 accepted Decision 和已消费原提案正文派生自身主体。director apply 计划只能确认原件。`closeWorldGovernance()` 在同一排队 append 批次计算唯一 resolution 和 wake，精确重试返回原件且不追加。投票要求模拟时间严格早于 deadline；close 等待窗口结算，且结果已不可改变或已到 deadline。原 deadline 与提案 acceptance 原子排队，并在 Native deadline 阶段结案；早结案取消原截止事件。通过不等于制度已生效，enact 仍要求独立获准的世界请求与 accepted 计划。 严格的 `{ boundary: true }` 重载在写队列内重新核验共享的提前结案资格；新的暂停、窗口未结算、已到截止或结果未定边界返回 `undefined`，不追加记录。已保留的 resolution 原样返回，暂停时也如此。原可信重载仍支持显式机械结案。两种调用保留相同的原子 resolution、wake 和截止取消记录；此选项不增加持久格式。

已安装 enact/revoke 操作保留原 passed 提案、正文 hash、目标版本、scope、前驱、policy、audience 和模拟日期。严格 Norm 版本、区间 closure、结果及冻结公告责任在同一 Native mutation append 保存。mutation 保留原 recordedAt，回放不读取墙钟。canonical wake 在 availableAt 只公告原批准文档，独立纯时钟边界保留生效与截止时刻。公告、Session 消费和理解仍是不同事实。普通 World 成员的非 World 决策也通过已记录 context-view 获取获准事实/Norm 背景。

场景编写的初始 Norm 使用 `origin: scenario`，保留原定义 hash 与更早的 Native bootstrap sequence，不创建提案、投票、resolution 或 mutation。actor ready 与初始数据在同一个完整初始化记录中发布。后续获准 enact 或 revoke 使用 `origin: governance`，关闭区间时仍保留初始版本及其来源。场景委员会声明冻结 rule、quorum 和原 membership 区间：同一人可有不重叠的半开区间，重叠或无法同时达到的阈值拒绝。初始化校验所有声明的 canonical 成员与有界区间；提案 admission 只统计实际当前有效 membership，未来 membership 不能提供当前票数。

validated `clocky.organization.hiring-approval/1` 核验指定委员会与岗位 allowlist。审批提案绑定一份原招聘 request/hash、当前 Norm 版本和有限 Persona 选项；制定制度的 resolution 不能批准该次招聘。Native reserve 保存每份必需 passed resolution，commit 再按全部当前生效 validated Norm 核对同一依据。授权或制度变化保留原 reservation 并拒绝/标记计划 stale。driver 跳过等待审批的计划，让其他角色和到期事件继续推进；没有后继工作可解决时报告 approval-required。已有 accepted task/commitment 保留原条件，不支持的 migrate-existing 制度请求返回类型化义务引用且不发布 Norm。金额和未知 policy/参数仍不支持并拒绝。

Native 流 75 在原外部注册表保留实际已接受的调控者 Decision、已消费视图、认知版本、冻结策略、核验过的原输入及规范发布。一批 mutation 将核验后的事实或有限事件责任、安全结果和固定调控者通知一起提交。通用事实发布不能伪造此来源。延迟叶子在原调度边界前不发布；消费时重验当前约束，原子保留实际发布及独立调控者通知，不替换最初的已排期结果。约束失败保留 pending 责任及类型化 `SIM_EXTERNAL_ADJUDICATION_BLOCKED` 停止原因。精确重试保留原记录，完整记录和通知批次遵守冻结字节额度。这些封闭效果不能修改资源或承诺。

未核实报价要求原请求通过 `input.quoteScope` 授权单位和币种。缺失时，校验明确指出此前提并引导角色选择其他允许的结果，不会虚构币种。

条件校验比较重叠的权威区间，包括已保留的未来事实。经核验的库存、余额和承诺观察保留原 Native 游标，随后有证明的台账变动不改写先前的观察。

场景主动环境请求要求原有限日历和显式选择支持的领域。每次实际 occurrence 记录可用的 director wake 或独立 `maxRequests` 额度耗尽。Native 从原来源派生 trigger、稳定 business key、作用域和目标；复制 ID、角色文本和任意 wake 都不能授予权限。已接受案件保存实际 Director Decision/binding/epoch 与 trigger，`notificationOperationId` 为 null。请求、规划和结果观察分别消费有因果来源的 Native 上下文，经相同 Agent 工具和共享公平队列执行，不创建发给自己的 Channel/Envelope。普通请求保留真实私有通知及收件消费证据。拒绝或取消的场景案件仍占额度，每次 occurrence 只准入一个业务身份。延迟环境后果消费原持久 leaf 和结果 wake。Native stream 102 拒绝早期格式；compiler 9 保留独立场景额度及声明的已安装能力。

Native 乐观写入以 `SimulationRevisionConflictError` 拒绝旧 cursor，并保留精确 expected/actual revision。识别该类型不会改变原准入比较或 journal 事实。

Native stream 102 包含必需的资源预留账本及历史额度。reserve/commit/cancel 和原 scheduler 期限与即时转移共享本地算术。到期在精确模拟期限消费原 applied 操作来源，不以墙钟 timer 或伪造取消释放资金。本地到期/取消历史保留身份，已提交支付不自动退款。招聘费用使用同一账本并保留原 accepted World 来源；preparing 或未知清理在 canonical owner 确认结算前保留原 hold。

`awaiting-evidence` 方案保留已声明的缺失字段、作为响应者的原请求人、输入修订、模拟期限及有限次数。原私有 Channel 投递安全问题索引；只有实际消费该通知的接收者上下文才能提交 `world/evidence`。接受的文本回答和可见来源引用形成不可变输入修订，并通知导演；原请求保持不变。询问必须确认原规划读集仍有效、保留后续规划机会，且不能打断未结算的结构或资金工作。已准备的回答决策消耗冻结的 `maxEvidenceAttemptsPerRequest`，包括放弃回答或取消。实际消费截止事件或耗尽回答次数后，记录唯一 `insufficient-information` 结果；取消案件同时关闭问题和待处理唤醒。Native 重放验证原来源及修订链；完整问题、回答和结算批次的字节额度均包含调度记录。

岗位容量耗尽或关键占用冲突使原方案读集失效，保留原 proposal/hash/reads 并记录 stale；真正失去授权保留独立原因。其他配额错误不改写为 stale。已准备的规划尝试在失败或取消后仍占额度；后继方案必须引用精确原前驱。

普通目标请求要求当前任职于 active、noncognitive 的岗位和组织。已消费操作授权必须保留 active 的 canonical 端点，并匹配原声明关系类型；profile 中的角色文本不提供权限。招聘请求准入核验全部当前有效硬制度的岗位白名单，即使尚未公告；advisory 和未来生效制度不拒绝当前请求。同案件委员会审批仍在 reserve/commit 阶段要求。预开的 intent 在尚无 accepted request 时，首次实际请求仍重验；已有精确 request receipt 重试不产生新业务效果。

`simulations.inspectPersonnelObligations(selection, query)` 还可通过 local provider 已安装的 Native manifest 直接读取关闭的 run。它返回同一 fold snapshot 及有界清单，无需 `open()`、writer ownership 或可写恢复；不据此推断 canonical Team 覆盖完整。

有限日历 `recurrence` 版本 1 仅使用规范模拟 tick：每周期内有界班次、精确排除时间和额外时间，必须给出结束 horizon，发生数与周期数至多 4096。civil 日历使用随包 moment-timezone 0.6.5 / tzdb 2026e，显式时区、UTC 起点、tick 大小、星期、当地班次、排除日期和额外班次。DST 缺口/重复必须声明 reject/earlier/later；不依赖宿主 Intl 或本地时区。priority 在同时间、同 phase 内先于稳定 slot 排序。房间/设备预约字段不支持且严格拒绝；日历 wake 不自动预订资源。`reviseWorldCalendar()` 要求已初始化、暂停且没有 accepted window 的运行、当前规则 revision 和不变 target；原 Host/principal 命令、取消旧待触发 occurrence、排入一个新后继一起原子提交。旧规则、已消费 wake 及原收件人不变。相同 command 精确重试不重复追加，也不能替换 payload。director 授权日历必须新建场景。

`governance.define-review-route` 在投票前冻结有序/AND/OR ReviewRoute，要求每个委员会的明确权限并保留原 electorate、规则和期限。依赖步骤的 ballot context 要求前置已通过；OR proof 可显式保留待完成分支。治理提案和制度请求保留带 hash 的完成证明，引用同一精确正文、目标和 scope 的真实委员会 Resolution。缺失/循环依赖、重复审批人和替换批准均拒绝。`governance.delegate-vote` 保存独立委托人对精确提案的授权或撤销；代理人必须已属于冻结 electorate，仍需自己的读取与工具权限。代理票保留实际代理 Decision/Session，只计入委托人且每人至多一票。后续到期或撤销阻止新代理票，不改 accepted 票。Product 提案 impact 读取和制度规划预览全部未来规则发生（包括尚未排入队列的惰性后继）、已有案件/任务/承诺/资源 hold/操作/wake 及尚未完成的因果步骤；已安装招聘政策要求全部适用批准，不支持的既有义务迁移明确阻塞。

已安装的 `environment.supply-step/1` 领域更新独立无认知环境实体，限制模拟生产与消费并保留已承诺库存；mutation 保留实际输入、结果、模拟时刻和固定/季节实现身份。`person-state.experience/1` 更新独立有界主观状态，要求本人已提交 intent 和显式 audience，不改变出生 Persona 或权限。两种操作使用原 Native mutation 日志；模型替换需要新实验。参见[状态所有权决策](../../../.agents/notes/implemented/architecture/2026-10-19-world-environment-evolution.zh.md)。

显式 `rebuildIndex(selection, expectedRevision, authorize)` 通过同目录暂存、文件同步和原子重命名发布严格版本化的日志引用索引。普通检查仍然只读：校验完整且有界的源前缀，丢弃格式错误或过期索引，永不信任持久化投影。provider 只缓存引用元数据，每次观察仍按原领域可用性和投影不变量完整回放，不保留第二份完整业务快照。重建重试保留源 revision；provider 关闭等待发布完成。索引不删除历史，也不降低扫描边界。

Stream 99 保留 `run/generation` 责任，并对未知用量保守计费。精确接受重试保留原 job；输出不能覆盖已有结果，取消不丢弃已接受 IO，验证不推理。Persona incorporate 要求已有精确匹配的 A2 草稿。planner 准入冻结真实 Native 读集，拒绝未安装 effect、scope 切换、过期父任务及超出委派额度。director 选择校验已消费的精确助手输出并保留原读集，因此并发变更产生 stale 计划，不覆盖业务状态。

`organization/rename-object/1` Native provider 仅修改活跃非认知对象的名称，保留可选描述与原身份。来自同一精确 provider 的不相交上下文仍开放时可以提交。未知读取或跨 owner 引用回退 canonical 全运行维护并保留原因；checkpoint 准入、原权限与目标 revision 继续约束提交。详见[局部变更契约](../../../.agents/notes/implemented/architecture/2026-10-19-local-object-mutation.zh.md)。

仅 Host 使用的 `bindFederationTime` 安装不可序列化的桥接权限。Sync 在 Native 提交队列内解析当前已认证邮箱证据，并在返回前持久化 owner、generation、安全上限、原邮箱序号、完整归档前缀 hash 和永久停止项。`drive`、决策 wake 收集和调度记录 fold 均拒绝在该排他上限及之后推进时钟或消费事件；关闭重开仍保留限制，不允许回退或删除永久停止项。首次绑定要求暂停状态。上限零冻结时间零的消费，`maxTime + 1` 允许最后一个 tick，Native 自身的时间限制仍然执行。Dispose 删除实时更新权限，但不释放持久限制。缺少 peer 边界时保留最后安全时间；受支持的联邦邮箱服务提供明确的已认证同步，不引入模型动作。
