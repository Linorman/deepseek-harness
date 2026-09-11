# Native multi-agent gap closure development plan

本计划执行[gap design](gap-design.md)中的当前边界，服务于共享 dirty worktree 的下一轮功能开发、测试执行、文档收敛和发行验收。

本计划不改变原始主提案、P0/P1 Note或既有 2026-09-05 计划的 owner；旧计划只作为历史证据，新的当前入口由本目录提供。

## 执行规则

生产代码和测试代码编写由 gpt-6-astra medium owner负责；测试、构建、lint执行和文档撰写由 gpt-5.6-luna max负责。这是协作代理设置，不是 Clocky 产品的模型路由；同一共享文件只有登记 owner 可以写，验证代理只读取和运行。

功能优先、必要测试随后、文档在证据稳定后收敛；功能验收需要的负例、恢复和并发测试不能被延后到 release 之后。

记录 command、log、source hash、artifact digest、审计时点、平台、Node/pnpm版本和 credential 注入方式/可用性；不记录密钥值、`.env` 内容或访问 token，也不执行 reset、clean、commit、push或未经登记的源码生成清理。

Source plane 测试通过 direct Node ESM launcher、项目内 TMPDIR 和显式 tsconfig paths解析源文件；artifact plane 测试必须明确使用最新 build 输出或 isolated pack。

任何一次 PASS 只适用于其 command、输入、源码时点和测试范围；focused PASS、单 browser scenario、limited publint和旧 full-unit 不得合并成全仓放行结论。

`confirmed`、`partial`、`unverified` 和 `decision`的定义见[设计报告](gap-design.md#范围输入和判定方式)；`decision`先完成产品决定再进入实现，`unverified`先补证据或明确不做。

当前状态与 [gap-design.md](gap-design.md) 同步：F 为 12 confirmed、1 partial、0 unverified、7 decision；T 为 1 confirmed、3 partial、4 unverified；D 为 13 confirmed；O 为 4 confirmed、1 partial、1 unverified。总计 47 个稳定 ID，其中 30 confirmed、5 partial、5 unverified、7 decision；已实现但缺同候选证据的能力只进入测试缺失。


当前候选摘要（2026-09-10）：F-CH-01、F-CT-02、F-RT-01、F-RT-02、F-SC-01、F-SC-02、F-WS-01、F-UI-01、F-UI-02、F-UI-03、F-LG-01 和 F-LG-02 已 confirmed；F-RT-03 为 partial。T-01、全部 D rows、O-01/O-03/O-05/O-06 已 confirmed；T-02/T-03/T-06/T-07/O-04 为 partial；T-04/T-05/T-08/O-02 为 unverified；F-CT-03..08 与 F-SC-03 为 decision。

当前 evidence ledger 为 127 条记录（V01–V119 与 8 条 PUB）。V113 source regression 为 1016 files、16143 passed、114 skipped、0 failed，Hub 为 52 files/799 tests；V119 doc-sync 为 24 passed、4 failed。V119 的失败是既有 translation pairing、Markdown wrap、Config catalog 和 persistence catalog，不能写成完整文档或 release PASS。

当前功能与测试状态不因 focused evidence 自动外推：separate-host、real-model、coverage、performance、live-model/GIF 和 canonical release 仍分别由 T-02/T-04/T-05/T-06/T-07/O-02 追踪；decision rows 先完成产品决定。

## 当前证据入口

[verification-evidence.json](verification-evidence.json) 保存验证记录；每条 PASS 只适用于其 command、source/artifact plane、候选版本和测试范围。

关键入口：V109–V110 绑定 task-linked consult、ACP ownership 和 JSON/SQLite Loader recovery；V113 绑定当前 source regression；V116–V118 绑定 bounded collections、workflow、GUI 和 keyless Web；V119 绑定当前 doc-sync 结果。完整 command、scope、hash、log 和 next action 只维护在 ledger 中。

[audit-baseline.json](audit-baseline.json) 保存 64 个证据源的 hash、HEAD、branch 和采集时点，用于发现 drift，不是 restore archive。

[gap-audit-root.json](audit-inputs/gap-audit-root.json)、[gap-audit-runtime.json](audit-inputs/gap-audit-runtime.json)、[gap-audit-channel-product.json](audit-inputs/gap-audit-channel-product.json) 和 [gap-audit-docs-evidence.json](audit-inputs/gap-audit-docs-evidence.json) 是本计划的只读审计输入；[fact-review.json](audit-inputs/fact-review.json) 是最终事实复核。

[documentation-validation.json](documentation-validation.json) 保存初始本地结构验证；当前 doc-sync 结果以 verification ledger 的 V119 为准。

## 角色和独占范围

| 角色 | 负责范围 | 可写 source | 交给 Luna 的验证 |
|---|---|---|---|
| 集成人 | 共享接口、Host、bundle、legacy、release candidate、跨 owner 决策 | `packages/host/apiproxy`, `packages/bundle`, release scripts, candidate manifests | Host/Client faces、build、browser、release gates |
| child开发者 | parent child reservation、Delegation、placement、scheduler、workspace eligibility | `packages/team/team-delegation`, `team-placement-default`, `team-scheduler-dag`, parent TeamRun slices | child/placement/scheduler/workspace behavior and focused types |
| child结果开发者 | child result/receipt/closure、human outbox、UI race product slices | child result/workflow/human-client and assigned UI files | child Loader、outbox、UI tests and snapshots |
| Core/SDK开发者 | type/schema/protocol/public API and source JSDoc | owning `packages/core/team`, `packages/core/session`, `packages/sdk/*` | source tsc, protocol/SDK tests, generators |
| workspace/supervisor开发者 | provider roots、loss、supervisor descriptor、HTTP pack | `packages/team/team-workspace-*`, `packages/agent-runtime/*` | provider loss, tarball closure, remote runner |
| 验证与文档执行者 | execution, evidence ledger, current internal docs | `.tmp/handoffs`, this plan directory after authorization | direct Node tests, static gates, doc validation; no product code |

独占 ownership 只约束写入，不允许 owner 用自己的局部测试代替另一 owner 的 consumer、artifact或跨进程证据。

## 阶段 0：候选冻结与证据边界

入口：Root确认 source inputs、bundle composition、当前 owner、版本和本轮目标；旧日志保留但标记 historical。

步骤：

1. 重新生成 source manifest，记录 `git rev-parse HEAD`、branch、dirty paths、Node/pnpm/OS、tsconfig face和关键 source SHA-256。
2. 复制或引用可审阅的 candidate patch，不把 HEAD当作可复现实现；将不含敏感内容的关键 logs 复制到本目录 `evidence-logs/`，其余项目内临时输出只保留索引。
3. 为每个待执行 row 预先登记 command、source/artifact plane、expected count、skip policy和 evidence path。
4. 对 source/artifact 混用风险执行 O-03 hygiene inspection；不得 blanket-clean shared worktree。

出口：candidate manifest可由另一位开发者取得；每条历史 PASS有适用范围；所有 unverified/decision项有 owner。

失败处理：hash drift、缺文件、旧 artifact或环境不一致进入 O-01 evidence failure；不继续拼接旧 PASS。

## 阶段 1：修复高层 channel retry

入口：F-CH-01的 Host/SDK principal resolver、Hub keymatch和现有 media/parser输入保持可读；不添加新高层 receipt API，除非现有 durable record不足以保存 canonical draft。

独占 owner：集成人负责 Host/SDK seam协调，频道开发者负责 principal resolver，Hub开发者负责锁内 same-key match；验证与文档执行者只运行测试。

实现顺序：

1. 在 principal resolver 中先验证 current authenticated actor、channel membership、manifest fingerprint和 retained request anchor。
2. basic helper 使用 immutable role 与 retained request anchor 重建 canonical draft，规范化 consult `null`/exact peer 和 discussion `null`/full peers，再交给已有 `postChannelEnvelope` 的 Hub locked same-key match；命中返回原 Envelope，未命中继续当前 phase/cursor/adapter 校验。
3. 仅对 new key继续执行 current phase、expectedNext、active channel和speaker checks。
4. 对 consult response lost、discussion close、direct close和restart统一处理；same-key 语义等价 draft 重试成功，canonical delivery/causation/correlation/task/trace/priority/ttl/audience/content/attachment 真正变化才返回 conflict。
5. Host、SDK server和Python route复用相同 Core wire semantics；`taskId` 按 `draft.kind` 保留，不按 `protocolStatus.phase` 推导。

阶段 1b 只在 compaction 或媒体 anchor 确实无法由 retained request 重建时启动；届时先评估最小查询/receipt 设计，不提前增加新的高层 API。

持久化检查：如果现有 Envelope payload已经足够保存 normalized request，保持 journal format；否则由 Hub owner定义一个最小 high-level request anchor，更新 JSON/SQLite fold、schema、TS/Python parser和 retry evidence。

恢复检查：旧 key 命中仍检查当前 membership、role、channel metadata和 retained request anchor，当前 `expectedNext` 不得否定该只读命中；只有 new post 的 revoke、foreign/cross-team、wrong role/turn、closed storage和mismatched media才 fail closed；read-only same-key match不重新触发 policy side effects。

出口：Host/SDK request retry、closed response/discussion/direct retry、same-key conflict、restart、revoke and no-duplicate attachment全部有同候选 JSON/SQLite evidence。

## 阶段 2：Child shared slice 与范围决定

入口：shared child saga source和现有 delegation/child-result/usage/Loader tests可运行；F-CT-03..08的产品范围尚未默认打开。

独占 owner：child开发者负责 TeamDelegation/parent task；child结果开发者负责 child result/receipt/closure；TeamRun owner负责 child topology；Hub owner负责 durable proof/fold。

已支持 slice 的基线复验顺序（不新增实现）：

1. 通过 `TeamRun.startDelegatedTask` 创建唯一 parent child task，初始 delegation phase为 requested。
2. 由 `TeamDelegation` 发现 pending parent并调用 `beginTaskDelegation` 建立 reservation，再创建 shared child、绑定 child run、等待 channel admission并发送 objective。
3. 由 child Team 产生 parent-service response；Hub 先持久化 parent result admission。
4. `completeChildTeam` 以该 admission 提交 service receipt，并等待 child quiescent/terminal 及 charges 完成。
5. Parent 可在 result admission 后读取 result/artifacts；只有 service receipt、child终态和 charges屏障满足后才能完成 parent final settlement。
6. Restart、duplicate key、partial bootstrap、service receipt missing、child nonterminal和parent charge pending都按现有 durable records恢复。

共享 slice 出口：delegation6、task-delegation4、child-result28、usage replay4、child-delegation Loader complete/cancel、closed-channel outbox Loader和 human outbox evidence在同一 candidate重跑；Hub full-suite另由 T-01 关闭。

范围决定行：

| 决定 | 当前默认 | 进入实现的条件 | 禁止的捷径 |
|---|---|---|---|
| F-CT-03 nonshared child workspace | 不承诺 | 产品确认 worktree/E2B child root owner、lease和artifact provenance | 把 Participant attempt 当 child allocation |
| F-CT-04 workflow child node | 不承诺 | workflow schema、compiler、result aggregation和cancel semantics签字 | 让现有 participant compiler默认为 child |
| F-CT-05 child generations | one child | 设计 generation id、usage/result isolation和terminal ordering | 复用 attemptHistory或同 delegationId开第二 child |
| F-CT-06 parent review | review none | reviewer owner、proof、receipt、rework semantics决定 | 把 service receipt当 reviewer receipt |
| F-CT-07 parent placement | template selection | child topology route/descriptor和grant narrowing决定 | 直接解禁父 task placement |
| F-CT-08 child integration | 暂不承诺 | child-result provenance union、artifact visibility和target CAS可证明 | 将 child sourceTaskId伪造成 Participant completed attempt |
| F-SC-03 hierarchy ceilings | per-Team现有上限 | whole-tree count/activation ledger语义决定 | 递归即时求和取代可恢复 ledger |

每个 decision row 的出口是 decision record、接口归属、持久化字段、拒绝语义和测试矩阵；“不做”也要有替代路径，不计为功能缺陷。

## 阶段 3：runtime、placement、scheduler、workspace

2026-09-10 runtime 补充：已修复 provider 卸载但 fencer/supervisor 仍存在时继续终止旧进程的问题；cold replacement 在 fencing 前记录 `AGENT_RUNTIME_PROVIDER_UNAVAILABLE` 并保留旧 epoch。新增两条回归先复现失败，再通过 runtime/controller 215 项联合回归；channel 113 项回归、相关包类型检查与定向 lint 通过，另通过真实 Loader 启动的 ACP 进程恢复快照（[V120–V125](verification-evidence.json)）。另已修复 fencing 期间 provider 卸载的竞态：保留 durable fence 证明并记录同名 stall，重开 JSON 存储后状态一致；6 files/135 tests、类型检查和 lint 通过（[V126–V129](verification-evidence.json)）。F-RT-03 保持 `partial`，独立 host 验收未执行。

入口：阶段 0 candidate frozen；F-CT shared slice未回归；placement和workspace owner对 child isolation边界有共识。

并行组 A：F-RT-01 与 F-SC-01。

步骤：placement owner 在 `ready` boundary 过滤 `execution.kind: 'child-team'`；Delegation owner先增加跨 pulse page/Team预算和 event wake，再按目标规模设计 StorageLog directory pagination、轻量 Team index或 `maxScanned` continuation；scheduler 保留 child Team内部 participant task路径。

出口：only-child不会调用 controller.activate；mixed task只激活 participant；multi-page discovery无遗漏/重复且每 pulse drive有界。StorageLog内部全量 stream/id sort、archive skip和当前 id-index cursor的限制分别记录，不能宣称总 I/O或内存已界定。

并行组 B：F-RT-02 与 F-WS-01。

步骤：workspace provider通过 optional preflight 做可判定的 route compatibility，placement保留 activation 后 final eligibility；shared workspace提供默认关闭的 periodic observation stage、interval和per-pulse allocation bound；不得把 pulse 伪标为 publish；artifact/provider loss和integration provenance转入 T-04/O-02 验证。

出口：不兼容 route不长期占 lease；periodic/publish/release无重复错序且 pulse disposal 等待已接受操作；provider loss和integration CAS进入对应测试出口；不把 workspace observation当 filesystem lock。

并行组 C：F-RT-03 与 T-08。

步骤：SDK recovery保持现状；若 ACP恢复进入范围，定义 provider-owned descriptor、process identity和fence；scheduler固定 ranking input/version并把 candidate/restart/no-provider matrix纳入 T-08。

出口：unknown/unreachable/old epoch产生 named stall；相同 frozen input选择一致；真实 remote runner和当前本地 recovery证据分开。

F-SC-02 frozen defaults单独等待产品语义；undefined若表示无额外 constraint，不为生成冗余空对象。

## 阶段 4：UI/API bounded product surfaces

入口：Host/SDK channel catalog/admission/input/attachment/summary routes和现有 6 client files test已在当前 candidate通过；后端 page/API owner确认返回 cursor语义。

独占 owner：client runtime开发者负责 page state，Host/SDK/Python开发者负责 wire，UI开发者负责 TeamPage/UI，集成人负责 browser composition；验证与文档执行者负责执行。

执行顺序：

1. F-UI-01 先为 members/tasks/artifacts定义独立 cursor/pages/loading/error/hasNewer；继续保留 selected Team和failed page。
2. F-UI-02 接入 childTeamId、delegationResult和child artifact refs，只读导航不自动 resume。
3. F-UI-03 接入 workflow plan bounded read、dependency links和plan phase；authoring继续 `team_workflow_*` tool。

API不变条件：所有 mutation仍 actor-free on wire，由 authenticated principal/human binder产生 runtime proof；cursor/revision只是 optimistic fence，不是 authority。

出口：每个 collection有 bounded page tests；child result/artifact visibility and private rejection；workflow plan display；真实 browser scenario和可观察 durable WAL；failed reads不清除 selection/input。

## 阶段 5：Legacy 和 Session cutover

入口：F-CH/F-CT/F-RT核心边界已决定，合法 AgentRuntime/ACP/SDK consumer inventory完成；不得用 grep alone删包。

独占 owner：集成人/legacy开发者负责 source/config/tool/catalog/package/release；Session开发者负责 header/parser/persistence；验证与文档执行者执行 compatibility smoke。

步骤：

1. 对 subagent/fork/report/control packages、Python runtime drivers、carrier routes和model-facing tools分类为 internal reusable、explicit compat或dead。
2. 将 reusable activation mechanics归 AgentRuntime-owned modules；保留 legitimate SDK/ACP fresh/resume/fence/shutdown。
3. 对 product Session `origin`/`delegationDepth`先完成 consumer migration，再设计 compat descriptor；保留 `parentSession` fork lineage。
4. 更新 release family discovery、package exports、config/tool/module catalogs和compat constraints。
5. 在 source、packed tarball、Python wheel和default profiles上检查 absence/presence。

出口：default source/packed composition无被替代的公开入口；explicit compat（若保留）private/compat-prefixed且可运行；old headers across JSONL/SQLite/compressed carriers reject；两 SDK snapshots pass。

## 阶段 6：测试、文档、发行收敛

入口：功能 owner提交 source status和negative/recovery cases；所有 decision rows已分类；O-01 candidate manifest更新。

测试顺序：

1. T-03 child kill-point matrix和 T-01 Hub full suite。
2. T-02 changed-source per-file coverage，再执行 full repository coverage lane。
3. T-04 multi-host fault matrix和 T-05 real-model collaboration。
4. T-06 complete browser/GIF matrix。
5. T-07 先修真实 ACK load fixture，再执行三次 performance reference runner。
6. T-08 state-machine/property expansion。

文档顺序：

1. 以 V119 的四个失败 gate 为共享文档/生成物 owner 的待办，不把本目录计划改成双语 pair。
2. 源代码或 generator 修复后重新运行对应 catalog、graph、pairing 和 Markdown gates。
3. 只在当前边界与同候选证据同步后更新 ID 状态；删除历史 follow-up，不复制 ledger。
4. 最后运行本节列出的文档验证命令，并保留失败根因。

发行顺序：

1. O-06 已 confirmed；剩余发布重点是 O-02 canonical package/platform closure。
2. source tsc、artifact build、NodeNext consumer和限定 publint先绑定同一 candidate。
3. 运行 full publication closure、isolated tarball import、Python wheel/bundled runtime和 Linux/macOS/Windows consumers。
4. 记录 package/artifact digest、launch/shutdown、tool inventory和失败诊断。

阶段出口：功能、测试、文档、其他四类均有状态；unverified项已验证或有明确 blocked reason；decision项有产品结论；release pack闭包和多平台 consumer通过。

## 可勾选交付矩阵

### 功能性缺失

矩阵中的 `[x]` 仅表示该 ID 的状态字段为 `confirmed`；`partial`、`unverified` 和 `decision` 保持未勾选。

| Done | ID | 状态 | 独占 owner | 必交证据 |
|---|---|---|---|---|
| [x] | F-CH-01 | confirmed | 集成人/频道开发者 | Host/SDK/JSON/SQLite keyed retry and no duplicate |
| [x] | F-CT-02 | confirmed | child开发者/tool开发者 | dependency gate; model-facing authoring remains deferred |
| [ ] | F-CT-03 | decision | 集成人/workspace开发者 | product decision and independent child lease design |
| [ ] | F-CT-04 | decision | workflow开发者/child开发者 | child template/compiler/result decision |
| [ ] | F-CT-05 | decision | child开发者/Hub开发者 | generation id and accounting decision |
| [ ] | F-CT-06 | decision | TeamRun/review开发者 | parent review owner/proof decision |
| [ ] | F-CT-07 | decision | TeamRun/placement开发者 | child topology placement decision |
| [ ] | F-CT-08 | decision | artifact/Hub开发者 | child result to explicit integration CAS |
| [x] | F-RT-01 | confirmed | placement/scheduler开发者 | no child Participant activation |
| [x] | F-RT-02 | confirmed | workspace/placement开发者 | compatibility and owned lease cleanup |
| [ ] | F-RT-03 | partial | supervisor/controller开发者 | descriptor、fence、old epoch and host failure |
| [x] | F-SC-01 | confirmed | child开发者 | bounded page discovery and fairness |
| [x] | F-SC-02 | confirmed | 集成人/Hub开发者 | frozen omitted-placement semantics |
| [ ] | F-SC-03 | decision | 集成人/Hub开发者 | per-Team vs whole-tree ceilings |
| [x] | F-WS-01 | confirmed | workspace开发者 | pulse decision and observation ordering |
| [x] | F-UI-01 | confirmed | client runtime/UI开发者 | member/task/artifact pages and stale selection |
| [x] | F-UI-02 | confirmed | child/UI开发者 | child navigation and artifact visibility; [evidence](evidence-logs/ui-child-result-2026-09-09.log) |
| [x] | F-UI-03 | confirmed | UI/workflow开发者 | bounded plan projection |
| [x] | F-LG-01 | confirmed | 集成人/legacy开发者 | source/config/package/tarball cutover |
| [x] | F-LG-02 | confirmed | Session开发者 | old header reject and compat descriptor |

### 测试缺失

| Done | ID | 状态 | 必交证据 |
|---|---|---|---|
| [x] | T-01 | confirmed | Hub full suite and full repository result on one candidate |
| [ ] | T-02 | partial | [V139](verification-evidence.json): HTTP client per-file 100%; endpoint and full coverage pending |
| [ ] | T-03 | partial | [V131–V133](verification-evidence.json): 26/26 cross-log crash/replay cases; identity/receipt/charge deduplication proven; [V135](verification-evidence.json) covers archive sequencing; packaged routes and multi-host pending |
| [ ] | T-04 | unverified | multi-host provider/transport fault matrix |
| [ ] | T-05 | unverified | [V134](verification-evidence.json): model key/route absent; configure environment before fan-out/rework/child/files acceptance |
| [ ] | T-06 | partial | complete browser scenarios and GIF artifacts |
| [ ] | T-07 | partial | ACK-corrected load runner, 3 samples, median, RSS, CI |
| [ ] | T-08 | unverified | state-machine models, seeds and replay agreement |

### 文档缺失

| Done | ID | 状态 | 必交证据 |
|---|---|---|---|
| [x] | D-01 | confirmed | team-delegation package README and family links |
| [x] | D-02 | confirmed | architecture map names current channel/child extensions |
| [x] | D-03 | confirmed | Team subsystem service ownership and generated region |
| [x] | D-04 | confirmed | capability graph generated edges |
| [x] | D-05 | confirmed | module graph generated nodes/edges |
| [x] | D-06 | confirmed | event listener matrix includes delegation |
| [x] | D-07 | confirmed | Config source JSDoc and generated catalog |
| [x] | D-08 | confirmed | `team_task_delegate` tool catalog |
| [x] | D-09 | confirmed | Host/SDK route README contracts and pairs |
| [x] | D-10 | confirmed | TeamRun/tool child operation docs |
| [x] | D-15 | confirmed | UI child/collection contract |
| [x] | D-16 | confirmed | placement README language pairing |
| [x] | D-17 | confirmed | authenticated invitation Note format |

### 其他缺失

| Done | ID | 状态 | 必交证据 |
|---|---|---|---|
| [x] | O-01 | confirmed | candidate manifest, hashes, reproducible artifacts |
| [ ] | O-02 | unverified | canonical npm/Python/platform release consumers |
| [x] | O-03 | confirmed | source-adjacent artifact hygiene check |
| [ ] | O-04 | partial | human inbox retention decision and bounded history |
| [x] | O-05 | confirmed | Typert use-site import ownership and generator PASS |
| [x] | O-06 | confirmed | supervisor HTTP closure and isolated tarball import |

## 命令与证据模板

以下是建议命令模板，不是已运行证据；实际执行结果只从 [verification-evidence.json](verification-evidence.json) 和对应日志读取。

通用 source command 前缀：`env TMPDIR="$PWD/.tmp/verification-runtime" TSX_DISABLE_CACHE=1`。

Focused behavior 使用 `node node_modules/vitest/vitest.mjs run <files> --reporter=dot`；snapshot 使用 `CLOCKY_SNAPSHOT=replay node node_modules/vitest/vitest.mjs run --config <config> <files>`；执行前创建项目内 TMPDIR，每个场景保留 raw log。

Host face 使用 `node node_modules/typescript/bin/tsc -b tsconfig.host.json --pretty false`，Client face 使用相同 launcher和 `tsconfig.client.json`；两个 face 不共用未声明的 output。

最新完整 build 使用 `pnpm run build`，因为 build script需要实际 pnpm invocation；build之后才运行 artifact-plane NodeNext和publint。

NodeNext 使用 `pnpm run verify-node-next-types`；限定包使用 `node node_modules/publint/src/cli.js run packages/<group>/<package>`，full release另运行 repository publication closure。

文档 source/generator修复后执行 `pnpm run verify-cordis-catalog`、`pnpm run verify-config-catalog`、`pnpm run verify-tool-catalog`、`pnpm run verify-doc-graphs`、`pnpm run verify-module-graph`；这些命令不能在 source blocker存在时被记为 PASS。

最终文档验证执行 `pnpm run verify-doc-budgets`、`pnpm run verify-md-wrap`、`pnpm run verify-md-links`、必要的 `verify-doc-refs`、`pnpm run doc-sync` 和 `git diff --check`；用户暂停文档期间不运行旧 docs gates，当前授权后再在最终 Markdown完成时执行。

每条 evidence row 至少填写：ID、status、candidate/source hash、artifact hash（如适用）、command、environment、pass/fail/skip count、log link、first failure、owner、next action和是否同一候选。

## Release 条件

不能把 20 个功能 ID 全部勾选作为唯一放行条件；必须同时检查测试、文档和其他 rows 的出口。

放行前必须有 T-01/T-02 的同候选 full Hub/coverage 结果、T-04/T-05 的实际环境说明、T-06 browser/GIF、T-07 performance samples、O-02 canonical packs，以及当前 doc-sync 失败项的 owner-level closure evidence。

功能中的 `decision` rows 可以在 release scope中明确标记为不承诺，但不得静默当作已实现；`unverified` rows必须有验证结果或具名 BLOCKED_ENV和解锁责任人。

任何旧日志、旧计划表、历史 model run、单包 coverage、limited publint、selected browser或 build success都不能替代同候选完整证据。

文档发布前，generated catalogs由 generator刷新，package/architecture docs由 owning tier维护，Chinese pair按现有 pairing workflow同步；本目录两个内部文档保持中文且不新增 README/Agent Note/site projection。

Full release gate结束后，Root更新 [gap-design.md](gap-design.md) 的状态与 [verification-evidence.json](verification-evidence.json) 的同候选记录；Luna不自行把 goal标记为完成。
