# Native multi-agent：开发与验收执行计划

本计划落实 [gap-design.md](gap-design.md)。设计文件维护唯一状态表，本文件只维护工作包、依赖、操作顺序和退出条件；实际命令结果进入验证记录。旧 [2026-09-08 plan](../2026-09-08-native-multi-agent-gap-closure/development-plan.md)仅为历史输入。

用户 2026-09-17 调整：优先已确认的 F 功能开发；完成后可暂停 goal。独立 T/D/O 矩阵不再作为该暂停条件；保留支持功能结论的必要回归与原状态表更新，待决定 F 不扩张。 当前已到达 F 功能开发暂停点；逐项结果只维护在 gap-design 登记表，恢复后由用户决定是否推进 T/D/O。

## 开始方式

本轮文档由单一执行者完成，不使用 subagent。后续开发沿用已授权的协作方式，owner 指包或文件责任，不指定模型。共享 Team runtime/UI 正在改动时，先接收已有结果，不创建竞争实现、不回滚其他工作。

第一次开发会话从 W00 开始，再做 W01 的 P0 证据核查和 W02 的在途修复接收。其余工作按下表依赖推进；环境准备在 W00 即开始，不能等实现全部结束才发现缺少第二主机、模型 route 或 Linux runner。

## 工作包和写入责任

| 工作包 | 覆盖 IDs | 依赖 | 主要写入 owner 与交付 |
|---|---|---|---|
| W00 候选与构建输入 | O-01、O-03 | 无 | 集成人 + build/tsconfig owner：输入清单、污染来源和可复现工作副本。 |
| W01 P0 安全入口 | T-09、F-CH-01 | W00 输入已记录 | auth/channel/closure/Session owner：具名 P0 验证表与必要修复。 |
| W02 运行修复接收 | F-RT-04、F-SC-05、F-CH-02 | W00；相关 P0 路径可验证 | Agent Client、scheduler、Hub owner：接收 R1/R2/R3 修复及恢复验收。 |
| W03 Child 资源治理 | F-SC-03、F-CT-02、F-RT-01、F-RT-02、F-SC-02 | W01、W02 | Core/Hub/Delegation/placement owner：资源维度与 reservation、shared 冲突及已有行为复验。 |
| W04 有界读取 | F-SC-01、F-UI-04 | W00；与 W03 共享 Hub 修改串行 | StorageLog/Hub owner 先定 API；Host/SDK/client owner 接入轻量详情与扫描 bounds。 |
| W05 模型与 workflow | F-MX-01、F-MX-02、F-SC-04 | W01、W02；placement 接口与 W03 一致 | TeamRun/tool/Agent Client owner：结果交接、返工依据、workflow 构造与角色就绪。 |
| W06 恢复与保留 | F-RT-03、F-WS-01、O-04、T-03、T-04 | W01、W03；独立主机环境就绪 | runtime/supervisor/workspace/human-client owner：远程恢复、资源丢失、inbox retention、child packaged route。 |
| W07 UI 产品验收 | F-UI-01、F-UI-02、F-UI-03、T-06、D-15 | 接收当前 UI；W04/05；remote cases 依赖 W06 | client runtime/ui-team/Host owner：真实业务流程、accessibility 与 GIF。 |
| W08 文档与生成物 | D-01、D-02、D-03、D-04、D-05、D-06、D-07、D-08、D-09、D-10、D-16、D-17、O-05 | 每个 owning 工作包接口稳定即可开始 | 各代码 owner 写契约，generator owner 生成并验证，中英配对共同交付。 |
| W09 最终功能证据 | T-01、T-02、T-05、T-07、T-08 | W01..08 的目标改动完成，候选冻结 | 集成人组织 source/coverage/model/property/performance 验收；具名场景必须通过。 |
| W10 Canonical 发行 | F-LG-01、F-LG-02、O-02、O-06 | W08/09；所有强制矩阵已通过 | release/SDK/Python owner：build、pack、isolated consumers、三平台与最终 absence scan。 |
| W11 可选组合决定 | F-CT-03、F-CT-04、F-CT-05、F-CT-06、F-CT-07、F-CT-08 | W00 即可记录，纳入项需重新排依赖 | 产品/架构 owner：范围结论；只为选入项补实现计划。 |

同一文件在同一时段只由一个 owner 修改。Hub、Core schema、TeamRun、SDK protocol 等共享文件的变动先统一字段与语义再传播；不按包数量机械拆出多套重叠实现。W11 的延期建议不能用于推迟 W03 的资源保证。

## 工作包执行卡

### W00：建立可继续工作的输入

1. 记录 HEAD、branch、dirty paths、必要未跟踪源码、Node/pnpm/OS、lockfile、配置和当前 owner。只保存非敏感环境信息，模型/凭据仅记录是否可用。
2. 对照 [review-baseline.json](review-baseline.json)和现有修复记录，区分本轮接收、无关修改、generated artifacts；本轮 review manifest 不充当发布候选。
3. 追踪 O-03 的真实输出生产者；修 compiler/generator 输出目录，保留 resolver regression，补会报告污染路径的窄检测。不要清空共享 src 或运行 blanket clean。
4. 为当前工作包取得允许复制的精确源码副本或可重放 patch；保留必要未跟踪输入，排除 secret/config credential 文件。HEAD 单独不能代表 dirty 实现。
5. 提前确定目标模型、两台独立主机、supervisor 身份/认证方式、Linux performance runner 和三平台 artifact runner。缺项记录所需能力与环境 owner，其他本地工作继续。

退出：下一位开发者可取得该工作包输入；source 与 artifact 的执行入口清楚；输出污染可定位。完整 release candidate 在 W09 前再次冻结，不要求开发期间所有历史命令都针对同一个永不变化的版本。

### W01：将 P0 变成显式前置条件

按设计文件的 P0 映射登记具体文件、测试名、source hash 和执行结果。重点覆盖高层 channel retry 在相同 canonical 请求、closed phase、撤权、compaction/media anchor 下的行为，以及 proof、retained implementation、Session flush/receipt 的顺序。

已有结果仅在相关输入未变且覆盖目标时复用。发现 authority、durability、lease/view 回归时优先修复；相关 P1 路径在安全条件重新通过前不得关闭。P0 改动涉及文件的逐文件 coverage、assembled snapshot、文档和最小 packed-consumer 检查在依赖方验收前完成；W09/10 再提供最终全仓和全平台结果，不能把历史 P0 已实现当作免验理由。

退出：P0-AUTH/LIFE/LEASE/VIEW 各有具名结果，未通过项有复现和 owner；没有由 caller id、cursor 或缺失 provider 构造 authority 的新捷径。

### W02：接收在途可靠性修复

先读取 [Team 修复记录](../2026-09-13-team-audit/IMPLEMENTATION.md)、当前 diff 和对应日志。对 R1/R2/R3 逐项比较“旧复现、当前实现、现有测试、剩余入口”，已修复的代码不重复改写。

验收次序：不同真实 turn 的 continuation 链与 restart → wake backlog 大于预算且仍能 review/assign → review open 已持久化后 post 失败并重启。各场景保留不触发故障的对照，区分受控 mock、真实 Hub、独立 Loader 进程。

退出：continuation 不丢 task/attempt，阶段公平性可观察，review channel durable identity 唯一；取消、旧 epoch、duplicate event、rework attempt replacement 均不重复执行或结算。涉及模型输入和生命周期时补 runnable-example 及两个 SDK snapshot owner。

### W03：补资源限制，复验 child 支持切片

1. 在 owning proposed Note 明确 child count、live Activation、ancestor capacity、预留与释放时机；用例说明 coordinator/idle/stopping epoch 如何计数。
2. 比较复用 parent reservation 与新增最小 ancestor record；只实现能够证明 hierarchy 上限的最小方案，所有可调上限进入 Config/冻结模板。
3. 保留 child parent task 无 Participant lease、grant/budget 收窄、pending charge 阻止后续工作、blockedBy outcome 和 shared writeScopes 互斥。
4. 在 JSON/SQLite 验证并发兄弟与多层 child、partial bootstrap、重复调用、parent cancel/archive、unknown termination 和重新加载后的同一计数。

退出：P1 指定的每个资源维度都有 authoritative admission/replay 检查；拒绝不会先启动超额进程，未证实停止不释放 capacity。已有 F-RT-01/02、F-SC-02 只因真实缺陷修改，不重新设计默认值。

### W04：关闭扫描与传输上界

先确定目标规模和指标，再分两步提交：Provider discovery 的可续扫实际工作量；产品 lightweight selection/detail API 与客户端保留策略。页面数量、扫描数量、materialized Teams、驻留 rows 和 response bytes 分开测量。

修改 cursor/summary 类型时，Core/Host/TS/Python/client 同步；模型可见变化添加 Session 可重建证据。内部 full-state 读取保持明确消费者，不把这一工作包扩张为重写整个 Hub。

退出：大量 archived Team 不导致一次 page 无界加载；插入/删除/空页/重扫有进展；大型 Team 首次打开不传全量 history；反复 Load more 有有限驻留策略；selection/reconnect/failed page 不破坏已有输入。

### W05：保证模型拿得到证据、构造得出 workflow

先接收正在变化的工具 schema、wait projection、continuation/rework source 和 prompt。普通 worker、child、failed/released/lease-expired/rework 分别保留有界准确字段；未首次返工不填充空历史，超限有可用读取路径。

以真实工具构造 A→B，验证结构化 schema 与 parser 一致、非法依赖在 durable side effects 前拒绝。active 自定义角色已有路径用回归保留；dormant/custom/remote role 需要 activation 时由现有 placement owner 就绪，编译部分失败按现有 plan/channel binding 恢复。

退出：coordinator 下一模型请求确实含 worker 验证与产物；B 的 assignment 含 A 的 review reason；角色不可用有结构化原因；watch 文案与 cursor 行为一致。真实模型易用性由 T-05 验收，keyless 只证明结构与执行路径。

### W06：独立主机、child carrier 与 inbox retention

| 场景组 | 必需入口与断言 |
|---|---|
| child carrier | installed TS/Python SDK + packaged runtime 创建 child，完成/取消/重启；assert 一个 child、result/receipt/charge 去重、parent archive 等 settlement。 |
| supervisor | A 主机 Hub/Host、B 主机真实 endpoint；provider/host/profile/epoch 精确匹配，旧 epoch 不可 send/heartbeat/settle/integrate。 |
| 故障 | Hub restart、endpoint termination、网络中断、credential rotate/revoke、provider retirement、slow consumer、duplicate/out-of-order 分别执行。 |
| workspace/artifact | sandbox loss、retained artifact 读取、private/foreign 拒绝、integration target CAS、取消后的 allocation release/stall。 |
| human inbox | restart 后 final/action 不丢，display watermark 与 receipt 分离，retention 不删除未读或被引用内容，旧 cursor 有明确恢复结果。 |

复用已存在的 JSON/SQLite child kill-point 与 archive 场景，仅对改变的输入重跑；不要再造另一套 saga 测试驱动。这里可先 build/pack 该工作包需要的 carrier 并记录 digest，不依赖 W10 的最终全平台发行结果；最终候选变化后由 W10 判断这些证据是否仍适用。相同故障运行可同时满足 T-03/T-04，但记录一个 evidence ID 和各自断言，不能当两次独立运行相加。

退出：实际 separate-host 与 same-machine 日志分别标识；remote recovery 能证明新 epoch 的 Session、workspace 和 artifact 条件，不只验证 HTTP fence。环境不足保持开放并允许其他工作包交付。

### W07：按当前 UI 完成产品流程

先接收当前 Team workspace 布局与 navigation，不恢复旧 overlay。每组至少覆盖成功、denied/conflict、请求失败后输入保留、reconnect 和相关 terminal/provider-unavailable 状态。

| 产品组 | 必需操作 |
|---|---|
| participant | invite、activate、remove、interrupt；human/service/offline peer 可检查且不伪造 Session。 |
| channel | direct subset/null/final、consult、discussion、own ACK、close、retry、summary、ordered attachment read。 |
| task/workflow | create/edit/dependency/owner proposal/cancel/delete、attempt/result、workflow phase/dependency/failure、child inspect。 |
| human/review | approval、question、human accept/rework；Host restart 后按 exact owner 回答并去重。 |
| artifact/integration | preview/download、已支持 Participant source 的 proposal/integrate/conflict；child source 未支持时显示准确限制。 |
| lifecycle/scale | resume/cancel/archive/stall、remote termination、各集合和 inbox continuation、有界详情读取。 |

使用真实 server 与 model/replay 流程，断言 authoritative WAL；检查 keyboard、focus、error association、窄屏和 reduced motion。按项目 GIF skill 为产品可见变更录制实际流程。输出截图/GIF、测试和源码绑定；不把 accessibility 或成功截图替代业务断言。

### W08：按事实 owner 修文档

每个代码工作包在接口稳定时就更新对应 Note/README/JSDoc，不把所有文档拖到末尾。生成物按 source/type ownership → Config/Tool/Client/Persistence/Cordis → graph → pairing/freshness 的依赖处理；不能手写 generated region。

D-02/09/10 需要补内容，D-03/04/05 需要补 ownership/graph；D-07/08 的完整出口包括相关 catalog freshness。D-01/06/16/17 的已有内容按变化维护。D-15 随 W07 验收，此处最终检查它的配对与生成引用。

退出：全部 D 项符合登记范围；`doc-sync` 的失败没有被搬到表外；中英当前契约一致。内部计划保持单体中文，旧文档只加新入口，不重写历史 ledger。

### W09：冻结候选并执行最终功能验收

1. 更新 O-01：候选完整输入可取得，测试/scenario 配置与 artifact plane 明确；记录所有影响过往证据的漂移。
2. 按当前 [pre-push 检查策略](../../skills/dsh-pre-push-checks/SKILL.md)选择一次所需检查。每个工作包用 focused evidence，最终 promotion 才执行不可约完整矩阵；不要每小步重跑全仓。
3. 运行 Hub/full source regression、逐文件 coverage、两 SDK/keyless snapshots、property/race 和真实模型矩阵。
4. 真实模型覆盖 fan-out/fan-in、review accept/rework、child、workflow、真实文件/产物与 cleanup；同时比较简单任务和可并行任务，观察正确性、重复劳动、token/成本与完成时间。
5. 在 P1 指定 Linux reference runner 执行三次性能样本并保留 raw samples/median/RSS/queue/shutdown；阈值链接到设计文件的上位来源，不在这里另存一套数值。

退出：所有强制场景通过或明确阻止 promotion；skip 逐条有范围解释，release 必需案例不能以环境 skip 关闭。发现代码缺陷后修复并重跑受影响检查；最终候选变化时不沿用不适用的 artifact digest。

### W10：构建、打包与发布判断

从冻结候选执行 build，再验证 publication closure、NodeNext、canonical family tarballs、isolated installation、TS/Python SDK、Python wheel/bundled runtime、native artifacts 和 Linux/macOS/Windows consumer 的 launch/shutdown。

F-LG-01/02 的 absence/presence inventory 在 source、catalog、bundle、snapshot 和 packed view 各自执行；合法 runtime/显式 compat 不因 grep 命中被删除。O-06 保留稳定 protocol artifact，重新确认每个相对 import target 均已发布。

退出：设计文件的全部强制验收通过，W11 的范围结论明确，无 unresolved release blocker，精确候选、日志与产物可供另一人取得。`BLOCKED_ENV` 不能满足本出口。通过本工作包仅产生可发布结果；实际 commit/push/merge/publish 按用户授权执行，不因计划存在而自动发布。

## 命令入口与证据记录

命令均从仓库根目录运行，先创建项目内临时目录。下列是执行模板，不是通过记录；以 [package.json](../../../package.json)、[run-gates](../../../scripts/run-gates.ts)和 owning suite 的参数为准。

```sh
mkdir -p .tmp/native-multi-agent-closure
env TMPDIR="$PWD/.tmp/native-multi-agent-closure" TSX_DISABLE_CACHE=1 node node_modules/vitest/vitest.mjs run packages/team/team-delegation/tests packages/team/team-placement-default/tests --reporter=dot
env TMPDIR="$PWD/.tmp/native-multi-agent-closure" TSX_DISABLE_CACHE=1 CLOCKY_SNAPSHOT=replay node node_modules/vitest/vitest.mjs run --config vitest.snapshot.config.ts examples/headless-agent/tests/child-delegation.snapshot.ts examples/headless-agent/tests/child-delegation-restart.snapshot.ts
```

| 验证层 | 正式入口及限制 |
|---|---|
| 源码测试 | `pnpm run test`、`pnpm run test:coverage`；开发中按 owning files 定向执行，最终 coverage 必须满足每文件政策。 |
| types/lint | `pnpm run typecheck`、`pnpm run lint`；脚本有 build 前置，不能伪记成纯 no-emit 检查；source face 定向命令按当前 pre-push skill 选取。 |
| snapshots/model | `pnpm run test:snapshot`、`pnpm run test:e2e`；SDK/ACP/JSON-RPC owning 场景同步，模型环境仅记录非敏感 route/config 与存在性。 |
| browser | `pnpm run test:web`；已经同候选 build 后可用 `pnpm run test:web:built`，场景筛选按当前 web config，另按 skill 记录 GIF。 |
| docs | `pnpm run doc-sync`；包含的子检查不无故重复。内部 plans 不在所有 Markdown gate 扫描范围，另做本目录 links/anchors/newline/ID 检查。 |
| artifacts | `pnpm run build` 后 `pnpm run verify-node-next-types`、`pnpm run publint`、`pnpm run hygiene`；pack/install 使用现有 release scripts，经 CLI 参数核实后执行。 |
| final platform | 当前 CI/release workflow；Windows 由真实平台 runner 验证，不为一般验收运行 Wine。 |

每条执行证据记录：evidence ID、对应 gap/scenario、command/exit code、开始结束时间、OS/arch/Node/pnpm、输入 manifest、plane、artifact digest（适用时）、pass/fail/skip、日志路径/hash、失败原因和下一步。只有实际执行了才登记 PASS；缺环境登记 `BLOCKED_ENV`，不得把存在日志或测试文件当作执行通过。

对同一候选的证据可共享引用，不复制 raw logs 或历史测试数量到每个工作包。登记表关闭时链接到最小充分证据；后续源码/配置/fixture 漂移时记录受影响项，复验后恢复适用性。

## 本轮文档交付范围

设计阶段交付新的设计、执行计划、审查基线和文档验证记录，并在旧两份文档添加新入口。开发阶段的实际结果统一记录在[执行证据](execution-evidence.json)，完成状态仅更新设计登记表；功能优先，必要契约合并到现有 Note 和 README。
