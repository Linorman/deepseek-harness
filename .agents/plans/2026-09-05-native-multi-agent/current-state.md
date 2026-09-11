# 2026-09-06 接手状态与剩余工作

本页供[分派入口](start-here.md)安排接手，按当前主工作区区分可复用实现和剩余验收。需求与工作包映射见[33 项验收映射](acceptance-map.md)，精确增量和历史日志见[执行记录](execution.md)。**用户已要求优先功能实现：P1 功能开发已分派，不等待完整 P0 覆盖率；P0 与发行尚未签收。** 开发子代理现统一使用 gpt-6-astra / High；旧 Extra High 实例已在冻结交接后退休。

## 基线与状态含义

主工作区为 master，HEAD 为 fb14b0b9b1d8bfc5abebc22be2574eb691329900，包含大量已有未提交修改。“已合入”仅表示已进入主工作区，不表示已提交、已合并远程 PR 或已发行。只 checkout 该 HEAD 不能复现实际开发状态；集成人必须提供共同源码快照及相对补丁，不得整树覆盖或清理其他修改。

PARTIAL 表示已有实现但整项验收未完成；PENDING_INTEGRATION 表示增量仍在独立 worktree；OPEN 表示审计识别的差距尚未关闭。CLOSED 必须有对应实现与同一候选版本的完整证据。不能根据文件数、测试数或耗时计算完成百分比。

## 可复用的主工作区实现

| 范围 | 当前实现 | 剩余责任 |
|---|---|---|
| Final admission | [Hub](../../../packages/team/team-hub/src/index.ts)保留独立 team/final-admitted；[TeamRun](../../../packages/team/team-run/src/index.ts)执行 intent→sink→receipt；TTL 不丢弃已接纳 final 的 human delivery | P0 共同版本复验；principal inbox 和 display 仍归 WP08 |
| 生命周期 | [controller](../../../packages/team/team-activation-controller/src/index.ts)支持 exact-epoch recoverClosure、持久 fencedAt、关闭失败清理及当前 Team 授权；[workspace recovery](../../../packages/team/team-workspace-recovery/src/index.ts)具备有界读取重试 | 与最终 Hub 约束共同验证；不能把 offline 状态当作终止证明 |
| 关闭推进 | [closure driver](../../../packages/team/team-closure-driver/src/index.ts)共享启动扫描、保留已接纳 observer、汇总 cleanup 错误；[bridge](../../../packages/team/team-closure-driver/src/hub.ts)在恢复改变 cursor 后重新获取 authority | failure/cancellation 与工作区释放确认的真实进程矩阵已合入；无终止证明仍必须明确 stall |
| Hub 命令 | 首次 final 资格、human owner、取消后 human-action 新接纳、跨频道清理 authority 重验和 cancellation quiescedAt 已合入 | 旧取消和终态 fixture 已修正并通过 93 项测试；补足完整方法职责与消费者证据 |
| Hub 恢复读取 | terminal Team 对照各 channel WAL 验证归属、终态和交付结算；completed 对照真实 admission、final 内容和 receipt；支持保留 WAL 前缀 | Team 内部 terminal resource 的完整 fold/checkpoint 校验也已合入；共同版本广测和覆盖率仍待完成 |
| 调度、审阅与回收 | [scheduler](../../../packages/team/team-scheduler-dag/src/index.ts)按 completed attempt 选择 review request，等待可用但仍 running 的 owner；回收跳过旧前缀并先 channel 后终态 Team journal | 当前单包55项通过；与TeamRun/tool合计140项通过。真实retention与rework Loader已有src/lib证据；完整coverage待共同版本重测 |
| View 容量 | Hub 对符合格式但 UTF-8 超限的投影返回 TEAM_CHANNEL_BACKPRESSURE，保留 pending 与原 cursor | 纯策略 Unit/Loader 已合入：同一大 source 重复拒绝，独立小 source 通过真实投递；不修改 Link-local 的错误重试分类 |
| Agent Client | [实现](../../../packages/team/team-agent-client/src/index.ts)支持结构等价 view 重投、恢复失败释放、关闭后晚到资源结算，以及有限 workspace CAS 重试和失败 close 后 owner 保留 | 271 项 owning/consumer 测试与逐文件四项 100% 已有证据；最终共同版本仍需复验 |
| Proof、lease、view | [Core runtime](../../../packages/core/team/src/runtime.ts)有短期 proof、准确实现 lease；Session view 重建与 TS/Python 共用 16 场景 wire 语料已有验证 | AUTH/LEASE/VIEW 的候选版本证据不能由局部通过替代 |
| 构建与 Loader | 正式 tsdown 产出缺失入口、HMR watcher 关闭、Loader 并发 await 与 provider 初始化顺序修复已合入 | 该版本全仓 unit/build 已通过；后续 Hub 与 scheduler 改动需要自己的共同版本验证 |

主工作区现已注册 Direct v4，支持显式多人消息、subset/null广播、有序text/image及独立recipient intents；真实src/lib两后端场景已通过。默认TeamRun仍使用v3，invitation/ack、remote/final Consumer与默认切换继续由WP02后续片完成。生产summary Consumer已合入Root：协调者工具与认证人类API可提交带来源fingerprint的有界文本摘要，summarized-window按持久摘要加raw tail重建；私密子集与图片来源会明确拒绝。child proof仍未等同于WP05生产Consumer。

## 正在交接的独立增量

| 工作目录 | 当前独占工作 | 接手边界 |
|---|---|---|
| .tmp/native-team-development/lifecycle | High agent：WP02频道admission | Direct v4首30文件已合入并通过共同unit/src/lib；继续pending→真实endpoint ack→active、optional/expiry、人类/service/WS与内部dispatch等待 |
| .tmp/native-team-development/final-admission | High agent：WP06共享工作区观察 | WP03摘要77路径已合入；当前实现有界扫描、独立observation与精确allocation proof、publish/release事实 |
| .tmp/native-team-development/closure-coverage | High agent：WP04 workflow内任务取消 | 普通task取消101路径已合入；现以Root同步的152路径共同输入开发workflow取消、依赖与plan结果传播 |

每轮交付保留精确文件清单、SHA-256、轮前基线、补丁和实际日志。后续人员先取得集成人确认的源码输入，再开始工作。

## 最新证据及限制

| 范围 | 已观察结果 | 适用范围 |
|---|---|---|
| 生命周期两包 | Root 7 suites / 124 tests，选定包逐文件四项 100% | integrated-lifecycle-hardening.log；不代表整个 Hub |
| 正常 final 生命周期 | 真实 Loader 的 src/lib 各 1/1 通过 | final-lifecycle.snapshot.ts；实际 Link、scheduler、SQLite、无 pulse 推进 |
| Final、冷读与 terminal intent | Root src/lib 聚合各 3 suites / 11 tests 通过；随后 terminal 八场景 Root lib 8/8 通过 | terminal-integrated-src.log、terminal-integrated-lib.log、terminal-complete-integrated-lib.log；完整 terminal 八场景 Root src/lib 也各 8/8 通过 |
| Terminal 跨流和内部资源恢复 | 共同源码 4 suites / 86 tests 通过；跨流文件自身 32/32 | terminal-resources-integrated.log；覆盖无效 checkpoint、缺 sink/receipt、错误归属、内容、保留前缀与内部资源 |
| 工作区确认与定价真实 Loader | Root src/lib 各 4/4 通过 | native-workspace-usage-src.log、native-workspace-usage-lib.log；晚于第一次 vendor 集成、早于最新 channel recovery/wake 增量 |
| Review task 故障恢复 | Root src 4/4；交接 worktree src/lib 各 4/4 | review-terminal-integrated-src.log；JSON/SQLite × failure/cancellation，保留 attempt/consult 历史和准确未确认 epoch stall |
| Final/goal phase journal/checkpoint | Root 两文件 36/36 通过 | final-phase-integrated.log；其中十二项新用例覆盖不允许的 phase 与目标状态关系 |
| Activation proof 与 checkpoint 时间 | Root 三文件 60/60 通过 | activation-quiescence-integrated-consumers.log；新增十二项覆盖初建 proof、不可变性、字段/record 时间与 checkpoint 回退 |
| 纯 view 与 human task creator | Root 两文件 14/14；capacity Loader src/lib 各 2/2 | human-creator-pure-view-integrated.log、pure-view-capacity-integrated-src.log 与 pure-view-capacity-integrated-lib.log；真实大/小 source；持久 human attribution/duplicate key 关系 |
| Audit repair 与 retention | Root 四文件 55/55；scheduler 单包 51/51 | audit-retention-integrated.log、scheduler-retention-all-green.log；当前 index90c2a2e4、fold5465、scheduler4bc857e8 |
| 正常 human question producer | Root src2/2通过 | human-question-integrated-src.log；正式 UserQuestions/ApiProxy、真实 worker、Mux/sourceId 与持久 action 对应，公开 cancellation 收尾 |
| 真实 completed archive/compaction fixture | 4/4 通过 | durable-completion-fixtures.log；由公开命令、final sink/receipt 和 quiescence 创建有效终态 |
| Hub owning | 最新已识别集合126文件、1,792 passed / 1 skipped；覆盖率仍失败 | hub-owning-budget-candidate；9,347路径不变，无新顶层临时目录。index S91.60/B86.99/F98.45/L93.28，fold S99.82/B99.42/F100/L99.90，另四文件全100；不再作为独立功能开发前置 |
| 全仓串行 unit | 新 Loader 共同版本 15,479 passed / 115 skipped；956 文件通过、9 文件跳过 | loader-candidate-full-unit.log；8,914 个源码路径前后 hash 一致；之后合入的 view 容量与 optional checkpoint 小片不在这份全仓证据内 |
| 最近正式 Host build | PASS，24.565秒，42个本轮输入前后相同 | budget-candidate/host-build.log与inputs.json；包含A/H1预算及C审批扩展，未包含尚在开发的下一轮Loader与多资源场景 |
| 最近 doc-sync / hygiene | doc-sync 28/28、hygiene 14/14 | budget-candidate/doc-sync.log与hygiene.log；doc typecheck使用同一已通过Host构建的contracts-ready入口，保留28项依赖图 |
| 预算与审批共同验证 | 7 suites/211 unit、4 suites/12 lib、18个TS文件lint通过 | budget-candidate/verification.json；包含retry limit下真实rework完成、usage扫描、两后端审批及Host-loss，不代表完整Hub coverage |
| 普通单任务取消共同版本 | Root Host build、4 suites/src14、5 suites/lib19（含SDK5）、Pythonadvanced built-workspace replay通过 | task-cancellation-integrated；四个owning suite合计124项通过（115+9）。支持queued/running/review、准确owner停止与allocation/action收尾；workflow取消仍未实现 |
| 显式频道摘要共同版本 | Root 37 unit、summary/Direct v4/usage合计src6与lib6，Host/Client build均通过 | wp03-integrated；4个源码生成器通过，完整doc-sync和最终发行验收仍待完成 |
| Direct v4首片 | 61 unit、JSON/SQLite src2/lib2、Host build通过 | wp02-integrated；30输入不变。原AgentClient workspace reservation单例在Root1PASS/74过滤，无workspace/teardown生产修复或根因结论 |
| 审批、审阅与回收集成 | JSON approval src1/1，三个构建产物suite共6/6 | review-budget-integration/approval-src.log及approval-review-retention-lib.log；包含新approval producer和既有review/rework/retention场景 |
| 真实本地模型复验 | Qwen单场景142.044秒退出0，三个Session与SQLite独立验证通过 | native-headless-review-projection；completed wait实际携带匹配reviewer/accepted attempt，模型最终文字正确报告审阅接受 |

日志位于项目 .tmp/native-team-development 下；交接给其他机器前需要保存为可持久访问的测试 artifact。早期统一 TMPDIR 的全仓失败及默认 fixture 环境的复查结果保留在执行记录；不能把复查通过拼接成全仓通过。此前的 HMR 失败在本次完整运行中未复现，独立文件和指定顺序也不能稳定重现，原因仍未确定。测试仅补充失败时的配置与错误诊断，没有修改断言、等待上限或轮询。

用户已明确要求所有后续测试临时产物留在项目内，TypeScript测试脚本使用禁用缓存的Node ESM入口，避免tsx CLI的系统临时IPC；旧全仓证据不代表已完成这项路径审计。本机真实LLM已完成API及一个原生Harness coordinator/worker/reviewer场景验证，实际服务需将示例中的high改为其支持的xhigh；配置与其余系统验收限制见[WP13](wp13-system-verification.md)。

## 33 项需求的状态

| 范围 | 状态 | 继续开发要求 |
|---|---|---|
| G01：未释放资源恢复 | PARTIAL | 关闭 P0-01/P0-03 的实际生命周期与重启矩阵，并共同复验 |
| G26：逐文件覆盖率 | PARTIAL | 多包已达标；Hub index/fold 等完整职责与最终消费者聚合仍未放行 |
| G27：生命周期故障矩阵 | PARTIAL | final 三窗口已有真实进程证据；failure/cancellation 等矩阵继续补齐 |
| G03：Direct v4 | PARTIAL | 多人消息与独立交付已合入；继续WP02剩余Consumer与默认接入，完整边界验收后签收 |
| G02：生产频道摘要 | PARTIAL | 有界文本Consumer、工具/认证API、来源验证与摘要加raw tail已集成；随admission升级历史可见性，继续完整策略验收 |
| G07：单任务取消 | PARTIAL | 普通任务的pending/review/assigned/running路径已集成并通过真实组合；继续workflow内取消和依赖/plan传播 |
| G04–G06、G08–G25：功能、UI、cutover | OPEN | 按 WP02–WP12 实现剩余生产行为；频道admission及工作区观察有独立分支实现，待共同集成 |
| G28–G31：系统、远程、浏览器、性能 | OPEN | WP13 负责完整环境与指定场景的候选版本证据 |
| G32–G33：发行、文档收敛 | OPEN | WP14 负责两 SDK、三平台、文档和提案最终验收 |

因此仍有 33 项需要最终签收，6项在主工作区标为PARTIAL。按用户最新优先级继续实现功能，并在各片完成后做必要验证；完整P0/发行签收不再阻止独立功能开发。

最新源码输入为 Hub indexb0540913、foldf346384a、closure driver982f8c4a、scheduler80257221、TeamRun84720c40、activation controller cc1b5aad、tool-team-task8594d74f。Controller在provider启动后读取当前cursor绑定；TeamRun将reviewer各准备步骤与task admission的重试次数分开，仍使用原配置上限。Controller99项、TeamRun及workflow retry79项、真实并发producer src/lib各1项及Host build通过，证据在activation-admission-progress/handoff.json。

真实Qwen复验对应此前index885962be/TeamRun8eedc374的review投影版本，已完成文件修改、一次审阅、Goal/final及资源收尾，模型看到的有界审阅投影与持久事实相符。完整证据在 .tmp/native-team-development/local-llm/native-headless-review-projection；原始失败文字对应的第一次运行保留，API与模型路由配置见WP13。
