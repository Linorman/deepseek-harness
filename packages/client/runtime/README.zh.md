# @clocky/clocky-client-runtime

归档预览要求来源已暂停且静止，不会退休角色。执行保留一个原 command、revision 和 plan hash，读取用于对账其持久结果。首次归档复制并校验完整 owner 历史，不删除原件或释放历史容量。归档原记录分页需要独立的完整记录读取权限；拥有 run 或归档命令不代表可以读取 Session、Channel 正文。

生成请求、读取、执行、状态转换和 Persona 草稿方法保留原 job 身份，仅显式执行调用模型。产品输入必须为用户撰写；Host 记录实际 principal 来源并限制 runtime、scope 和 audience。Persona 纳入经过已有 A2 预览和提交路径，保留生成草稿的 revision/hash。读取和重试不创建替代 job，未知输出仍是原对账责任。结果属于私有数据，并按当前权限重新检查。

命令回复未知时，必须先查询原结果，才能再次发送变更。not-found 查询允许按保留的原 payload/key 精确重试；查到回执则恢复原结果。并发提交、过期权限及缺失观察都不能分配替代命令。

World 案件列表以 run 和状态筛选定义选择身份。cursor、page size 和 `expectedRevision` 仍是读取约束并原样转发；下一页增加 revision 不改变所选列表身份。每页替换先前的有界窗口。Native revision、查询或披露策略变化会拒绝旧游标并要求从首页刷新；案件正文和 Persona 仍使用独立详情授权。

[English](README.md) | 中文

World 读取分别保留一个有界的预检、案件列表、独立授权案件分区和原定义导出窗口。`closeWorldPreflight`、`closeWorldCase`、`closeWorldExport` 退休各自的精确 generation。切换运行、策略重置、断连与授权替换在迟到响应进入另一视图前清除私有案件详情。原 `world-create`、`world-prepare`、`cancel-world-case` 命令复用现有保留身份、查询与重试 owner；取消查询核对精确的 `worldCancellation` payload。公开 schema 声明引用浏览器安全类型叶子，包含 TypeScript 为推断 scalar 和诊断取名的输出路径。

来源权限刷新独立于仿真世界 watch。`watchSource()` 持有一个精确来源及配置的读取结算后计时器，`inspectSource()` 继续定位或原文分页，`refreshSource()` 刷新当前原文。Team 撤权帧会为祖先权限依赖保守清除正文，不改变其他编写授权。来源切换取消旧 IO，所有者在卸载时排空已接收读取。

`recordExporter()` 创建由插件持有的有界日志下载所有者，跟踪当前选择、凭据代际及策略观察，重建有序完整记录，并在调用同步文件消费者前重新验证。进度不含正文，取消清除保留输出，卸载排空已接收读取。日志列表与精确原文检查分别在 `records`、`record` 中保持独立有界。

`ctx.simulationRuns` 持有有界目录／run／集合／对象／模板／预检／控制观察。 同一运行及凭据 generation 的重复 `control(runId)` 轮询共享一个在途读取，使耗时超过轮询间隔的历史查询仍能完成。选择其他运行、暂停、断连或替换凭据仍取消旧观察；结算后的下一次轮询发起新读取。`preflight(input)` 保留一个精确草稿校验窗口，不分配命令身份；替换、暂停查看、断线及凭据退役取消进行中的校验，不返回过期授权。`closePreflight()` 清理已改变或关闭的草稿；创建权限拒绝不撤销独立运行查看及私有输入。读取等待握手完成，并隔离请求／授权代际。普通断线或刷新失败将保留内容标记为过期，直到成功观察替换；认证或查看拒绝清除内容，私有 World 案件详情在读取失败时丢弃；行政控制权限与查看权限保持独立。`observe(runId, { waitMs, retryMs })` 为可见运行持有一个有界元数据等待及重试计时器。策略替换清除私有页并取消持有旧响应，不改变编写授权或原命令；后续世界 revision 只将保留页面标记过期。新握手在策略核对前隐藏上下文正文。disposer 只退休自己的观察者，插件卸载排空被替换的等待。`pause()` 取消视图读取并释放未观察私有上下文，不取消已受理执行。`administration(ctx, options)` 为 UI 插件创建有界原命令 owner，在 IO 前保留精确 create／prepare／checkpoint／restore／manage／ingress 输入，独立查询持久结果。编写输入捕获授权版本，后到响应不能进入另一账号，`not-found` 不分配新身份。UI 注册者提供明确额度，通过 inject hook 绑定裸观察源。见 [Simulation 工作区约定](../ui-simulation/README.zh.md)。

`lookupTaskUpdate()` 在选中 Team 权限下读取精确原 Team／task／command 的结果。取消、Team 替换与授权替换会收回旧结果和诊断。管理操作转交确定拒绝前，会将元数据与已提交身份和 revision 核对。结果 revision 推进任务检查的最低版本，再次读取失败仍将旧字段标为过期。明确权限拒绝清理私有数据，普通失败保留数据，`not-found` 不触发自动写入。

表单拥有一个独立于候选查询和任务检查的任务引用观察。它仅对请求 ID 分批，所有页面固定同一 Team revision，原子发布完整集合，并把已观测变化标为过期。替换和退役隔离迟到 IO；普通失败保留已授权条目。消费者容量、批量和轮询额度约束其生命周期。

请求检查器拥有一个精确人工事项的正文、处理状态和 Team cursor。新的 Team revision 或收到的答复事实要求重新检查；旧读取不能覆盖更新事实。普通 IO 失败与断线保留标明过期的内容，权限收回则清除。UI 答复草稿与这些服务端事实分开存储。

`readMemberDetail()` 在 `list.memberDetail` 中持有一个精确成员的 capability 分页。续页固定已观察的 Team cursor，更新事实要求明确刷新。普通失败保留分页；选择切换、授权替换及卸载清除分页并取消待完成读取，重连重新验证原窗口。

TeamTaskRuntime 保留有界 selection、可选标量元数据和独立集合窗口。首次打开与后台刷新使用`team.selection`；类型化任务事件使独立任务 inspector 标记为待刷新。成员 Session 链接携带 Participant 身份，并通过`team.member.session`核对。Session 摘要携带头部中不可变的 Team/Participant 身份；协调者输入通过有界 selection 核对，不需要独立历史路由缓存。进入草稿或归档会释放当前选择和窗口。

明确的产品访问失效会清理 Session 正文／fiber、Team 数据与本地首次输入草稿，以及工作区元数据。该重置隔离更早的未完成响应。重连重置当前授权后才分发该代际保留的帧；基线读取负责对账这些增量。

Host 授权 scope 变化时，WorkspaceManager 对未完成的基线和修改回执设置代际隔离。Team 撤销会清理工作区与归档缓存中的已知 Session 引用；后到帧不能重新填充。当前已授权基线可恢复访问。工作区元数据保留其 Host 访问语义。

Team、通道和收件箱列表、通道记录及审计视图各保留一个 provider 页。续页替换当前窗口，失败保留原页。Team/通道列表刷新重读当前起点，返回首页才重启遍历；已选 Team、任务和通道不依赖列表成员。收件箱换页复用未提交回答确认。通道同意操作的重试身份由通道、参与者、邀请版本和 manifest 指纹派生，不需要历史键缓存。

对于每条 Session 提示词，运行时都会采样浏览器当前的 `Intl.DateTimeFormat().resolvedOptions().timeZone`，并只把该值附加到这一次请求。该值不缓存，因此旅行与并发标签页都能保留消息本地的来源信息。浏览器若无法提供非空时区，会在本地拒绝该提示词，而不会悄然使用部署状态代替。

设置所有者共用本包定义的不依赖 React 的 `SettingsScopeSpec`、`SettingsScope` 与快照类型。ui-settings 拥有 `ctx.settingsScope.bind(spec)`、对应的 Host 传输、schema 校验与生命周期；详见[该包的约定](../ui-settings/README.zh.md)。

<a id="slot-declaration-injection"></a>

Team 待处理预览与完整列表页使用 runtime 持有的独立读取器。普通 IO 失败保留获准内容，明确拒绝会清除内容。已知新 revision 会阻止续页，直到显式刷新。轮询只读取预览首页；Team 替换、凭据变更和断线阻止迟到响应发布。所属 UI 提供经过验证的行数与刷新额度。


`listRequests()` 持有一个运行行政日志的元数据窗口，其 revision 独立于 Native 世界推进。权限拒绝只清除此行政响应。冷 `retry-request` 保存准确原 run／command 选择，通过 Host 保留的 payload 查询／重试；已有原请求保留原命令类别。返回 receipt 同时核对两个 ID。授权替换清理选择，普通视图取消不终止已受理 Host 工作。

仿真原命令还独立暴露有界的请求日志观察，与保留回执分开。日志 revision 仅在同一运行内排序元数据；已完成／失败的元数据解释较早的已受理回执，不替换回执。不可比较的终态需要核对。离开当前页的观察标为保留结果，读取拒绝清除元数据，账号替换清除原命令。只有查询成功才替换回执；日志已确认终态时阻止再次提交该原命令。日志投影超过完整记录字节上限时，预留的容量标记明确呈现待核对状态并阻止重试／释放；离开当前页不能清除此标记，只有可容纳的新鲜观察才能完成核对。原输入与查询能力仍然保留。

## Slot 声明注入

`ctx.slots.inject(name, callback)` 将完整的 `SlotMap` key 作为贡献项的依赖，适用于贡献方插件可独立于声明条目激活的情形。声明存在时，它会同步运行 `callback`，否则等待；声明折叠会 dispose（资源释放）回调 effect，重新声明则会再次运行回调。控制器归调用方的插件 fiber 所有，因此卸载贡献方会取消等待或移除其活跃注册项。直接调用 `slots.register()` 向未声明 slot 注册仍会抛出异常。

回调返回一个同步 disposer 或由多个 disposer 构成的 iterable。因此，generator 可以 yield 多个 `slots.register()` 调用，并将它们组成一项事务：setup 失败会回滚先前 yield 的 effect，teardown 则按逆序运行它们。声明生命周期使用专用的单调 declaration epoch（声明代次），因此，即使折叠与重新声明合并在同一次 renderer 通知中，回调仍会重启，而普通条目变更不会重启它。声明绑定的 teardown 与账本变更同步运行，在同一 tick 内的后续注册之前释放运行时资源。详见 [slot 声明注入决策](../../../.agents/notes/implemented/architecture/2026-08-05-slot-declaration-injection.zh.md)。

## Team 任务产品状态

Team 列表刷新只读取用户已明确请求的页范围。`loadMore()` 根据 `nextCursor` 获取一页，失败时保留已有行；后续刷新维持该请求范围。runtime 暴露的 channel read 也保留同一 `nextCursor`，因此 detail consumer 可以显式请求后续 WAL page。`readArtifact(teamId, artifactId, signal?)` 通过 Host 验证精确引用，并发布单一 `artifactDetail` 窗口；返回读取结算，不返回字节。相同目标的刷新失败及普通断线保留已获准内容，重连后重新验证；目标／Team 选择／授权替换、已知拒绝及关闭均取消旧 IO 并清理旧窗口。不直接读取引用 URI。

`TeamTaskRuntime` 持有 `ctx.teamTasks`。客户端启动时会清除已选转录并调用 `startDraft()`，不分配 Team 或 Session。`start()` 通过 `team.start` 将修剪后的文本同时作为 Team 目标和首条可信人类消息发送。启动失败时保留同一键和语义指纹；在放弃草稿前，改变后的重试会被拒绝。`open(teamId)` 读取持久化 Team 状态并解析协调者 activation 的 Session id。`archive(teamId)` 使用当前 Team cursor，在 Host 确认持久归档标记后隐藏终态 Team。连接时会对 Team 列表进行单飞刷新；尚无 Team watch 流。Session 刷新与转录导航仍归调用方持有，因为 Team runtime 从不把 Session 视作产品身份。

`inspect()` 与重连刷新允许 Team 没有已绑定的协调者。此时 `TeamTaskSelection.coordinatorSessionId` 缺省；独立授权的成员 Session 查询仍可使用。旧有 `open()`、`start()` 和显式 `resume()` 仍要求已绑定协调者，并返回必需的 Session 身份。检查不会调用这些执行操作。

`SimulationRuntime.listTaskReviews()` 保留一个可取消、固定观察版本的元数据页。审核读取拒绝清理该行政页面，不撤销独立查看授权。原命令 owner 接入 `review` 请求，核对查询恢复的操作、尝试、版本、审核结果和规范原因后才接受原回执。读取或查询不激活审核实体，也不授予普通 Team 修改权限。

`SimulationRuntime.directory()` 在当前名称页成功后读取准确有序的 `runStatuses()` 批次，只允许查询保留目录中的 ID。替换窗口退休状态 IO，刷新失败保留过期观察。运行选择、连接和授权变化取消在途读取；状态请求不获取原生所有权，也不提交管理意图。

`SimulationRuntime.invalidateRun(runId)` 记录管理、检查点、恢复或停止目标回执到达终态后，该运行的保留观测已被取代：`invalidatedRuns` 以失效计数保留该运行，直到失效之后发起的 `runStatuses()` 批次成功返回为止，同时重读已选运行的控制与检查结果。`SimulationRuntime.runControl(ctx, { timeoutMs })` 创建单一停止目标 owner：以新命令标识发送 `updateRunControl`，把主机拒绝（`invalid`、`forbidden`、`unavailable`、`stale`）与已确认回执分开，并把传输中断、超时与内部失败视为结果未知，只能以同一命令与载荷精确重试。它从不开始调度，凭据更换会清除它。

原命令 owner 接入 `retry-operation`，核对查询返回的原运行／操作／尝试次数／规范原因，不用其他 payload 替换不确定身份。结果未知操作预览占一个独立有界响应族，不替换用户的操作表格。读取预览或查询授权不启动推理或目标执行。

`readTaskDetail()`拥有一个当前任务记录、最近的已结算 attempt，以及每类历史的一页替换窗口。成员、任务与工作流集合读取 browse 摘要。历史读取锁定记录版本；切换任务或关闭详情会取消旧读取。模块导航保留这份有界选择，重连后重新验证。观察到新版本时，操作会禁用直到显式刷新。任务写入成功会刷新所选记录；取消后的轮询使用有界详情，并在不再查看该任务时停止。

`readWorkflowDetail()`保留一个工作流版本及任务窗口。切换计划会取消旧读取，模块导航复用当前页；新版本事件保留可见内容，续页前必须显式刷新。工作流链接保留已选计划身份。

## Workspace 与 Session 列表

Workspace 和 Session 列表各自具有单调的 `pending` → `ready` 基线阶段，也有各自的刷新活动／错误状态。列表请求期间到达的增量插入或更新／移除／顺序帧与一元变更回显会在其响应之上回放。每次成功的 Workspace 基线都会重新建立 Host 持久 Workspace 顺序，因此重连会接纳该客户端离线期间提交的变更。`WorkspaceRuntime.insertBefore` 会立即安装乐观顺序；只有最新一元回声可以替换它，更新的 Host 顺序帧优先于旧回声，而最新请求被拒时会恢复最近一次由 Host 确认的顺序，不会恢复更早且尚未提交的拖拽。已移除的 Workspace id 会保留进程本地删除标记，避免延迟到达的 changed 帧将其复活。Workspace 新近程度只在两条基线都 ready 后派生，且绝不改变 Workspace 列表顺序。

`SessionSummary.pendingInteraction` 将阻塞 Session 的实时用户操作分类为 `approval`、`plan-review` 或 `question`。`SessionManager` 依据稳定的请求标识跟踪可应答请求的 requested/resolved mux 帧，即使 `Session` 对象尚未实例化也不例外；实例化前的缓冲会保留每个仍有效的请求，替换回放产生的重复项，并移除已解决的请求，因此打开 Session 时，列表状态始终有一个对应的可应答 `PendingWait`。审批与问题并发时，第一个 pending 问题具有更高的呈现优先级，以匹配 composer 路由；只有满足 plan-review composer 二元呈现约束的请求才会保留独立的 `plan-review` 状态。普通 Session 状态的作用域限定在连接代次内：断连时清除，mux 打开时的回放只恢复仍处于 pending 的请求。Team 操作另有持久的 principal inbox 记录，在 Hub 重启后仍然存在，不依赖当时的 Session promise。

`WorkspaceRuntime.delete(workspaceId)` 在一元响应成功后从客户端投影中移除注册记录；对应的 `host/workspace-removed` 帧具有幂等性，并负责同步其他标签页。Session 状态与当前 Session selection 相互独立，因此 Workspace 消失后，其已纳入客户端投影的 Session 会立即投影到 Ungrouped 下。

`WorkspaceListState.archivedSessionIds` 镜像 Host 的注册表级全局归档集合（一个按 Host 顺序的 `readonly SessionId[]`，仅在成员变化时才替换；需要 O(1) 查询的消费方自建临时 Set）。它是全快照状态：`workspace.list` 基线、`archiveSession` 一元回声和 `host/archived-sessions-changed` 帧各自安装完整集合。`WorkspaceRuntime.archiveSession(sessionId)` 通过 wire 归档；投影层在当前 selection 落入归档集合时统一清空——一条规则同时覆盖本地回声、其他标签页的帧、以及重连基线恢复出一个离线期间被归档的 selection。在 `workspace.list` 请求进行中安装的集合还会取代该过期基线携带的集合。各分组视图在所有位置隐藏集合成员，而会话行本身仍留在列表 store 中。

SlotRegistry 分别为 renderer 提供 `useSessions` 与 `useWorkspaces` 的裸 observable；ui-renderer 创建钩子。Workspace 业务状态不会进入 `SessionListState` 或条目 store。

`abbreviateHomePath` 是 Web Workspace 悬停卡片与 Tool 摘要使用的仅展示 POSIX 家目录缩写；Windows 盘符或 UNC 路径保持原样，缺失、空或文件系统根的 home 不改写路径。

`SessionListState.jobsBySession` 按 last-wins 镜像宿主的 `session/jobs` 帧，以会话为键，不需要 Session 实例。被清空的集合存为缺失的键，因此「缺失」与 `[]` 是同一种表示，消费方永远不必检测哨兵值。两处清理让它不至于比它所反映的真相活得更久：`session/subscribed` 丢弃该会话的镜像，因为新一代只为非空集合发送 baseline，被留下的列表会变成幽灵；`host/session-removed` 再丢一次，因为 owner 销毁是在 mux 流上移除记录的，而移除帧走 host 流，两者没有相对顺序。

`SessionRuntime.search(query, signal)` 是基于 `session.search` RPC 的无状态单次操作。它返回经过排序的会话／snippet 对，但不会将查询条件、加载状态或错误状态写入共享 Session 列表，因此每个 UI 所有者都自行负责防抖、取消、抑制陈旧响应和回退呈现。`searchResultLimit` 将 `SESSION_SEARCH_RESULT_LIMIT`——即响应 schema 自身强制执行的上限——作为注入的呈现数据重新公开，使客户端插件无需复制该值。它是协议常量而非逐连接状态，因此连接 handle 不携带它。

## 会话空白投影

`SessionSummary.blank` 镜像主机派生的空日志位，在客户端只降不升：由 `session.list`／`host/session-added` 帧播种，本地首次获 Host 接受的 `prompt()`（RPC 成功响应时——受理即证明用户消息已入主机日志）与任何 `running: true` 状态帧翻为 false，每次列表重拉重新对齐。`Session.composerPhase` 把任何可见的非命令 Chat Node 视为对话内容，因此客户端插件可以在不打开轮次的情况下投影持久用户输入，而仅包含通用命令行的窗口仍保持 Host blank 状态。缺少插件输入 Node 的历史窗口会恢复该空白状态，直到加载更早页面后该 Node 恢复。

## 待处理队列投影

`ConversationSnapshot.queue` 是 Host 提供的 `agent.inbox.nextTurn` 权威瞬态快照；待处理的 next-step steering（中途引导）不进入此投影。每行携带其 `MessageId`、所有内容块均为文本时的完整可编辑文本，以及扁平化预览。Host 根据持久 `agent/inbox/spliced` 变更派生完整 `session/queue` 快照，并在重连时发送基线；面向单条消息的 `agent/inbox/inserted`、`claimed` 与 `discarded` 通知不用于重建该投影。`Session.updateQueue()` 经 Host 侧 `Inbox.splice()` 发送编辑／移除操作，客户端不做乐观变更，因此下一份 Host 快照是唯一可见的提交结果，claim 竞态则可能呈现 `queue-item-not-found`。

## Conversation 组装

每个 `Session` 都把连续事件窗口交给 `ConversationNodeAssembler`。插件注册业务 Definition，把单个事件映射为稳定的 `{kind, id}`，在唯一 start 事件处创建 State，折叠有关联的 update，再为已注册的视图目标构造最终节点。Assembler 负责 Context 索引、只读前序 Context 查询，以及引用稳定的 Turn/Step Location 索引。实时 append 只对每个 Definition 求值一次，并且只更新命中的 Context；加载更早分页时保留已有 Context 与节点身份，只匹配新 prepend 的事件，并重放前序依赖或 Location 事实发生变化的 Context。完整替换仅用于 open、resync 和 gap repair。

Definition 作者只根据当前事件完成匹配，为每条关联事件提供稳定业务 id，并保证 update 能按日志 `seq` 回放；renderer 只消费最终 Node data 与受限 Location value，不扫描 Session 或 Chat 集合。完整注册和分页路径见 [Conversation Node 实操手册](../../../docs/cookbook/adding-a-conversation-node.zh.md)。

`ui-conversation` 注册内建 Chat Definition 与 keyed Chat snapshot builder。append 来源的 user、assistant 和 Tool result 构成人类可见记录；仅供模型使用的 replacement 副本不进入 Chat，compaction 检查点除外，它会成为独立标记，并在更早分页补齐 summary 溯源后更新。持久 inbox splice Context 能把 next-step 用户消息判定为 steering，无须让 inbox 状态成为 Session 特例。上下文消息保留生产者 provenance 与 form。StatsLine 读取 `ConversationSnapshot.chat.legacy.nodes`；Session 则把该 legacy slice 镜像到顶层 `nodes`、`partial` 和 `runningCalls` 公共兼容字段，无须运行第二套业务 fold。`ui-trajectory` 在同一个 Session 窗口上注册独立 Definition 与 target builder；它保留现有的 stage-oriented view model，既不消费 Chat 兼容字段，也不运行另一套 history fold。 Inbox compaction 错误保留当前可见页；`recoverInbox()`显式从服务端给出的保留边界继续读取，watch 发现 compaction 时亦如此。

Chat builder 为每个 Session 保留一个 mutable keyed store。内容更新只通知受影响的 node key；结构变化才重建顺序和 Location 成员关系；prepend 只增加行，不替换既有 keyed value。每个 Assistant chunk 都会更新 Definition State，但最多每个 animation frame 请求一次物化；final message 与 Turn/Step 关闭会立即发布。参见 [Client Tool 展示所有权决策](../../../.agents/notes/implemented/architecture/2026-08-08-client-tool-presentation-ownership.zh.md)。

## Trajectory 请求数据

Trajectory Definition 组装出一条按时间顺序排列、以用途为判别字段的提供方请求流。助手请求始终携带数值型 `turn` 与 `step`；压缩请求携带 `step: 0`，其 `turn` 所有者可以是 `null`。这个 null 所有者表示手动压缩独立运行在两个轮次之间，并不表示它属于任一相邻轮次。由取消定稿的 `assistant/message` 会保留持久结果 seq 和提供方信息，但不会将请求标记为完成；`step/end` 会把该请求归类为错误。`session/end-seed` 边界会在边界时刻将未匹配的压缩请求以错误状态结束，错误固定为 `Compaction was interrupted before completion.`；后续 start 会投影为独立请求，而不会覆盖这项遗留的未匹配请求。

## Code Mode 子调用树

每个 `ToolCallBlock` 都通过 `subCalls` 按启动顺序递归拥有自己的子调用。Chat 的 Tool Definition 按 call id 关联 root call 与 result，把 Code Dispatch 的 start/settlement 记录折叠进该 root Context，并投影为一棵 keyed 递归树；child call 不会成为独立 Chat root。start 落在已加载窗口之外时，其 settlement 仍以 `callTime: null` 渲染。一次 child 更新只复制其祖先链，因此未变化的 sibling 保持对象身份。会引入环或超过固定 256 层深度上限的边会被消费，但不会修改树。Trajectory 的 Tool Definition 为自己的 target 独立组装同一种嵌套数据契约。

## Session 标题投影

`SessionManager` 独立于列表和 Session 实例到达情况，保留最近一次通过验证的 `session/title` 控制快照。seq 更高的事件会替换旧快照，标题时间戳计入列表新近程度；订阅基线会先丢弃 seq 超过其 `lastSeq` 的任何已保留标题，再接收可选的折叠标题。显式移除 Session 也会清除已保留标题。因此，面向客户端的 `SessionSummary.title` 只包含实际的持久化标题；`displayTitle` 始终存在，并依次回退到 cwd basename 和 Session id。冷态持久化会话会保持该回退值，直到打开或恢复会话，促使主机折叠并投影由日志支撑的标题。`ISession.rename` 用 unary 响应中的 `{title, seq}` 直接结算 `title` 投影格，遵循同一 seq 高者胜规则——列表行和所有 `useProjection('title')` 读者在推送帧到达前即更新；推送帧随后重放同一 seq 时为无操作。

## 模型重试投影

Host 所属的 LLM（大语言模型）retry invariant 会在持久追加边界验证按提供方路由的 `llm/retry` 与 `llm/retry-started` 记录，包括标识、顺序、计时器、整数、状态、提供方延迟和非空诊断字段约定。客户端的 Retry、Assistant 与 Turn Error Definition 把这些记录和 Assistant、Turn／Step 事件一起折叠：失败尝试的流式输出片段会被移除，并在 retry 事件的序列位置插入一条持久重试提示。该提示在匹配的 started 记录到达前为 `scheduled`；如果所属 Step 或 Turn 先关闭，则标记为 `cancelled`，started 记录到达后则标记为 `started`。normal mode 提示携带其有限上限；always mode 提示保持显式无界。终态 `turn/end` 错误会从持久消息与可选错误码投影出一个 `turn-error` 节点——重试耗尽后它与定格的重试提示并列渲染；AUTH 投影会把可能回显凭据片段的提供方文案替换为 `API key is invalid`，原始诊断仍保留在会话日志中。安排了下一次重试的中间失败只保留该次尝试的重试提示。窗口重建与历史回放使用同一组 Definition，因此刷新既不会让已丢弃的分片重新出现，也不会丢失终态失败反馈。可见但尚未定稿的输出会在终态错误旁冻结为中断的 Assistant 节点。

reason 为 `max-tokens` 的 `turn/end` 会在该轮位置投影出一个 `turn-max-tokens` 节点：一条 warning 样式的本地化提示，说明回答在单次请求的输出 token 上限处停止，已截断的输出保留在对话流中，并提示发送“继续”可在新一轮接着输出。事件本身不携带 token 数量，提示因此不显示任何数字。窗口重建与历史回放使用同一 Definition 重建该节点，刷新和恢复后结束原因保持一致。

## 会话模型选择

每个常驻 `Session` 都拥有一个 `modelSelection` 快照，其中包含当前模型选择、按提供方分组的目录、逐提供方失败记录，以及 `idle`／`loading`／`ready`／`selecting`／`error` 状态。历史记录会建立或刷新当前模型选择，打开选择器会刷新目录；选择失败会保留上一次模型选择和可用分组。目录与选择操作共用单调递增的代次，因此较旧响应无法覆盖较新的模型选择。重连重建会恢复 Host 报告的模型选择，同时不替换未变化的选择子结构。

只有成功的已认证握手才发出 `connection/reset`。`connection/authorization-cleared` 在明确认证拒绝后，或恢复另一个已认证主体前，清退主体投影而不读取。设置、模型／预设目录与 Cordis 消费方丢弃或取消旧应答；显式凭据重查由连接服务持有。

对于 `world-create`，只有 `simulation-product-preflight-changed` 证明本次命令未受理。保留的原件转为 `notAccepted`，新意图须重新预检。普通 invalid 错误、传输失败和 `not-found` 查询保留结果未知处理，不开放替换 payload。

## 私密备份导出

`simulations.backupExport({ runId, commandId })` 返回已完成原件的精确私密字节。调用要求有效连接，在连接权限 generation 改变后拒绝响应。产品独立要求完整记录披露授权，读取不启动推理。 完整分支导出还要求祖先的当前披露授权，或针对该分支的显式 `includeProvenance: true` 授权；只有分支自身权限不能读取祖先字节。

## 不可变实验 cut

`simulations.branchWorld`、`readWorldBranch`、`queryWorldCausal` 和 `compareWorlds` 使用已完成的原始归档 cut。分支要求明确 UUID 与记忆策略，保持暂停，直到独立 start。runtime 校验原始选择与完整因果响应上限，并在连接权限变化后拒绝迟到响应。查询不推理；比较报告实际预算与终止条件，质量、成本和因果结论保持明确未知。

## 模型体验

无，因为会话对象层会选择后续 Host 请求使用的提供方／模型路由，但不添加任何模型可见内容。

#### KV Cache 影响

更改模型选择可能改变提供方侧的缓存复用，或使其失效；该包本身不会改变提示词前缀。

## 已知限制与暂缓事项

- **`loader.unload` 是 stub**：它会抛出 not-implemented；客户端没有从 fiber dispose 到注册与样式移除的卸载链。
- **scope 拆卸由阶段驱动，目前只能有一个占用者**：已 staged 的会话精确跟随 `list.current`（staging 就是打开信号：事件窗口打开 ⟺ 会话位于 stage）；在 staged 状态下被移除的会话，其 scope 会冻结保留，直到 stage 转向其他会话，而非直到真实观察者数量降为零。解析（`binding()`／`scope()`）只是纯寻址，可安全用于渲染；渲染层经 `currentProvideInfo` observable 读取当前 bundle。并发 pane 落地时，staged 状态可以扩展为多 pane 列表。
- **插件 bundle 从该包导入值时必须使用 `/client` 子路径**：裸包名不在 loader externals 表中，会内联第二个模块实例；其私有 scope-tag Symbol 永远无法匹配。
