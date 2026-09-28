# Team 功能审查与改进方案

本文保留改进前的审查基线；已落实的修复及当前验证结果见[实施结果](RESULTS.md)。

审查日期：2026-09-13。基线：`26bc4314fca3a98e9f479c509f7771e623ef60f9` 加审查时工作区；[源码指纹](evidence/source-manifest.json)记录主要 team 源文件和产品组装配置。本报告是审查与实施计划，不代表改进已经实现。

## 结论

Team 已具备较扎实的持久化、权限、任务租约、投递去重与取消基础。主要风险集中在跨阶段的信息和状态交接：已有机制单独成立，但连续续跑、调度预算组合、review 建频道后发送失败、不同 worker 接手返工，以及 coordinator 获取工作证据等路径没有完整闭合。建议优先修复这些具体问题，不重写 Team 架构，也不加入统一的无限重试或自动换模型机制。

本次确认三个可重复的运行缺陷、四类模型工具信息缺口和一个跨 worker 返工设计缺口。现有测试的大量通过不能代替这些组合场景的验证；新增复现中出现的预期失败是缺陷证据，不是修复结果。

## 范围与方法

以当前源码为准，检查 [Team 家族](../../../packages/team/README.md)、[TeamRun](../../../packages/team/team-run/src/index.ts)、[任务工具](../../../packages/team/tool-team-task/src/index.ts)、[报告与通信工具](../../../packages/team/tool-team/src/index.ts)、[Agent Client](../../../packages/team/team-agent-client/src/index.ts)、[调度器](../../../packages/team/team-scheduler-dag/src/index.ts)、[Hub](../../../packages/team/team-hub/src/index.ts)，并抽查 Link、activation/workspace recovery、closure 和 [LLM retry](../../../packages/llm/llm-retry/src/index.ts)。核对 Headless/Web 实际组装，运行现有包测试与真实 Loader 的 keyless 场景，追加有对照的故障序列复现。

本次不做 UI 视觉审查，不修改运行源码。已有 UI、文档和构建产物的工作区改动属于其他工作，不包含在本报告的改进交付中。报告、审计探针和运行日志保存在本目录；探针未加入产品 CI。没有对每个文件逐行证明，也没有测量长期跨主机故障率、完整覆盖率或真实模型的规划质量。

真实模型 smoke 已尝试运行，但因没有可用模型环境变量而跳过；项目根目录也没有 `.env`。因此关于模型易用性的结论来自模型实际可见 schema、prompt 和工具结果，不声称已经测得实际模型的成功率。

## 运行流程与现有合理机制

正常链路为：人类输入持久化 → coordinator 分解与创建 task/workflow → scheduler 选择符合能力、并发和 workspace 条件的 participant → 创建 attempt lease 与 assignment Envelope → Agent Client claim、启动 attempt、写入 Session 并 flush → worker 执行和 report → 可选 reviewer 审查 → coordinator wait 与整合 → `team_final` → 持久化交付与 closure。

| 环节 | 已有设计与本次判断 |
|---|---|
| Agent 引导 | coordinator 要求明确目标、输入、交付物、约束、验收和交接；worker 默认使用不继续委派的 preset。这些职责区分应保留。 |
| 工具权限 | schema 按角色暴露，执行时仍检查当前 scoped Agent、initiator、activation 和 attempt。无需为同进程的合法类型重复增加验证。 |
| 任务分配 | DAG 依赖、能力匹配、write scope 冲突、并发上限、attempt 次数与 Team 预算参与实际分配，不只是 prompt 约定。 |
| 输入投递 | claim 与 Session flush 屏障先于模型步骤和 receipt；重放识别既有来源，避免回执失败导致同一输入重复执行。 |
| 工具响应丢失 | task report、heartbeat 和 integration 存在已提交状态回读与幂等处理；不应把任何工具异常都转换为重新执行工作。 |
| 模型请求失败 | provider policy 拥有可重试错误集合、退避、抖动、Retry-After 和取消。该层应处理瞬态请求故障。 |
| 输出截断 | 设计意图是同 Session 有限续跑，耗尽后明确结算；下文发现的是 worker 连续回合关联的实现缺口。 |
| 取消 | 等待取消和任务取消分离；任务取消检查具体 attempt/turn 的停止证据，保留清理进度。不能因等待超时就默认任务已经停止。 |
| 工作区 | allocation、发布、integration、release 由各自 owner 管理；恢复可区分尚未释放资源。保持当前 provider 分工。 |
| 冷恢复 | activation recovery 是显式、同主机、有限扫描并经旧 epoch fence 的恢复，不是任意多主机接管。该限制合理且需要在运维配置中明示。 |

## 需要优先修复的运行缺陷

### R1 · P1：worker 第二次输出截断失去任务关联

**定位。** [Agent Client](../../../packages/team/team-agent-client/src/index.ts) 第 491–506 行从当前 turn 查找 assignment；第 535–538 行产生来源为普通 `plugin` 的续跑消息；第 2736–2759 行只识别目标 turn 实际 claim 的 `team-task-assignment`。第一个 turn 的 assignment 不会自动归属第二个 turn。

**复现。** 将 `maxTaskOutputContinuations` 设为 1：第一回合 claim 任务并以 `max-tokens` 结束，实际续跑消息进入 Inbox；第二回合 claim 此消息后再次截断。预期应耗尽预算并调用 `settleTaskAttempt`，实际调用次数为 0。重复通知同一个第一回合的现有测试式对照则通过。见 [复现代码](continuation-regression.spec.ts) 与[输出](evidence/continuation-regression.log)。

**影响。** `maxTaskOutputContinuations: 3` 并不能保证三次真实续跑的链路完整。任务可留在 running，直到其他事件或租约到期处理；[Headless 配置](../../../packages/bundle/headless/cordis.patch.yml)第 158 行和 [Web 配置](../../../packages/bundle/web-app/cordis.patch.yml)第 194 行的租约为 3,600,000 ms，用户可能长时间只看到等待。

**最小方案。** 续跑输入保留可持久化的 task/attempt/activation 来源关联，由此把新 turn 关联回同一 attempt；复用当前 Inbox/Session 来源机制，不按“最近一个任务”猜测，不重新投递已确认的 assignment Envelope。预算按 attempt 累计，每个 turn/end 至多计一次，耗尽后沿现有失败结算入口处理。

**验收。** 连续不同 turn 的截断能推进到上限并结算；重复同一 turn 事件不消耗第二份预算；report、取消、lease 替换后的旧续跑不唤醒任务；重建 delivery 后能从持久化来源恢复正确归属。

### R2 · P1：唤醒扫描用尽预算会阻止后续任务分配

**定位。** [调度器](../../../packages/team/team-scheduler-dag/src/index.ts)第 563–581 行在已有 assigned wake 的扫描达到 `maxWakeDispatchesPerDrive` 后直接结束整个 drive；新的任务分配在第 598 行之后。即使已有 Envelope 不需要重新发送，验证也会消耗 wake 预算。

**复现。** 两个 assigned task 保持未 claim，另有空闲 participant 和 ready task，wake 预算为 1；连续五次 drive 后新 task 仍是 pending。预算改为 2 的对照可以分配。见 [调度复现](scheduler-repro.spec.ts)和[输出](scheduler-repro.log)。轮转 wake cursor 能推进扫描，但不能让当前 drive 走到被提前 return 跳过的阶段。

**影响。** Link 投递或 worker 启动暂时滞后时，原有 assigned 任务可能把空闲容量闲置，也可能挡住后续 review 派发。产品默认 wake 预算为 8、worker 上限为 32，因此问题并非只存在于不合理配置；发生时间取决于 assigned backlog 是否持续。

**最小方案。** 将 wake 恢复、review 派发、新 assignment 作为独立有界阶段；用尽一个阶段的额度后仍给其他阶段进展机会。保留现有 lease、并发、资源和 scope 检查，并保留 backlog 的续扫位置。不要通过无限增大预算掩盖饥饿。

**验收。** assigned backlog 大于扫描额度时，空闲合格 worker 仍能在有限次 drive 内接到新任务；review 同样能推进；每阶段上限、取消和无重复 Envelope 的约束仍成立。

### R3 · P1：review 频道已经创建但请求发送失败后，重试另建频道

**定位。** [调度器](../../../packages/team/team-scheduler-dag/src/index.ts)第 898–910 行先 open 后 post；第 916–936 行依靠已经存在的 review request Envelope 识别频道。[Hub](../../../packages/team/team-hub/src/index.ts)第 8096 行每次创建新 ID，第 8119–8140 行没有把 review task/attempt 的 durable 关联保存在新频道的可恢复身份中。

**复现。** 让第一次 `postChannelEnvelope` 在 review channel attached 之后短暂失败。下次 drive 预期复用唯一频道，实际已有两个 attached channel。见[故障注入与对照](scheduler-repro.spec.ts)和[日志](scheduler-repro.log)。测试使用真实 scheduler 与受控 Team provider；Hub 源码核查确认其创建与身份保存方式吻合，不把此单元复现夸大成进程崩溃实测。

**影响。** 短暂失败可留下空 review 频道；重复发生会消耗 channel 配额，使后续 review 更难恢复。增加 post 的重试次数无法修复“已经创建但尚无 Envelope”的恢复身份缺失。

**最小方案。** 由 Hub 持久化唯一的 `{taskId, attemptId, reviewerId}` 与 review channel 关联，或在现有 durable 创建入口实现等价的创建幂等身份。重试和重启都能先取回同一频道，再继续 invitation/request；不可只靠内存缓存，也不可按参与者相同就复用其他任务频道。

**验收。** open 成功后 post 失败、回执丢失、重新加载三个路径都只有一个该 attempt 的 review channel；不同 task/attempt 不串频道；邀请未确认时仍维持现有 admission 规则。

## Agent 引导、工具设计与交接

### M1 · P1：完整 worker 结果没有沿正常 wait 返回给 coordinator

[报告工具](../../../packages/team/tool-team/src/index.ts)第 462–477 行允许提交 `evidence`、`artifacts`、`changed_paths`、`verification`；[TeamRun](../../../packages/team/team-run/src/index.ts)保留完整结果，但[工具投影](../../../packages/team/tool-team-task/src/index.ts)第 750 行只返回 `summary`。因此“报告里有证据”并不等于 coordinator 下次模型请求能看见证据。扩展的 Cordis 服务读取或把一切塞入 summary 不能代替正常交接。

最小方案是在 wait 的终态输出中保留有界的 result，包括证据、产物引用、变化路径、验证和 integration 状态；list/watch 继续保持紧凑。超限提供明确截断标记与可读取的详情引用，不返回无限日志。验收用每字段不同的标记证明 coordinator 首个后续请求能获取实际证据；普通 worker 与 child Team 的产物都可引用。

### M2 · P1：换 worker 返工没有继承审查依据

[assignment 渲染](../../../packages/team/team-agent-client/src/index.ts)第 2522–2523 行只含原始 subject/description、task/attempt、workspace；[coordinator review 投影](../../../packages/team/team-run/src/index.ts)第 5506–5517 行也不含 reason。若返工换 participant，不能假定新 worker 已有原 worker 的会话上下文。

此处有重要限定：[review 响应](../../../packages/team/tool-team/src/index.ts)第 1743–1760 行会通过 consult 把 reason 发给原 attempt participant，因此不是所有返工都收不到理由。确认的设计缺口是新 worker 的 assignment 没有携带 durable 修订依据；尚未追加 A→B 完整模型输入复现，不声称已经测得其返工失败率。

最小方案是按当前 task 状态生成紧凑 `previous_attempt`：最近结果摘要、最近失败或 rework reason、必要 artifact 引用；原首次 assignment 不加空历史。验收必须让 A 提交结果、reviewer 指定具体缺陷、B 接手，并检查 B 的真实请求含准确理由；所有注入信息随 Session 可重建。不要复制全量 reviewHistory。

### M3 · P2：workflow 被推荐使用，但模型看不到完整参数定义

[工具定义](../../../packages/team/tool-team-task/src/index.ts)第 547–553 行只暴露通用 JSON 与 `TeamWorkflowPlan` 类型名；[真实 schema](../../../packages/core/team/src/schema.ts)第 1606–1652 行要求具体嵌套结构。prompt 又在存在依赖、fan-in 时推荐该工具。人工预制合法 plan 的测试只能证明执行器接受方案，不能证明模型能从现有接口构造方案。

优先方案是面向模型暴露任务节点、依赖、结果选择和必要 bounds 的结构化输入，由现有 workflow owner 编译固定 channel 细节。如果确需完整 plan，则暴露真实 JSON Schema、可用角色/能力和一个最小合法例子。普通任务路径保持简单，不要求所有任务改用 workflow。

验收分两层：keyless 测试验证实际 schema 与可执行 A→B 示例一致，非法依赖在执行前拒绝；真实模型只收到产品 prompt/schema，用自然语言任务构造两阶段方案。后者才能评估实际易用性。

### M4 · P2：失败结果删除了已知的终止原因

[终态投影](../../../packages/team/tool-team-task/src/index.ts)第 755–757 行把 `released` 和 `lease-expired` 都变成没有原因的 `phase: failed`。coordinator 无法据此区分主动交还、租约耗尽和明确执行错误，影响是否修改 brief、换 worker、等待恢复或停止的决策。

最小方案保留有限枚举 `last_outcome.kind` 和已有 failure code/message，按需补充 attempt_count/max_attempts；不创建推测性的全局错误分类系统。验收 failed/released/lease-expired 三种结果可区分，并明确 task 是否已经耗尽内部重试。

### M5 · P3：watch 文案引用不存在的 list cursor

[task 工具](../../../packages/team/tool-team-task/src/index.ts)第 487 行让模型使用上次 list 或 watch 的 cursor，但第 479–480 行 list 只返回 tasks。最小修正是说明首次调用 watch 省略 `after_cursor` 获取快照，以后使用 watch 返回的 cursor；无需仅为修正文案扩充 list。验证 list→首次 watch→cursor watch 的使用链路即可。

M1、M3、M4、M5 的[审计探针](prompt-tools-probes.spec.ts)已经通过，证明的是当前字段丢失和文案/schema 缺口；[日志](evidence/prompt-tools-probes.log)不能用作修复验收通过的证据。

### Prompt 策略建议：按任务收益委派，集中一处说明

当前 prompt 的明确 brief、依赖、scope、验收和禁止 worker 再委派值得保留。但 [coordinator prompt](../../../packages/team/team-run/src/index.ts)第 262–273 行与多个工具描述重复强调把实质工作交给 worker，容易把“能拆分”当成“值得拆分”。这是设计建议，不是已测出的性能缺陷。

建议由 coordinator prompt 单独拥有策略，工具描述只解释具体行为。可采用以下意思的简洁引导：

> 对能独立交付、可独立验证且能节省时间或上下文的工作使用 worker。每个任务明确输入、产物、约束和验收；有依赖先安排前置产物，独立任务可并行。相同文件由一个明确 owner 修改。用实际证据验收 worker 结果，缺证据时补查。任务仍在内部重试或取消尚未完成时，不重复创建同一份工作。只有目标完成且相关任务结算后才提交最终结果。

小型单步工作、强依赖串行任务和一个共享文档的编辑可以保持单执行者。用真实模型评测四种场景：简单问答、两个独立工作流、A→B 依赖、共享文档；衡量交付正确性、重复工作和总成本，而不是只检查调用两次 start。

## Retry 与 fallback 的责任划分

| 故障类别 | 现状与建议 |
|---|---|
| 429、短暂网络/服务错误 | 交给现有 provider retry；保留有限次数、退避与取消。不要在 Team 层再完整重跑 task 来补偿同一次请求。 |
| 认证、无效配置、缺 preset/provider | 明确报错并修正配置；不自动降级成 coordinator、默认 preset 或不同模型，以免改变任务能力与权限假设。 |
| context overflow | 交给已有上下文恢复策略；与请求重试分别计预算。模型切换仅作为显式部署选择，不当作默认必备能力。 |
| model output limit | 同 attempt 接续，按 R1 修复来源与预算；不是重新创建 task。 |
| cursor/revision 冲突 | 同一幂等操作重读状态、重新取得当前 proof，再有限重试；不把永久错误混进冲突重试。 |
| request 已落盘、响应丢失 | 先读回同一任务/报告/频道身份，保持既有幂等机制；R3 补足 review 创建到发送之间的身份。 |
| task 执行失败/rework | 由现有 attempt policy 决定是否重试；下一 attempt 带失败/审查依据。coordinator 根据 M4 的原因决定是否调整方案，不盲目新建相同任务。 |
| Link 连接失败 | 当前 [Agent Client](../../../packages/team/team-agent-client/src/index.ts)第 599–613、703–727 行对连接异常安排固定延迟重连。保持暂时断线重放；仅对 provider 已有、明确的永久拒绝码暂停并呈现原因，等配置或 binding 改变再尝试。此为源码层改进建议，未做远程断网/凭据故障实测。 |
| worker 正常结束但未 report | 当前 observeTurnEnd 只专门处理 max-tokens。建议针对确切仍运行 attempt 的 completed-without-report 给一次有界提醒；明确 error 在底层恢复耗尽后及时结算。不要对 interrupted/cancelled 一律续跑，也不要将每次 idle 判为任务失败。该建议尚未增加完整组合复现。 |
| 进程或资源释放失败 | 由 activation/workspace/closure owner 接续其 durable 清理状态；不得在旧 owner 尚未终止时并行启动替代者。多主机自动接管保留为独立部署问题。 |

应保留正常模式有限 retry；显式 always 模式的无限请求是部署选择，需要明确成本/取消行为，不应被当作项目默认恢复策略。本次没有发现需要再包一层全局 retry、对所有字段增加运行时校验、或默认采用跨模型 fallback 的依据。

## 实施顺序与验收

| 阶段 | 交付 | 验收重点 |
|---|---|---|
| 1：恢复进展 | 分别修复 R1、R2、R3；每项独立可审查 | 现有红色复现转绿，保留对照；随后增加实际 Loader/持久化组合路径，不能只改测试期望。 |
| 2：证据交接 | M1 完整有界结果、M2 返工依据、M4 失败原因 | 查看 coordinator/接手 worker 实际下一次请求；补齐普通 task、review、child-Team 的端到端交接。 |
| 3：模型易用性 | M3 workflow schema/示例、M5 watch 文案、精简委派策略 | 合法与非法 workflow 都走真实工具；执行自然语言模型评测，记录模型、配置、消耗和结果。 |
| 4：部署恢复 | 按确切错误码改进 Link 永久错误呈现；评估未 report 的有限提醒 | 每种改进都有当前故障证据和明确停止条件，不扩展为任意自动重试。 |

这些变化应放在现有 plugin owner 中；非平凡实现按仓库规范编写 Agent Note、更新 README/JSDoc，模型或协议可见变更加入 runnable-example keyless snapshot。只有改变 agent/session 生命周期时再覆盖两个 SDK snapshot owner，不把本次报告本身当作产品行为变更。

## 测试结果与复现命令

所有命令从仓库根目录执行。表内部分聚焦检查与全量 team 检查重叠，不能相加宣传为独立测试总数。

| 检查 | 结果 | 证据 |
|---|---|---|
| Team 家族与 core/team、team-link、team-workspace、team-artifact | 142 文件，2011 passed / 1 failed | [日志](evidence/team-tests.log) |
| Scheduler/activation/workspace/Link 六包聚焦检查 | 19 文件，341 passed | [日志](scheduler-recovery-tests.log) |
| review consult accepted/rework 聚焦复查 | 2 passed | [日志](review-consult-rerun.log) |
| LLM retry、in-process runtime、closure | 10 文件，173 passed | [日志](evidence/llm-runtime-closure-tests.log) |
| 三个工具包聚焦检查 | 56 passed；与 Team 检查重叠 | 工具检查另经四项探针复核 |
| 三个 keyless Loader/snapshot 文件 | 6 passed / 5 failed | [日志](evidence/team-snapshots.log) |
| R1 连续回合复现与原事件对照 | 1 failed / 1 passed | [日志](evidence/continuation-regression.log) |
| R2/R3 调度故障复现 | 2 failed / 1 passed | [日志](scheduler-repro.log) |
| M1/M3/M4/M5 现状探针 | 4 passed，断言当前缺口存在 | [日志](evidence/prompt-tools-probes.log) |
| CLI 真实模型 Team smoke | 1 skipped；无模型配置 | [日志](evidence/real-team-e2e.log) |

现有 Team 检查唯一失败为 [review composition](../../../packages/team/team-scheduler-dag/tests/composition.spec.ts)第 638 行，预期第二个 consult，实际只有一个。独立复查通过；该用例使用较短 lease，可能受全套并发时序影响，但本次未证明根因。应保留失败证据，检查实际 task phase/lease 与 clock，再决定使用确定时钟还是更符合场景的租约；不能直接归咎环境或把它并入 R3。

Loader/snapshot 的五项失败分两类：

- [headless TeamRun 快照](../../../examples/headless-agent/tests/headless-team-run.snapshot.ts)第 419 行仍断言旧 prompt 字符串 `at least two independent worker tasks`，当前 prompt 已采用其他措辞。这是陈旧断言，不能解释为 worker 委派流程失败。应在确定委派策略后对齐真实行为与文字契约。
- [workflow cancellation 场景](../../../examples/headless-agent/tests/workflow-task-cancellation.snapshot.ts)的 tool/api × JSON/SQLite 四种组合均在 final 交付时失败：`Principal final delivery requires the durable human inbox Consumer`。对应 fixture 使用 principal final 路径但没有所需 human inbox Consumer；[Hub](../../../packages/team/team-hub/src/index.ts)第 2863 行明确拒绝。应修复 fixture 的实际组装并重新跑完整场景，保留 admission 检查，不能通过删除安全要求来让快照通过。这四项目前不能算作已验收的完整取消流程。

```sh
pnpm exec vitest run packages/team packages/core/team packages/core/team-link packages/core/team-workspace packages/core/team-artifact --maxWorkers=4
pnpm exec vitest run packages/llm/llm-retry packages/agent-runtime/agent-runtime-in-process packages/team/team-closure-driver --maxWorkers=2
pnpm exec vitest run --config vitest.snapshot.config.ts examples/headless-agent/tests/headless-team-run.snapshot.ts examples/headless-agent/tests/team-channel-view.snapshot.ts examples/headless-agent/tests/workflow-task-cancellation.snapshot.ts --maxWorkers=2
pnpm exec vitest run --config .agents/plans/2026-09-13-team-audit/vitest.audit.config.ts
pnpm exec vitest run --config .agents/plans/2026-09-13-team-audit/repro.vitest.config.ts
pnpm exec vitest run --config .agents/plans/2026-09-13-team-audit/vitest.prompt-tools.config.ts
pnpm exec vitest run --config vitest.e2e.config.ts apps/cli/tests/real-team.e2e.ts --maxWorkers=1
```

文档检查结果见[验证记录](VALIDATION.md)。本次未单独运行产品 build、全仓 typecheck、覆盖率或跨平台验证；实施阶段按实际改动选择相应检查。
