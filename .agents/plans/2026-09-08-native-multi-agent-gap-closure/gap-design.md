# Native multi-agent gap design

本文件是 2026-09-08 的内部 gap 设计参考，描述当前共享工作区中的功能边界、测试边界、文档缺口和发行前置条件。

开发执行顺序、独占文件责任、阶段入口与出口、命令和证据栏见[development-plan.md](development-plan.md)。

初始本地文档验证和新文件影响范围见[documentation-validation.json](documentation-validation.json)；当前 doc-sync 结果以 verification ledger 的 V119 为准。

本文件不替代[原始主提案](../../../.agents/notes/proposed/architecture/2026-08-27-native-multi-agent-work-system.md)、[P0 安全闭环](../../../.agents/notes/proposed/architecture/2026-09-04-native-multi-agent-p0-safety-closure.md)或[P1 产品收敛](../../../.agents/notes/proposed/architecture/2026-09-04-native-multi-agent-p1-product-convergence.md)。

## 范围、输入和判定方式

审计输入是共享 dirty worktree；HEAD 为 `fb14b0b9b1d8bfc5abebc22be2574eb691329900`，HEAD 不包含当前实现。

[audit-baseline.json](audit-baseline.json) 保存 64 个证据源的 SHA-256、HEAD、分支和采集时点，用于发现漂移；它不是恢复归档，也不证明历史命令在这些 hash 上运行。

[verification-evidence.json](verification-evidence.json) 保存验证记录及日志摘要；其中 PASS 只适用于记录的命令、范围和历史源码时点。

[gap-audit-root.json](audit-inputs/gap-audit-root.json)、[gap-audit-runtime.json](audit-inputs/gap-audit-runtime.json) 和[gap-audit-channel-product.json](audit-inputs/gap-audit-channel-product.json) 是本设计使用的 Root、runtime 和 channel/product 只读审计输入。

[gap-audit-docs-evidence.json](audit-inputs/gap-audit-docs-evidence.json) 是文档与证据边界审计；它记录了本文件需要修复或保留的文档事实。

[fact-review.json](audit-inputs/fact-review.json) 保存 Root 对初始审计的最终事实复核；本报告的分类、child commit order、canonical retry、bounded discovery、workspace pulse 和 Consumer ownership以该复核及源代码为准。

`confirmed` 表示源码或执行证据直接建立了该事实，`partial` 表示主要机制存在但指定子项或共同版本证据不完整，`unverified` 表示没有足够的同一候选版本证据，`decision` 表示源码有意拒绝或提案没有作出承诺、需要产品范围决定。

功能项的“确定项”统计为 `confirmed + partial`，不把 `unverified` 变成功能缺失，也不把 `decision` 变成无条件开发承诺。

当前登记 20 项功能边界与缺口：`confirmed` 12 项、`partial` 1 项、`unverified` 0 项、`decision` 7 项；确定项 13 项，待决策项 7 项。已实现但缺共同版本证据的能力计入测试缺失，不重复计入功能性缺失。

测试项、文档项和其他项单独统计，不与功能项相加为完成百分比。

本报告登记测试 8 项、文档 13 项、其他 6 项；ID 总数为 47。D-17 是本轮新增的 Note 格式缺口，其他 D/O/T 数量与此前审计保持一致。

本轮文档交付包括本报告、执行计划、可审阅的审计输入和证据日志；旧 `start-here.md` 的顶部入口指向本目录，旧计划正文保留为 2026-09-05/06 的历史分派记录。

历史审计结论：仓库级 publication closure 曾失败（[V17](verification-evidence.json)），Cordis 和 graph 生成器曾被 Typert 类型归属阻断（[V18](verification-evidence.json)、[V19](verification-evidence.json)），Config、Tool、Module catalog 检查曾失败（[V20–V22](verification-evidence.json)）；八个限定 publint CLI 退出 0 与这些历史 FAIL 同时成立。当前候选的 Hub/full-repository/channel-recovery/closure-driver/supervisor-recovery 回归见 V49/V50/V51/V52/V53，完整 release closure 仍未关闭。

源码面通过显式 TypeScript source、测试和类型配置验证；构建产物面通过 build 生成的 `lib`、packed view、NodeNext consumer 和限定 publint 验证。

源码测试使用项目内 `TMPDIR`、`TSX_DISABLE_CACHE=1` 和 direct Node ESM launcher；不把 source PASS 与过期 `lib` PASS 合并为一条证据。

## 当前基线

### Channel 基线

channel catalog、direct/consult/discussion 表单、own invitation ACK、endpoint admission metadata、channel list/WAL bounded paging、watch/reconnect fence、ordered media、exact-envelope attachment read、explicit summary、closed outbox 和 ACK/selection/summary recovery races已有实现。

[Host channel API](../../../packages/host/apiproxy/src/api/teams.ts) 的 `channelCatalog`、`channelList`、`channelAdmission`、`channelInvitation`、`channelInput`、`channelAttachment` 和 `channelSummarize` 位于约 281–319 行；[SDK protocol map](../../../packages/sdk/protocol/src/types.ts) 的对应方法位于约 626–638 行。

[Direct adapter README](../../../packages/team/team-channel-direct/README.md) 定义 v1–v4、ordered text/image、v4 subset/null audience、independent recipient intents 和 two-party human final。

[Admission Consumer](../../../packages/team/team-channel-admission/src/index.ts) 的 `TeamChannelAdmission`、`runOnce` 和 `waitUntilActive` 位于约 51–147 行；它负责 deadline recovery 和 dispatch wait，不代替 endpoint acknowledgement。

[Summary Consumer](../../../packages/team/team-channel-summary/src/index.ts) 的 `TeamChannelSummary.summarize` 位于约 88–179 行；它保存 source fingerprint、policy、bounded extractive text 和 retry identity。

已有证据包括 [client-six](evidence-logs/client-six-final-2026-09-08T1956.log) 6 files/94 tests、[latest build](evidence-logs/full-build-2026-09-08T1958-final-ui.log)、[formal channel browser](evidence-logs/formal-channel-browser-2026-09-08T2000-final.log) 1 selected/2 skipped、[NodeNext](evidence-logs/verify-node-next-types-2026-09-08T2001-final.log) 269 APIs 和八个限定 publint CLI 记录。

这些记录证明指定切片可运行；它们不证明三场景 browser matrix、全 Hub 或全仓 release matrix 已关闭。

### Child Team 基线

parent task 的 `execution.kind: 'child-team'`、父级 grant 收窄、类型化 budget/depth 检查、parent reservation、child create/bind/start、parent-service result、charge、cancel 和 terminal settlement已进入共享源码；全树 child count/live activation 上限另列为决策项。

[TeamRun.startDelegatedTask](../../../packages/team/team-run/src/index.ts) 约 1982–2025 行创建 parent child task，冻结 template、grant、budget、scope 和 retry key。

[TeamDelegation.advanceTask](../../../packages/team/team-delegation/src/index.ts) 约 201–315 行驱动 reservation、child creation、channel consent、request/response exchange、result admission 和 cancellation。

已有 child 行为证据是 [delegation 6](evidence-logs/team-delegation-2026-09-08T1921-after-second-lint-fixes.log)、[child-result 28](evidence-logs/team-hub-child-result-2026-09-08T1918-after-lint-fixes.log)、[task-delegation 4](evidence-logs/team-hub-task-delegation-2026-09-08T1918-after-reservation-fixture.log) 和 [usage replay 4](evidence-logs/team-hub-usage-replay-2026-09-08T1912-after-reservation-fixture.log)。child-result 与 task-delegation 日志是为本报告额外保存的非敏感证据，不计入 59 条 verification ledger记录。

[closed-channel Loader](evidence-logs/closed-channel-outbox-snapshot-2026-09-08T1903-after-disabled-summary.log) 覆盖 consult、discussion、workflow 的 closed outbox 真实 Loader 入口；独立 [child delegation Loader](../../../examples/headless-agent/tests/child-delegation.snapshot.ts) 是 child complete/cancel 的入口。

shared child saga 是当前支持的 slice；`TeamRun.startDelegatedTask`、`TeamDelegation.advanceTask`、Hub child result admission和 usage replay共同构成它的实现。它的 remaining work属于测试缺失，见 T-03；nonshared child workspace、workflow child node、multiple child generations、parent review、parent Participant placement 和 child-owned integration 不得从字段存在推导为已承诺功能。

### Shared workspace、supervisor、telemetry、placement 和 cancellation 基线

[Root audit](audit-inputs/gap-audit-root.json) 将 default Team-first composition、placement/scheduler、supervisor/HTTP、telemetry、normal task cancellation 和 workflow cancellation 的已实现部分与未闭合证据分开记录；对应 source 包括 [placement](../../../packages/team/team-placement-default/src/index.ts)、[scheduler](../../../packages/team/team-scheduler-dag/src/index.ts)、[activation controller](../../../packages/team/team-activation-controller/src/index.ts)、[workspace](../../../packages/team/team-workspace-shared/src/index.ts)、[telemetry](../../../packages/team/team-telemetry-otel/src/index.ts) 和 [TeamRun](../../../packages/team/team-run/src/index.ts)。

这些基线分别有实际 owning tests：[placement tests](../../../packages/team/team-placement-default/tests/placement.spec.ts)、[scheduler tests](../../../packages/team/team-scheduler-dag/tests/scheduler.spec.ts)、[controller recovery tests](../../../packages/team/team-activation-controller/tests/recovery-admission.spec.ts)、[workspace provider tests](../../../packages/team/team-workspace-shared/tests/provider.spec.ts)、[telemetry tests](../../../packages/team/team-telemetry-otel/tests/otel.spec.ts) 和 [TeamRun tests](../../../packages/team/team-run/tests/team-run.spec.ts)。测试文件存在不等于本候选版本整套通过，具体执行范围以 evidence ledger为准。

[Current state](../2026-09-05-native-multi-agent/current-state.md) 的实现段落仍可作为历史索引，但其中的全仓数字、旧 worktree 状态和“后续接入”措辞不表示当前候选版本。

最新 [channel-root-live](audit-inputs/channel-root-live.json) 是历史审计索引，记录 channel fourth batch、UI race fixes、child baseline 和 usage replay focused PASS；当前 Hub/full-repository/channel-recovery/runtime-recovery/typecheck/catalog/type-equivalence/note-format/readme-gate 与 Session legacy-header/descriptor-depth、principal inbox checkpoint/compaction、ACP/HTTP supervisor local runtime、direct-v4/consult/discussion/reconnect browser、TeamRun non-final message lifecycle、bounded child-row authority、parent cancellation delegation drive、selected active-child navigation 和当前文档 gate 结果以 V49/V50/V51/V52/V53/V54/V55/V56/V57/V58/V59/V60/V61/V62/V63/V64/V65/V66/V67/V68/V69/V70/V71/V72/V73/V74/V75/V76/V77/V78/V79/V80/V81/V82/V83/V84/V85/V86/V87/V88/V89/V90/V91/V92/V93/V94/V95/V96/V97/V98 及其日志为准。

普通 cancellation 与 workflow cancellation 已有对应 source/test slices；[verification ledger](verification-evidence.json) 和 [Root audit](audit-inputs/gap-audit-root.json)保留了它们的适用范围。跨主机、真实模型、性能和 release artifact仍由测试与其他项追踪。

TeamRun 对成功的 non-final `team_message` turn 会保留 Team active，等待后续 input 或显式 final Envelope；没有成功 Team message 的 completed turn、模型 failure 和失败 tool result 仍进入 missing-final 或 failure lifecycle。该行为由 [V87](verification-evidence.json) 的完整 TeamRun suite 与真实 browser consult response 路径共同覆盖。

[channel-root-live](audit-inputs/channel-root-live.json) 是历史审计索引；当前状态和 release 边界以各 ID 条目及 V109–V119 为准，不把历史 `recent_verified` 或局部 PASS 变成当前 release PASS。

## 功能性缺失

### 当前候选状态

截至 2026-09-10，本报告按各 ID 的 `状态：`字段统计：功能 20 项为 12 confirmed、1 partial、0 unverified、7 decision；测试 8 项为 1 confirmed、4 partial、3 unverified；文档 13 项全部 confirmed；其他 6 项为 4 confirmed、1 partial、1 unverified。总计 47 个 ID：30 confirmed、6 partial、4 unverified、7 decision；`decision` 仍需产品范围决定，不能当作无条件开发承诺。

当前验证记录与执行范围见 [verification ledger](verification-evidence.json)。V113 的同候选 source regression 为 1016 个 test-result files、16143 passed、114 skipped、0 failed，Hub 为 52 files/799 tests；V119 的 doc-sync 为 24 passed/4 failed，失败项是既有 translation pairing、Markdown wrap、Config catalog 和 persistence catalog，不构成 release PASS。

当前已关闭的功能边界为 F-CH-01、F-CT-02、F-RT-01、F-RT-02、F-SC-01、F-SC-02、F-WS-01、F-UI-01、F-UI-02、F-UI-03、F-LG-01 和 F-LG-02；F-RT-03 保持 partial。T-04/T-05/T-08/O-02 仍缺同候选或目标环境证据，T-02/T-03/T-06/T-07/O-04 仍为 partial，七个 decision row 不计入无条件功能承诺。

各 ID 的具体边界、owner 和关闭证据只在对应条目中维护；历史 follow-up 不在本设计重复记录，完整命令和日志见 [verification-evidence.json](verification-evidence.json)。

#### F-CH-01 高层 channelInput 的幂等重试

状态：`confirmed`，优先级 P0。

现状与触发：consult request 已提交但 response 丢失时，`expectedNext` 已进入 respondent；initiator 使用原 key/content 重试会先在 principal resolver 被拒绝；final response、discussion bound close 和 direct close 后也触发同一窗口。

源证据：[Host channelInput](../../../packages/host/apiproxy/src/api-proxy.ts) `channelInput` 约 4074 行；[principal resolver](../../../packages/team/team-channel-admission/src/principal.ts) `resolvePrincipalChannelText` 约 111–120 行；[SDK server input](../../../packages/sdk/server/src/server.ts) `inputTeamChannelWithCall` 约 1032 行；[Hub admission](../../../packages/team/team-hub/src/index.ts) `admitChannelEnvelope` 约 12210 行。

目标与不变条件：同一 actor/channel/key 的语义等价原请求在协议推进后仍返回原 Envelope；consult 的 `null` 与规范化 exact peer、discussion 的 `null` 与规范化 full peers按同一 canonical draft处理；只有 text、delivery、causation/correlation、task、trace、priority、ttl、audience/content或attachment 等 canonical 字段真正不同才返回 conflict。新 key 仍要求 active phase、expected speaker、membership、grant 和 request identity。

开发步骤与归属：Host 与 SDK server 继续共用 principal admission seam；有 key 时先保留当前 own acknowledged identity/metadata 检查，再按 immutable role 与 retained request anchor 重建 canonical draft，交给已有 Hub locked same-key match；命中返回原 Envelope，未命中才执行当前 phase/cursor/adapter 校验。

持久化与兼容性：优先复用现有 sender/key/draft match 和 Envelope payload；`taskId` 按 `draft.kind` 保留，不按 `protocolStatus.phase` 推导；只有 compaction 或媒体 anchor 确实无法重建时，才评估最小 high-level lookup/receipt，并同步更新 JSON/SQLite fold、wire/schema、TS/Python consumers 和 session snapshot owner。

恢复、并发与失败：旧 key 命中时仍检查当前 authenticated membership、role、channel metadata和 retained request anchor，当前 `expectedNext` 不得否定这个只读命中；只有 new post 才按当前 phase、speaker、wrong turn、foreign channel或 mismatched media fail closed；并发 same-key match 与 new-key post 在 Hub channel lock 下线性化。

必要测试与观察：Host/SDK request→response lost-response retry、response-after-close、discussion bound close、direct close、restart、语义等价表示重试、canonical 字段变化 conflict、revoked principal 和 no-duplicate Envelope；观察原 cursor、Envelope id、source fingerprint 和 no extra attachment reference。

依赖与风险：依赖 current authenticated principal、immutable role、retained request anchor 和 Hub durable idempotency；旧 key 的预检不能跳过身份、metadata 或 Hub same-key match，媒体或 compaction anchor缺失时应明确进入专项边界设计。

### 子 Team

#### F-CT-02 普通父任务 DAG 与 child delegation

状态：`confirmed`（当前 shared child dependency scope）。

现状与触发：普通 parent task 的 `blockedBy` 会在 `TeamDelegation.advanceTask` 中检查，child task 在依赖完成后进入 reservation；model tool 当前没有直接提交 child `blockedBy` 的参数。

源证据：[delegation prerequisite check](../../../packages/team/team-delegation/src/index.ts) 约 206–215 行；[TeamRun task creation](../../../packages/team/team-run/src/index.ts) 约 2011–2018 行；[tool delegate schema](../../../packages/team/tool-team-task/src/index.ts) 约 414–430 行。

目标与不变条件：未完成 dependency 不创建 child；dependency terminal failure/cancel/delete 给出明确 parent outcome；完成后只创建一次；普通 task DAG 与 named workflow plan保持不同语义。

开发步骤与归属：先保留 Core/Host `blockedBy`；若产品要求 model 直接编排，TeamRun/tool owner 增加显式 blockedBy，并让 Hub 使用相同 cursor/revision checks；不要让 tool 隐式扫描任务顺序。

持久化与兼容性：parent task `blockedBy`、delegation phase 和 child identity继续进入 Team journal；新增 wire field必须同步 tool result、Host/SDK/Python schema和 catalog。

恢复、并发与失败：依赖完成事件与 delegation discovery竞争时按 parent queue重读；child create retry不能绕过 dependency；dependency deleted/failed/cancelled必须保留 blocker provenance。

必要测试与观察：blocked pending、dependency completion、dependency terminal failure、restart、duplicate discovery 和 concurrent sibling tasks；观察 task revision、blockedBy outcome、delegation phase 和 child creation count。

依赖与风险：依赖 shared child saga baseline和 T-03；模型是否需要直接 DAG 参数是产品决定，不把当前 tool omission报告为越权漏洞。

2026-09-09 current implementation supplement：Hub outcome batch 已覆盖普通 `execution.kind: 'child-team'` task 的 terminal dependency propagation。未启动 reservation 在 blocker failed/cancelled/deleted 后进入 `cancelled`，保留 `blockedByOutcome` 的 blocker id、revision、phase，并同步取消 requested child reservation；真实 SQLite edge matrix 已覆盖三种 blocker phase，40/40 通过，详见 [child dependency outcome evidence](evidence-logs/child-dependency-outcome-followup-2026-09-09.log)。当前 shared child dependency gate 已 confirmed；model-facing blockedBy authoring 与非 shared child workspace 等边界保持显式 deferred scope。

#### F-CT-03 非 shared 的 child workspace

状态：`decision`。

现状与触发：当前 child grant 强制 shared workspace；父 child task 不能直接拥有 worktree/E2B root，子 Team内部 participant workspace能力与父 delegation root没有同一 lease。

源证据：[child grant](../../../packages/team/team-run/src/index.ts) 约 2009–2017 行；[child workspace](../../../packages/team/team-delegation/src/index.ts) `workspace` 约 149–161 行；[Hub grant check](../../../packages/team/team-hub/src/index.ts) `assertTaskGrant` 约 14125 行。

目标与不变条件：只有产品确认 child×worktree/E2B 组合后才实现；child root 必须有独立 provider-owned lease、parent provenance、artifact boundary 和 cancellation/restart owner。

开发步骤与归属：先记录产品决定；若纳入，workspace owner设计 child execution root request/spec，TeamRun保存 frozen child runtime，Delegation owner驱动 lease，Hub保存 reservation/settlement provenance。

持久化与兼容性：不得把 Participant TaskAttemptId 伪装为 child allocation；需要 child root provider、lease、artifact/proposal source identities及 versioned schema；shared slice保持兼容。

恢复、并发与失败：bootstrap partial、provider loss、parent cancel、child restart、CAS conflict 和 integration后释放都必须清理 exact child lease；不能只在 parent task phase上推断文件已释放。

必要测试与观察：真实 worktree/E2B child root、parent/child concurrent writes、provider loss、restart、cancel、artifact visibility 和 target integration；当前不执行，因为范围未决。

依赖与风险：依赖 F-RT-02、T-04/O-02 和产品对 whole-child workspace ownership 的明确承诺。

#### F-CT-04 workflow plan 中的 child 节点

状态：`decision`。

现状与触发：workflow template 当前冻结 participant role fields；TeamRun compiler和Hub plan binding没有 child execution branch。

源证据：[workflow template type](../../../packages/core/team/src/types.ts) `TeamWorkflowTaskTemplate` 约 3507 行；[schema exclusion](../../../packages/core/team/src/schema.ts) child workflow refinement 约 2360 行；[compiler](../../../packages/team/team-run/src/index.ts) `compileWorkflowPlan` 约 2325 行。

目标与不变条件：只有产品确认后，workflow task template 才能选择 child execution；child task不产生 Participant lease；plan result从 admitted delegation result读取；parallelism/attempt bounds只计一次。

开发步骤与归属：Workflow schema owner增加 versioned execution union；TeamRun compiler增加 child reservation/binding branch；Delegation owner接管 child saga；Hub plan fold保留 template→task→child identity。

持久化与兼容性：plan/task binding、child delegation、workflow result projection 和 restart cursor必须一体化；旧 participant-only plan replay不变；禁止让现有 compiler默认把 child 当 participant。

恢复、并发与失败：workflow cancel等待 child真实终态；plan restart不重复创建 child；child failure/cancel propagates exact blocker；workflow channel cleanup仅清理其自身 unbound channel。

必要测试与观察：participant→child→participant dependency、plan compile/restart、child result/failure/cancel、parallelism accounting、workflow channel close和JSON/SQLite replay；当前仅设计。

依赖与风险：依赖 shared child saga baseline、F-CT-02、F-SC-03；这是产品组合决策，不是当前 workflow engine 缺失。

#### F-CT-05 失败后的多个 child generation

状态：`decision`。

现状与触发：当前 delegated task固定 `maxAttempts: 1`，同 delegation key不创建第二 child；Participant task retry与child generation不是同一概念。

源证据：[TeamRun delegated task](../../../packages/team/team-run/src/index.ts) 约 2014–2018 行；[child schema refinement](../../../packages/core/team/src/schema.ts) 约 2359 行；[P1 delegation saga](../../../.agents/notes/proposed/architecture/2026-09-04-native-multi-agent-p1-product-convergence.md) 约 103 行。

目标与不变条件：默认保留 one child per delegation；只有产品确认 retry 后才引入 DelegationAttemptId/generation；旧 child未terminal不得新建 generation。

开发步骤与归属：先作范围决定；若纳入，TeamRun保存 generation history，Hub定义每 generation request/result/cancel/usage provenance，Delegation串行驱动新 child。

持久化与兼容性：不能复用 `attemptHistory` 或将同 delegationId映射第二 child；每 generation 必须防重复 charge/result contamination；旧同-key idempotency保持。

恢复、并发与失败：旧 generation terminal、parent lease、charge、receipt和artifact settlement完成后才允许下一 generation；restart和duplicate call必须返回正确 generation。

必要测试与观察：失败后 retry、旧 child未终态拒绝、generation restart、usage/receipt isolation、same-key replay和artifact provenance；当前不计入 release done。

依赖与风险：依赖 shared child saga baseline和全树预算决定；不能因为 `maxAttempts` 字段存在就承诺 child retry。

#### F-CT-06 父任务对 child result 的 review

状态：`decision`。

现状与触发：当前 child task使用 `reviewPolicy: { kind: 'none' }`；child内部可有自己的 coordinator/reviewer，但 parent task没有 participant review phase。

源证据：[TeamRun child admission](../../../packages/team/team-run/src/index.ts) 约 2017 行；[child review refinement](../../../packages/core/team/src/schema.ts) 约 2359 行；[tool task result](../../../packages/team/tool-team-task/src/index.ts) `TaskReviewValue` 约 42–49 行。

目标与不变条件：只有决定要求 parent review 后才定义 reviewer owner、review proof、result receipt和rework semantics；parent review不得撤回已持久 child result。

开发步骤与归属：先决定 child内部 review、后继 evaluator task或 parent review；若采用 parent review，TeamRun/Hub定义独立 review route和result projection。

持久化与兼容性：service receipt 与 reviewer receipt保持不同 provenance；rework不能伪造 Participant attempt；restart保留 review pending和child result。

恢复、并发与失败：parent cancel、review response lost、reviewer revoke、child terminal race必须有明确 authority；child result admission完成后 parent review failure只影响 parent outcome。

必要测试与观察：accepted/rework、review restart、receipt/review authority separation、cancel race、artifact retention；当前仅记录设计决策。

依赖与风险：依赖 shared child saga baseline和 product review policy；不把 review none 误判为 implementation failure。

#### F-CT-07 父任务为 child topology 指定 Participant placement

状态：`decision`。

现状与触发：child template selection决定 child coordinator/provider/model；父 task placement描述 Participant task，不自动描述整个 child Team。

源证据：[child template selection](../../../packages/team/team-run/src/index.ts) 约 1994–2010 行；[child placement exclusion](../../../packages/core/team/src/schema.ts) 约 2360 行。

目标与不变条件：保持 Participant placement 与 child topology placement分离；如需多 host child，使用 versioned child template/execution route 和 grant validation。

开发步骤与归属：产品确认后由 TeamRun定义 child template selector，AgentRuntime/placement owner定义 child topology route，Hub验证 child grant；不要直接解禁父 task placement。

持久化与兼容性：保存 template/provider/model route descriptor和 actual binding provenance；旧 shared child path不变。

恢复、并发与失败：descriptor mismatch、unknown provider、host unreachable、old epoch和 child restart 都必须 fail/stall，不伪造 Participant activation。

必要测试与观察：template route selection、descriptor mismatch、remote child restart、old epoch reject、grant narrowing；当前不执行。

依赖与风险：依赖 F-RT-03、F-CT-03；父 placement不能绕过 child authority。

#### F-CT-08 child result 的 integration task

状态：`decision`。

现状与触发：child result 可以携带 artifact references；Hub `assertTaskIntegration` 约 14009 行要求 `source.attemptHistory` 中存在 completed `sourceAttemptId`，而 child schema 约 2359 行明确没有该 attemptHistory，因此直接把 child `sourceTaskId` 送入普通 integration 会被拒绝。

源证据：[Hub integration validation](../../../packages/team/team-hub/src/index.ts) `assertTaskIntegration` 约 13999 行；[child artifact candidate](../../../packages/host/apiproxy/src/api-proxy.ts) 约 1325 行；[SDK candidate](../../../packages/sdk/server/src/server.ts) 约 2454 行。

目标与不变条件：只有产品确认后才能增加 child-result admission provenance union；在此之前保留普通 integration 对 Participant completed attempt 的要求，不把后继 integration 当作现成 child 替代路径；private/foreign/ambiguous artifact拒绝。

开发步骤与归属：Artifact/Hub owner核对 candidate union、visibility和 source provenance；若范围纳入，新增 child admission provenance union、解析和 CAS 验证，不扩大 delegation task角色，也不伪造 sourceAttemptId。

持久化与兼容性：保留 childTeamId、delegationId、result fingerprint、artifact provider/ref、target revision；现有 Participant integration replay不变。

恢复、并发与失败：child result late arrival、artifact provider loss、target CAS conflict、private reference和 restart都须保留 source identity并返回明确结果。

必要测试与观察：child artifact→integration CAS、private/foreign/ambiguous rejection、provider loss、restart and target conflict；当前证据不足。

依赖与风险：依赖 T-04/O-02、F-UI-02 和产品范围决定；当前结论是 child 自身 integration 明确被 schema 拒绝，后继 integration 是否接纳 child provenance仍待设计。

### Agent runtime 与 placement

#### F-RT-01 placement 必须隔离 child execution

状态：`confirmed`，本轮已完成。

现状与触发：`team-placement-default` 的 readiness 只检查 phase、cancellation、lease、attempt和dependencies；scheduler drive开始时先调用 placement.prepare，匹配的 dormant Participant route可能被 child delegation唤醒。

源证据：[placement ready](../../../packages/team/team-placement-default/src/index.ts) `ready` 约 197 行；`prepareTeam` 约 126 行；[scheduler drive](../../../packages/team/team-scheduler-dag/src/index.ts) `driveTeam` 约 447 行。

目标与不变条件：child task不申请 Participant activation lease；child Team内部的 participant tasks仍正常进入 placement；Hub assignment grant不因 placement filter而放宽。

开发步骤与归属：placement owner在 ready boundary检查 execution discriminator；scheduler保持真实 assignment condition；TeamDelegation继续拥有 child Team进度。

持久化与兼容性：不新增 task phase或伪 lease；execution.kind 已持久化，过滤只改变 placement admission。

恢复、并发与失败：混合 child/participant task只激活 participant owner；child task cancellation、parent stall和 restart不触发 placement side effect。

必要测试与观察：only-child with matching offline route no controller.activate、mixed task filtering、child Loader success/cancel、scheduler shutdown；观察 activation calls、lease count和task kind。

依赖与风险：依赖 execution union和已有 child Loader；过滤 child 时不要漏掉 child Team内部任务。

#### F-RT-02 activation 前后的 workspace eligibility

状态：`confirmed`。

现状与触发：placement 需要同时处理 activation 前可判断的 route cwd/provider compatibility 和真实 activation binding 后的 provider eligibility；仅使用后验检查会先激活永远不适配 task 的 Agent。

源证据：[placement](../../../packages/team/team-placement-default/src/index.ts) 的 `preflight`/`activateTaskOwner`；[workspace registry](../../../packages/core/team-workspace/src/index.ts) 的 `preflight`；[workspace provider contract](../../../packages/core/team-workspace/src/types.ts)；[shared workspace provider](../../../packages/team/team-workspace-shared/src/index.ts) 的 `preflight`/`eligible`。

目标与不变条件：pre-activation只做 provider明确可判定的 route compatibility；最终 workspace eligible仍由 provider在真实 binding下判断；不重复分配 root或伪造 attempt。

开发步骤与归属：workspace owner定义 request/spec兼容判定；placement owner调用纯 compatibility或保留 post-activation check；controller负责已拥有 lease 的释放。

持久化与兼容性：不改变现有 allocation schema；必要的新 selector descriptor必须在 Team template/task creation时冻结。

恢复、并发与失败：unsupported shared/worktree/E2B route、provider loss、post-publication cancel、CAS conflict和 release failure要有 owned lease cleanup或明确 stall。

必要测试与观察：incompatible route no long-lived lease、compatible route assignment、provider loss、cancel cleanup、workspace observation and artifact retention。

依赖与风险：依赖 workspace request/spec、controller lifecycle和T-04/O-02；preflight不能伪称最终 eligibility。

#### F-RT-03 supervisor recovery selector 的范围

状态：`partial`。

2026-09-10 runtime 补充：已修复 provider 卸载但 fencer/supervisor 仍存在时继续终止旧进程的问题；cold replacement 在 fencing 前记录 `AGENT_RUNTIME_PROVIDER_UNAVAILABLE` 并保留旧 epoch。新增两条回归先复现失败，再通过 runtime/controller 215 项联合回归；channel 113 项回归、相关包类型检查与定向 lint 通过，另通过真实 Loader 启动的 ACP 进程恢复快照（[V120–V125](verification-evidence.json)）。另已修复 fencing 期间 provider 卸载的竞态：保留 durable fence 证明并记录同名 stall，重开 JSON 存储后状态一致；6 files/135 tests、类型检查和 lint 通过（[V126–V129](verification-evidence.json)）。F-RT-03 保持 `partial`，独立 host 验收未执行。

现状与触发：SDK local/HTTP supervisor recovery和unknown fail-closed已有实现；automatic startup recovery按显式 recovery kind、provider/profile/host筛选；ACP owned-process 已有同样的 durable descriptor 与 local fencer，且可选复用 authenticated HTTP supervisor，但 separate-host execution 尚未验收。

源证据：[startup matching](../../../packages/team/team-activation-recovery/src/index.ts) `matchesLocalStartupRecovery` 约 231 行；[controller cold replacement](../../../packages/team/team-activation-controller/src/index.ts) `coldReplaceOwned` 约 581 行；[ACP termination mode](../../../packages/agent-runtime/agent-runtime-acp/src/index.ts) 约 760 行。

目标与不变条件：现有 SDK recovery不回归；ACP 只有在真实 process identity、fence proof和 durable descriptor存在时才能 resume，可选 supervisor 必须通过 exact generation/owned-process fence；unknown/unreachable继续 stall或unsupported。

开发步骤与归属：supervisor owner定义 versioned provider recovery selector；controller定义 exact-generation fence；ACP owner提供 process identity、local fencer 和可选 supervisor descriptor；separate-host consumer 仍由独立环境验收。

持久化与兼容性：descriptor包含 provider/profile/host/process identity/epoch and session binding；旧 SDK descriptor继续解析；不把 disconnected当 offline。

恢复、并发与失败：old epoch send/heartbeat/integrate reject；provider retired、host unavailable、generation mismatch和fence failure produce named stall。

必要测试与观察：SDK current recovery、ACP process restart if enabled、unknown descriptor、host unavailable、generation conflict、new epoch resume；记录 provider/host/profile/epoch。

依赖与风险：依赖 activationSupervisors、controller exact-generation fence和真实 remote runner；ACP scope尚未确认，不得泛称 remote recovery缺失。

### Scheduler 与治理

#### F-SC-01 delegation discovery 的有界性

状态：`confirmed`。

现状与触发：TeamDelegation `discover` 每个 pulse调用完整 `listTeams()`，再顺序 drive所有 Team；Config只有 per-drive operations、channel page和pulse interval，没有 page cursor或per-pulse total bound。Hub 的 `listTeamsPage` 当前限制 visible items，但内部仍通过全量 storage-log stream/id 排序并可能为跳过 archived 调用多个 `ensureTeam`。

源证据：[delegation Config](../../../packages/team/team-delegation/src/index.ts) 约 18–33 行；`discover` 约 132–140 行；[activation recovery bounded scan](../../../packages/team/team-activation-recovery/src/index.ts) `recoverOnce` 约 149 行；[Hub listTeamsPage](../../../packages/team/team-hub/src/index.ts) 约 2081–2115 行；[StorageLog list](../../../packages/storage/storage-log/src/index.ts) 约 154 行。

目标与不变条件：第一步使用 `listTeamsPage`、跨 pulse cursor、每 pulse page/team bound和event-driven selected Team wake；同时明确该方法目前只限制返回页，不等于 storage I/O 或 memory 全有界。第二步按目标规模设计 storage-log directory pagination、轻量 Team index或 `maxScanned` continuation；不未经设计修改公共 cursor 格式。

开发步骤与归属：Delegation owner增加 bounds和cursor；Core/Hub owner确认 listTeamsPage顺序；event listener继续只 request affected Team/parent。

持久化与兼容性：cursor属于 Consumer runtime state，不写 Team journal；Config defaults进入 config catalog；旧 deployment config使用显式 defaults。

恢复、并发与失败：当前 cursor 是排序 id 数组下标而非快照稳定序号；page insertion、archive skip、循环重扫、duplicate event、long scan、dispose、list failure和 child result race都必须无遗漏、幂等并有工作上界；accepted drive等待但不阻塞新 event queue。

必要测试与观察：multi-page no omission/duplicate side effect、per-pulse limit、event fairness、restart scan、dispose/page race；观察 page cursor、selected count、drive count。

依赖与风险：依赖 Core `listTeamsPage`、StorageLog目录设计和D-07 JSDoc/catalog；不能把 page size误当整轮、总 I/O 或内存 bound。

#### F-SC-02 omitted placement 的 frozen defaults

状态：`confirmed`。

现状与触发：TeamRun product template 现在可声明 `placementDefaults`；Hub 在 task creation admission 前解析 omitted participant-task placement，并将 resolved restriction 持久化到 task。未配置 template default 时，absence 明确表示无额外 constraint。

源证据：[TeamRun placementDefaults](../../../packages/team/team-run/src/index.ts) Config 与 productTemplate creation；[Hub resolveTaskPlacementDefault](../../../packages/team/team-hub/src/index.ts) 与 `createTask` admission；[task placement schema](../../../packages/core/team/src/schema.ts)。

目标与不变条件：undefined 的语义已确定为：有 template `placementDefaults` 时使用该 default，无 default 时表示无额外 constraint；creation 时冻结 resolved placement，且只能由 grant 收窄，旧 task selection 不漂移。

开发步骤与归属：TeamRun owns the optional JSON-friendly template defaults；Hub resolver 在 policy 前完成 explicit resolve；scheduler 只消费 frozen task fact。

持久化与兼容性：保存 resolved placement/version或明确 absence marker；不在 run()内隐式 `?? default`；wire and SDK fields保持 actor-free。

恢复、并发与失败：template change、retry、restart、stale creator和 grant narrowing都按 creation snapshot；invalid default fail at admission。

必要测试与观察：omitted vs explicit placement、template update、retry/restart、narrowed grant 和 old task stable selection；当前 focused Hub/TeamRun tests cover omitted vs explicit resolution。

依赖与风险：依赖 Team productTemplate和Core task schema；当前授权 subset并非因此失效。

#### F-SC-03 hierarchy-wide resource ceilings

状态：`decision`。

现状与触发：per-Team depth、parent budget/charge、task concurrency和activation count已有实现；提案还讨论 total child count/ancestor live activation，当前未发现独立全树 ledger。

源证据：[Hub child budget](../../../packages/team/team-hub/src/index.ts) `assertChildTeamBudget` 约 14078 行；`bindActivation` 约 3456 行；`resourceBudgetUsage` 约 15002 行；[runtime child scope matrix](audit-inputs/gap-audit-runtime.json)。

目标与不变条件：先决定 per-Team vs whole hierarchy；只有确认全树上限后才增加 ancestor reservation/settlement ledger；不削弱现有 parent charge/depth gates。

开发步骤与归属：Root预算 owner提出可观测语义；Hub owner设计 cross-journal reservation；Delegation owner接入 one-shot child admission；metrics owner增加 counts。

持久化与兼容性：全树 count/activation/charge必须可恢复、幂等、带 ancestor provenance；不能递归即时求和代替 durable ledger。

恢复、并发与失败：兄弟并发创建、partial bootstrap、restart、duplicate charge和 ancestor cancel必须不双算；上限拒绝留下可解释 reservation state。

必要测试与观察：siblings concurrency, partial bootstrap, restart, max-depth, budget, charge repair and metrics；当前为决策项，不计无条件 done。

依赖与风险：依赖 shared child saga baseline、budget definition和cross-journal ownership；树级上限不是当前已证实越权。

### Workspace

#### F-WS-01 shared workspace 的 observation pulse

状态：`confirmed`。

现状与触发：shared workspace支持 baseline/publish/integration/release/restore observation和declared/undeclared/external-window分类；配置可显式开启有界 periodic pulse，默认保持关闭。

源证据：[Core observation stage](../../../packages/core/team/src/types.ts) 与 schema；[shared Config/pulse](../../../packages/team/team-workspace-shared/src/index.ts)；`observeAllocation`；[Hub classification](../../../packages/team/team-hub/src/workspace-observation.ts) `classifyObservationPaths`。

目标与不变条件：periodic pulse 使用 Core 明确的 `observation.stage: 'periodic'`、显式 interval 和每 pulse allocation bound；默认关闭，不伪标为 `publish`。只观察真实 owned allocation，结果仍由 Team WAL/audit派生。

开发步骤与归属：shared workspace provider owns the pulse timer/queue and bounded allocation selection；Hub records `periodic` observations；TeamAgentClient/TeamRun只消费 owner事实，不自行扫描。

持久化与兼容性：Core types/schema、fold、observer proof、audit/SDK projection接受 `periodic` stage，并保留 observation source allocation、scope、truncation、timestamp和provider provenance。默认不启用不改变现有 runtime cost。

恢复、并发与失败：publish/release/pulse concurrent ordering、path truncation、close cancellation和symlink avoidance都要 deterministic；不能把 root变化归因给某 writer。

必要测试与观察：long-running write visible within pulse、publish/release no duplicate/out-of-order、truncation、close、symlink；shared provider focused suite当前为21 tests通过。

依赖与风险：依赖 sidecar/observation queue和Hub `recordWorkspaceObservation`；idle root cross-attempt扫描不并入本项。

### UI 与 API

#### F-UI-01 member/task/artifact 集合的有界读取

状态：`confirmed`，当前功能范围已完成；独立测试矩阵由 T-04/T-06 追踪。

现状与触发：Host已有 member/task/artifact page APIs，channel已分页；client runtime 现已接入这些 page APIs，TeamPage 从独立 bounded collections 投影 members/tasks/artifacts，并保留完整 Team snapshot 作为 authority/mutation fallback。

源证据：[client Team runtime](../../../packages/client/runtime/src/client/teams/service.ts) `open` 约 175 行；[TeamPage](../../../packages/client/ui-team/src/client/TeamPage.tsx) 约 178–204、415；[Host page APIs](../../../packages/host/apiproxy/src/api/teams.ts) `memberList` 约 247 行、`taskList` 约 360 行；CP-02见[产品审计](audit-inputs/gap-audit-channel-product.json)。

目标与不变条件：member/task/artifact分别持有 cursor/pages/loading/error/hasNewer；selected Team change不能被旧 response污染；failed page保留已读 rows。

开发步骤与归属：client runtime owner已实现独立 page state、selection generation fence 和 explicit continuation；Host artifact list 会在 provider-owned references 进入 wire 前过滤 private/ambiguous refs；UI TeamPage已消费 projections；TypeScript SDK 与 Python SDK artifact-list helpers 已同步。

持久化与兼容性：wire使用 existing afterCursor/limit/nextCursor；不把 full Team snapshot变成新的 model-visible payload；selected task/member refs仍从 authoritative Team identity读取。

恢复、并发与失败：connection loss、stale generation、event during read、empty/last/duplicate page、abort and retry都必须保留 dirty marker和selection。

必要测试与观察：runtime/UI/Host/SDK/Python focused evidence 已覆盖 first-page/continuation projection、empty/last page、non-advancing cursor、event/read race、artifact permission、failed-page retention、reconnect generation 和 client tsc；完整 keyless browser 已通过；live-model/GIF 与 multi-host UI transport 仍由 T-06/T-04 追踪。

依赖与风险：依赖 Host page methods和T-04/O-02；当前 client projection不再把 full member/task/artifact arrays作为唯一展示输入，本轮 browser failure/retry、键盘和窄屏已通过，跨主机 transport 仍由 T-04 追踪。

#### F-UI-02 child 导航与 result artifacts

状态：`confirmed`。

现状与触发：Host/SDK artifact candidate已包含 `task.delegation.result.artifacts`；此前 TeamPage current taskArtifacts只合并 attemptHistory completed artifacts和workspace loss，现已补 child-Team execution/delegation result branch，并将其非 private artifact refs 纳入正式投影。当前 selected Team snapshot 的更新 task facts 也会 overlay 到同 id 的 bounded task row，避免旧 collection response 隐藏 child navigation 或 result state；loaded task page 还保留 explicit refresh action；V92 覆盖 39 个 UI tests、58 个 runtime/channel tests 和当前 build。

V98 selected browser follow-up：真实 Web/Host replay scenario 已创建 live child，显式刷新 bounded task collection 后打开 child Team，再通过 parent cancellation 完成 parent/child cleanup；1/1 通过且 page errors 为 0。该结果只确认 local active-child navigation/cancellation path，remote lifecycle、multi-host transport、GIF、integration/review 和 complete T-06 matrix 仍未闭合。

源证据：[TeamPage](../../../packages/client/ui-team/src/client/TeamPage.tsx) 约 178–204；[Host child artifact candidate](../../../packages/host/apiproxy/src/api-proxy.ts) 约 1325 行；[SDK child artifact candidate](../../../packages/sdk/server/src/server.ts) 约 2454 行；CP-03见[产品审计](audit-inputs/gap-audit-channel-product.json)。

目标与不变条件：parent page显示 child phase/stall/budget/result and read-only child link；delegation artifacts进入正式 bounded artifact projection；private/ambiguous/foreign refs继续拒绝。

开发步骤与归属：UI owner已添加 execution-kind branch和child navigation；runtime owner的现有 task status projection直接提供 child phase/result；Host/SDK reader复用 existing visibility；不新增自动 resume或 human authority。

持久化与兼容性：只读导航使用 parent task childTeamId/delegationId/result fingerprint；不把 child Session transcript复制到 parent page；artifact references继续 provider-owned。

恢复、并发与失败：child stalled/cancelled/restarted、result late、artifact provider loss、parent close和selected Team change保留状态；open只读 inspect不能自动 resume child coordinator。

必要测试与观察：real child Loader success/cancel/restart、child artifact read、private/ambiguous rejection、stalled reason、selection race and browser detail.

依赖与风险：依赖 shared child saga baseline、T-04/O-02 和 F-UI-01；当前 UI focused evidence 已覆盖 child navigation/result artifacts，但完整 browser/GIF 仍由 T-06 负责，collection pagination 仍由 F-UI-01 负责。

#### F-UI-03 workflow plan projection

状态：`confirmed`，当前功能范围已完成；独立测试矩阵由 T-04/T-06 追踪。

现状与触发：`team_workflow_start`、cancel、wait tool和Hub durable plan projection已存在；Host 现已提供 bounded `team.workflow.plan.list` read RPC，client runtime 和 TeamPage 以只读方式展示 phase、bounds、bindings、dependencies、result/failure。

源证据：[tool workflow](../../../packages/team/tool-team-task/src/index.ts) 约 538、561、594 行；[Hub workflow projection](../../../packages/team/team-hub/src/index.ts) 约 4979 行；[TeamPage](../../../packages/client/ui-team/src/client/TeamPage.tsx)；CP-04见[产品审计](audit-inputs/gap-audit-channel-product.json)。

目标与不变条件：UI只读展示 plan phase、ordered task/dependency links、result/failure/cancel relation；authoring继续归 declarative tool，不引入 JS 编辑器。

开发步骤与归属：UI owner已渲染 read-only projection，保留未绑定 template 和失败状态；Host/Runtime bounded workflow plan read 与 cursor/loading/error 已实现；TypeScript SDK protocol/client/server 和 Python SDK read helpers 已同步；late collection response 的 stale-read marker 由 runtime 按 selected Team cursor 保留；human mutation另行设计 principal route。

持久化与兼容性：使用 durable plan/task binding和result projection；重启不依赖 Session transcript；已有 `team_workflow_*` tool wire不变。

恢复、并发与失败：pending invitation、compiling、failed bind、participant plan cancellation、stale plan cursor和selection race都显示可解释状态；child-node cancellation只有 F-CT-04 获批后才纳入。

必要测试与观察：当前 focused UI/Host/SDK/Python evidence 覆盖 phase、dependency links、binding、failure、bounded list route、workflow-plan stale read、ready/completed/cancelled 与 structured cancellation reason；keyless browser 的真实工具、导航和取消已通过；独立主机恢复、live-model/GIF 与 multi-host UI transport 仍由测试矩阵追踪。

依赖与风险：依赖 F-UI-01 和 workflow plan read API；participant workflow projection独立于 F-CT-04，child plan cancellation只有在该组合获批后才纳入。此项是 product observability补齐，不是 engine缺失。

### Legacy

#### F-LG-01 legacy product 与 release cutover

状态：`confirmed`。

现状与触发：Headless/Web/Python default composition已 Team-first；旧 subagent/workflow capability 仍为显式 examples 与测试开发路径，但已完成 consumer inventory、private compatibility classification、tarball absence 和 product catalog cleanup。

源证据：[subagent package](../../../packages/subagent/subagent/package.json)；[tool-subagent package](../../../packages/subagent/tool-subagent/package.json)；[Python runtime](../../../python/sdk-runtime/package.json) 约 89–113 行；[release family](../../../scripts/release/families.ts) 约 322 行；[Root legacy audit](audit-inputs/gap-audit-root.json)。

目标与不变条件：default source/packed composition不暴露被替代的 subagent/fork/report/control/model-JS workflow tools；合法 AgentRuntime/ACP/SDK lifecycle保留；显式 compat 使用 private compatibility package 且有真实 consumer。

开发步骤与归属：Legacy owner建立 source/config/tool/catalog/runtime carrier inventory；抽取可复用 activation mechanics到 AgentRuntime owner；删除已证明无 consumer的入口；更新 release families、constraints、catalog和compat smoke。

持久化与兼容性：不在无 consumer 证据时删除 shared runtime；compat descriptor/version显式；packed artifact、Python wheel和NPM exports同步。

恢复、并发与失败：legacy removal不能破坏 fresh/resume/fence/shutdown；unknown compat package fail at load；release artifact不得携带未声明 source/compat entry。

必要测试与观察：`verify-legacy-cutover` 已执行 source/config/dependency/catalog/carrier/release-member/tarball inventory；default profiles、explicit compat examples、Python/TS/ACP runtime smoke 仍分别由其 owning suites负责。

依赖与风险：依赖 F-RT-03、O-02 和 consumer inventory；grep hit不等于 model-visible exposed tool。

#### F-LG-02 Session header 的 legacy fields

状态：`confirmed`。

现状与触发：product Session header曾接受 `origin`/`delegationDepth`，而 P1要求在 direct subagent consumers迁移后移除这些 legacy fields。

源证据：[Session types](../../../packages/core/session/src/types.ts) 约 94–104 行；`CreateSessionOptions.meta` 约 132 行；[Session parser](../../../packages/core/session/src/index.ts) 约 136–141 行；[P1 legacy proposal](../../../.agents/notes/proposed/architecture/2026-09-04-native-multi-agent-p1-product-convergence.md) 约 216 行。

目标与不变条件：retain `parentSession` only as fork seed lineage；product create/header/projection reject old fields explicitly across JSONL/SQLite/compressed carriers；Session format rule follows current pre-release policy。

开发步骤与归属：先完成 F-LG-01 consumer closure；Session owner defines compat descriptor event if necessary；TS/Python SDK/persistence parsers and snapshot owners update together。

持久化与兼容性：no silent converter or dual reader；new model-visible event follows SessionEventMap and ignorable rules；old pre-release header rejection is explicit。

恢复、并发与失败：current Team sessions fork/resume；old header from cold storage rejects; parentSession remains lineage and never becomes authority。

必要测试与观察：old header JSONL/SQLite/compressed reject, current Team resume/fork, both SDK snapshots, explicit compat composition if retained。

当前完成：SessionHeader/CreateSessionOptions/CreateAgentOptions 已删除两个字段并在创建/恢复边界显式拒绝旧输入；JSONL/压缩 carrier 拒绝旧 header，SQLite schema 升至 19 并拒绝旧物理 schema；subagent descriptor 升至 v3，持久化 `depth`，projection、child listing、depth enforcement 和 API ownership consumer 已迁移。V78 覆盖 8 files/516 tests；descriptor-less ordinary fork 只作为遍历节点，`parentSession` 仍只表示 fork seed lineage。

依赖与风险：依赖 F-LG-01；不要把 current Team-first composition误写成 legacy removal complete。当前 F-LG-02 的 remaining release boundary 仅由全仓/多平台 artifact lanes单独追踪，不再存在 Session header source gap。

## 测试缺失

#### T-01 当前 Hub 全套与全仓验收

状态：`confirmed`。

现状：V113 在同一 candidate 上完成 1016 个 test-result files、16143 passed、114 skipped、0 failed，Hub 为 52 files/799 tests；T-01 已关闭。该结果是 source unit regression，不替代 coverage、multi-host、real-model、browser、performance 或 release matrix。

设计：冻结 source/test inputs，先跑 owning Hub full suite，再跑不可约 final matrix；把 obsolete fixture、product defect、environment failure 和 intentional skip 分开。

Done：保存 same-candidate source manifest、执行/通过/失败/跳过计数、首错 stack、环境和 artifact 链接；focused PASS 不替代 full PASS。

#### T-02 逐文件 coverage

状态：`partial`。

现状：既有 Core AgentRuntime source lane 达到逐文件 100%；SDK provider 记录为 statements 96.66%、branches 91.61%、functions 100%、lines 98.20%。[V138–V141](verification-evidence.json) 将 supervisor HTTP client.ts 的四项 coverage 补齐至 100%；endpoint.ts 基线仍为 80.85%/77.01%/80%/88.78%。ACP/supervisor 剩余文件、全仓逐文件 100% gate 与 separate-host recovery 仍未闭合。

设计：按 changed Core/Hub/Consumer/client source 绑定同一 source hash 测量，保留每文件 100% policy，覆盖 genuine branches，不合并历史百分比。

Done：coverage report必须绑定 source hash、测试输入和未覆盖分支；新文件不能借旧 report 放行。

#### T-03 child saga 的 kill-point 矩阵

状态：`partial`。

现状：[V131–V133](verification-evidence.json) 在 JSON/SQLite 各 13 个 WAL append 后的 SIGKILL/独立 Loader 重启窗口验证 child 唯一性、result/service receipt 去重、charge 来源与逐笔结算，26/26 通过；4 个终态场景再次独立重启后标识一致且没有新 model request。Host 类型检查和定向 lint 通过。[V135–V137](verification-evidence.json) 另验证 JSON/SQLite 完成与取消流程的 parent archive 顺序：child 运行时拒绝、父子资源结算后允许、重复归档只有一条记录。TS/Python packaged route 和 multi-host evidence 仍未闭合。

设计：JSON/SQLite、parent/child restart、duplicate retry、cancel race、partial bootstrap、service receipt/parent charge、artifact/usage provenance 使用真实 proof issuer；不使用 synthetic final/human/lease shortcut。

Done：每个 delegation identity 只有一个 child；parent result/charge/receipt 不重复；parent archive 等待 settlement；TS/Python packaged route 有实际证据。

#### T-04 统一 multi-host 故障矩阵

状态：`unverified`。

现状：WebSocket Hub 与 authenticated HTTP supervisor 只有 same-machine independent-process 证据；separate-host、credential rotation、provider loss 和 remote runner 仍未验证。

设计：覆盖 append/notify/flush/receipt/fence/bind、duplicate/out-of-order、slow consumer、credential rotation、unknown host、provider loss、artifact retention 和 integration CAS，并区分 unit、same-machine、独立重启 Hub 与 actual separate hosts。

Done：disconnect 不能替代 process termination proof；旧 epoch、unknown host、revoke/fence 和 child artifact/reference provider loss 都必须有 typed observation。

#### T-05 当前真实模型协作

状态：`unverified`。

现状：当前 candidate 没有完整 real-model collaboration evidence；[V134](verification-evidence.json) 确认当前进程与根目录 `.env` 未配置真实模型 key/route，需补齐环境后执行。旧模型日志不能证明当前 endpoint 可用。

设计：在 verified model 上运行 two-worker fan-out/fan-in、review accept/rework、child delegation、workflow 和 real files/artifacts，并断言 WAL、Session、filesystem、allocation、quiescence 与 failure cleanup。

Done：同一 candidate 必须有 named real-model scenarios、完整资源结算和失败解释；keyless replay 单独记录。

#### T-06 browser 与 GUI 展示矩阵

状态：`partial`；V117 已完成当前 keyless Web lane。

现状：GUI lane 为 292 files、3920 passed/1 skipped，keyless Web lane 为 72 files、237 passed/14 skipped/0 failed；真实 channel、collection、workflow、keyboard 和窄屏路径已覆盖。live-model/GIF、独立环境、remote lifecycle 和完整 product mutation matrix 仍开放。

设计：consult/discussion、child navigation、remote lifecycle、task integration/review、offline/races、keyboard/accessibility 使用 real server/model replay；GUI change保留可复查 GIF。

Done：每个 product mutation path 都有 browser scenario、authoritative WAL assertion、accessible state/error/keyboard observation 和 artifact。

#### T-07 performance budget runner

状态：`partial`。

现状：4096 与 16384 SQLite load 已通过真实 endpoint ACK；macOS large-load 与 fresh-process samples 已记录，lifecycle cancel/shutdown slice 已通过。Linux、CI budget 和跨平台 performance evidence 仍未完成。

设计：使用真实 ACK 的 load fixture，测量 startup-to-first32、full enumeration、RSS、10000 pending/64 activations/1000 tasks 以及 confirmed cancel/shutdown；test timeout 不能代替 performance budget。

Done：记录 reference thresholds、executed scenario count、三次 raw sample、median、RSS 和 queue/shutdown metrics。

#### T-08 state machine 与 property coverage

状态：`unverified`。

现状：当前 candidate 的 receipt/invitation、child reservation、task lifecycle、JSON/SQLite ranking/workflow replay、workflow selection、scheduler budget 与 deterministic ranking properties 已合并为 9 files/97 tests；仍缺 ranking restart/no-provider、完整 cross-log agreement 和 minimized counterexample。

设计：为 invitation revisions、child reservations、task cancellation、workflow target extensions、ranking candidate/version、competing publication/closure 建立 model 或 justified alternative，并保存 seed/minimized counterexample。

Done：每个新增 state machine 都有 named model、invalid transitions reject、live/replay projection agreement 和 reproducible seed。

## 文档缺失

#### D-01 team-delegation 的 package README ownership

状态：`confirmed`。

现状：[team-delegation package](../../../packages/team/team-delegation/) 已有英中 package contract 和 `i18n.yaml` 配对记录；[team family README](../../../packages/team/README.md) 的表已列出该 Consumer 与其 `ctx` 依赖。Package README 的 Model Experience 与 Known Limitations 结构已通过针对该包的检查；全仓 doc-sync 仍被其他 package、generated catalog、type ownership 和 translation-pairing 漂移阻断。

设计：新增 package contract，覆盖 Config、proof source、bounded discovery、child saga、result/charge/cancel/close 和 unsupported combinations；family README只保留角色和链接。

Done：package README、family table/composition links、英文/中文 package pair与source/catalog links一致；`## Model Experience`与`## Known Limitations and Deferred Work`结构满足 package gate。

#### D-02 当前 channel/child extension 的 architecture map

状态：`confirmed`。

现状：[architecture.md](../../../docs/architecture.md) 约 109–113 行只列 direct 到 v3、basic/workflow，未把 direct v4、admission、summary、delegation列为当前 extension map。

设计：architecture只补 ordered map、ownership和links；协议字段和 lifecycle留在 package README/subsystem。

Done：paired architecture pages列出当前 package responsibility，不含 stale status narration。

#### D-03 Team subsystem service map 与 Consumer ownership

状态：`confirmed`。

现状：[subsystems/team.md](../../../docs/subsystems/team.md) 约 5–7 行未列 admission/delegation，generated region有 summary约 119–137 行但没有 admission service entry。`team-delegation` 是导出的 Consumer class/plugin，不声明 `ctx.teamDelegation`，所以这里需要补 package/Consumer ownership edge，而不是虚构新的 Context service。当前 type-equiv gate还指出 [core subsystem](../../../docs/subsystems/core.md):184 的 `CancelOptions` 只写了 `keepInbox`，漏掉 source 的 `resumePending`。

设计：为真实声明的 `ctx.teamChannelAdmission` 选择 subsystem owner；为 `TeamDelegation` 选择 package/Consumer owner；同步修正 type-equiv 的 `CancelOptions.resumePending` 对侧，再按 generator mapping重新生成两语言，不手改 generated region。

Done：每个选定 Context/service有唯一 owner、source symbol、link和通过的 partition check。

#### D-04 capability graph

状态：`confirmed`。

现状：[capability-seams.md](../../../docs/capability-seams.md) 约 571–582 行显示 `ctx.teams`/workflowExtensions，但没有 admission、summary和delegation edges；[gen-doc-graphs.ts](../../../scripts/gen-doc-graphs.ts) 约 523–613 行 curated rows也缺它们。

设计：修 generator/service rows和package edge source；生成 English/Chinese pair，不 hand edit。

Done：`verify-doc-graphs`可完成 Typert analysis和freshness check，graph包含所选 service/Consumer edges。

#### D-05 module graph

状态：`confirmed`。

现状：[module-graph.md](../../../docs/module-graph.md) 约 314–318、1720–1834 缺 current admission/delegation nodes；`verify-module-graph`已报告 stale。

设计：从 peerDependencies重新生成，确认 cycle和新 package dependencies；不手加 table row。

Done：`verify-module-graph`在同一 candidate pass，两语言 graph列出所有 package nodes。

#### D-06 event producer/consumer matrix

状态：`confirmed`。

现状：[event matrix](../../../docs/event-producer-consumer.md) 约 29/66 行列出 channel/team listeners但没有 team-delegation；[TeamDelegation](../../../packages/team/team-delegation/src/index.ts) 约 67–77 行监听 `team/changed` 和 `channel/changed`。

设计：解决 source import boundary后重新生成 event matrix；behavior留在 package README。

Done：generated row包含 delegation listener或有明确 generator exemption，`verify-doc-graphs`通过。

#### D-07 config catalog 与 source JSDoc

状态：`confirmed`。

现状：[config catalog](../../../docs/config-catalog.md) 已包含 `team-delegation`、placement、AgentRuntime recovery 和 TeamRun member Config；本轮补齐了 delegation、placement、SDK supervisor 与 TeamRun member 字段 JSDoc。V119 仍报告 repository Config catalog stale，该 freshness 问题由 generator/source owner 处理，不改变本项的 source contract status。

设计：代码 owner补字段 JSDoc，generator生成 delegation bounds；不要在 generated Markdown手写 Config。

Done：`maxOperationsPerDrive`、`channelPageSize`、`pulseIntervalMs`出现在 catalog；source field contract 已确认，generated catalog freshness 由当前共享 doc-sync follow-up 追踪。

#### D-08 tool catalog

状态：`confirmed`。

现状：[tool catalog](../../../docs/tool-catalog.md) 约 43 行 committed row缺 `team_task_delegate`；source在[tool-team-task](../../../packages/team/tool-team-task/src/index.ts) 约 414–430 行，`verify-tool-catalog`报告 first difference。`verify-client-catalog`还报告 [slot-catalog.ts](../../../packages/extensions/cordis-client-runner/src/client/slot-catalog.ts) stale，`verify-persistence-catalog`报告 `plan/mode` 在 [index.ts](../../../packages/plan/plan-mode/src/index.ts):53 与 `index.d.ts`:37 重复声明。

设计：先稳定 tool description/result和 client/persistence generator input，再运行 generator；README单独说明 operation，catalog保持 generated inventory；不要把 generated client/persistence freshness问题写成新功能缺失。

Done：tool、client、persistence 三类 generated inventory与 source 一致，catalog两语言列出 tool、scope、result and authority；V119 仍报告 persistence catalog stale，由对应 generator owner处理。

#### D-09 Host/SDK route README

状态：`confirmed`。

现状：[Host README](../../../packages/host/apiproxy/README.md) 约 29–35 行、[SDK protocol README](../../../packages/sdk/protocol/README.md) 约 17–38 行、[SDK client README](../../../packages/sdk/client/README.md) 约 32–42 行和[SDK server README](../../../packages/sdk/server/README.md) 约 25–33 行仍主要列旧 Team channel surface。

设计：按 package contract补 catalog/admission/invitation/input/attachment/summary/list；明确 actor-free wire、human binder、bounds、retry/failure；generated table留给 catalog。

Done：TS/Python/Host/SDK package docs route scope一致，Chinese pair按现有流程更新。

#### D-10 TeamRun/tool 的 child operation 文档

状态：`confirmed`。

现状：[TeamRun README](../../../packages/team/team-run/README.md) 约 33–43 行主要描述 default-worker tasks，且约 9 行触发 hard-wrap；[tool README](../../../packages/team/tool-team-task/README.md) 约 7–24 行没有 `team_task_delegate`，其中文对侧约 46 行还引用不存在的 `team_worker_pool_set` anchor。

设计：分别补 child request/result/artifact/depth/grant/settlement/model-visible contract；同时修 TeamRun 段落的物理换行和 tool-team-task 中文 catalog anchor；scope matrix中 decision组合保持明确标记。

Done：caller可从 package docs判断何时使用 delegate、如何 wait/cancel、child result有哪些 fields以及哪些组合尚未承诺。

#### D-15 UI child/collection contract

状态：`confirmed`（focused UI contract；browser evidence remains T-06）。

现状：[ui-team README](../../../packages/client/ui-team/README.md) 现在描述 bounded member/task/workflow/artifact collections、newer/error/stale-selection behavior、child result/navigation 与 read-only workflow projection；CP-02/03/04 的浏览器边界仍由 T-06 追踪。

设计：由 UI/runtime/API owner分别维护 bounded member/task/artifact projections、child read-only navigation和workflow plan summary；README只写稳定 consumer contract。

Done：UI docs说明 collection pagination、newer refresh、child result/artifact visibility、stale selection/error behavior和 read-only workflow projection；browser/multi-host evidence继续由 T-06/F-UI rows拥有，文档不手写测试清单。

#### D-16 placement package 的语言 pairing

状态：`confirmed`。

现状：[team-placement-default README](../../../packages/team/team-placement-default/README.md)存在，但同目录没有 `README.zh.md`；pairing gate还报告 [deterministic scheduler Chinese Note](../../../.agents/notes/implemented/architecture/2026-08-28-deterministic-team-dag-scheduler.zh.md):13 错用英文 README 链接，并报告多份既有 README/Note/catalog pair drift。该包有公开 placement route、workspace compatibility和failure contract。

源证据：[package files](../../../packages/team/team-placement-default/)；[placement source](../../../packages/team/team-placement-default/src/index.ts)；[placement tests](../../../packages/team/team-placement-default/tests/placement.spec.ts)。

设计：按现有 package README pairing workflow补中文对侧，修正 placement Note 的 locale link，并由各既有 pair owner处理其 drift；保留 source owner对英文 contract的唯一维护责任，不把缺少对侧误写成功能缺失。两份本目录内部计划继续保持不配对。

Done：placement README pair已同步、locale links可解析、package contract覆盖配置/限制/失败和模型非作用；V119 的全仓 pairing 仍有既有 pair drift，本目录内部计划继续按执行文档例外处理。

#### D-17 Authenticated human channel invitation Note format

状态：`confirmed`。

现状：[implemented invitation Note](../../../.agents/notes/implemented/feature/2026-09-06-authenticated-human-channel-invitations.md) 缺少 `## Problem`、`## Decision`、`## Consequences` 和 `## Alternatives considered`，`verify-agent-note-format`因此失败；这只说明格式未满足，不改变该 Note 的实现状态。

源证据：[doc-sync log](evidence-logs/documentation-doc-sync-2026-09-08T2118.log) 的 agent-note-format gate；[implemented Note format instructions](../../../.agents/notes/implemented/AGENTS.md)。

设计：由 Note owner 根据当前 authenticated human invitation 实现和实际取舍补齐四个规范段落，Alternatives 只写可从真实设计资料还原的方案；不编造替代方案，不把格式修复写成新的 channel 功能。

Done：Note 通过 `verify-agent-note-format`，Problem/Decision/Consequences/Alternatives 内容与当前实现、权限边界、失败语义和验证证据一致；不修改 archived notes或将 Note 标记为已完成功能。

### 当前文档 gate

V119 的 `doc-sync` 为 24 passed、4 failed。失败项属于共享文档或生成物 owner，不是本目录两份计划的直接失败；两份内部计划继续保持中文单体，不加入双语 pairing 范围。

| 失败 gate | 当前根因 | 处理责任 |
|---|---|---|
| translation pairing | 既有 Agent Note、docs 和 package README pair drift | 对应 pair owner |
| markdown wrap | 既有 package README hard-wrapped paragraphs | 对应 package owner |
| config catalog | generated Config catalog stale | source/JSDoc 与 generator owner |
| persistence catalog | generated persistence catalog stale | persistence generator owner |

详细命令、退出码和日志仍以 [verification-evidence.json](verification-evidence.json) 的 V119 为准；修复这些共享输入后再重跑全仓 doc-sync。

## 其他缺失

#### O-01 candidate provenance

状态：`confirmed`。

当前问题：dirty HEAD、多个 handoff时点和 `.tmp` logs不能自动构成一个可复现 release candidate。

设计：冻结 source manifest、patch/isolated snapshot、runtime/env、commands、artifacts、source hashes；hash manifest只检测 drift，不是 restore archive。

Done：另一位开发者可取得 exact inputs并重跑；CI artifact保留 logs/digests；不会隐含 commit/push授权。

#### O-02 canonical package 与 platform release

状态：`unverified`。

当前问题：latest build、NodeNext 269和八个 limited publint CLI已通过；canonical npm tarball、Python wheel/bundled runtime、Linux/macOS/Windows consumer尚未完成。

当前补充：pure `clocky-sdk` wheel 与 macOS arm64 `clocky-runtime-bin` wheel 已在当前候选构建，并在 fresh Python 3.12 venv 中成功启动真实 SEA runtime；installed SDK wheel + production runtime child smoke 与 advanced SDK snapshot replay 也通过。Linux x64/arm64、Windows 与 multi-platform consumers 仍未验证，见 [Python wheel evidence](evidence-logs/o02-python-sdk-wheel-2026-09-09.log)。

设计：运行 release family scripts、isolated install、source/artifact tool inventory and launch/shutdown parity；dev-only `./src/*` warning不能成为发布 source的授权。

Done：同一 candidate有 package/artifact digest、三平台 consumer、Python wheel/runtime和process teardown结果。

#### O-03 source-adjacent artifact contamination

状态：`confirmed`。

当前问题：[source artifact quarantine](../../../.tmp/source-artifact-quarantine/team-channel-basic)保留 stale/generated index/basic JS/d.ts/maps；Vite rewriteRelativeImportExtensions 曾解析 adjacent artifact。

设计：审计 rootDir/outDir、clean behavior和generator；增加 narrow hygiene detection with legitimate exceptions；不 blanket-clean shared dirty tree。

Done：clean source tests只解析 current source，production build只写 designated outputs，污染时 gate给出路径。

#### O-04 human inbox long-history policy

状态：`partial`。

当前问题：paged inbox有实际 capability，长 history dedup/display成本和 retention/compaction anchor尚未定义。

当前补充：TeamHumanClient 已为 principal display cursor 写入 durable `LogCheckpoint` anchor；默认 inbox read 在 checkpoint 存在时从 display cursor 后缀读取，并允许调用方在该 checkpoint 覆盖 compaction prefix 后继续读取 retained suffix；显式 history read 与早于 retained boundary 的 cursor 仍 fail closed，JSON/SQLite inbox focused suite 22/22 通过（V83）。这降低了长历史默认读取成本，但不定义自动 retention、保留时长、有损 cleanup 或最终 audit/display retention policy，O-04 仍保持 `partial`。

设计：checkpoint/index 现在可作为 display suffix 的 compaction fence；在启用自动 retention 前仍需定义 retention period、active action/final receipt/audit refs、display semantics 与 retained-cursor recovery policy。

Done：selected history scale bounded，unseen deliveries/references preserved，old cursor有 explicit recovery response，不用 silent lossy cleanup。

#### O-05 documentation generator 的 cross-package type ownership

状态：`confirmed`。

当前问题：`verify-cordis-catalog` 和 `verify-doc-graphs` 在 [human-delivery-types.ts](../../../packages/core/team/src/human-delivery-types.ts):99 发现 `TeamChannelViewEventData` 跨包引用；当前 use-site 通过 local `./types.ts` 间接到 Session declaration，Typert analyzer 要求明确 declaring package import。失败证据见 [Cordis log](evidence-logs/docs-verify-cordis-catalog-2026-09-08T2010.log) 与 [graph log](evidence-logs/docs-verify-doc-graphs-2026-09-08T2010.log)。

设计：由 type owner 将 use-site 改为合适的 `@clocky/clocky-session/types` import，保留 Session 作为 declaring package；先验证 analyzer ownership，再处理 generated freshness，不抑制 analyzer、不复制或移动类型。

Done：Cordis 与 graph generators 通过 ownership analysis并进入实际 freshness check，Host/NodeNext public type contract不变。

#### O-06 supervisor HTTP published protocol chunk

状态：`confirmed`。

当前问题（已修复）：完整 publication closure 曾发现 [activation-supervisor-http](../../../packages/agent-runtime/activation-supervisor-http/) 的多入口 bundle 引用未发布的 hashed `protocol-*.js` chunk。

设计：优先按 [agent-runtime-sdk tsdown config](../../../packages/agent-runtime/agent-runtime-sdk/tsdown.config.ts) 的独立 entry 模式消除共享 hash chunk；备选是生成稳定、明确声明的 internal protocol artifact并只加入该文件；不恢复 `lib/*.js` 宽 glob，不关闭 transitive relative-import checker。

持久化与兼容性：保持 public entry/exports 和 shared class/state identity；发布 view必须包含每个相对 import target，source plane不变。

恢复、并发与失败：isolated tarball import index/client/endpoint/invariant，supervisor health/fence and declared dependencies，unknown/missing chunk fail during packaging rather than runtime。

必要测试与观察：`publint-all` closure、clean isolated install、entry imports、minimal supervisor health/fence and NodeNext declarations；当前结果见 [O-06 fix log](evidence-logs/publint-activation-supervisor-http-2026-09-09.log)，limited CLI PASS仍单独记录。

依赖与风险：这是 artifact-plane release blocker，依赖 build/pack config owner；重复 bundling可能破坏 shared runtime identity。

Done：`unbundle: true` 生成稳定 `lib/protocol.js`，package `files` 显式发布该 artifact；repository `publint-all`、package publint 和 isolated tarball imports 通过。

## G01–G33 当前映射

下表把旧验收编号映射到当前稳定 IDs；“当前实现/验收判断”描述本轮源码与证据，不复述旧计划的状态词，也不把局部 PASS升级为完整验收。

| 旧 Gap | 当前实现/验收判断 | 当前 IDs | 当前基线/证据边界 | 关闭所需的新证据 |
|---|---|---|---|---|
| G01 未释放资源恢复 | 已实现部分机制，验收未闭合 | F-RT-03, T-03/T-04, O-04 | controller/closure/workspace slice已有；多 provider/跨 host kill points未闭合 | JSON/SQLite真实资源窗口、fence/quiescence、provider loss和同候选日志 |
| G02 摘要 Consumer | 当前实现/验收待补 | T-03/T-08, D-03/D-07 | summary Consumer、Host/SDK route和fingerprint已有；完整 compaction/restart evidence待绑定 | source visibility、fingerprint、checkpoint/compaction、same-key replay |
| G03 Direct subset/broadcast | 当前实现/验收待补 | T-06 | v4 adapter、independent recipient tests/build已有；正式 browser只选一个场景 | v4 full recipient/final matrix、browser and receipt evidence |
| G04 Invitation/ack | 当前实现/验收待补 | T-03/T-06 | own ACK、pending restart、deadline logic和8 open-channel tests已有 | local/WS/human/service endpoint matrix、expiry/release/browser |
| G05 General placement | 部分实现，跨 provider 验收未闭合 | F-RT-01/F-RT-02, F-SC-02 | child isolation、workspace preflight/final eligibility和frozen omitted-placement defaults已能验证 | route compatibility、provider eligibility和跨 provider evidence |
| G06 结果/延迟/成本排名 | 当前实现/验收待补 | T-08 | ranking source/property suites存在，当前 candidate evidence不足 | frozen ranking input/version、restart and no-candidate matrix |
| G07 单任务完整取消 | 部分实现，完整验收未闭合 | T-01/T-03 | normal/workflow cancellation slices已有；full Hub/remote resource matrix未闭合 | pending/review/assigned/running、old epoch、Team cancel、allocation settlement |
| G08 模板/workflow角色 | 部分实现，child组合待决定 | F-UI-03, F-CT-04 | workflow role/compiler and UI task slices已有；workflow child组合是 decision | role route/reviewer evidence、plan projection和明确 child decision |
| G09 Child task模型/入口 | 当前实现/文档待补 | F-CT-02, D-01/D-08/D-10 | TeamRun/tool/Hub/Delegation path及focused tests已有；package docs/catalog缺口存在 | child package docs、tool catalog、full input/result/authority matrix |
| G10 Child saga/结算 | 当前实现/验收待补 | T-03 | delegation6、child-result28、usage4和Loader已有 | all cross-log kill points、parent receipt/charge/archive and artifacts |
| G11 Shared workspace observation | 已实现默认关闭 periodic pulse，完整 provider-loss 验收未闭合 | F-WS-01, T-04/O-02 | baseline/publish/integration/release/periodic classification and bounded pulse slice已有 | provider loss、artifact/integration provenance and cross-host evidence |
| G12 Supervisor seam | 部分实现，完整 descriptor/进程验收未闭合 | F-RT-03, T-04 | SDK/HTTP supervisor slice和unknown fail-closed已有 | provider descriptor/retirement、health/fence、actual process evidence |
| G13 Cross-host recovery | 源码路径存在，跨主机验收未执行 | F-RT-03, T-04 | WebSocket/HTTP sources存在；独立 host execution未证实 | two-host old epoch/new epoch/fence/stall matrix |
| G14 Sandbox loss settlement | provider contract存在，loss验收未闭合 | T-04, O-02 | provider/artifact contracts存在；loss/settlement candidate未闭合 | sandbox loss、artifact retain、allocation retry/stall and release |
| G15 Durable human inbox | 已实现分页/closed outbox，长期验收未闭合 | T-06, O-04 | closed outbox10、Loader1和SDK/Host inbox methods已有 | long-history retention、display cursor、restart pagination and browser |
| G16 人工请求重启回答 | durable action路径存在，重启矩阵未闭合 | T-06, O-04 | human action/inbox source已有；full approval/question/review restart matrix未绑定 | revoke/retry/duplicate and persisted display/action evidence |
| G17 UI成员管理 | 组件路径存在，真实成员流程未闭合 | F-UI-01, T-06 | component/channel UI slices已有；full member browser flow未闭合 | invite/activate/remove/interrupt real service browser |
| G18 UI频道管理 | 当前 keyless browser 已通过，独立环境/GIF 验收仍开放 | T-06 | V117 完整 Web lane 覆盖现有 consult/discussion/direct v4 browser scenarios | live-model/GIF and independent-host acceptance |
| G19 UI任务/DAG | 当前 plan UI、集合 bounds 与任务/依赖导航已完成 | F-UI-01/F-UI-03, T-06 | V116/V117 覆盖失败/取消恢复、绑定任务导航、workflow tool、Team cancellation 与 keyless Web regression | live-model/GIF and independent-host acceptance |
| G20 UI人工review/action | backend facts存在，真实 UI 流程未闭合 | T-06 | backend action/review facts已有；full UI owner flow未证实 | accept/rework/approval/question with correct owner and browser |
| G21 UI integration | integration表单存在，child artifact browser组合验收未闭合 | F-UI-02/F-UI-03, T-06 | integration表单、target/version、source attempt和child artifact focused projection已有；browser组合证据未闭合 | target/version/policy/proposal/conflict/child-artifact verification UI |
| G22 UI分页 | 成员/任务/workflow/artifact 有界集合已完成 | F-UI-01, T-06 | V116/V117 验证独立 cursor/loading/error/newer、failed page retention、keyboard 和窄屏 | independent-host and long-history extensions remain separate |
| G23 UI一致性/mutation | 部分实现，完整流程未闭合 | F-UI-01, T-06/O-04 | reconnect collection slice 38/38 and full client runtime 28 files/368 tests pass; current full flow not closed | authoritative selection、stale/offline/partial、failed mutation draft |
| G24 Legacy产品/发行移除 | 已确认，旧 surface 仅保留 private compatibility | F-LG-01, O-02 | default Team-first、private compat inventory、release/tarball/catalog gate 已通过 | canonical cross-platform release consumer parity 仍属 O-02 |
| G25 Session旧属性退出 | 已完成当前 source/consumer cutover，artifact/release parity另行追踪 | F-LG-02, T-05 | V78覆盖旧 header reject、descriptor v3 depth、JSONL/SQLite、child listing/depth/API consumer；跨平台 artifact仍由 O-02 追踪 | full-repository current candidate 与 release artifact parity |
| G26 逐文件覆盖率 | 旧包有覆盖率，当前 candidate未绑定 | T-02, O-01 | old package coverage exists；latest changed candidate coverage未绑定 | same-source per-file 100% and named branch report |
| G27 生命周期故障矩阵 | selected slices存在，完整矩阵未闭合 | T-01/T-03 | selected durable/closed/usage slices已有；full Hub and all kill points未闭合 | JSON/SQLite real process windows and resource proofs |
| G28 统一跨主机故障矩阵 | local/HTTP/WS路径存在，跨主机未执行 | T-04, F-RT-03 | local/HTTP/WS packages存在，separate hosts未执行 | static/dynamic, duplicate/order, slow/revoke/fence evidence |
| G29 真实模型完整协作 | 旧/局部模型证据存在，当前全流程未执行 | T-05 | keyless replay and old real model evidence分开存在 | current model fanout/rework/child/files/artifacts |
| G30 浏览器/GIF | 完整 keyless Web lane 已通过，live-model/GIF 仍未闭合 | T-06, O-01 | V117：72 files，237 passed/14 skipped/0 failed | current live-model/GIF and independent-environment evidence |
| G31 性能预算 | fixture 与 macOS reference samples 已完成，完整性能验收未闭合 | T-07, F-SC-01 | ACK-corrected 4096/16384 loads 1/1；macOS 3 samples/median/RSS 已记录，Linux/fresh-process/CI 未执行 | ACK-adjusted load harness, 3 samples/median/RSS/CI |
| G32 双 SDK/全仓/发行 | 发行验收未完成 | O-02/T-01/T-02 | supervisor HTTP publication closure已修复；canonical release、TS/Python/three-platform packs仍未验收 | TS/Python/three-platform packs, canonical closure/tarball import, and full candidate checks |
| G33 文档/证据收敛 | 文档与证据收敛未完成 | D-01..D-10,D-15..D-17, O-01/O-05 | generated graphs/catalogs stale or blocked；current plan now captures boundaries | source JSDoc/type ownership fixes, regenerate, paired docs, Note format, doc-sync and evidence ledger |

## 关闭判定

功能项只有在 source behavior、owning consumer、negative path、recovery/concurrency path和同候选证据同时存在时才能标记 CLOSED。

`unverified` 只表示缺证据；必须先补验证或作范围决定，不能用“源码看起来存在”改成 PASS。

`decision` 只有在 Root记录产品范围、接口 owner、持久化兼容性和拒绝语义后才可进入开发；决定为“不做”也要保留明确 rejected combination 和替代路径。

full Hub、full repository coverage、multi-host、real model、browser matrix、performance和canonical release是独立出口；任何 focused test、limited publint、单 browser case或旧 doc-sync不替代它们。

文档生成先修源代码和 generator input，再运行 generated catalog checks；不手改生成区域，不把历史证据表复制成新的事实源。

本轮编辑后 verify-md-links 与 verify-doc-budgets 通过；doc-sync 仍为 24 passed、4 failed，且不能把 doc-sync 或局部 gate 写成 release PASS。
