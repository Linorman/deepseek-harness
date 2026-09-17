# Agent Note: Bounded Team control-plane read pages

Status: implemented

[English](2026-09-01-bounded-team-control-plane-pages.md) | 中文

## Problem

Team provider 已经会以 storage-sized page 读取 channel WAL，但面向产品的 channel、Team、participant 和 task read 仍可能返回完整逻辑结果。因此 Host、SDK、Python 与 Web consumer 没有共享 continuation contract，长期运行的 Team 可能让一次 management request 产生不必要的大 response。Internal scheduler 与 recovery scan 仍需要完整 projection，所以不能把所有已有 full-read caller 都改成 page，否则会混淆产品 pagination 与 provider-owned replay。

## Decision

`clocky-team`新增独立的 bounded read seam：`listTeamsPage()`、`listParticipantsPage()`、`listTasksPage()`和`readChannelPage()`。Collection request 携带 exclusive `afterCursor` 与正整数 `limit`。数值 collection page 使用 bounded look-ahead；Team discovery continuation 统计扫描条目，并可跟随空页。

Team-list cursor 是有界 provider scan 的 opaque 位置；归档和无关名称占用扫描工作量，但不会成为可见 item。Participant 与 task cursor 指向 durable projection map 保留的稳定 provider order。Channel cursor 是 channel-WAL sequence。本地 Hub 会以 `recoveryPageSize` 限制请求 page，校验 channel record 连续性，并只对 bounded page 中的 record 应用 view policy。已有 full `listTeams()`、`listTasks()`和`readChannel()`继续作为 scheduler、recovery 与 finalization scan 的 provider-owned seam。

Recovery Consumer 只有在完成该 page 中每个 summary 的 hydration 后才会提交 Team discovery cursor。Channel admission 与 human delivery queue 在传播临时 Team、channel、storage 或 admission failure 前会把当前 channel 重新放回队列，因此下一次 bounded pass 会重试同一项，而不会越过未处理工作。

Host 的 `team.list`、`team.member.list`、`team.task.list` 和 `team.channel.read` route 接受可选 cursor／limit field，并将解析后的 default 转发给 page seam。TypeScript SDK protocol 与 high-level API 暴露相同 field 和 continuation result。Python SDK 将 snake-case cursor／limit argument 转发为相同 wire field。Browser Team refresh 会跟随 Team-list continuation page，runtime contract 也会暴露 channel page continuation。

已有的 `readAudit()` page 现在也会读取一个 bounded look-ahead record，因此恰好结束的最后一页不会错误地带上指向空 continuation 的 `nextCursor`。

已有不带 page field 的产品 caller 会收到 server 的有界 default page；需要更多内容的 caller 必须显式继续读取。

Team discovery 使用有界 backend name iterator，不使用数组 ordinal 或完整 stream listing。SQLite 定位 name 索引；JSON 扫描目录条目而不解析 body。本地 opaque cursor 最多保留配置数量的扫描，每个扫描只保留一个 retry page。即使没有可见 Team，`scanned` 仍限制实际 discovery 工作量；过期要求显式开始新扫描。Scheduler 每个 pulse 推进一页，每个有界 Team 轮次后归还事件循环处理合并工作。Delegation 也把`maxOperationsPerDrive`应用于返回前的整个轮次；自身产生的 WAL 事件不能重置预算，后续工作按每个 parent 合并到一个后续事件循环轮次。路由缓存只保留未解决的 child 关系，不累计整个 child 历史；终态 snapshot 移除路由并直接用 ancestry 唤醒 parent，冷 discovery 不重新缓存这些终态关系。Admission 保留其读取的 Team/channel 投影引用。归档 Team 及 audit handle 在最后一个已接纳读取结束后释放；终态 channel 不等待无关 watch。重新打开会等待旧 stream 关闭。结束的 admission 清空引用集合，避免继承的异步上下文保留已丢弃投影。Discovery 读取与每个 Team journal 批次原子提交的 tail 摘要：JSON 放在同一原子文档首行，SQLite 在同一事务更新元数据行。`maxDiscoveryBytes`限制读取，并在追加前拒绝超限元数据。摘要缺失或不匹配会失败，不回退到完整回放。不使用异步维护的独立索引，以免崩溃后暴露过期生命周期。Team journal format 33 要求此摘要，SQLite physical schema 3 保存摘要。显式 hydration 仍负责完整历史验证。

`getTeamSelection()`提供有界身份、生命周期、显示前缀、集合计数和准确 coordinator binding，不实体化历史数组。Host 与 SDK transport 保留这一独立投影。浏览器 fixture 与 Hub 共用纯数据入口`@clocky/clocky-team/selection`；投影器将大小失败作为数据返回，由各 caller 映射 transport error。浏览器白名单只允许该 subpath，不允许 Team runtime 入口。尚未完成的启动返回`starting`；协调者歧义或缺失返回明确的不可用原因。UTF-8 文本截断保留完整 code point；路由元数据超出配置的总字节额度时拒绝。冷 selection 仍在内部加载完整权威 Team。 `includeMetadata: true`仅在完整响应仍符合相同字节上限时附带准确目标、预算和用量；超限返回明确的 unavailable 状态，保留轻量选择结果。待处理人工操作计数与取消原因文本仍是有界显示数据。

`getMemberSession()`返回指定保留成员最后一个已发布的 activation/Session/provider 绑定，包括离线历史，不启动或恢复 Agent。Hub 使用`maxSelectionBytes`限制该响应；成员不存在、绑定不存在或身份字段过大均明确失败。Host `team.member.session`与 SDK `team/member-session`保留准确的 Team/成员选择；浏览器和 SDK 拒绝身份不匹配的响应。浏览器成员查看使用这一按对象读取入口，不加载完整 Team。

`getHumanAction()`按 Team/action 身份读取一个当前持久操作，并受`maxSelectionBytes`限制。缺失或超限时明确失败，不回退到完整状态。Host `team.action.read`和 SDK `team/action-read`保留这一选择；读取不会接纳回答。

Team、通道和收件箱列表、通道记录及审计视图各保留一个 provider 页。续页替换当前窗口，失败保留原页。Team/通道列表刷新重读当前起点，返回首页才重启遍历；已选 Team、任务和通道不依赖列表成员。收件箱换页复用未提交回答确认。通道同意操作的重试身份由通道、参与者、邀请版本和 manifest 指纹派生，不需要历史键缓存。

可见 selection 只包含有界标量元数据与计数；执行记录属于独立集合窗口和任务 inspector。首次打开与后台读取使用`getTeamSelection()`。Session 摘要携带头部中不可变的 Team/Participant 身份；协调者输入按需通过有界 selection 核对，只有当前频道 admission 可免去重复归属读取。历史路由没有独立缓存。进入草稿释放 selection 和窗口；GC 回归检查旧选择与页面窗口可被回收，且 coordinator 路由仍可使用。

`browse()`读取任务、成员和工作流列表摘要，保留准确 id、协议角色、revision 与计数，不返回说明、grant、attempt/review 数组、DAG 模板或结果 body。`maxSelectionBytes`限制整页，`maxSelectionTextBytes`限制文本前缀，`recoveryPageSize`提供默认和最大行数。整页预算对每行只计算一次编码字节数（包括 JSON 转义与分隔符），不反复编码增长中的页面。字节预算耗尽时，续页从第一条未读记录继续；单条记录无法放入时明确拒绝。`scanned`包含 ordinal 前缀遍历，因此该 API 限制响应大小，不声称前缀扫描或冷 hydration 已有工作量上限。Host `team.browse`与 SDK `team/browse`拒绝响应作用域不匹配。

`inspectTask()`将可编辑的当前字段与已结算 attempt、review decision 分开。历史窗口使用索引，不遍历前置数组；`expectedRevision`防止混合不同任务版本的页。Core/Host/TS/Python 校验计数、归属、attempt ordinal 和续页条件。完整响应先检查容量再复制；单个记录超限不会阻止读取其他分区。子团队结果保留其接纳数据，不伪造 Participant attempt；接纳规则已禁止私有产物引用。共用的结果投影器为详情及现有 Host 任务/工作流读取移除私有产物引用，包括 integration proposal。

工作流详情从串行化的计划投影生命周期、执行上限和一页任务/依赖引用，不复制完整 DAG 或任务结果。字节预算包含查找计数，续页锁定计划版本。浏览器列表使用工作流摘要，独立保留一个可取消的详情窗口；失败和过期响应保留原页。

浏览器任务工作区读取 task browse 行及独立详情分区。最近结果引用与按时间排序的历史窗口分开，换页不会把旧结果标成最近结果。刷新失败保留当前字段；版本变化保留可见数据并显示新版本提示，同时禁用修改操作。刷新会替换当前记录并清除其他版本的历史。页外依赖直接打开详情，不伪造列表行。停止后的结算只轮询所查看的任务记录；关闭详情取消读取，模块导航保留单份有界详情。

任务 Session 导航使用已有的有界成员绑定读取。Participant 的 Session id 跨 activation epoch 保持不变，因此任务视图只需记录中的 participant 身份，不需要 activation 历史数组。绑定缺失会失败，不替换其他 participant，也不恢复 Agent。

待处理操作预览仅从当前 principal 收件箱页派生。临时 approval/question 事件只标记有新数据，不保留请求正文或替换页面。Durable 更新按 revision 更新匹配的可见操作；页外更新只标记可用性。换页会释放旧预览和问题正文。频道重试指纹只保留 canonical content、audience 和 delivery 的 SHA-256 摘要，不在指纹状态中重复保存编码媒体正文。未变更的重试复用原键，包括提交前撤回编辑的情况。发送确认后，先清除 inline 文字、媒体和重试状态，再等待频道刷新。刷新失败不会把已接纳内容重新视作待发草稿；未确认的发送即使刷新也失败，仍保留原始错误和重试状态。显式导航沿用收件箱现有的未提交回答确认，不通过自动刷新丢弃草稿。

`inspectMember()`按成员读取准确的非敏感身份与 placement 元数据，以及一页按索引读取的 capability。不复制其它成员、grant、启动 reservation 或派生 attempt 统计。Capability 保留准确字符串，整页必须满足`maxSelectionBytes`；元数据或单条 capability 过大时明确拒绝。续页固定`expectedTeamCursor`，成员状态变化后必须刷新。Host、TS/Python SDK、fixture 和浏览器详情共用这一数据契约。弹窗替换分页，失败保留当前页，关闭时取消读取。

浏览器草稿保留使用经过验证的公开部署上限：所有频道的条数与总序列化字节数，并原子更新每条草稿的字节计数。超限拒绝当前编辑，不淘汰其它草稿，也不发送无法保存重试状态的请求。发送确认和明确丢弃释放位置。纯浏览偏好有独立条数上限，包含草稿的视图保持驻留。`client-modules.browserConfig`只为已声明浏览器插件发布显式 JSON 配置；web Loader 在页面启动时交给各插件 schema 验证。不隐式复制 Host 配置；部署修改后需要刷新页面。

## Alternatives considered

**原地修改已有 full-read method。** 不采用：scheduler、recovery、finalization 与 test-only authoritative scan 有意需要完整数据。把它们与产品 page 混用，要么破坏 recovery，要么迫使 provider 从 API-shaped page 重新拼出 full result。

**让 Host 对 `getTeam()` 或已经 materialized 的 full result 做 slice。** 不采用：这会让 provider 与 transport boundary 仍然无界，而且 channel read 仍需先重建整个 WAL 再切片。Provider-owned page seam 会在 storage／projection boundary 处限制 response。

**为所有 list 使用 string token 或 Team journal cursor。** 不采用：participant／task list position 是 projection-order cursor，不是 journal position；引入 opaque token persistence 会增加 state，却不会改善本地 pre-release contract。不同 list family 使用 distinct numeric cursor semantics，并在文档中明确说明。

**当 page 恰好填满时直接返回 `nextCursor`。** 不采用：恰好结束的 full page 会错误宣传 phantom continuation，导致不必要的空请求。一个 bounded look-ahead record 可以在保持内存有界的同时明确判断 exhausted。

## Consequences

Management plane 在 local Hub、Host、TypeScript SDK、Python SDK 与 Web refresh 之间拥有统一 page vocabulary。Response 同时受 caller limit 与 Hub 配置的 recovery size 限制；channel view projection 在产品 read path 中不再要求完整 WAL。代价是 list traversal 由 caller 负责，并且并发插入会按文档化的 provider-order traversal semantics 被观察。完整 provider scan 仍只对拥有 replay 或 repair 责任的代码开放。

Core schema、JSON／SQLite Hub restart、Host fetch、SDK server forwarding、Web refresh 与 Python wire test 覆盖 page limit、cursor advancement、最后一页耗尽、channel look-ahead 和 restart reconstruction。Property/model-based、real-model、distributed、browser/GIF 以及 load/retention evidence 仍按 [native multi-agent work-system proposal](../../proposed/architecture/2026-08-27-native-multi-agent-work-system.zh.md) 保持 pending。
