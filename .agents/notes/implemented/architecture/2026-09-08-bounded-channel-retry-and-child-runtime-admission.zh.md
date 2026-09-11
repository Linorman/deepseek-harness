# Agent Note: 有界频道重试与 child runtime admission

Status: implemented

[English](2026-09-08-bounded-channel-retry-and-child-runtime-admission.md) | 中文

## Problem

认证后的高层 channel input 可能在返回 accepted Envelope 的响应丢失后继续存在。如果在 durable Hub 幂等查询前重新检查实时 protocol turn，consult response、discussion bound 或 direct channel close 后的有效重试就会被拒绝。Placement 还必须区分 child-Team task 与 Participant task，restart discovery 也不能在一个 pulse 中扫描所有 Team。

## Decision

Host 与 SDK principal admission Consumer 在根据不可变 membership 和 retained request anchor 重建 canonical consult 或 discussion draft 时保留 caller 的 channel post key。它们仍要求当前 authenticated human invitation 已 acknowledged，然后由锁内 Hub 查询决定返回原 Envelope，或继续执行当前 phase、cursor、adapter 和 policy 校验。等价的 null 与 exact-peer audience 归一化为同一个 draft；canonical 字段变化仍然是 conflict。Host RPC 将该 conflict 映射为 `team-channel-idempotency-conflict`。

`team-placement-default` 只为 `participant` task 申请 Participant activation。挂载 workspace registry 时，placement 先请求选定 provider 的可选 `preflight()`，在 activation 前拒绝能够判断不兼容的 route；随后用 `eligible()` 检查返回的 activation，并在保留 placement lease 前释放不兼容的 activation。没有 preflight 能力的 provider 仍受 activation 后检查保护。

`team-delegation` 通过 `listTeamsPage` 发现 Team，并在有界 pulse 之间保留 provider-order continuation cursor。事件驱动请求仍会唤醒受影响的 Team 及其 parent；restart discovery 从 `-1` 重建 cursor。

TeamRun 持久化 complete finalization intent 后，Hub 允许在 Team quiescing 期间读取该 exact final channel 的有界 pending delivery。其他 channel 和 cancellation path 仍保留 active-state 检查。

Shared workspace provider 提供 opt-in periodic observation pulse。每个 pulse 只按配置上限访问 live provider allocation，通过现有 Team proof 和 WAL path 记录明确的 `periodic` observation stage，与 release/publish scan 串行，并在 disposal 时等待已接受的 pulse。默认 interval 为关闭。

## Alternatives considered

**增加高层 channel receipt 查询。** 拒绝，因为现有 sender/key WAL projection 已保留 canonical Envelope，能够在 JSON 和 SQLite restart 后恢复，并且会在 Hub channel lock 内检查。

**让 placement 将每个 ready task 都当作 Participant task。** 拒绝，因为 child-Team execution 拥有自己的 topology，不能申请 Participant activation lease。

**保留完整 `listTeams()` discovery，只依赖每个 Team 的 operation bound。** 拒绝，因为 pulse 仍可能在 operation bound 生效前执行无界 Team discovery，使事件驱动工作饥饿。

## Consequences

带 key 的高层重试仍受当前 authenticated membership 和 invitation acknowledgement 约束；新 key 不能绕过 Hub 执行的 active phase 或 expected speaker 检查。Attachment admission 在 Hub 返回 retained Envelope 前仍可能重复执行 provider 侧的 content-addressed lookup。Workspace provider 可以通过 `preflight()` 在 activation 前拒绝 route；没有该能力的 provider 仍由 activation 后的 `eligible()` 检查保护。Periodic observation 为 opt-in，不代表 filesystem lock 或 writer identity。

Team detail projection 会在 task id 和 revision 对应时，将 selected Team 的较新 task facts overlay 到已经由 bounded task page 加载的 row 上。这保留 page bound，同时避免 stale row 隐藏 child-Team navigation 或当前 result state；它不会暴露已加载 page 之外的 task。

Bounded task collection 在首个 page 加载后也会保留显式 refresh 操作，因此即使 notification 没有携带 newer marker，用户仍可 reconcile durable child 或 task mutation。Refresh 继续受 cursor bound 约束，失败时保留已有 row fallback。

正常 completion quiescence 期间，human-owned outbox 可以从其参与的 active 或 closed channel 继续执行有界 pending read，以便排空普通 response；activation-bound model delivery 仍只允许 active Team 与 active channel，final channel 继续使用独立的 completion admission。

## Verification

### 当前 candidate 补充（2026-09-09）

Python SDK runtime 的默认组合现在在 `team_task_delegate` 旁挂载 Team workspace registry 与 shared provider。通过 `python/sdk-runtime/node_modules/.bin/clocky-jsonrpc-agent` 运行的 `sdk-child-team` smoke 已通过，覆盖 parent delegation、child completion、result admission 和 parent final acceptance。独立 Loader crash snapshot 已在 SQLite 与 JSON 两种 backend 上通过 13 个窗口：child creation、child-run binding、child response、parent result-admission、child result admission、child response receipt、child closure、child terminal phase、parent charge pending、parent charge accepted、parent charge settled、parent settlement 以及 child cancellation 后注入 SIGKILL。重启后保留 durable result/cancellation intent 且不重新进入模型；pre-terminal 窗口对 in-process provider 返回明确的 `ACTIVATION_TERMINATION_UNCONFIRMED` stall，child-terminal/parent-settled 窗口保留 parent task completed、parent Team active 的 coordinator finalization pending 状态。Charge window 的 append race 可能在 selected charge record 前或后保留 parent result，但两个 backend 都保持不重复和不重新进入模型。本次配置变更后的最新 full-repository run 为 16,022 个通过、1 个失败、116 个跳过；失败属于已有的 Team Agent Client link-lifecycle 时序用例。该文件第二次隔离重跑为 80/80，而第一次隔离重跑触发了另一条时序失败，因此该 lane 保留为 flaky evidence，不记为全仓绿色结果。

Hub terminal recovery 现在会在验证 child result 时保留 in-flight Team stream，使 `assertParentResultStored()` 复用已打开的 parent stream，而不是再次 open。该修复关闭了 JSON `parent-settled` restart 中此前把 `already-open` storage error 误报为 malformed completed-child evidence 的失败；修复后聚焦的 9 文件 child matrix 仍为 258/258。

Client Team runtime 现在消费已有的 bounded member/task/artifact page APIs，维护独立 collection state。TeamPage 展示这些 rows 和显式 continuation controls，以 selection generation 拒绝 late read，并在 page 失败时回退到 authoritative snapshot。Host artifact page 会在暴露前过滤 private 和 ambiguous refs。runtime Team-task suite 通过 33/33（包含 selection change 后拒绝 stale collection response、artifact continuation、failed-page retention、non-advancing cursor rejection 和 `hasNewer` marking），TypeScript SDK focused suite 通过 98/98，Python SDK suite 通过 45/45，完整 Team UI suite 通过 7 个文件/61 个 tests；完整 browser race coverage 仍未闭合。

TeamPage 还会从 authoritative Team snapshot 只读投影 workflow plan：lifecycle phase、bounds、ordered template rows、task bindings、dependency links、result count 和 failure reason。它不创建或修改 plan；`team_workflow_*` 仍是 tool owner。完整 Team UI suite 通过 7 个文件/61 个 tests；bounded workflow-plan read API 和 browser race coverage 仍未闭合。

Host 现在提供 bounded `team.workflow.plan.list`，client runtime 将其加载为独立 workflow-plan collection cursor。同步后的 TypeScript SDK protocol/client/server tests 通过 98/98，Python SDK client tests 通过 25/25；stale-read race 和 browser coverage 仍未闭合。

聚焦 source tests 覆盖 AgentRuntime、basic/direct channel adapter、有界 delegation discovery、child-only placement、preflight 拒绝、workspace root compatibility、bounded periodic observation（21 个 workspace tests）、workspace 不兼容时立即释放 activation、SDK close 后 consult replay、Host close 后 direct input replay、JSON/SQLite envelope admission/recovery（42 tests）、JSON/SQLite terminal-channel recovery（32 tests）、completion intent 后的 TeamRun finalization read，以及 child/delegation/result/usage slices（134 tests），并包含 normalized audience replay 和 canonical conflict mapping。合并后的 runtime/channel candidate slice 为 16 个文件、316 个 tests 通过、1 个按平台跳过；activation recovery/ACP/controller slice 为 8 个文件、134 个 tests 全部通过，其中包含 JSON/SQLite closure recovery；extended transport、client、tool 与 human-outbox channel slice 为 8 个文件、196/196 全部通过；ACP bridge/lifecycle 为 23/23，ACP demo composition 为 13/13，SDK plugin composition 为 6/6。额外 channel fixture slice 覆盖 channel-open cleanup（32/32）、retained implementations（9/9）、replay properties（2/2）、全部 edge cases（37/37）以及 interrupt/invariant authority（7/7）；workflow selection recovery 为 6/6；child reservation lineage edge cases 为 2/2，team-hub restart/nested-usage/pending-charge child slices 为 5/5；变更 package 的 TypeScript project references 已一起编译，当前 source/catalog candidate 的 `doc-typecheck` 与 `verify-config-catalog` 已通过。完整 Hub directory 当前 candidate 已通过：50 个文件、780 个 tests 全部通过。同一 candidate 的 full-repository lane 覆盖 1,009 个 test-result 文件，16,139 个 tests 中 16,023 个通过、0 个失败、116 个跳过。T-01 已由这两套同候选 suite 确认；T-03 仍未验证，因为 child cross-log kill-point matrix 仍是独立必需证据。

Team detail surface 现在会投影 child-Team phase/failure、已接纳 result text、非 private child artifact refs，以及只读的 `openTeam(childTeamId)` 操作。Overlay 会先关闭 parent detail 再打开 child，且不会自动 resume child。聚焦 UI TypeScript face 和完整 Team UI suite 通过（7 个文件、59/59），strict frontend design audit 为零 findings，`doc-typecheck` 通过；完整 browser/GIF 覆盖和有界 collection pagination 仍属于独立的 T-06/F-UI-01 工作。

### 当前 candidate 后续补充（2026-09-09）

有界 client collection runtime 现在将 provider-owned artifact page 与 task page 独立维护。后完成的 task response 不能覆盖先完成的 artifact page；Team cursor 前进时，workflow-plan collection 会与 members、tasks 和 artifacts 一起标记为 newer。runtime 回归覆盖反向完成顺序并通过 34/34。

Child-delegation Consumer 会将非推进的 channel continuation fail closed 为 `TEAM_CHANNEL_CURSOR_CONFLICT`，不再让 recovery drive 自旋。Team discovery 对应增加非推进 page 检查并报告具名 cursor conflict；channel-admission recovery 对其有界 Team page 使用相同检查。delegation focused suite 通过 9/9，admission/scheduler composition suite 通过 64/64，invitation/local/WebSocket channel suite 通过 71/71。Client、delegation 和 admission TypeScript project references 均以 exit 0 编译。这些检查不扩展独立的 browser、multi-host、coverage 或 release 结论。

当前 AgentRuntime SDK provider 与 ACP lifecycle compatibility slice 通过 40/40，另有 1 个按平台跳过的测试，覆盖 local recovery fencing、remote Link recovery 和 ACP child lifecycle；不宣称 ACP independent-host recovery。

Hub 现在会将 terminal dependency 传播到普通且尚未启动的 child task，形成 durable cancelled outcome。Parent task 会保留包含 blocker identity 及其 terminal revision/phase 的 `blockedByOutcome`，requested child reservation 则在没有创建 child Team 或 Participant lease 的情况下进入 cancelled。真实 SQLite edge case 已通过，Hub directory 当前为 50 个文件、781 个 tests；该修改关闭 shared-workspace dependency outcome slice，但 model-facing blockedBy authoring 与延期的 child 组合仍不在范围内。

随后加入 invitation property 和 SQLite child-reservation 后，当前 Hub directory 为 50 个文件、783 个 tests；781-test 数字仍代表前一个 candidate slice。

随后加入 durable ranking replay 与完整 failed/cancelled/deleted child dependency matrix 后，当前 Hub directory 为 50 个文件、787 个 tests；785-test 数字代表前一个 candidate slice。

Team-level recovery 现在会在重新读取 Team state 前，校验 local 和 WebSocket Team Link journal watch 返回的 cursor；重复或回退的 `changed` 结果会让 Link fail closed。Workspace release recovery 对有界 Team-list continuation 使用相同的 fail-closed 规则，并在重新扫描重复 page 前报告 `TEAM_CURSOR_CONFLICT`。三个 recovery regression 已通过：workspace-recovery suite 为 28/28，local/WebSocket/workspace focused slice 为 96/96；变更后的 Link 与 recovery TypeScript face 以及 targeted lint 均通过。Channel cursor 校验和独立的 multi-host/browser/release 边界保持不变。

TeamRun 现在会对 quiescence wait、workflow-plan wait、child-task wait、completion wait、channel final wait 和 default-worker task watch 使用相同的 Team-watch progress 校验。重复或回退的 `changed` 结果会按所属 wait 报告 `TEAM_RUN_NOT_QUIESCENT` 或 `TEAM_CHANNEL_CURSOR_CONFLICT`，而不会再次提交同一本地 wait。TeamRun suite 通过 93/93，TypeScript face 通过；package-wide lint 仍报告本次变更之外的既有问题。

SDK activation recovery 现在会在有界 Team-list continuation 重复或回退时报告相同的 `TEAM_CURSOR_CONFLICT` code。真实 startup recovery suite 通过 22/22，TypeScript face 通过；这只关闭本地 recovery continuation 的错误分类，不扩展 ACP 或 separate-host 证据。

Hub 测试现在增加了固定 seed 的 child-reservation model companion，覆盖 create/retry、bind、stall、cancellation、child terminal outcome、settlement、concurrency usage 和 checkpoint parsing，共生成 100 个 action sequence。Property 使用 seed `20260912` 通过；live JSON/SQLite interleaving 与完整 T-08 matrix 仍由独立证据负责。

Live reservation matrix 现在会在 JSON 和 SQLite 上执行 create→bind→parent cancellation，在 child terminal 前拒绝 settlement，然后通过 closure continuation 取消并 terminalize child，再结算 parent。task-delegation suite 通过 7/7；更广泛的 child interleaving 仍由独立证据负责。

Hub lifecycle fixture 现在还会在 dispose SQLite Hub 前通过 AbortSignal 取消 idle channel watch，同时保留 startup/first-page/enumeration/RSS/shutdown reference metrics。该 2/2 slice 只增加 macOS same-process lifecycle 证据；fresh-process、Linux 和 CI performance budget 仍未闭合。

Channel admission 现在会把不推进的 `watchChannel()` 结果拒绝为 `TEAM_CHANNEL_CURSOR_CONFLICT`。其 focused service regression 为 1/1，admission TypeScript face 与 targeted lint 均通过；这只关闭本地 wait continuation safety。

本地 artifact retention Consumer 现在会把重复的 Team-list continuation 分类为 `TEAM_CURSOR_CONFLICT`，不再返回普通 failure。其 provider suite 通过 7/7，TypeScript 与 targeted lint 均通过；跨 host artifact retention 仍不在范围内。

principal human-inbox Consumer 现在会对启动 Team-list delivery scan 与 durable storage row iterator 使用具名 cursor guard。其 JSON/SQLite inbox suite 通过 16/16，TypeScript 与 targeted lint 均通过；分布式 inbox retention 仍不在范围内。

closure-driver discovery Consumer 现在会在有界 scan 重用 cursor 前，以 `TEAM_CURSOR_CONFLICT` 拒绝重复的 Team-list continuation。其选定 discovery regression 通过 3/3，TypeScript 与 targeted lint 均通过；更广泛的 closure-driver 和 multi-host 证据仍独立保留。

ACP 同主机 recovery 现在使用显式的 `acp-local-cold-replace` record，保存 runtime profile、workspace cwd 和准确 child process identity。只有在配置 recovery 且主机提供 exact process identity 时，ACP provider 才注册匹配的 local fencer；activation controller 的 cold replacement 会恢复持久化 cwd 和 resume Session。Startup recovery Consumer 显式按 record kind 选择，默认仍是 SDK recovery。ACP lifecycle/schema/recovery slice 通过 23/23，另有 1 个依赖 macOS identity 能力的 skip；跨主机 ACP supervision 仍不在范围内。

有界 Team collection runtime 现在会在 member、task、workflow-plan 或 artifact read 开始后、selected Team cursor 前进时保留 `hasNewer`。因此 late first-page response 不能隐藏 authoritative Team refresh 发布的 newer marker；continuation read 也会保留已有 marker，直到显式 newer refresh 成功。workflow-plan stale-read regression 已通过，Team-task runtime suite 为 36/36。

TeamRun 现在支持在 frozen product template 中配置 JSON-friendly `placementDefaults`。对于省略 `placement` 的 participant task，Hub admission 只在创建时解析一次该 default；显式 task placement 仍优先，resolved restriction 会随 task 持久化以保持 retry 和 restart 稳定。聚焦的 Hub 与 TeamRun placement/template tests 已通过。

Authenticated HTTP supervisor 现在会在 client 和 endpoint 的每个请求读取配置凭证。因此已有 client/listener 无需重建即可接受轮换后的环境变量；启动后凭证变为空时会以 `SUPERVISOR_UNAVAILABLE` 或 HTTP 503 fail closed。Endpoint suite 通过 7 个 tests，另有 1 个 Linux-only skip；TypeScript face 与 targeted lint 均通过。

原 subagent 与 model-authored workflow family 现在是 private compatibility package，只由显式 examples 消费。Clocky release family 和 Python runtime carrier 排除它们；product tool catalog 跳过这些 private tool manifest；legacy cutover gate 检查 default config、carrier dependency、catalog、public release member 和 packed tarball。当前 release pack 包含 249 个 public Clocky tarball 且没有 compatibility tarball，AgentRuntime/ACP/SDK package 保持可发行且未被删除。

本地 cold replacement 现在会在 AgentRuntime provider 被撤销、本地 stale-epoch fencer 缺失，或该 fencer 无法终止所拥有 epoch 时持久化 typed Team stall。对应 code 为 `AGENT_RUNTIME_PROVIDER_UNAVAILABLE`、`AGENT_RUNTIME_FENCER_UNAVAILABLE` 和 `AGENT_RUNTIME_FENCE_FAILED`；这些 local-owner case 可以没有 supervisor descriptor，而 supervisor-owned recovery 继续保留准确 descriptor 与 generation 检查。聚焦的 controller/schema slice 通过 29 个 tests。

Team cancellation cleanup 现在会在每个 cancelled workflow-plan projection 上保留结构化 reason。TeamRun 与 `team_workflow_wait` 会携带该 reason，TeamPage 会在 cancelled phase 旁显示它；JSON/SQLite workflow replay 与生成的 tool catalog 使用同一 optional field。

Workflow-plan collection 现在由 Hub provider boundary 的 `listWorkflowPlansPage()` 执行分页。Host 和 SDK 会直接传递 durable cursor 与 limit，因此较大的 plan history 不会先作为 unbounded source collection 完整 materialize 后才形成 wire page。

旧的 unbounded Core `TeamRuntime.listWorkflowPlans()` method 已移除；source contract 现在只暴露 provider-bounded page method，Cordis API/catalog region 也记录了这个 bounded seam。

旧的 unbounded Core/Hub `listTasks()` method 也已移除。TeamRun finalization 现在使用带 cursor-progress 校验的 task page scan，因此剩余 internal task read 与 Host/SDK collection read 使用同一个 bounded source contract。

Team DAG scheduler 的 all-Team pulse 现在通过显式 `teamPageSize` 的有界 `listTeamsPage()` continuation 发现 Team。重复或回退的 discovery cursor 会 fail closed，dispose 期间也会在继续调度其他 Team 前停止 page scan。

Core/Hub unbounded `listTeams()` contract 现在已移除。Scheduler、recovery、workspace、human-client 和 ACP fixture 都使用 `listTeamsPage()`；SDK public `listTeams()` 只作为循环读取 page 的 bounded transport facade 保留。

当前 child-row authority follow-up 已通过 focused UI Team browser suite 38/38、client Team/channel runtime suites 57/57、两个 client TypeScript face 以及当前 197-artifact build。Selected Team projection 会将较新的 task revision overlay 到已经加载的 bounded row，runtime 也会在 task-change event 后对 selected Team 执行 targeted refresh。Active-child browser navigation 和 separate-host transport 仍未验证。

父 Team 的 cancellation boundary 现在使用由 `team-run` 所有、由 `team-delegation` 注册的可选 effect-scoped `TeamDelegationDriver` registry。TeamRun 持久化接受 parent cancellation 后，会在释放本地 ownership 或报告 cancellation 前等待现有的 coalesced delegation drive；没有挂载 delegation Consumer 的组合保持原有行为。TeamRun 与 TeamDelegation focused lane 通过 104/104，真实 child-delegation cancel Loader snapshot 通过 1/1、另一个 sibling scenario 按筛选跳过，当前 channel browser lane 通过 4/4，当前 build 生成 197 个 client artifact。这只关闭本地 parent-cancel/child-saga 时序 gap；remote、multi-host 和 active-child browser 证据仍未完成。
