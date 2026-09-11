# 共享接口、版本和并行集成约定

本页是[开发计划](overview.md)的跨工作包协调参考。P1 候选接口是待实现约定；P0 已实现的部分在对应段落标明，现有公共 API 仍以源码和 owning Agent Note 为准。每个领域只设一个接口主责，功能作者保留实现责任。

## 接口登记

| 编号 | 领域与主责 | 消费者 | 开始并行前必须明确的交付 |
|---|---|---|---|
| C0 | 生命周期，WP01 | WP04/05/07/08 | durable intent、资源处置结果、恢复 proof、terminal admission 条件 |
| C1 | 频道，WP02；摘要增量由 WP03 | WP04/05/08/10 | direct v4、invitation/ack、retained implementation、view 与 summary provenance |
| C2 | 任务和 placement，WP04 | WP05/07/11 | execution discriminator、取消请求、约束解析、排名版本、placement 结果 |
| C3 | supervisor，WP07 | WP01/04/05 | termination mode、recovery descriptor、health/fence 结果、generation |
| C4 | allocation，WP06；loss 增量由 WP07 | WP01/04/05/11 | observation、unavailable/preserved/released 区分、integration policy 输入 |
| C5 | human delivery，WP08 | WP01/02/05/09/10/11 | inbox admission、final sink receipt、display cursor、action response、principal 绑定 |
| C6 | 客户端状态，WP09 | WP10/11 | 按 Team 的权威 selection、分页控制器、mutation command、冲突与取消结果 |
| C7 | 发行兼容与证据，WP12/WP14 | 全部 | release family、旧字段替代、schema/version 同步、候选提交与证据清单 |

接口登记记录字段含义、创建者、读取者、JSON/schema owner、取消结果、幂等键作用域、CAS 字段、错误集合、最小正负场景和批准的提交。WP00 负责排序和确认依赖，不在无人实现时直接增加运行时占位类型。

## 共享文件修改责任

| 文件集合 | 逻辑归属 | 集成规则 |
|---|---|---|
| [Team 类型](../../../packages/core/team/src/types.ts)、[schema](../../../packages/core/team/src/schema.ts)、[runtime](../../../packages/core/team/src/runtime.ts) | C0–C5 分领域拥有 | 功能作者提交完整增量；WP00 串行合并并检查类型、验证和消费者一起到位 |
| [Hub 命令](../../../packages/team/team-hub/src/index.ts)、[fold](../../../packages/team/team-hub/src/fold.ts)、[持久 schema](../../../packages/team/team-hub/src/schema.ts) | 对应命令/事件领域主责 | 同一函数或事件的改动不能同时合并；依据最后已集成提交重放场景 |
| [TeamRun](../../../packages/team/team-run/src/index.ts)、[Agent Client](../../../packages/team/team-agent-client/src/index.ts) | C0/C1/C2/C4/C5 | 按方法登记临时修改权；不得复制第二套 binding/proof/receipt 路径绕过冲突 |
| Host、SDK protocol/server、Python models | 对应接口主责，WP14 校验投影 | 一个格式变化的全部语言/schema 在同一逻辑切片提交 |
| [TeamPage](../../../packages/client/ui-team/src/client/TeamPage.tsx)、[TeamBrowser](../../../packages/client/ui-team/src/client/TeamBrowser.tsx) | WP09 组合；WP10/11 功能子组件 | WP09 先建立组合位置和 props；功能作者只维护对应子组件与测试 |
| bundles、workspace manifests、lockfile、生成目录 | WP00 集成，功能作者提供输入 | 不手改生成物；统一重生成并审查差异，不接受互相覆盖的 lockfile |

允许不同 worktree 同时修改同一文件的不同约定，但依赖 PR 必须基于可见父提交，合并进入共享集成线时串行处理。不要为减少冲突机械拆分巨型 Hub；只有新命令有独立 owner 时才作局部提取。

## 不可改变的时序

| 操作 | 必须保留的顺序与失败结果 |
|---|---|
| 业务写入 | 认证/principal 或 provider proof → 解析 JSON → 结构权限 → 锁内重新解析 proof 与 CAS → policy → 必要的再次校验 → durable append → observer |
| Agent delivery | channel WAL → 精确 claim → Session 保存内容与 provenance → flush → receipt；重投递查 durable source，不把 notify 当 receipt |
| Human delivery | channel WAL → 当前 principal/service 的 durable sink append → flush → receipt → UI/SDK display；显示确认是另一个 cursor |
| Task cancellation | intent 写入且限制新工作 → 精确 attempt/epoch 取消 → owner 完成或 fence proof → allocation settlement → task terminal |
| Child delegation | parent requested → child 创建幂等事实 → parent binding → start → child terminal/result receipt → parent charge 修复 → parent task terminal |
| Workspace integration | durable integration task + expected target version → policy → provider proposal/apply → result/verification/产物事实；不能因模型说“完成”跳过 provider |
| Teardown | 同步关闭新接纳 → 保留已接纳操作 authority → 逐层释放并等待 → 汇总所有分支错误；socket close 不是远程终止证明 |

锁内不得长时间等待模型、网络、进程终止或文件扫描。记录精确意图后在锁外执行 provider 动作，再带 cursor/attempt/generation 回写；并发修改令回写拒绝或重新读取，不复用旧授权。

## Final receipt 的明确决策

交互式 final 使用 WP08 的 principal inbox 作为 durable 接纳证明。关闭驱动可以修复“sink 已提交、channel receipt 未提交”的窗口；不能只因为 closure intent 引用了 final 就推断 human sink 已持久化。

Headless 没有认证 principal 时，保留 system-owned run。由其封闭结果接纳方持久化精确 Team/channel/envelope/content 引用后再 receipt，不伪造 principal。C5 为 principal inbox、parent delegation service 和 system result sink 定义可区分的持久 provenance，具体类型与格式随 WP08 提交。

P0 的 WP01-result 已在主工作区实现最小 durable final admission：[TeamFinalAdmission](../../../packages/core/team/src/types.ts)与 [admitTeamFinalResult](../../../packages/core/team/src/runtime.ts)保留 Team/channel/Envelope 与 sequence、精确内容 fingerprint、派生的 recipient/owner、admission idempotency key 和 admittedAt。内容由 channel WAL 拥有，retention 保留该引用；team/final-admitted 独立于 closure intent，sink 为 team-run-result，不产生公共 inbox 或一般人类写权限。它保留在内部 Hub projection/checkpoint，不作为公共 TeamStateSnapshot 的 inbox。当前 journal/checkpoint 已作相应格式更新，集成人继续登记后续实际版本。

WP08 再把交互式接纳接到 principal inbox，Headless 保留明确的 system result sink；不要建立一个同时要求两份 sink 都成功的重复真相。两阶段各自测试“仅有 intent、仅有 sink、已有 receipt”的崩溃窗口，P0 不等待 P1 完整 inbox。格式切换随拥有者修改并按 pre-release 规则拒绝旧值，不增加永久兼容 reader。P0 已合入行为和未完成验证见[当前状态](current-state.md)；WP08 的交互式扩展仍需自己的实现和 owning Note。

## 版本、幂等和错误

Team journal/checkpoint、channel WAL/checkpoint、principal inbox、audit、Link frame 各自拥有版本。WP00 为每个合入切片登记实际递增值，不在工作包里提前硬编码数值；SQLite 保持单调 SCHEMA_VERSION，Session 继续遵守 format 0 的 required-on-read 规则。

模型或 wire 输入不得带 actor proof、凭证、caller-selected sender authority、live root 或进程句柄。业务 idempotency key 必须绑定完整语义载荷：同 key 同载荷返回原结果，同 key 不同载荷拒绝；重试时重新生成短期 proof。每个 key 记录保留期限及 compaction 所需 watermark，禁止记录被压缩后悄悄重新执行。

错误按实际失败领域分类：认证/权限、stale cursor/revision、stale attempt/generation、provider unavailable、termination unconfirmed、预算拒绝、冲突、格式不支持、已压缩 cursor。新增 error code 先由领域主责登记；前端保留 typed code，不靠匹配错误文本判断是否重试。

## 分页约定

每个查询有有限 limit、exclusive afterCursor 和可选 nextCursor。业务 cursor、provider ordinal、principal display cursor 不能混用。删除、取消和 compaction 后，游标要么单调推进，要么返回明确 stale/compacted 结果；不能重复整页或无限循环。

list/get/watch 的返回值明确是否包含完整集合。产品详情不能以 getTeam 的完整内部状态长期替代所有分页接口；scheduler/recovery 的 provider-owned 读取按其自身有限规则保留。UI 不循环下载全部页伪装分页。

## 交接与变更流程

接口更改者列出受影响消费者和必要场景；各消费者确认其代码能接收、拒绝、重试和取消该变化。WP00 登记生产依赖；依赖切片没合入时可以使用测试 adapter 表达约定，但不得在 shipped composition 放入假成功 provider。

每次共享父提交变化后，只重跑因该变化失效的证据。正式 PR 依赖使用仓库规定的 GitHub stack；并行 worktree 是开发隔离，不是免除 stack 合并规则。参见[pre-push 检查](../../skills/dsh-pre-push-checks/SKILL.md)。

### C1：显式频道摘要

WP03 的 `ChannelSummarySelectionInput` 由 coordinator tool / authenticated human API 创建，绑定 channelId、expectedCursor、含两端来源 WAL 范围和频道作用域幂等键。生产 `team-channel-summary` Consumer 读取 Hub 授权来源并提供有界确定性文本及规范来源 fingerprint；请求者证明与系统输出证明分别复核。Channel WAL 6 / checkpoint 9 要求 `sourceFingerprint`，Hub 在提交与重放比较完整有序来源 Envelope。摘要是全频道事实，隐藏来源子集拒绝；相同键/范围返回原结果，新键需新游标。默认 directed 保持原投影，显式 summarized-window 消费最新摘要与 raw tail。后续 admission 的 WAL 7 / checkpoint 10 合入时，可见性读取必须同步到 `ChannelEnvelopeRecord.deliveryIntents` 与 sender；`TeamEnvelope` 本身没有该字段。
