# API 与运行时设计

状态：产品 API 设计提案；底层原生只读检查已实施，产品接入进度见 [plan](implementation-plan.md)。本文是 [产品设计](design.md) 的技术参考，定义拟议接口职责、持久化、并发、授权和恢复。接口名、包名与字段表是建议设计，不是当前公开 API 清单；现有类型和语义以 [Simulation 子系统](../../docs/subsystems/simulation.md)、[Simulation Team README](../../packages/simulation/simulation-team/README.md)、[Team 子系统](../../docs/subsystems/team.md) 为准。

## 1. 权威状态与依赖方向

| 所有者 | 持有的事实 | 不应承担的事实 |
|---|---|---|
| SimulationRun/provider | 世界、模拟时钟、决策、已接受操作、ingress、业务额度、仿真日志 | React 选中项、普通 Team 的调度授权 |
| simulationTeams | canonical Team/Participant/Session 绑定、writer 生命周期、模型准入、跨所有者检查点协调 | 浏览器连接生命周期、任意第三方执行 |
| Team Hub | 成员、通道、Envelope、任务与 attempt 的权威事实 | 仿真资源和时间推进 |
| Session | 实际模型可见输入、推理/工具历史、上下文视图与使用量 | 世界业务状态的替代副本 |
| 产品运行服务（新增） | 已登记运行、当前 Host 所有权、管理操作路由、授权读取、场景执行循环 | 复制并自行修改世界、Team 或 Session 权威事实 |
| Client runtime | 有界远程投影、读取版本、请求/重连状态 | 独立决定授权或执行成功 |
| UI store | 选择、筛选、滚动、未提交草稿与命令重试身份 | 世界状态、业务计数、成员执行权限 |

浏览器通过已认证的 Host transport 调产品服务，产品服务调用现有注册表、run 和 connection。SDK 管理客户端复用同一 DTO 与错误语义；Session 事件 SDK 继续按原有协议工作。服务端逻辑不以浏览器在场为执行条件。

## 2. 现有能力与新增职责

复用 `ctx.simulations.resolve/open` 做显式 provider/spec 解析，复用 `run.managePhase` 的持久管理身份、`run.ingest` 的 receipt、`connection.checkpoint` 的完整采集/发布以及 `ctx.simulationTeams.restore` 的历史验证。不要另建一套世界 phase、ingress 或 checkpoint 日志。

现有 registry 只解析并打开指定运行，不能假定它已有列表、后台 owner 或 Web driver。新增产品运行服务必须补齐以下职责：部署模板目录、持久运行目录、每个运行的唯一 Host handle、幂等创建与准备、场景 driver、授权的查询投影、异步管理请求与异常收尾。

拟议插件分工如下；落实前按 [capability seam 定义](../../docs/glossary.md#capability-seam) 核对 Service Definition / Provider / Consumer。静态定义和首个实现若共同演进可同包，不因分层名称机械拆包。

| 拟议模块 | 责任 |
|---|---|
| simulation-product | 产品服务接口、DTO 和首个本地运行目录/owner 实现；复用现有存储能力 |
| simulation-driver | 具名、版本化场景策略与有界执行循环；可作为独立演进的 provider |
| Host simulation API handlers | 认证、输入校验、限流/大小限制、调用产品服务、稳定错误映射 |
| client runtime simulation domain | 运行列表、详情、子集合、管理操作状态和重连 |
| client ui-simulation | 页面、表单、详情和与 Team/Session 的授权导航 |
| simulation-task-executor | 受限任务分配、交付、attempt 与结果发布协议；只有自动执行模式启用 |

Web 首期采用显式 opt-in composition/overlay。挂载 UI、API、目录、provider、策略、执行与恢复服务形成闭包；缺少必需依赖时启动或最早可解析处报错。可选 executor 缺失只关闭对应场景能力。正式默认启用需独立完成产品验收；仅新增 npm 依赖不代表运行配置已接入。

新增产品 Config 至少声明下表字段类别；具体数值在实施时按当前服务默认值与容量验证选取，不写成插件中的固定常量。既有 run spec 的上限与服务级并发配置仍由原所有者管理，产品配置只能进一步收紧，不暗中覆盖。

| 配置类别 | 校验和作用 |
|---|---|
| 运行目录存储与可选 provider | 受部署控制的存储位置；provider 必须存在且支持所需读取/恢复能力 |
| 场景与策略 allowlist | ID/版本唯一、引用可解析；输入参数 schema 严格，禁止任意代码 |
| 最大持有运行数、启动/管理队列 | 正整数容量与有界排队，防止仅创建/恢复请求耗尽 Host |
| 查询项目/字节上限、watch 等待/连接数 | 与传输限制一致；游标过期和断线恢复有明确结果 |
| driver 工作量、调度间隔、退避 | 验证范围；无工作时等待，不忙轮询；停止准入后不再排新工作 |
| capability 重读、身份缓存容量 | 有界且绑定认证代际，失效通知优先 |
| checkpoint/关闭等待策略 | 使用已有采集边界与部署超时，超时不等于释放未确认 writer |

## 3. 运行目录、所有权与启动恢复

运行目录记录 runId、名称、provider、不可变 spec、场景/策略版本、创建主体、访问控制关联及创建操作身份。不得包含密钥。目录是发现与授权入口，最新世界状态仍来自 provider 日志；目录中的缓存摘要必须带 revision 和更新时间。

创建使用稳定命令 ID 和参数 fingerprint：先持久记录分配的 runId 和创建意图，再创建 provider run、canonical Team、实体及频道 reservation，最后记录准备结果。恢复先按原身份读取并核对已提交结果，只补做缺失步骤；复用已有的幂等 reservation，但不能假定每个底层方法都幂等。provider 的 create 在运行已存在时会拒绝，实体创建也不能盲目重放，均须核对不可变配置。失败保留可检查状态，不能显示为完整运行或自动删除已产生的日志。

运行列表只读取目录和安全投影，不为每行 open 一个 run，不争抢 coordinator lock。产品服务以 provider + runId 为所有权键，合并并发打开请求，为已接管运行维护唯一 live handle 和查询投影。未接管的历史运行由 provider 支持的只读、一致性受控读取获得摘要；无法在写入并发下得到稳定读时返回 busy/unavailable，不能为了浏览而获取写入所有权或触发恢复。

另一个进程持有 owner 时，页面显示“由其他进程运行”及可公开的诊断。不得通过删除锁文件或创建第二个 owner 解决。Host 重启后已登记运行可见，但不自动继续模型调用；先验证/恢复至暂停，再由授权命令继续。恢复拒绝与未确认旧 writer 都必须保留状态和占用证据。

准备完成、首次推理之前，由产品 owner 自动建立初始完整 checkpoint；成功后才将运行标记为可启动。在该 checkpoint 完成前崩溃，走独立的创建/准备对账：验证原 run/spec、Team/实体/频道 reservation 和残留 owner，补做缺失步骤并重新完成初始 checkpoint，全程不推理。没有完整 manifest 时不调用普通 restore 假装成功，也不把单纯 open 当作跨所有者验证。创建/准备对账与完整检查点恢复在 API 操作状态和 UI 原因中区分。

关闭浏览器、取消 HTTP 等待与释放 live handle 是不同操作。服务 unload 关闭新准入，停止 driver，排空已接受工作，并通过 connection/run 的既有关闭机制释放；失败保留未确认状态。部署选择 checkpoint-on-shutdown 时必须有明确配置与超时，不把进程退出误报为完整检查点成功。

## 4. Team 产品查询接口

在现有认证体系下新增或扩展有界查询，不向前端传完整 authorityGrant。

| 拟议方法 | 输入 | 输出与规则 |
|---|---|---|
| team.capabilities | teamId、可选表单上下文 | 当前主体可用操作、模式/选择项、不可用原因、观察版本；只返回授权可见信息 |
| team.member.readiness | teamId、有界 participantIds | 各身份的参与资格、route 匹配/运行绑定/容量/恢复状态；不得启动 actor |
| team.identity.resolve | teamId、有界身份 ID 集合 | 获准的名字与身份状态；按 ID 去重；未知/不可访问不泄露额外信息 |
| team.task.browse 扩展 | teamId、query、phase、分页 token | 同一稳定排序下的摘要、next token、总量若可计算、观察 revision |
| team.attention.list | teamId、类型过滤、分页 token | 人工问题、审批、review、恢复事项的授权投影与来源定位 |

能力结果包含 action、allowed、稳定 reason code、需要的补救类别和观察版本。成员就绪度允许多个原因并存，按影响执行的先后展示；缺少 route、provider 未加载与容量暂满不能混为不可用。表单显示解释本地化，诊断信息只暴露允许披露的字段。

能力/就绪度观察版本不能只使用 Team WAL cursor：主体授权、provider/route 注册代际、运行绑定和容量都可能独立变化。Host 为实际读取来源提供失效通知，client runtime 通过其已有响应式通道发布；服务无法推送某来源时使用有配置上限的重读，并在提交前重新获取/验证。页面保持打开时 provider 卸载、route 变化或容量释放也应收敛，不要求用户切换 Team 或刷新整页。名字与详情缓存按连接、主体授权代际和对象隔离，权限拒绝主动失效。

任务依赖查询与任务主表共用权威查询能力，但有独立筛选与分页状态。可见身份解析使用批量上限，不支持任意跨 Team ID 探测。分页 token 绑定 Team、过滤条件、排序版本与观测游标，查询改变时旧 token 作废；过期/冲突保留旧页面并要求刷新。

## 5. Simulation 产品 API

以下名字为拟议 RPC 方法族；编码时沿用现有 schema、RPC map、Host/client faces 和远程类型生成方式，不手写另一套浏览器协议。所有跨边界 run/entity/decision/operation/checkpoint 身份复用或新增品牌类型；输入在 wire/config 边界严格校验。

| 方法族 | 核心输入 | 核心输出 |
|---|---|---|
| simulation.catalog | 当前认证主体 | 已授权模板、版本、策略、模型选择、支持的执行模式与限制 |
| simulation.runs.list | 有界分页、筛选 | 安全摘要页与当前可用操作 |
| simulation.runs.create | commandId、模板版本、许可参数、运行名称 | 稳定 runId、准备操作引用；创建不推理 |
| simulation.runs.inspect | runId | 概览、模拟时间、业务 phase、owner/连接状态、revision、下一步原因 |
| simulation.collections.list | runId、collection（entities/decisions/operations/checkpoints）、类型筛选、分页 token | 各类有界元数据摘要、观测 revision 与筛选总量；不传整个 SimulationSnapshot |
| simulation.sources.inspect | runId、decisionId、sourceIndex、可选 envelopeSequence、expectedRevision、分页 token | 冻结 Team Envelope 的有界定位／独立授权原文，逐次验证实体 sources grant 与当前 Team 权限；只返回匹配来源，未找到时可显式继续定位 |
| simulation.records.list | runId、metadata/original、可选 sequence/kind、expectedRevision、分页 token | 原生日志元数据或独立整运行历史授权下的 JSON 文本分片；totalRecords 统计原始记录，续页绑定 revision 和读取策略 |
| simulation.objects.inspect | runId、collection、对应品牌对象 ID、详情 section、可选 expectedRevision | 授权的单对象元数据／来源引用；attempt 与检查点引用独立分页，原始上下文内容保持删节 |
| simulation.runs.manage | runId、managementId、目标 phase | 持久管理请求结果及当前状态观察 |
| simulation.ingress.create | runId、ingressId、获准目标、文本、最早模拟时间 | 持久 receipt 和事件分配，不承诺立即消费 |
| simulation.checkpoints.create | runId、checkpointId、许可的采集配置 | 检查点操作引用、进度与完成/失败结果 |
| simulation.runs.restore | runId、命令 ID、完整 checkpointId | 异步管理引用；验证成功后暂停，验证失败保留原因 |
| simulation.requests.get | runId、命令 ID | 原请求的已知状态和结果；区分尚未登记与结果未知 |
| simulation.changes.watch | runId、cursor、等待上限 | 有界变更提示/最新 revision，或要求重新读取 |

目录注册的 provider/spec 和模板版本由 Host 解析，浏览器只引用公开选择 ID。URL 参数不接受文件系统路径作为 run selection。恢复所需实现版本由服务端已安装实现决定，用户不能填写任意值绕过一致性检查。

### 5.1 身份、重试与版本

普通传输 rpcId 只用于请求响应对应；持久 commandId/managementId/ingressId/checkpointId 用于业务重试，二者不互相替代。相同持久身份和相同参数返回原结果；参数改变必须拒绝。已经失败的持久操作若定义为终态，修正前置条件后创建新操作，不复活原失败身份。

复用 run.managePhase 的原有持久语义：旧命令重试返回历史结果，不撤销后续管理请求。响应同时返回 operation 结果和最新 run 观察；UI 不把历史“running 成功”当成当前仍 running。需要额外并发控制的产品命令在 Host 单一 owner 队列内完成检查和准入，不在队列外进行容易失效的“先检查后写”。

公开 API 如增加 expectedRevision，必须为相应命令明确原子性：幂等重试先取原结果；新命令的版本校验与持久接受在同一权威写队列完成。现有 managePhase 没有此参数，第一版不得仅在代理层加字段就宣称已提供严格 CAS。初版可保持明确的按队列顺序管理语义，并向多客户端显示实际处理顺序。

restore 的产品请求身份属于运行目录/行政记录，恢复本身重用底层对 retained prefix 和当前 suffix 的重复验证。进程中断不能仅因上次返回过成功就跳过新的历史验证；操作结果查询与发起新恢复是不同动作。

### 5.2 错误与等待

| 错误类别 | 示例 | 客户端行为 |
|---|---|---|
| validation | 无效时间、字段超限、非法依赖 | 关联字段，保留输入 |
| forbidden | grant 不允许、当前主体无权操作 | 禁用相关操作，解释可公开原因 |
| unavailable | provider/route/模板未配置 | 提供部署或选择修正入口 |
| conflict | revision/身份 payload 冲突 | 保留草稿，刷新并显式重新确认 |
| busy | owner 被占用、checkpoint 正在采集 | 显示现有操作，提供查询，不并行接管 |
| recovery-required | writer 状态未确认、历史不完整 | 进入诊断/恢复，禁止启动 |
| outcome-unknown | 发送已接受但应答丢失 | 保留原身份，查询/对账后重试 |
| internal | 未分类实现错误 | 稳定错误引用与人工可读提示，隐藏敏感栈 |

将现有 TEAM_GRANT_DENIED 等已知业务错误映射到明确类别；表单依赖 code/field/recovery hint，不能解析英文错误消息。允许性提示不是授权凭证；提交时重新鉴权。

长操作返回持久操作引用，HTTP 超时只结束等待。中止 checkpoint 采集遵循现有准入和排空规则，不承诺取消已接受的清理或已发布结果。没有受支持的业务取消时按钮写“停止等待”，不能写“取消执行”。

### 5.3 授权与输出预算

按 run 的 read、manage、ingress、checkpoint、restore 和允许的 scope 执行授权。首次版本可映射到同一已认证本地主体，但接口必须保持行为区分；不因未来角色尚未实现而绕过当前认证。run ID 不授予读取能力。

每种列表设置服务端项目数/字节上限，每种详情按 section 读取。字段包含 snapshotRevision、读取完整性与更新提示；UI 不从半页推算全量。私有知识、模型输入、原始日志、路径和错误详情按投影策略删节。主机共享 model permit 指标若展示，明确标注“主机共享”，不能计入单 run 消耗。ingress 的 source 由已认证主体生成，只用于归因；不能把浏览器自报的 source 当授权。

订阅传输复用已有通道；第一版只发失效/新 revision 等有界通知，再按需重读。断线重连后先检查游标，缺口导致刷新；禁止把最新状态拼接到不同 revision 的分页而伪造一致快照。

## 6. 场景 driver 与模型准入

设置 running 只表达管理意图，执行由受信任场景 driver 推动。模板显式选择具名、版本化策略，负责准备 topology、选择 wake、选择实体驻留、收集已授权上下文、打开决策窗口和解释停止原因。浏览器不生成模型上下文，不调用低层 writer 能力。

driver 在单 run 上串行推进控制步骤：处理既有可执行操作和输入；检查 pause/阻塞/额度；选择有界候选实体；确保候选已驻留、writer 有效且权限成立；恢复待处理输入并准备授权上下文材料；调用 openWindow 冻结窗口和槽位；有界并发执行认知；在槽位满足条件后按序 commit；执行已接受操作并对账。openWindow 要求 actor 已有 active writer 并固定其 epoch，窗口人数同时受可用驻留容量限制，不能开窗后再休眠窗口成员腾出容量。推理并发受现有 service-wide model permit 和 run 的驻留/额度约束，不能为了产品界面另开无限 Promise 队列。

所有执行入口复用 `executeDecision` / `executeDeterministicDecision`、受支持的 drive 与 writer 校验。上下文进入 Session 并 flush 后才请求模型；取消、等待额度和模型流清理期间维持现有权限重检与额度占用。已提交提案不会因其他 slot 较慢被前端擅自取消或接受。

driver 把 paused、等待决策、等待收件人、重试时间未到、未知结果、容量不足、恢复必需、协调轮次上限和微步阻塞分别投影。达到工作上限后安排受配置控制的下一次推进或等待事件，不在 HTTP 请求中无界循环。周期、每次工作量、队列、超时和并发均为验证后的部署 Config。

首期运行策略采用已受支持且有验收场景的有限集合。模板策略变化必须保持版本一致性；运行 spec 固定版本失配时拒绝执行，不在恢复时偷偷选择新版。

第一个产品模板从现有公司示例提取受信任的初始化与协调策略，运行时实现放入生产模块；示例反向消费该模块作为验收入口。不得让 Web 产品直接导入 tests/fixture 中的 helper。模板明确允许用户调整的参数、实体角色、知识选择、停止条件和预算；没有完成输入 schema 与生产 driver 的模板不进入 catalog。

## 7. Simulation 自动任务执行协议

### 7.1 保持隔离

现有普通 team-agent-client 跳过 Simulation Team，Hub 对其 Envelope 要求 simulation-operation proof，actor 工具只允许仿真观察/暂存/提交。这些限制保留；不能通过放开通用发送、普通 task assignment 或 unrestricted tools 来补齐功能。

新增 executor 仅服务明确启用自动任务模式的场景。它以真实 Team 任务作为工作记录，以 Simulation decision/world operation 作为仿真业务执行权威。任务完成和承诺履约是两个不同事实：task-completed 策略可由完成证据履约，转账或债权人确认策略仍检查其自己的证据。

### 7.2 一次任务的完整路径

1. 仿真决策接受 task/create，既有 outbox 在 canonical Team 创建任务，保留不可变创建归属与 receipt。executor 只消费此类有可验证来源的任务。
2. 根据场景受限能力、任务依赖、Team 状态、实体身份和 run phase 选择获准 entity；驻留通过现有 connection/controller 管理。无路由或容量时只记录/展示原因，不伪造 assignment。
3. 为任务尝试创建持久执行关联，绑定 runId、创建 operationId、taskId/revision、entityId、participantId、attempt 身份及按序保留的 decision/epoch 关联。一个 attempt 不等于一个永远不变的 decisionId；同一 live writer 的响应重试复用原身份，合法的新决策保留前驱、原因与新身份。关联先持久化，再发布分配/唤醒；重复处理使用同一责任身份。
4. Host 获取范围受限、可撤销的 task-execution proof。Hub 在自己的锁内验证 canonical Team、任务来源、当前授权、writer/epoch 和精确任务操作，保留能力匹配、工作区、预算、review、重试和取消约束；proof 不能由浏览器或日志反序列化获得，也不能授予任意频道发送权。
5. 经专用受支持的交付路径记录任务输入和 wake，启动真实 attempt；模型认知只能使用仿真工具，或由注册的确定性策略执行。投影明确显示所属 attempt 和决策。
6. 根据场景定义的完成条件检查已接受操作的业务结果；仅有 submit、消息发布或函数返回不构成成功。等待未知操作结果、review 或额外履约时保持可解释状态。
7. 使用同一任务执行关联与精确 attempt/revision 记录结果/失败。只有存在经过验证的 interaction 关联、窗口已关闭、交互与承诺状态允许时，才调用既有 reconcileTask 更新引用和允许的承诺履约；其他任务仅保留任务事实。响应丢失后读取目的端记录并对账，不再创建第二个 attempt 或新 task。

任务执行关联和新增 proof 属于跨持久化/授权协议变更，必须先定义 schema、重放不变量、幂等冲突、失败与撤销后行为，再实现消费者。长期唯一性为“一次 task attempt 对应一次被承认的执行关联”；需要下一次尝试时根据 maxAttempts 和依赖策略创建新身份，不能复用旧 attempt 重新执行。

普通结果提交仍验证当前 writer 和精确 attempt。确认 writer 已退休后的系统收尾使用独立的受限退役权限，只能将关联中的旧 attempt 记录为失败/取消及其原因，不能借系统权限伪造 completed。该权限在 Hub 锁内验证退休证据，不能依赖请求方传来的布尔值。

现有 task/create 不携带 interactionId。需要任务履约的场景必须由受信任策略持久记录可选 interactionId，明确它与创建 operation/task 的关系，并验证 interaction 已接受、承诺可对账、预期执行者与履约规则一致；该关联属于新增协议，不由 UI、任务标题或消息文本猜测。无 interaction 的普通仿真任务不调用 reconcileTask，已取消/关闭承诺也不能被迟到任务完成复活。

### 7.3 失败、关闭与恢复

在关联持久化、assignment、唤醒、attempt-start、业务效果、结果发布和 reconcile 各点注入进程退出。恢复需要读取 Run 与 Team 双方证据，重建尚未完成责任，确认旧 activation 停止，然后决定保留、继续、失败或新尝试。单方记录不完整不能推定成功。

进程退出或 writer 替换会退休旧 writer 并取消其未接受决策，已认领 wake 重新成为待处理责任；新 epoch 使用新的 decision/input 身份，保留旧取消与消费证据。executor 首期将旧 epoch 下未完成的任务 attempt 记录为失败，并附 writer 退休导致执行中断的原因；先对账已接受效果，再按 maxAttempts 等规则决定是否建立新 attempt。无剩余次数时停留失败，不借用旧 attempt 绕过预算。新的认知可以继续原业务责任，但已接受操作沿用原操作引用处理，不能用新幂等 key 重复业务效果。

Team cancellation/closing、实体终止、writer 撤销和 run pause 分别遵守各自语义。暂停阻止新的任务分配，已接受效果仍按既有规则收尾；checkpoint 必须纳入 executor 准入和交付队列，排空或形成可恢复责任后才能发布 manifest。旧 epoch 的迟到完成不得结算新 attempt。

自动执行发布前的示例必须删除成功路径对 assignTestTask/直接测试 start-settle 的依赖，通过生产 executor 实际生成 attempt 与完成事实。底层测试仍可用 helper 构造局部状态，但这种测试不能标记为执行闭环证据。

## 8. 局部重构与性能

先用回归测试固定现有行为，再进行内部拆分；协议扩展与纯搬移尽量分开评审。保持一个权威提交点、一个 owner 生命周期和原有 effect disposer。模块间传显式依赖或接口，不传可绕过授权的整个 ctx。

推荐顺序：Team API 错误映射和 capability/readiness 查询；TeamPage 子视图；client runtime collection/channel/inbox owner；TeamRun workflow/worker/recovery；Simulation 产品 owner 与 driver；最后在测量支持下拆 model admission/checkpoint 协调。并行重构不得改变已接受操作在 dispose、取消和重启下的责任。

优化优先提供用途明确的 read methods：单决策、实体映射、当前 open decision、摘要页和增量变更提示。可重建索引必须由日志同步维护并经重放验证；不能把依赖浏览器消费进度的缓存变成恢复依据。完整 snapshot 保留给明确需要它的调试/检查点路径，变更通知不要为每个订阅者复制全历史。

实际优化以 [性能与验收计划](implementation-plan.md) 的同机基线和业务结果一致性为依据，不承诺未经测量的吞吐或实体规模。
