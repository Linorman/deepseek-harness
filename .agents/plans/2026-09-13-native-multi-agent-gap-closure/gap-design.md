# Native multi-agent：当前缺口与收尾设计

按用户 2026-09-17 的执行调整，优先完成所有已确认、必需的 F 项功能开发；待决定项不扩张，独立 T/D/O 收尾不作为暂停本轮开发的前置条件。功能实现与发布验收分别记录。

本文件是开发参考，定义剩余需求、当前实现边界和验收条件；执行顺序见 [development-plan.md](development-plan.md)。状态只在本文的登记表维护，命令结果保存在各次验证记录中，不在执行计划复制完成勾选。

本文接替 [2026-09-08 gap design](../2026-09-08-native-multi-agent-gap-closure/gap-design.md) 的当前入口，保留其全部稳定 ID，并纳入 [2026-09-13 Team 审查](../2026-09-13-team-audit/README.md) 的运行与模型交接问题。旧报告、复现和 PASS 均是特定源码时点的证据；本文件不把它们改写成当前通过。

## 需求与基线

需求上位文件是[主提案](../../notes/proposed/architecture/2026-08-27-native-multi-agent-work-system.md)、[P0 安全闭环](../../notes/proposed/architecture/2026-09-04-native-multi-agent-p0-safety-closure.md)和 [P1 产品收敛](../../notes/proposed/architecture/2026-09-04-native-multi-agent-p1-product-convergence.md)。本计划保留其强制要求；扩展组合可以提出延期建议，已承诺的能力只能通过上位需求的明确修订退出版本。

审查基线为 `26bc4314fca3a98e9f479c509f7771e623ef60f9` 加共享工作区。工作区同时存在 Team UI 与运行修复；接收代码前必须核实当前 diff 和 owner。[review-baseline.json](review-baseline.json) 保存本轮读取文件的哈希及旧证据漂移检查，仅用于定位审查时点，不是可恢复源码归档，也不关闭 O-01。

历史证据入口：[V01–V141 与 PUB ledger](../2026-09-08-native-multi-agent-gap-closure/verification-evidence.json)、[Team 审查复现](../2026-09-13-team-audit/README.md)、[正在进行的修复记录](../2026-09-13-team-audit/IMPLEMENTATION.md)。复现失败证明缺陷存在；修复日志需要源码绑定和真实入口验收后才能关闭条目。文档交付验证见 [validation.json](validation.json)，不代表产品验证。

### 状态语义

| 维度 | 取值与含义 |
|---|---|
| 范围 | 必需：当前 P0/P1 或已支持路径必须满足；待决定：未承诺的扩展，默认不进入本轮实现。 |
| 工作状态 | 已实现：已确认的 F 功能开发及其必要回归完成，独立 T/D/O 验收仍单独开放；已有：登记的主要机制存在，优先复验而非重写；部分：有明确未完成子项；待做：交付物缺失；接收中：相关工作区实现正在变化，先接收当前结果；待决定：先决定范围。 |
| 证据状态 | 源码：本轮静态核查；历史：已有执行结果，需核实输入是否适用；未执行：缺目标验收；待接收：新修复尚无本计划认可的完整证据；通过：具名场景绑定输入且满足该项全部出口。 |

“已实现”记录用户要求的 F 开发暂停点，不代表完整发布验收关闭。“已有”不等于关闭。关闭一项需要其范围内的实现、负例、恢复/并发、文档以及适用证据均满足；发布还必须经过独立的 promotion 验收。`BLOCKED_ENV` 是执行阻塞原因，不是通过、关闭或范围豁免。实现变动只撤销受影响的证据适用性，不抹去历史 PASS；最终 release 仍需要同一可取得候选的完整证据。

## 缺口登记表

优先级：P1 为可能丢失进展、权限/资源保证或导致错误放行的问题；P2 为规模、产品完整性、文档与验收收尾。以下每个旧 ID 都有明确去向；不通过混合 F/T/D/O 数量计算完成百分比。

### 功能与支持边界

| ID | 优先级 | 范围 | 工作状态 | 证据状态 | 剩余工作或复验边界 |
|---|---|---|---|---|---|
| F-CH-01 | P1 | 必需 | 已实现 | 历史 | 高层 channelInput canonical retry；复验关闭后同 key、不同内容 conflict、撤权与媒体 anchor，复用 Hub 幂等记录。 |
| F-CH-02 | P1 | 必需 | 已实现 | 历史 | review channel open 已持久化、post 失败及重启使用同一 durable 身份；R3 已接收。N515 的 Hub/scheduler 回归与 N516 Loader 组装通过，完整发布验收仍归 T/O。 |
| F-CT-02 | P1 | 必需 | 已实现 | 历史 | shared child DAG blocker、唯一 child、取消与结算；保留 Core/Host blockedBy，模型直接 authoring 不默认扩展。 |
| F-CT-03 | — | 待决定 | 待决定 | 源码 | 整个 child 的 nonshared root 与 provider-owned lease。 |
| F-CT-04 | — | 待决定 | 待决定 | 源码 | workflow child node；与普通 participant workflow 的通用 placement 分开。 |
| F-CT-05 | — | 待决定 | 待决定 | 源码 | 同一 delegation 的多个 child generation；当前只支持一个。 |
| F-CT-06 | — | 待决定 | 待决定 | 源码 | parent 对 child result 的独立 review/rework。 |
| F-CT-07 | — | 待决定 | 待决定 | 源码 | parent 选择整个 child topology 的远程执行位置。 |
| F-CT-08 | — | 待决定 | 待决定 | 源码 | child result 作为 integration source 的 provenance；不能当成仅缺 browser evidence。 |
| F-RT-01 | P1 | 必需 | 已实现 | 历史 | placement 不激活 child parent task；child 内部 participant 仍可运行。 |
| F-RT-02 | P1 | 必需 | 已实现 | 历史 | preflight 与真实 binding eligibility 分工已验证。N284–N291 修复拒绝后的 lease 清理所有权；N303–N310 修复失败 close 缓存阻止重试，并保留关闭期间的真实准备错误。149 项相关测试、10 项 Loader 快照通过；placement 全包已有 scoped coverage。N353–N368 补 controller 无容量上限时的 raw handle 清理所有权、reservation 写回失败重试及失败 close 重试；198 项相关测试、10 项 Loader 场景通过。controller 完整 coverage 与最终候选复验仍开放。 |
| F-RT-03 | P1 | 必需 | 已实现 | 历史 | SDK/ACP descriptor 与本地 fence 已有；N358–N368 修复 stale fence 的准确 epoch 校验与 provider 终止证据要求，缺失/失败和执行期间撤权均不写持久终止事实。真实 Hub/Host 定向回归通过。N423–N437 补 stale fence 的 Participant 恢复互斥、关闭等待及真实插件卸载时的 proof 注册顺序；206 项定向测试、10 个 Loader 场景通过。逐文件 coverage、provider retirement 与独立主机恢复的完整矩阵仍开放。 |
| F-RT-04 | P1 | 必需 | 已实现 | 历史 | R1 已接收：真实 turn continuation 保留 task/attempt、确定性输入去重与预算；未 report 区分正常完成、error 和 cancellation。N515 的运行回归、N516 的真实 Loader 场景通过；独立完整矩阵仍归 T。 |
| F-SC-01 | P2 | 必需 | 已实现 | 历史 | 有界 name scan、opaque cursor、`scanned` 预算及分轮 scheduler 已有。已补与 journal 批次原子提交的有界摘要；JSON 只读文件头、SQLite 只读元数据行，冷 discovery 不打开 journal 或加载 Team。归档过滤、短读、字节上限、并发拒绝、重启与 4,096-record 场景通过（[N103–N109](execution-evidence.json)）。N438–N450 修复 delegation 持续重入绕过单轮预算：13 项单元测试、4 个真实 Loader 完成/取消场景及全部 26 个 JSON/SQLite crash 窗口在每轮 1 次操作下通过。N452–N470 补终态路由缓存清理、stalled 保留、关闭及迟到 discovery 处理；4,096 个生命周期的缓存上界测试、20 项单元测试和最终 30 个真实 Loader/crash 场景通过。逐文件 coverage 和完整目标规模/压力矩阵仍开放；Linux reference promotion 未执行。 |
| F-SC-02 | P2 | 必需 | 已实现 | 历史 | omitted placement 在创建时解析并冻结；无 default 表示无额外限制。 |
| F-SC-03 | P1 | 必需 | 已实现 | 历史 | 已补累计 child 预留及 `maxLiveActivations`：启动前持久预留、绑定唯一消费、确认 quiescence/清理后释放、子树整段预留、grant 收紧、未知启动跨重启保留及关闭 stall。发行 root 配置 32 child/128 live；[N19–N28](execution-evidence.json)覆盖本地实现与恢复。N369–N382 补 provider 未启动时的预留释放失败重试，以及 binding 已落盘但响应丢失后的准确 epoch 结算；终止成功后 readback/quiescence 失败不重复 dispose。206 项定向测试、10 个 Loader 场景通过，最终容量套件 24 项通过。逐文件 coverage、独立主机与最终候选验收仍开放，不据此关闭完整资源保证。 |
| F-SC-04 | P2 | 必需 | 已实现 | 历史 | 已补 dormant 自定义/远程角色的 placement 就绪、原 Session 恢复、路由/预算拒绝和卸载清理。N316 的真实 TeamRun workflow 验证任务驱动 placement 复用预备角色，placement 全包源码逐文件覆盖率达到 100%。其他跨包覆盖率与最终候选复验仍由 T-02/W09 验收。 |
| F-SC-05 | P1 | 必需 | 已实现 | 历史 | R2 已接收：wake/review/new assignment 各有独立额度；backlog 不阻止后续阶段，竞争中的旧 proof 有界重试并清理未提交频道。N515 的 scheduler 与真实 Hub 回归通过。 |
| F-WS-01 | P2 | 必需 | 已实现 | 历史 | 默认关闭的 periodic observation 已有；保留 bounds、排序、dispose 和不归因于具体 writer 的语义。 |
| F-UI-01 | P2 | 必需 | 已实现 | 历史 | member/task/artifact collection 分页与 stale/error 状态；接收当前 UI 改动后复验。 |
| F-UI-02 | P2 | 必需 | 已实现 | 历史 | child 只读导航、result/artifact visibility；必须走 inspect，不能隐式 resume。 |
| F-UI-03 | P2 | 必需 | 已实现 | 历史 | participant workflow 只读投影、依赖、失败/取消；不含 child workflow authoring。 |
| F-UI-04 | P2 | 必需 | 已实现 | 历史 | selection、任务/成员/工作流独立详情、单页列表/通道/审计/收件箱、Session 归属及操作预览均已收口（N140–N232）。草稿采用固定指纹与确认后释放；公开 browserConfig 可配置跨频道草稿条数/序列化字节及无草稿视图缓存上限，超限原子拒绝，明确确认的丢弃释放位置（N233–N253）。真实浏览器验证默认启动、配置上限、保留输入、丢弃和发送。N275–N283 补图片导入前整批大小/元数据检查与顺序编码，真实浏览器证明超限不读取文件且保留草稿，编码模块逐项覆盖率 100%。完整覆盖率、操作矩阵、完整峰值/目标规模与最终候选审计仍开放，不能以功能切片的历史通过代替整体关闭。 |
| F-MX-01 | P1 | 必需 | 已实现 | 历史 | M1/M2/M4 已接收：wait 保留工作证据、artifacts、verification 与准确失败原因；换 worker 的 rework assignment 携带有界前次结果和 review reason。N515 运行回归、N516 Loader 交接通过；真实模型质量仍归 T-05。 |
| F-MX-02 | P2 | 必需 | 已实现 | 历史 | M3/M5 与 prompt 已接收：workflow 嵌套 schema 可直接构造；watch 首次省略 cursor、后续使用返回 cursor；委派策略集中于 coordinator。N515 工具/运行回归、N516 模型可见 schema 的真实执行通过；真实模型质量仍归 T-05。 |
| F-LG-01 | P2 | 必需 | 已实现 | 历史 | 17 个 Goal/subagent/workflow 包已迁入 private packages/compat，包名与工具/命令均完成 compat/legacy 命名；产品 Host/Client 的旧 Goal RPC、无消费者的 Goal UI、默认 disabled 行和公开依赖已移除。公开 tool/config/model API catalog 排除兼容功能，Team workflow extension 保留。1,224 项最终回归、default Team 10 个 Loader 场景、兼容 Goal/Headless/ACP/SDK 场景、双端类型与 official build 通过。cutover、依赖闭包、constraints、client 包检查通过；旧 tarball 和 8 个旧 Goal 编译产物已保留到临时目录，未冒充新发行。最终跨平台 pack/consumer 仍归 O-02。 |
| F-LG-02 | P2 | 必需 | 已实现 | 历史 | Session 的 origin/delegationDepth 拒绝与私有 descriptor 已实现；675 项 Session/JSONL/SQLite/compressed 相关回归通过。真实 Loader 确认只有 parentSession 的 fork 不构成 subagent 身份，显式 ACP/SDK compatibility 仍能执行；最终跨平台 SDK/carrier 矩阵保留在 T-03/O-02。 |

### 验证

| ID | 优先级 | 范围 | 工作状态 | 证据状态 | 剩余验收 |
|---|---|---|---|---|---|
| T-01 | P1 | 必需 | 部分 | 历史 | N319 全仓源码在 coverage 下 16,444 项通过、114 跳过，没有测试失败；此次未复现 Host final receipt/HMR 超时。保留故障诊断，最终功能候选完成后复验。覆盖率门禁单独未达标，不混同测试结果。 |
| T-02 | P1 | 必需 | 部分 | 失败 | N319 全仓 coverage 中 110 个源码文件未达逐文件 100%，实际清单见执行证据。placement 全包及 channel-draft.ts 已有完整 scoped 证据；其余 Core/Hub/UI/协议等仍需补齐，不能累计历史百分比。 |
| T-03 | P1 | 必需 | 部分 | 历史 | child JSON/SQLite kill points、receipt/charge/archive 已有；N383–N411 已用本次 macOS runtime wheel 和隔离安装的 TS/Python SDK 验证完成、live child 取消、结算后进程重启、result/receipt/charge 与 parent archive 去重，并接入 installed Python CI。N412–N422 补两 SDK 的 macOS/JSON live model-request SIGKILL：保留同一 child/epoch/task，拒绝归档且零新模型请求；准确报告 workspace owner 未恢复的 `TEAM_DELEGATION_WORKSPACE_UNAVAILABLE`，不声称自动恢复运行。其余持久窗口、packaged SQLite、其他平台与跨主机证据仍开放。 |
| T-04 | P1 | 必需 | 部分 | 未执行 | 本地多进程已有，actual separate-host、credential rotation、provider loss 与恢复矩阵待执行。 |
| T-05 | P1 | 必需 | 待做 | 未执行 | N451 于 2026-09-16 重新确认模型 key、route 环境变量和根 `.env` 缺失，仓库配置的 localhost:18000 模型端口拒绝连接。fan-out/fan-in、review/rework、child、workflow、文件与 artifacts 的真实模型验收仍未执行。 |
| T-06 | P2 | 必需 | 部分 | 历史 | 接收当前 Team workspace UI；完整 mutation/recovery/accessibility browser matrix 与真实 server/model-flow GIF。 |
| T-07 | P2 | 必需 | 部分 | 历史 | ACK fixture 与 macOS 样本已有；补 P1 指定 Linux reference runner、三样本中位数与 CI budget。 |
| T-08 | P2 | 必需 | 部分 | 历史 | N292 复验 ranking property（seed 20260910 / 100 runs）及 JSON/SQLite 冷/检查点恢复、缺 recovery route 的 unknown cost；8 项通过。N350–N352 补真实 JSON Hub 的 workspace provider 缺失/注册 property（seed 20260916 / 20 runs）：失败重试不产生租约或频道，恢复后单次分配，task/Envelope 身份一致且冷重启重放一致；122 项相关回归通过。其他 provider/topology 组合及完整 cross-log property 仍开放；失败才保存 minimized counterexample。 |
| T-09 | P1 | 必需 | 部分 | 历史 | 显式映射并验证 P0-AUTH/LIFE/LEASE/VIEW/GATE，不能以测试总数替代 prerequisite。 |

### 文档

| ID | 优先级 | 范围 | 工作状态 | 证据状态 | 剩余交付 |
|---|---|---|---|---|---|
| D-01 | P2 | 必需 | 已有 | 源码 | delegation README/family ownership 已有，随最终行为更新限制与配置。 |
| D-02 | P2 | 必需 | 已有 | 通过 | architecture 已补 direct v4、admission、summary、delegation 扩展关系，并按当前 owner 修正 SDK/ACP/supervisor 恢复入口；英中配对及最终 28 项 doc-sync 通过（N449）。 |
| D-03 | P2 | 必需 | 已有 | 通过 | subsystem 已补 child execution/delegation/run-binding/result-admission 类型与 delegation Consumer 归属，明确不提供 `ctx` service，并修正 source proof 与 direct v4 契约；英中配对及最终 28 项 doc-sync 通过（N468）。 |
| D-04 | P2 | 必需 | 已有 | 通过 | 已在 generator owner 补 delegation 对 agents/teams/teamRuns/teamWorkspaces 的 Consumer 关系，以及 admission/summary 对 teams 的消费关系；生成图、英中配对与实际依赖审计通过（N471–N482），未虚构 delegation service。 |
| D-05 | P2 | 必需 | 已有 | 通过 | module graph 已按当前 manifest/peerDependencies 重新生成并配对，包含 admission/delegation。Freshness 检查纳入 doc-sync 的唯一共享入口；56 项测试及 29 项门禁通过（N471–N482）。 |
| D-06 | P2 | 必需 | 已有 | 源码 | event matrix 已列 delegation listeners；最终 generator freshness 复验。 |
| D-07 | P2 | 必需 | 部分 | 历史 | 已补部分 Config JSDoc；最终 Config catalog 必须与源码一致，不能仅关闭 source contract 子项。 |
| D-08 | P2 | 必需 | 部分 | 历史 | tool delegate 已入 catalog；client/persistence/tool 三类 inventory 与新工具结果保持一致。 |
| D-09 | P2 | 必需 | 待做 | 源码 | Host/TS/Python SDK README 补 admission/invitation/input/summary/attachment/list 的调用、权限与错误语义。 |
| D-10 | P2 | 必需 | 待做 | 源码 | TeamRun/tool README 补 delegate、wait result、rework 与 unsupported combinations。 |
| D-15 | P2 | 必需 | 接收中 | 待接收 | UI README 跟随当前 Team workspace 交付；说明分页、详情、只读 child 与错误保留。 |
| D-16 | P2 | 必需 | 已有 | 源码 | placement README 中文配对已存在；最终 locale/pair freshness 复验。 |
| D-17 | P2 | 必需 | 已有 | 源码 | invitation Note 所需段落已存在；不把格式修复重新当产品开发。 |

### 候选、构建与保留策略

| ID | 优先级 | 范围 | 工作状态 | 证据状态 | 剩余交付 |
|---|---|---|---|---|---|
| O-01 | P1 | 必需 | 部分 | 源码 | 已保存项目内 W00/W05 精确源码归档与逐文件哈希，入口见[执行证据](execution-evidence.json)；最终候选冻结与构建产物绑定仍待 W09/10。 |
| O-02 | P1 | 必需 | 部分 | 历史 | N383–N411 生成并安装 249 个正式 Clocky tarball、9 个 vendor 包、native entry 及 macOS SDK/runtime wheels；installed CLI 版本、严格 NodeNext 类型消费者与两 SDK child 业务检查通过。源码与产物哈希已保存；最终 canonical absence inventory、native 完整矩阵和三平台 consumer 仍开放。 |
| O-03 | P1 | 必需 | 已有 | 历史 | 已复现无 outDir 的 TypeScript emit 写入源码旁，并将 root/native base 输出定向到项目内临时目录；source-output 检查接入 CI/static 与 hygiene。3 个存量 JS 样本与 TS 6.0.3 输出逐字节一致；完整 build 未新增或修改 252 个旧污染文件，隔离源码检查为零违规（[N43–N49](execution-evidence.json)）。共享目录仍因保留旧文件而报错，历史具体命令未确认；最终候选验证仍需复验。 |
| O-04 | P2 | 必需 | 部分 | 历史 | N321–N329 补旧 cursor 恢复；N330–N338 补默认关闭、有 stream/record/byte/tail 预算的自动已读历史迁移。Admission anchor 与 indexedThroughCursor 保留 receipt/幂等身份；未读和未答 action 阻止越界，JSON/SQLite 故障与真实 Hub 重启、真实浏览器通过。N339–N349 修复确认日志已提交但 checkpoint 未更新时的显示位置回退；12 个 JSON/SQLite 重启场景保留未读消息、单调显示水位及 admission 幂等。构建、真实浏览器和 28 项文档门禁通过；N483–N498 用 index format 2 回收已读 final 正文，仅保留元数据、原序号和 JSON 编码正文摘要；校验后才重建重试返回，旧 anchor 版本拒绝。短文本的摘要开销计入预算，JSON/SQLite 真实 Hub 丢响应/压缩/重启验证通过。N499–N511 修复显示确认在 inbox 队列内等待 Team policy 的锁反转；确认在队列外授权后复验原记录，并发确认/压缩不回退 cursor，撤权与记录变更拒绝写入。Message/action payload 与逐 admission 元数据仍保留，长期空间回收、完整矩阵和 coverage 未完成。 |
| O-05 | P2 | 必需 | 已有 | 历史 | Typert declaring-package import 修复已有；最终 Cordis/graph 分析与 freshness 复验。 |
| O-06 | P2 | 必需 | 已有 | 历史 | supervisor protocol chunk 显式发布已有；在 O-02 的最终 build/pack 中复验。 |

本轮开发记录见[执行证据](execution-evidence.json)：已接收运行修复并通过定向 P0/Loader 回归，补齐 F-SC-04 的功能路径；F-SC-01 的冷 discovery 已改为有界原子摘要，并通过 N103/N104 功能与重启验证。N07 及新增源码的逐文件 coverage 仍待补齐；早期 lint 与文档叶项修复见 N19–N28；Client Context 的 lint 解析与前置构建顺序已修复，但 N174 全仓 lint 仍报告共享声明残留和其它源码诊断；本地未发现模型 key 或根 `.env`，独立主机、Linux reference runner 和三平台 runner 尚未建立，相关验收保持开放。

## 实现设计

### 资源上限与 shared child

F-SC-03 保留[现有 task execution reservation](../../../packages/core/team/src/task-execution.ts)及 [Hub child admission](../../../packages/team/team-hub/src/index.ts)。`maxConcurrency` 的 child 预留不是 total child count 或 live Activation 数；协调者、空闲 worker、stopping epoch 也必须在相应资源维度有明确计数语义。

开发前明确两个维度：child count 是否统计该 hierarchy 的累计创建、未归档或 live child；live Activation 何时预留、何种终止证据允许释放。推荐以可重放的已接受 child 身份计创建数量，以启动前 reservation 和确认 termination 后 settlement 计 live capacity；最终字段与默认值写入 owning proposed Note，并给出为什么满足 P1 的说明。未知或未确认终止的 epoch 不释放额度。

优先评估现有 parent reservation 的保守容量传递：子树获得的容量在父级预留并递归收窄，局部记账仍能建立祖先上限。若无法证明并发创建、恢复和释放时不超卖，再增加最小 ancestor reservation 记录；不预先承诺独立的通用资源账本服务。新 tunables 是 validated Config/冻结模板字段，不能藏在常量或运行时默认值里。

验收包括兄弟并发、三层嵌套、创建前后进程终止、重复 reservation/charge、stalled child、parent cancel/archive、zero/limit/limit+1 和恢复后相同计数。shared child 与普通 shared task 的重叠 writeScopes 必须互斥，child 不拥有伪造 Participant lease；已有 scope/concurrency 修复先复验。

### Discovery 和产品读取的实际成本

F-SC-01 分两层验收：Consumer 每 pulse 的 page/team/操作数，以及 Provider 实际扫描、materialization、驻留对象数。当前 [Delegation](../../../packages/team/team-delegation/src/index.ts)按页发现，[Hub](../../../packages/team/team-hub/src/index.ts)通过有界 name scan 和原子 tail 摘要读取元数据，不再为 discovery 打开完整 journal；目标规模和压力验收仍按 Provider 实际成本执行。

先测量 active/archived 混合目录、稀疏可见 Team 和事件风暴。为实际扫描增加可观察计数与部署限制；比较 StorageLog 可续扫目录、轻量持久索引、bounded scanned continuation，选择删除最多重复工作且能重放的最小方案。需要改变 cursor 时更新真实 Core/Host/SDK consumers，不让排序数组位置在插入/删除后被当作稳定快照 cursor。空可见页仍可以推进，循环重扫不能永久漏掉新 Team。

drive 预算必须覆盖事件合并后的持续重入；一批工作用尽时保存后续进度并归还调度机会。event wake、定时 discovery、关闭与读失败都要有明确进展/重试语义，不能依靠无限 while 或新增无限队列。

F-UI-04 将传输大小与 collection 展示分开验收。当前 [client open/inspect](../../../packages/client/runtime/src/client/teams/service.ts)通过 selection 获取身份、cursor、lifecycle、准确 coordinator binding 和可选标量元数据；后台刷新沿用同一投影。任务、成员和工作流详情已使用独立有界读取；累计草稿/浏览状态及完整覆盖率仍需收口。服务端始终重新校验 authority，浏览器不需要全量业务数组才能发起 mutation。保留明确的内部 full-state API，不在本轮顺带改写所有 Hub 内部消费者。

验收应证明首次打开大型 Team 不传完整 task/member/artifact history；loaded rows 有有限保留或逐出策略，累计 Load more 不能无限驻留；详情切换、旧响应、失败页、已删除 selection、reconnect 和新事件都保留可解释的 loading/error/newer 状态。

### Runtime 进展、review 与恢复

F-RT-04、F-SC-05、F-CH-02 的最小方案与复现由 [Team 运行审查](../2026-09-13-team-audit/README.md)拥有。接收当前修复后，核实以下出口而非重复实现：

| 路径 | 必须建立的关系 |
|---|---|
| output continuation | 新 turn 通过持久来源属于 exact task/attempt/epoch；预算按 attempt 计算；重复 turn/end 不双计。 |
| continuation 停止 | report、cancel、替换 lease 后旧输入不再执行；completed-without-report 的可选提醒有上限，error 不被误当正常续跑。 |
| scheduler phases | wake backlog 用尽本阶段额度后，review 和 ready assignment 仍获得有界进展；保留每阶段最大工作量。 |
| review open/post | open 已落盘但 request 未发送时，重启仍找到 exact task/attempt/reviewer 的同一频道；其他 attempt 不复用。 |

F-RT-03 沿 [activation recovery](../../../packages/team/team-activation-recovery/src/index.ts)、[controller](../../../packages/team/team-activation-controller/src/index.ts)和 provider-owned supervisor 扩展。provider 卸载、fence 已接受、cold replacement 启动之间须保留 durable fence 和命名 stall；unknown/disconnect 不充当 termination。独立主机的 resume/session data 与 workspace/artifact 可用性必须验证，不能只验证 HTTP health/fence。

瞬态模型请求重试归现有 LLM provider policy；任务重试归 attempt policy；资源释放归 activation/workspace/closure owner。本轮不加入全局重试层或自动跨模型降级。Link 永久错误处理只有在确定错误码、复现与恢复触发后进入 F-RT-03，不根据文案推断永久失败。

### 模型交接与 workflow

F-MX-01 的 wait 返回有界 evidence、artifact references、changed paths、verification、integration 和可区分的 terminal outcome；list/watch 保持紧凑。超限必须有 truncation 信息和确实可用的后续读取路径，不发明不可调用的详情引用。child 返回 admitted delegation result，不能伪造 Participant attempt。

rework assignment 只携带当前 task 所需的最近 outcome、review reason 与可见产物引用。必须用 A 完成、reviewer 指出具体问题、B 接手的真实请求验证交接；不能因原 worker 收到 consult 就认为换 worker 已有上下文。新增模型输入随 Session 重建，private/foreign artifacts 不因结果投影而泄漏。

F-MX-02 优先复用真实 workflow schema，或由现有 owner 把面向模型的结构化输入编译成 plan；不建设第二个 workflow engine。模型必须能发现当前可用角色、能力、依赖、bounds 和结果选择，并构造可执行的 A→B。watch 首次无 cursor 的行为与描述一致。coordinator prompt 集中说明有收益才委派、完整 brief、证据验收和结束条件；不把单步任务强制拆成多 worker。

F-SC-04 独立核查 [compileWorkflowPlan/resolveWorkflowParticipants](../../../packages/team/team-run/src/index.ts)：当前可解析 active 自定义角色；对于已授权但 dormant 的 role，不能在 placement 尚无任务可消费之前永久拒绝。先定义 role 的声明、唯一性和 binding 冻结点，再复用统一 provisioning；provider 缺失或角色歧义应给出 typed failure/stall。保留编译未完成的 task 不可被调度，以及部分 channel/task bindings 的重启去重。远程 review 也使用同一 activation/grant 验证。

### UI 与 principal inbox

F-UI-01..03 接收[当前 Team workspace 设计](../../notes/implemented/architecture/2026-09-11-team-workspace-ui.md)及其源码后，以数据契约验收，不把旧 TeamPage/overlay 布局当作必须恢复的目标。child 的阅读导航与显式 resume 分开；mutation 的 cursor/revision 仅是并发前提，principal/proof 始终由 Host 产生。

T-06 为 participant、channel、task、review、human action、integration、lifecycle 各自保留完整操作矩阵。F-CT-08 未获纳入前，child integration 只验拒绝/明确说明，不把不可用路径列为待补 happy-path browser。

O-04 定义 principal inbox 的 display、未读 action、final receipt、Team audit 与 channel replay watermarks。自动 retention 默认不启用，配置开启后只能删除所有必要引用都已释放的前缀；旧 cursor 返回保留边界和可恢复动作。checkpoint 只证明可读 suffix，不单独授权删除。测试长历史、未读 final、未答 action、revoke、Host restart、compaction 后显式 history 和默认 suffix read。

### Source 与 artifact 分离

O-03 保留 [source-entry resolution regression](../../../scripts/source-entry-resolution.spec.ts)，追踪真实编译器/generator 的 rootDir、outDir 和 declaration outputs，禁止新的 production build 向 src 写产物。添加可执行的窄检测，列出路径与生产者；合法手写声明需要具名例外。共享工作区的污染不能 blanket-clean，验证使用可取得的隔离候选或经 owner 确认的最小清理。

O-01 在开发阶段保存每个工作包的输入范围；在最终验证前再冻结完整候选。源码哈希、测试日志哈希、artifact digest 是不同对象；只保存 HEAD 加 dirty 文件名无法重建实现。候选必须包含必要未跟踪源码、lockfile、配置、生成输入和测试 fixture，并通过 allowlist 排除 `.env`、凭据与无关用户文件。

### 文档修复

D-02/D-03/D-09/D-10 由 owning prose 写当前调用与失败语义；D-04/D-05/D-06/D-07/D-08 先修声明或 generator 输入再生成。D-01/D-15/D-16/D-17 已有内容只跟随真实变动维护。O-05 分析成功和 generated freshness 成功分别记录，二者都通过才关闭相关 catalog 行。

非平凡代码改动按[项目文档规范](../../../docs/AGENTS.md)更新 owning Note、README、JSDoc 与英中配对；不把实施日志塞进 implemented Note。本文两份内部计划保持中文单体，不发布到文档站点。所有必需 D 项和当前 doc-sync 失败均需明确 owner 与闭合结果，不能移动到表外后宣布文档全部完成。

## 待决定组合

以下是延期建议，尚未代替产品决定。决策记录必须说明支持范围、当前拒绝行为、替代路径与再次考虑的触发场景；只有选择纳入时才展开 durable/wire 设计。

| ID | 本轮建议 | 可用路径或明确限制 |
|---|---|---|
| F-CT-03 | 延后独立 child root | 使用当前 shared child；需要隔离写入时用已支持的 participant workspace task，不能声称是 isolated child。 |
| F-CT-04 | 延后 child workflow node | participant workflow 与独立 child task 分开编排；不声称具有统一 plan 取消/结果语义。 |
| F-CT-05 | 保留 one child per delegation | 失败任务先完成结算；需要再尝试时由授权调用创建新父任务，保留原失败，不复用旧 delegation key。 |
| F-CT-06 | 延后 parent-native review | child 内部 review 或独立 evaluator task；两者均不等价于 parent review/rework。 |
| F-CT-07 | 延后 parent topology placement 参数 | 使用已注册 child template；parent Participant placement 不自动应用到 child。 |
| F-CT-08 | 延后 child-result integration provenance | child artifact 可按权限预览/下载；普通 integration 只接 completed Participant attempt，不能伪造 sourceAttemptId。 |

这些延期不取消 P1 的 root/participant remote、review、integration、workflow 或资源限制。若真实场景要求任一组合，在编码前调整 scope、owner、接口、格式和对应验证预算。

## 验收与发布约束

| 需求 | 必须可检查的结果 | 当前工作项 |
|---|---|---|
| P0-AUTH | unauthenticated/revoked/foreign/wrong-operation 在所有新增入口被拒绝；actor-free wire | T-09、T-04、T-06 |
| P0-LIFE | completion/failure/cancel/missing-final/budget 的真实重启结算与资源停止 | T-09、F-RT-04、T-03、T-04 |
| P0-LEASE | active adapter/view/extension 在 retirement 后继续有效，new admission 拒绝，终态释放 | T-09、F-CH-01、F-CH-02 |
| P0-VIEW | exact channel view/assignment/rework 输入先持久化并 flush，再 receipt/model；两 SDK 可重建 | T-09、F-MX-01、F-RT-04 |
| P0-GATE | 受影响文件 coverage、snapshot、docs、packed consumers 有可取得输入 | T-02、O-01、O-02 |
| P1-CHILD / SCHEDULE | 有界 child/activation、DAG、placement、review、取消、去重与结算 | F-CT-02、F-SC-03..05、F-CH-02、T-03 |
| P1-DIRECT / ADMISSION | v4 subset/null/final restrictions、独立 receipt、真实 ACK、expiry、restart、retry | F-CH-01、T-08、T-09、T-06 |
| P1-WORKSPACE / REMOTE | observation、独立主机恢复、fence、sandbox loss、artifact retention 与 target CAS | F-WS-01、F-RT-02/03、T-04、O-04 |
| P1-UI / BROWSER | 已支持 mutation 全流程、权限/冲突/恢复、无隐式 resume、有界读取与 GIF | F-UI-01..04、T-06 |
| P1-LEGACY | canonical 产品 source/catalog/bundle/carrier 无被替代入口；保留显式兼容 smoke | F-LG-01/02、O-02 |
| P1-PERF / PROMOTION | reference budgets、真实模型、全仓门禁、两 SDK 和三平台 artifact consumers | T-01..08、O-01/02、全部 D 项 |

P1 的 [reference budgets](../../notes/proposed/architecture/2026-09-04-native-multi-agent-p1-product-convergence.md#reference-budgets)保持原值；Linux reference runner 负责 wall time，其他平台验证确定性的 page/queue/retained-object/allocation 上界。不能以延长测试 timeout 或更新 baseline 静默放宽预算。

没有配置真实模型或第二主机时，可以交付已验证的本地工作包，并登记环境阻塞；不得称完整 P1、release 或主提案 promotion 完成。所有强制项通过、可选组合有明确范围结论、最终候选证据完整后，才按原提案处理 Note lifecycle 与发布。
