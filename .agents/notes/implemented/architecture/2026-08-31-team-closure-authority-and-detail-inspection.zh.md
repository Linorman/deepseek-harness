# Agent Note: Team closure authority and detail inspection

Status: implemented

[English](2026-08-31-team-closure-authority-and-detail-inspection.md) | 中文

## Problem

Team completion 和 cancellation 可以通过普通 phase write 表示，而 task、workspace、review 与 product consumer 各自只携带完成判断所需的一部分 proof。浏览器页面也只有 Team summary，没有由 owner 路由的方式查看权威 channel record、audit entry、task outcome 或 Participant Session descendant。

## Decision

`TeamRuntime` 暴露 typed `completeTeam()`、`failTeam()` 和 `cancelTeam()` command。Completion 要求准确的 coordinator-to-human final Envelope、持久 human receipt、已完成的 objective，以及 task、activation、human action、channel 和 delivery 都已 quiescent。Failure 要求 task 和 activation 已到终态。Cancellation 首先追加 `team/cancellation` request，将 active 或 stalled admission 移到 `quiescing`，取消无 lease 的 work 与 pending human action，并关闭 channel；active lease 或 activation 在 owner settle 或 fence 前仍然可见。相同 key 的 retry 会在这些 resource quiesce 后完成 request，不同 key 会冲突。本地 `TeamRun` Consumer 会在释放 coordinator lease 前请求 cancellation；若拒绝发生时没有可观察到的 cancellation request，则会保留本地 run ownership 以供 retry。Product Host 不再路由通用的 `team.phase` mutation。

挂载的 `team-closure-driver` Consumer 会在重启后从持久 Team state 恢复已接受的 completion、failure 和 cancellation intent。TeamRun 在 completion intent 后、receipt 与本地 teardown 前持久化独立的 final-result admission。只有 intent 的结果由 driver 通过追加到同一个封闭 sink 来接纳，driver 返回新的 cursor，之后只凭新的 continuation authority 修复 receipt。它还会在 coordinator 的 missing-final、structured turn failure 或 frozen budget exhaustion 返回 caller 前记录该事实。Closure-owned pending delivery 会在 channel 和 Team 的终态 record 提交前收到带明确 reason 的 `channel/delivery-expired`；未确认的 remote termination 会保持 stalled，而不会被报告为已 settle。

`team-run-result` sink 记录准确的 Team、channel、Envelope、WAL sequence、canonical content fingerprint、派生的 recipient 与 durable owner，以及 Team-scoped idempotency key。该 journal fact 独立于 closure intent 和 receipt；checkpoint 保留这项事实，channel retention 保留其引用内容。它继续作为 unattended system-owned run 的封闭 result owner。Principal-owned final 改用 `principal-inbox`：Hub 等待 [human inbox Consumer](../../../../packages/team/team-human-client/README.zh.md) 完成追加，再记录带准确 inbox sequence 的 admission。Recovery 使用同一 sink 选择和幂等 Envelope identity。产品 display acknowledgement 是独立的单调 principal cursor，不能证明 channel delivery。Notification 或 model claim 不能重建已接纳结果。

终态恢复根据每个关联 channel 的 WAL 验证所属 Team、终态 phase 与交付结算。Completed Team 还必须具有相互匹配的 closure 选择和独立 final admission、准确的保留 Envelope 及内容 fingerprint，以及对应的 human receipt。Checkpoint 或重放投影对外可见前执行这些检查；不一致的 checkpoint 回退到 source journal，存储错误和实现加载错误继续向调用方报告。Final 查找从保留的 WAL cursor 开始，使合法前缀压缩后仍能恢复 completed 状态。

首次结果接纳与 completion intent 都要求 pending human delivery 或已提交的 human receipt。持久 expiry 不能占用结果位置，只有经过 deadline 不能使交付失效。Sink 接纳结果后，scheduler TTL expiry 会保留准确 channel、Envelope 和 recipient 的交付直至 receipt，重启后也一样。该选择在 expiry 批次截取前执行，使其他到期交付仍可结算。明确取消与失败按各自的 durable intent 结算交付。

Closure-driver 的启动调用方共享一次初始恢复扫描。每个 Team serializer 拥有所有合并的 observer action，在入队前复制输入，并在某个 pass 失败后继续处理其余 action，再报告累计的失败。这样，失败或重复的通知不会丢弃另一个已接纳的 observation。Dispose 会同步关闭新接纳入口，拒绝 backend pass 尚未开始的排队 observer，将每个已接纳的 proof 保留到对应 backend pass 结算，并在关闭失败时仍注销公开的 driver。

Hub bridge 在生命周期结算前将一次精确 epoch 的恢复委派给 activation controller。Team cursor 改变时结束本次 pass，再用新 authority 继续。已接纳的 completion 不因原 actor 不同而跳过 Team event，因此没有轮询 pulse 的部署也能在 result admission 或资源恢复后继续推进；TeamRun 不再保留另一套 channel-cleanup 窗口。

Controller 的 stall command 区分 proof 载荷无效与并发 Team 写入。Proof cursor 与 command 不符时拒绝其权限；若准确 intent 和 epoch 仍有效，则持久 cursor 推进会返回 `TEAM_CURSOR_CONFLICT`，使 controller 能在配置上限内重新读取并重试。

直接取消和 driver cleanup 会先尝试所有选定 channel 分支，再报告存储失败。单个失败保留原错误，多个失败按执行顺序汇总，durable intent 继续支持重试。前一 policy 等待期间可能撤销 proof，因此每个分支在 policy 前及 append 前都重新验证 authority。重试跳过已关闭 channel，任何分支失败都会阻止 Team 被接纳为终态。

Team 与 Participant authority grant 是不可变的 typed subset。Child Team、Participant 和 task request 不能扩大 operation hook、workspace mode、relative read/write scope 或 typed resource ceiling。Task admission 会针对 Team budget 保留声明的 ceiling；assignment 与 usage path 会在接受新的 lease 或 model step 前执行运行时 wall-time、retry、concurrency、token、turn 和 cost limit。Typed cost ceiling 会拒绝 provider pricing 未知的 sample 或 child charge，而不会按 0 计入。Review assignment 携带准确的 completed result、reviewer、initiator 和 review revision；reviewer 从已记录 source 派生 CAS fence，并在 resolve task 前向 initiator 发送幂等 response。

Usage 重放比较 journal 保存的规范化 cost。未提供 provider cost 时使用 Team 创建时冻结的 rate table；同值 sample 不新增 usage observation 或 parent charge，token 数量或显式 cost 改变时仍可替换原 sample。Policy 读取原始 request。定价错误在 phase、cursor 与 policy 检查通过后才报告，保留这些检查的拒绝优先级；重启后的重放继续使用持久 rate table。

每个 workspace-sensitive local consumer 会先从 Agent scope 上的 Team allocation 解析 root，再回退到 Session header。Persistent shell 在 allocation 改变时丢弃缓存 process，local file-reference index 也会针对新的 allocation root 重建。因此 filesystem、LSP、skill、instruction、reference、sandbox policy 和 process tool 都使用同一个 provider 选择的 execution root。

渲染后的 channel view 必须符合 Team 冻结的 `maxChannelViewBytes` 限制，按 UTF-8 序列化字节数计算。合法投影超过上限时返回 `TEAM_CHANNEL_BACKPRESSURE` 并报告实际及最大字节数，不将其当作 WAL 损坏。拒绝后 delivery 保持 pending，Team 与 channel cursor 不变。无状态投影策略对同一份不可变 source 必须生成相同 view，因此重试该超大输入不能减小其体积。独立 source record 可以生成符合上限的 view。Source provenance 与读取后的 activation authority 继续独立校验。

[Channel-view 容量示例](../../../../examples/headless-agent/tests/channel-view-capacity.snapshot.ts) 使用同一个纯策略处理两个实际 worker review result。超大结果在重复 claim 后仍保持 pending，没有 Session view 或 receipt。独立的小结果通过日志化 view 进入 reviewer 模型，receipt 写入晚于 Session flush。JSON 和 SQLite 上的两个 Team 都通过公开 cancellation 路径完成收尾。

浏览器 Team owner 为 Team audit page 和 channel WAL 提供可取消的有界读取，展示 task attempt evidence 与 artifact，并且通过 runtime owner 打开 Participant 的 descendant Session。Detail view 保持紧凑并对 mutation surface 只读；它不会抓取 Session transcript 来推导 Team state，也不会创建第二个 composer。

ACP Link bridge 的更具体 owner 仍是[ACP activation Team Link note](2026-08-31-acp-team-link-bridge.zh.md)：remote activation 使用 Team 解析出的 proxy Session，在 Link receipt 前 flush 已接纳的 input 与 completion fact。已有的 [review-route](2026-08-28-typed-team-task-review-routes.zh.md)、[workspace-root](2026-08-28-shared-team-workspace-root.zh.md)、[portable-consumer](2026-07-28-portable-execution-world-consumers.zh.md) 和 [Team product owner](2026-08-29-local-team-product-run-owner.zh.md) note 继续负责各自较窄的 mechanism。

Closure controller 从持久 Team snapshot 中派生未结算 epoch，不以 live-handle map 代替完整资源集合。精确的 provider fencing 在 allocation cleanup 前记录不可变的 `fencedAt`；释放完成后的完整 quiescence 是另一项事实。这一区分使成功终止的证明跨崩溃保留，即使 provider 无法再次证明已经退出的进程树。没有 live owner、可恢复 descriptor 或已记录的 fence 时，恢复会记录准确的 activation stall，绝不虚构 offline 状态。Workspace release 事件无需周期 pulse 就有 consumer 处理，已接纳的恢复工作在撤销 runtime proof 前完成结算。Failure cleanup 取消未完成的 task 和 human action，使未完成的 workflow plan 携带原原因进入 failed，并保留已结算的 attempt/review 证据。

Controller 的 activation 和 recovery 调用在异步等待前捕获目标身份。每次 human recovery authorization 必须仍解析到选定 Team。Handle 在 durable bind 后发布失败时，其 owner 保留到 dispose 记录 quiescence；cleanup 失败会保留 stopping entry 供重试，并与发布失败一起报告。Shutdown 保留已接纳 stopping-epoch cleanup 的 proof。迟到的 Team phase response 不会覆盖更新的 activation binding，已释放 entry 也不能授权另一次排队 cleanup。

Workspace recovery Consumer 对瞬时持久读取失败执行有明确次数和延迟上限的重试，读取重试独立于 provider release 和 confirmation。已识别的格式或权限失败立即停止。因此一次读取失败后的恢复不依赖另一条 allocation event；dispose 在撤销 proof 前等待已接纳的重试完成。Timer 时长受 Node 支持范围限制。

Agent Client 的 workspace mutation 使用可配置的有限 cursor 重试次数。每次尝试从同一个新 snapshot 取得 allocation revision 与 Team cursor，并签发新的准确 authority；provider cleanup 不在重试循环内。Delivery close 失败时，Agent 的 workspace lease、proof source、unavailable marker 和拒绝新 step 的 listener 保留到已接纳工作及映射资源结算，Core 因而能在 activation disposal 前重试同一个 owner。Live owner 保留本进程物理释放成功的事实，后续 confirmation 重试不再次释放；冷启动 owner 仍须通过 provider reconciliation 证明清理。Team error，包括 policy 拒绝，会直接报告，不通过 reconciliation 自动重试确认。

Channel 创建或冷恢复失败会先关闭已打开的 WAL，再释放保留的 adapter、view-policy 和 runtime lease。每项 cleanup 都会尝试，聚合错误保留原始错误在首位，每项 cleanup 错误只出现一次。Append 已提交但返回失败时保留未挂接的 source record，不发布 channel，也不将其关联到 Team。

Audit append 冲突会先退役过期的派生 stream handle，后续读取再重新打开。该 handle 的 close 失败时，repair 按顺序报告原始冲突和 cleanup 错误，各一次；close 成功时保留原始冲突不变。整个 audit repair 过程中，业务 source record 与 cursor 始终保持权威。

## Alternatives considered

**从 completion intent 直接推断 human receipt。** 不采纳，因为 intent 选择结果，但不证明 sink 已持久化。Recovery 必须先独立追加 sink，之后才可确认 delivery。

**在调用方释放全部 resource 后，仍将 cancellation 保持为终态 phase command。** 不采纳，因为 live 或 remote owner 可能超过调用方进程；没有 durable cancellation request，重启无法区分有意的 admission cutoff 与普通 quiescing Team，也无法可靠恢复 cleanup。

**使用一个宽泛的 grant object，或把 prompt instruction 当作 authority boundary。** 不采纳，因为宽泛 JSON capability 很难做 subset，而 prompt compliance 不能保护 channel、workspace、task 或 budget mutation。Typed operation、mode、scope 和 budget subset 会在 policy 与 durable acceptance 前检查。

**让浏览器 detail page 从 Participant Session transcript 重建 Team state。** 不采纳，因为 Session 无法权威地确定 Team cursor、channel order、receipt state、task revision 或 audit provenance。页面读取 Team API，并只将 Session 作为被选中的 descendant 打开。

**保留 model-supplied review revision argument。** 不采纳，因为 reviewer 可能复制 stale 或无关 revision。已记录的 assignment source 拥有 revision 与 response causation，model 只提供 decision 和 reason。

## Consequences

Typed closure fact 使 completion、failure 和 cancellation 在重启后可见且幂等，但 provider 无法证明 termination 的 remote cancellation 会保持在 quiescing 或 stalled，而不会被报告为 cancelled。Closure driver 也会在没有 process-local `TeamRun` credential 的情况下持久化 missing-final、structured turn-failure、frozen-budget 和 orphaned-quiescing stall。本地 cancellation 无法在 Hub 记录 intent 前 dispose 其唯一 coordinator；不相关的已接纳 record 推进已观察 cursor 时，它会重读并重试同一个 typed command；已经记录 cancellation 的并发 request 会让 cleanup 继续。Generic phase 仍是内部 transitional work 使用的 trusted provider primitive；shipped product caller 使用 typed command。

Team state 和 API payload 变宽，当前 Team journal/checkpoint format 为 26 和 27。Child usage 现在通过同一个持久 subtree aggregate 计费，未完成的 outbound charge 会成为 work admission fence。持久声明式 workflow plan 新增 whole-plan revision 及 task/channel binding；Detail page 执行有界读取，并将 mutation control 留给已授权的 Host Consumer。Advisory task owner proposal 现在会保留受 revision fence 保护的 scheduler hint，但不会转移 authority。authenticated product-principal binding 现在覆盖 participant invitation、artifact byte read、task editing、detached archive/resume 以及 real-browser/SDK credential admission；完整 remote recovery 仍是独立工作。

这些改动强化了 local authority、root consumption、subtree-wide child-usage charging 和已编译的 local `TeamWorkflowPlan` Consumer，但尚未提供完整 [native multi-agent work-system proposal](../../proposed/architecture/2026-08-27-native-multi-agent-work-system.zh.md) 所需的 property、real-model、multi-host、browser/GIF、load evidence。这些仍是该 proposal 中明确列出的 gaps，而不是本实现的隐含保证。

## Verification

Audit recovery 测试通过独立 SQLite connection，在原 handle append 前提交 Hub 生成的准确派生 values，验证真实冲突、close 成功/失败，以及后续读取不重复事实。JSON 则分别验证单 owner 锁，以及 append 已提交但返回 EIO 后的恢复；它不构成并发 writer 的 CAS 场景。

[Human-question 示例](../../../../examples/headless-agent/tests/human-question.snapshot.ts) 让 standard worker 的真实 question tool 经过 UserQuestions 和 ApiProxyService。JSON 和 SQLite 保留 source id 与实际 Mux request 对应的 pending human action，再通过公开 TeamRun cancellation 和一次 resolved event 保留该 identity。Session tool-call record 与独立 backend read 共同验证 producer 和持久 outcome。

[工作区释放重启快照](../../../../examples/headless-agent/tests/workspace-release-restart.snapshot.ts) 通过 TeamRun、scheduler 与 Agent Client 创建真实 task allocation，确认 provider 已实际清理后注入 confirmation 写入失败并终止 Host。新的 JSON 或 SQLite Loader 对原始 release request 执行 reconciliation，重试确认且不重复清理，并保留准确的未确认 worker stall。正式 profile 通过 Loader 依赖等待 provider 初始化；[Loader 就绪说明](../bug-fix/2026-07-20-config-hot-reload-resilience.zh.md) 解释并发 waiter 的重检查。

[计价 usage 快照](../../../../examples/headless-agent/tests/priced-usage.snapshot.ts) 让真实 coordinator 模型 step 产生 usage，并由实际只读 tool 保持 turn。Agent Client 首次记账后，真实 binding 以旧、新 cursor 重投同一 sample。JSON 和 SQLite 保留一条 usage observation 与不变的派生 cost；真实 TeamRun 取消后，独立读取 source 和 JSONL Session 验证 provenance。

[频道打开失败快照](../../../../examples/headless-agent/tests/channel-open-failure.snapshot.ts) 通过真实 TeamRun 创建，在 JSON 与 SQLite source append 提交前后触发失败。它保持物理 close 未完成以验证 implementation lease 仍被保留，随后验证原始、close 与 runtime-release 错误的顺序、零 publication/attachment，以及已提交孤立 WAL 的保留。

[组装后的 final-lifecycle snapshot](../../../../examples/headless-agent/tests/final-lifecycle.snapshot.ts) 通过真实 local Link 投递 TTL final，等待 scheduler 的持久 expiry，并证明拒绝没有留下 completion intent、sink admission 或 human receipt。随后 replacement final 通过 TeamRun 和 closure driver 完成，不依赖 closure 轮询 pulse。提交后的 cursor 确认 intent、sink 和 receipt 的顺序；进程退出后独立读取 SQLite，验证 source record 和 offline activation。

[独立 Loader 恢复快照](../../../../examples/headless-agent/tests/final-restart.snapshot.ts) 在首个进程持久化 intent、sink admission 或 receipt 后强制终止，再由第二个进程读取原始 JSON 或 SQLite 存储。Intent 窗口将准确的未确认 activation 记录为 stalled，不虚构 quiescence；sink 与 receipt 窗口在崩溃前释放真实 coordinator lease，恢复到 completed。第三个独立 Loader 验证冷启动读取，确认没有重复接纳结果或写入 receipt。崩溃证据从独立副本读取，避免测试检查在产品恢复前回收原 JSON 锁或 checkpoint 原 SQLite WAL。

[失败与取消重启快照](../../../../examples/headless-agent/tests/terminal-restart.snapshot.ts) 在真实 coordinator turn 失败或 TeamRun 取消提交 intent 后，或其 owner 记录 activation quiescence 后终止 Host。新的 JSON 或 SQLite Loader 保留 active objective 和准确的 epoch：终止未确认时保持 stall，已有持久 quiescence 时恢复到 failed 或 cancelled。未读 human 消息按对应 closure 原因过期。恢复不发送模型请求，也不创建 final admission 或 human receipt。

JSON 和 SQLite 上直接调用 Hub 的接纳测试会拒绝目标处于 paused 或 blocked 状态的 final，保持 Team cursor 不变且不产生 receipt，并在目标恢复后以同一结果和 key 接纳。该测试独立于 TeamRun 的调用方检查，验证 sink 自身执行资格限制。

Core schema、Hub fold、JSON/SQLite lifecycle、closure-driver restart scan、missing-final、structured-failure、budget-stall、orphan-quiescing 和 pending-delivery-expiry test 覆盖了变更的 acceptance path。TeamRun test 会约束 cancellation admission 先于本地 lease disposal、在 cursor 被中间推进时重试且不释放 ownership、在 intent 未获接受时保留 ownership、在返回 current turn failure 前先记录它，并确认该 product path 不会进入 generic phase transition。Team detail UI suite 还会覆盖 stalled／cancelled control、durable human-attention row、current 与缺失的 Participant binding、channel／audit／artifact retry state、有界 text preview 和 download。组装后的无密钥 Headless Team snapshot 也覆盖 worker activation/task-create cursor race 以及完整 workflow-plan start/wait path。Host 与 SDK route test 确认通用 product phase method 不可用。TypeScript host/client build 已通过，persistence 与 Cordis catalog 已重新生成；剩余 release-tier browser/GIF、keyed real-model、distributed、property 和 load suite 明确保持 pending。

Principal inbox 通过 JSON/SQLite restart、重复投递、分页、可见性与 display cursor 测试。Host fetch 测试在 final 尚未显示时完成真实 Team，并在完整 Host restart 后、不依赖本地 TeamRun owner 读取和确认 final。TypeScript SDK final snapshot 通过真实 Loader 和 stdio runtime 执行 inbox 读取与 display acknowledgement。普通 human message、持久 action continuation 与 inbox retention 仍需分别实现。
