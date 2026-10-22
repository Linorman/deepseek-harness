# Agent Note: Simulation Web UI 状态可信度、停止控制与业务可读性

Status: proposed

[English](2026-10-21-simulation-webui-legibility.md) | 中文

## Problem

2026-10-21 的 [UI 测试报告](../../../../.tmp/simulation-webui-20261021/ui-issues.md) 记录 UI-01～UI-14：运行列表与详情对同一运行给出相互矛盾的状态，用户无法设置停止边界，事项和概览以技术机制代替业务语义，故障、暂停、保存和恢复需要读懂内部组件才能判断。用户无法可靠回答“它现在是否在执行、停在哪里、发生了哪些业务、我下一步该做什么”。

代码阅读补充了以下事实与新问题（N 系列）：

- **UI-01 的结构性原因。** [RunDirectory](../../../../packages/client/ui-simulation/src/client/RunDirectory.tsx) 把批量状态交给 [RunStatus](../../../../packages/client/ui-simulation/src/client/RunStatus.tsx) 时不带 `control`，阶段只取 Native `world.phase`（`running` 仅表示请求运行），同时并排展示 `operational.driver`，因此会出现“已请求运行”配“空闲”；详情头部优先取管理端 `control.phase`。批量读取失败时，[service.ts](../../../../packages/client/runtime/src/client/simulations/service.ts) 的 `read()` 保留旧值只置 `stale`，卡片继续展示旧日期。DTO 已有 `observedAt`，UI 从未展示。服务端 `runStatuses` 逐行调用完整观察，长日志会退化为英文 `Simulation observation is unavailable`。
- **N-01/N-02 主操作错误。** 运行中“继续调度”仍是主按钮且与“暂停”同时可用；阻塞或调度失败时主按钮是“暂停”，恢复入口藏在溢出菜单，原因挤在按钮下方。
- **N-03 窄窗口不可用。** 约 390px 时侧栏不折叠，主区约 160px。
- **N-04 单位未本地化。** `SimClock` 已支持 `unitLabel`，调用方未传，显示“12 day”。
- **N-05/N-06/N-07 噪声。** 目录头像全为名称首字；同时显示 `SIMULATION` 与“模拟世界”两枚徽标；诊断集合直接展示 `world/1/decision/0`、`world-person:<uuid>` 和“决策 slot”。
- **N-08/N-09 层级。** 空日历占据概览英雄区；最常用的审计入口“记录”藏在“引擎”下拉。
- **N-10/N-11 细节。** 事项详情标题获焦像输入框；四点状态轨道无图例；全空的“最近更新”列仍占宽；分页无位置信息。
- **N-12 组件结构。** [Workspace.tsx](../../../../packages/client/ui-simulation/src/client/Workspace.tsx) 约 920 行，承担路由、轮询、读取编排与布局；phase/driver/stop 的解读分散在 `RunStatus`、[Controls](../../../../packages/client/ui-simulation/src/client/Controls.tsx)、[WorldOverview](../../../../packages/client/ui-simulation/src/client/WorldOverview.tsx) 三处，是 UI-01/UI-10 类不一致反复出现的原因。
- **N-14 刷新无结果反馈。** [Feedback](../../../../packages/client/ui-simulation/src/client/Feedback.tsx) 只表达加载和错误，手动刷新没有成功、失败或超时的结果。

后端由 [Simulation 系统可靠性提案](../bug-fix/2026-10-21-simulation-system-reliability.zh.md) 定义 D1～D6（停止目标、安全故障分类、领域摘要、协议预检、压缩与用量归因、有界读取），并声明 GUI 另行实施。本提案定义对应的 UI 设计、开发计划与验收清单。本提案只基于源码、截图与后端提案，没有运行测试或修改代码。

## Proposal

### 所有权与原则

[ui-simulation](../../../../packages/client/ui-simulation/README.zh.md) 拥有展示判断：状态合成文案、主操作选择、新鲜度降级、布局和本地化。后端拥有事实、准入与权限：UI 不推导业务成功、不扩大披露、不在浏览器串联本应由服务端保证的流程。遵守 [client 规则](../../../../packages/client/AGENTS.md)：组件只收 props，业务数据留在无 React 的对象层，订阅只在 renderer。

1. **一个事实，一种说法。** 目录、头部、概览和弹窗共用同一个运行状态合成函数。
2. **观测必带时间。** 每个状态显示来源观测时间；读取失败、断线或超过阈值时降级为“上次观测”。
3. **业务在上，机制在下。** 首层用领域语言；Native 修订、writer、Participant、Activation、commandId、日志序号进入“诊断”，可复制。
4. **控制只在后端确认后生效。** 停止目标、保存和恢复只在回执确认后显示为已生效。
5. **缺失说明原因。** 区分陈旧、未知、无权限、不适用、未提供（unsupported）和零值。
6. **每种状态只有一个主操作。**

### 设计取舍裁定

| 取舍 | 裁定 | 依据 |
|---|---|---|
| 运行状态在哪里合成 | ui-simulation 内的纯展示模块 `run-state.ts`；不放进 Product 契约，SDK 继续暴露原始字段 | D2 要求 phase/driver/inFlight/stop/checkpoint 独立表达并各带 revision/observedAt，不伪装原子快照。合成是展示判断，不是新事实 |
| 来源切面不一致时 | 采用保守态“正在核对”，详情列出各来源时间；不选任一来源当真相 | D2 同上 |
| 目录读取来源 | 改用 W6 第一阶段的小型控制投影与 D2 安全不可用原因，不再依赖完整观察 | D6 第一阶段；UI-01 根因之一是完整读取失败 |
| 停止模式 | 两种都提供，默认 `drain-admitted`，显示收尾预算；预算耗尽时列出剩余责任 | D1 定义两种模式、冻结 cut 与收尾预算 |
| 停止目标的时钟 | 只显示 provider 声明的时钟（如 `harbor-day`）；无可靠映射时显示后端拒绝原因，不提供输入框 | D1 禁止浏览器推导时钟，不可靠映射拒绝安装 |
| 设置目标与开始运行 | 两个独立命令：先提交目标并等待回执为 `armed`，再允许“继续运行”；关闭浏览器时运行保持暂停、目标保持已设置 | D1 的 run-control 命令与 start 分离，普通 start 不能绕过已触达目标 |
| “暂停并保存” | 首版不做合并按钮。暂停完成后，Banner 把“保存检查点”提升为下一步主操作；是否允许把目标设为当前时间来表达“暂停并保存”交由后端确认（见待决问题） | D1 未定义即时暂停加保存；不在浏览器串联两个命令 |
| 领域文案 | 封闭枚举（三层结果、披露态、故障类别、停止状态）由 UI 本地化；领域开放词汇（动作名、指标名、主体名）由投影器以有界文本返回，UI 原样展示 | D3 投影器输出业务标签并单独授权；新领域不应改主界面 |
| 领域计数 | UI 只展示投影器返回的计数及其定义与覆盖范围，不在前端推算口径；通用请求计数改名“技术请求状态” | D3 三层结果与证据引用 |
| 通用三卡片 | 仅当 D3 声明 `not-applicable` 时折叠；`unsupported` 显示“未提供”；其余照常显示 | D3 逐字段 allowed/withheld/not-applicable/unknown |
| 执行活动条 | 首版只用已有与 D1/D2/D5 字段：调度器状态与观测时间、在途工作、收尾集合剩余数、提供方 retry-after、本运行请求分类计数；“谁在哪一步”不在 UI 推断，列为后续后端需求 | 后端提案没有活动观测；推断会伪造进度 |
| 导航 | 路由模块 ID 不变；“引擎”标签改为“诊断”；“记录”提升为一级“历史”；业务时间线延后 | 现有 records 读取只能顺序分页，没有按模拟日或倒序读取；客户端扫描全量日志违反有界读取 |
| 新鲜度阈值 | ui-simulation 新增经校验的 Config 字段，默认值由 `controlRefreshMs` 推出 | 部署可变选择是 Config 字段 |
| 拆分方式 | 先做不改行为的结构拆分 PR，再在其上做行为变化 | 后端提案要求按职责拆独立 PR |
| 目录形态 | 列表行，状态在最左，按最近活动排序，支持状态筛选 | 比较多个运行时信息密度更高 |

### 运行状态合成

新增纯模块 `ui-simulation/src/client/run-state.ts`（无 React）。输入为 Native 观察、管理观察（详情为 `control`，目录为控制投影）、D1 停止目标、D2 故障、读取状态与连接。输出：

```ts
interface RunState<Key extends string, StopTargetView, FailureView, SourceTime> {
  kind: 'running' | 'stopping' | 'saving' | 'paused' | 'idle' | 'attention' | 'blocked' | 'failed' | 'completed' | 'reconciling' | 'unknown'
  headline: Key                       // localized entry
  simTime?: { value: string; unit: string }
  target?: StopTargetView             // D1: clock, boundary, mode, state, checkpoint
  failure?: FailureView               // D2
  primaryAction?: 'start' | 'pause' | 'save' | 'recover' | 'review' | 'edit-target' | 'refresh'
  sources: { native?: SourceTime; control?: SourceTime }   // each with revision and observedAt
  freshness: 'live' | 'aging' | 'stale' | 'unknown'
}
```

| 条件（节选） | kind | 主操作 |
|---|---|---|
| 暂停且无在途工作 | `paused` | 继续运行；若目标已触达则为“修改目标” |
| 暂停但仍有在途工作，或目标处于 `draining` | `stopping` | 无（显示收尾进度） |
| 暂停后检查点 `pending` | `saving` | 无 |
| 驱动器被观测到 scheduled/advancing/checkpointing | `running` | 暂停 |
| 请求运行、驱动器空闲、无在途工作、无停止原因 | `idle`（“已请求运行，暂无待推进工作”） | 暂停 |
| 驱动器失败或需要恢复 | `failed` | 按 D2 `actionCode` |
| 容量、预算、上下文等停止原因 | `blocked` | 按 D2 `actionCode` |
| 审核、证据、交接等停止原因 | `attention` | 去处理 |
| 两个来源 revision 或观测切面不一致 | `reconciling`（“正在核对最新状态”） | 刷新 |
| 观察不可用 | `unknown`，显示 D2/D6 的安全原因 | 刷新 |

新鲜度：来源观测在两倍刷新间隔内为 `live`；在 `staleAfterMs` 内为 `aging`（显示“x 分钟前”）；读取失败、断线或超过阈值为 `stale`。`stale` 时徽标改为虚线描边并加前缀“上次观测：”，停止所有运行动效，主操作降为“刷新”，其他控制禁用并说明原因。

展示组件 `RunStateChip`（目录、头部、弹窗共用；图标加文字，不只靠颜色）与 `RunStateBanner`（头部下一行：发生了什么、是否仍在执行、下一步）。

### 页面设计

**目录。** 列表行：状态 chip、名称、模拟时间与目标、观测时间、溢出菜单。不可观察行显示本地化的安全原因（missing、unsupported-version、history-limit、corrupt-history、owner-unavailable），英文原文只在技术详情。批量中单行失败只影响该行。去掉首字头像；筛选“全部/运行中/需要处理/已暂停/无法读取”；排序“最近活动/登记时间/名称”。

**运行头部。**

```
‹  QA-河港365日-原请求转交-Flash   [模拟世界]                            ⟳  ⋯
● 已安全暂停 · 第 12 天 / 目标第 12 天（完成已受理工作后停）· 观测于 14:43:05   [继续运行]
  无在途工作 · 检查点：第 12 天 14:43 完整保存
```

目标 chip 可点击编辑。停止过程由 D1 状态驱动：`停止接收新工作 → 收尾已受理工作（剩 N 项，预算剩余 …）→ 保存检查点 → 已安全暂停`。保存状态区分完整保存、部分保存（`external-state-required`，缺少外部案例状态）与保存失败；保存失败时仍显示已暂停并提供“重试保存”，重试沿用同一保存身份。

**概览。** 首屏依次为：运行摘要（阶段、模拟时间与目标、最近检查点、本运行用量摘要）；“需要人工干预的运行问题”（只放运行故障与待审核项，改名以区别业务责任）；领域业务卡（D3 投影的指标、未完成责任、计数及口径说明）；最近业务动态（D3 摘要后的最近事项）；治理/人员/外部世界（按 D3 适用性显示）；“运行管理”折叠区（日历、额度、请求记录）。空日历不再占据英雄区，只在有已排定事件时在运行摘要中显示“下一事件”。writer、Participant、Activation 移入诊断。

**事项。** 列为“模拟时间 · 主体 → 对象 · 业务动作 · 三层结果”。三层结果按 D3 显示：提交（已提交/已受理/拒绝）、执行（待执行/裁判接受/裁判拒绝/未知）、业务结果（已达成/未达成/未知/不适用）。`committed + ok=false` 显示为“裁判拒绝”，不用成功色。投影器缺失时显示“该领域未提供业务摘要”，不显示“未知领域”。请求哈希移入展开行与详情的技术详情并可复制。状态轨道加图例；全空列隐藏。

**权限表达。** 统一 `DisclosedValue` 组件，区分 withheld（“当前身份无权查看；由部署的披露策略决定”）、not-applicable、unknown、unsupported、读取失败。撤权后已显示的受限内容立即清空。

**故障面板。** `FailureCard` 由 D2 字段驱动：类别、失败时间与关联 revision、`retryDisposition`、`actionCode`。固定回答“哪个环节失败、当前是否还在执行、已完成结果是否保留、建议下一步”。`actionCode` 映射到主操作；未识别的 `actionCode` 走文档化默认（只提供“查看详情”）。“重试”只在可重试时出现并绑定原请求身份。原始诊断只通过授权的 `failureId` 关联查看。

**额度与用量。** `BudgetPanel` 同时用于开始弹窗和运行管理：配置上限（单请求、区间）、已预留、已结算、未知；按 D5 类别（业务选择、调控者裁决、结果收尾、普通通信、压缩、无法归因）和 token 种类（input、output、cache read、cache write）展示；不显示费用推算；主机共享池单独标注为主机全局。

**创建与预检。** 新建世界弹窗展示已安装模板及 D6 预检结果：时钟支持、模型上下文容量、单请求额度、初始上下文大小、provider 版本、是否支持完整备份。超限显示维度、实际值与所需值；长期消耗标为“估计/未知”。

**恢复弹窗。** 三层：首层“恢复到第几天的哪个检查点、恢复后保持暂停、不回滚历史、不重复已完成的模型调用、检查点是否完整”；第二层覆盖范围与校验；第三层 checkpoint ID、writer/owner 术语与来源标识，可复制。

**导航与历史。** 模块路由 ID 不变：“引擎”标签改为“诊断”，“记录”提升为一级“历史”。诊断集合优先显示实体名，ID 作为次要信息，“决策 slot”改为“决策序号”。

**视觉、术语与无障碍。** 降低背景装饰强度，`prefers-reduced-motion` 与 `prefers-reduced-transparency` 下关闭；颜色只表达状态并配图标与文字；字号分正文、辅助、诊断三级，对比度实测；所有 `SimClock` 传本地化单位；去掉 `SIMULATION` 徽标；窄于 768px 时侧栏变抽屉、头部压成两行、表格改卡片行；详情标题焦点用下划线样式；分页显示位置。

### 前端结构

| 模块 | 职责 |
|---|---|
| `run-state.ts`（新） | 状态合成、新鲜度、主操作；从 `RunStatus` 与 `Controls` 中抽出 |
| `RunStateChip.tsx` / `RunStateBanner.tsx`（新） | 统一状态展示与停止进度 |
| `RunDetails.tsx`（由 `RunStatus` 改） | 诊断字段与各来源观测时间 |
| `RunHeader.tsx`（新） | 合并 `RunCommandBar`、头部状态与控制 |
| `RunControls.tsx`（由 `Controls` 改） | 主操作由 `RunState` 决定；开始弹窗含目标与 `BudgetPanel` |
| `StopTargetDialog.tsx`、`FailureCard.tsx`、`DomainSummary.tsx`、`DisclosedValue.tsx`、`BudgetPanel.tsx`（新） | 对应 D1/D2/D3/D5 |
| `DirectoryPage.tsx` / `RunPage.tsx`（新） | 从 `Workspace.tsx` 拆出 |
| `useRunReads.ts`（新） | 运行页读取、轮询、失效编排 |
| `Workspace.tsx` | 只做路由分派与弹窗挂载 |

Client runtime 的 [simulations service](../../../../packages/client/runtime/src/client/simulations/service.ts) 新增 `invalidateRun(runId)`，在管理、检查点、恢复和目标命令回执到达终态后失效该运行的控制、运行与目录行；批量失败时逐行标记“上次观测”；把来源观测时间交给组件。

### 对后端提案的补充需求

以下 UI 能力需要后端提案未覆盖的接口，本提案不实现，列为后续需求：

- 执行活动观测（角色、步骤、开始与最后有效进展时间），只来自生命周期事件。
- 业务时间线读取：按模拟日、主体、动作与结果筛选，按请求聚合并倒序分页；以及原始记录“跳到最近”。
- 领域投影器文案按请求语言返回（注册时声明 zh/en 文案目录）。
- 事项列表按模拟时间排序与筛选。
- 确认能否以“目标 = 当前已确认时间 + 保存策略”表达即时“暂停并保存”。

## Development plan

UI 工作包按后端依赖排序；无后端依赖的先做。每个工作包一个或多个独立 PR。

| 工作包 | 依赖 | 主要修改所有者 | 完成条件 |
|---|---|---|---|
| U0 结构拆分 | 无 | ui-simulation | 行为与快照不变，`Workspace.tsx` 只做分派 |
| U1 状态与新鲜度 | U0；首版用现有字段，W2/W6 落地后换源 | ui-simulation、client runtime | 目录与头部同一说法；陈旧明示；主操作唯一；刷新有结果 |
| U2 停止目标与暂停保存 | U1、W1 | ui-simulation、client runtime | 目标仅在回执后生效；停止过程与保存完整度可见 |
| U3 故障与不可用原因 | U1、W2、W6 第一阶段 | ui-simulation | 故障卡片四问可答；目录不可用原因本地化且逐行 |
| U4 领域摘要与结果分层 | U1、W3 | ui-simulation | 事项与概览使用三层结果与投影计数；不升权 |
| U5 额度与用量 | U1、W5 | ui-simulation | 预留、已结算、未知与类别分开展示 |
| U6 创建预检与读取超限 | W6 | ui-simulation | 预检维度与备份能力可见；超限时仍能暂停与保存 |
| U7 导航、恢复弹窗、视觉与无障碍 | U0 | ui-simulation、ui-primitives | 历史一级入口；恢复三层；窄屏与键盘可用 |

### U0：结构拆分

- [x] 从 `Workspace.tsx` 拆出 `DirectoryPage`、`RunPage`、`useRunReads`，不改变任何可见行为、读取次数和路由。
- [x] 现有组件测试与 `CLOCKY_SNAPSHOT=replay pnpm run test:web` 不变通过。

### U1：状态与新鲜度

- [x] 新增 `run-state.ts` 与派生表全覆盖单测，含 `reconciling`、`stale`、断线和观察不可用。
- [x] 新增 `RunStateChip`、`RunStateBanner`；目录与头部改用它们；`RunStatus` 首层移除。
- [x] 主操作由 `primaryAction` 决定：暂停时不渲染暂停，运行时不渲染继续；失败或阻塞时恢复成为主按钮。
- [x] Config 新增 `staleAfterMs`（经校验，默认由 `controlRefreshMs` 推出），更新 README。
- [x] `invalidateRun(runId)`：命令终态后失效对应控制、运行和目录行；返回目录时重读该行。
- [x] 批量状态失败时逐行显示“上次观测 · 当前状态未知”，列表头给出错误与重试。
- [x] 手动刷新显示已刷新、失败、超时三种结果，并保留选择、滚动和草稿。
- [x] 所有 `SimClock` 传本地化单位；去掉 `SIMULATION` 徽标。
- [x] 复现“暂停回执后返回目录”路径，记录批量读取错误码与字节数，结论写回本提案。

复现（2026-10-21，无密钥 company 世界，JSON 存储，约 1.6k 个原生修订）：暂停回执后返回目录时发出 `simulation.runs.statuses`，每批返回 200 OK，正文 3,934 字节（传输 4,234 字节），耗时 206–349 毫秒；列表行从第一帧起即与详情一致显示“已安全暂停”和相同模拟时间。因此报告中的矛盾并非小日志上的错误状态回复，而是进入详情前的旧批次结果被当作当前状态继续显示，而 10,242 条记录的河港日志因逐行完整观测，刷新批次变慢或失败。没有该运行时无法重新测得河港的错误码。目录现在把这种行显示为“当前状态未知 · 上次观测”（批量读取失败或回执后的 `invalidateRun`），读取成本仍需后端 W6 控制投影解决。

### U2：停止目标与暂停保存

- [x] 开始弹窗加入停止目标区：时钟由 provider 声明；模式默认 `drain-admitted` 并说明收尾预算；可选择不设目标；可选检查点策略。
- [x] 目标命令独立提交；回执为 `armed` 前不允许继续运行；`pending`、`outcome-unknown`、越界拒绝分别显示。
- [x] 头部显示目标 chip 与 D1 状态；触达目标后主操作为“修改目标”，普通继续被禁用并说明原因。
- [x] 停止进度由 `armed → draining → paused` 驱动；收尾预算耗尽时列出剩余责任。
- [x] 保存显示完整、部分（`external-state-required`）、失败；失败时提供沿用原保存身份的重试。
- [x] 不支持时钟映射的场景禁用目标输入并显示后端原因。
- [x] 组件测试覆盖 11→13 被拒的提示、目标触达后继续被禁用、断线后目标仍显示为已设置。

### U3：故障与不可用原因

- [x] `FailureCard` 由 D2 字段驱动；`actionCode` 映射有文档化默认；重试只在可重试时出现。
- [x] 目录与头部展示 D2/D6 安全不可用原因的本地化文案；英文原文只进技术详情。
- [x] 测试：402、429、网络、上下文、未知异常、保存失败；旧批次失败在新批次成功后不再显示；脱敏夹具中的 token、路径和私有正文不出现在 DOM。

### U4：领域摘要与结果分层

- [x] 事项列表改为模拟时间、主体、业务动作、三层结果；哈希进入技术详情。
- [x] 概览新增领域业务卡，渲染投影器指标、未完成责任和计数定义；`unsupported` 显示“未提供”。
- [x] 通用三卡片按适用性显示或折叠；人员卡移除技术绑定数。
- [x] `DisclosedValue` 替换分散的受限文案；撤权后清空。
- [x] 测试：`committed + ok=false` 显示裁判拒绝；未知结果不计入成功；跨角色与撤权不泄露。

### U5：额度与用量

- [x] `BudgetPanel` 用于开始弹窗与运行管理，按 D5 类别和 token 种类展示，未知用量不计为零，不显示费用推算。
- [x] 主机共享池与本运行额度分开标注。

### U6：创建预检与读取超限

- [x] 新建世界展示 D6 预检维度与备份能力；超限显示维度、实际值与所需值。
- [x] 详情读取超限时，头部状态与暂停、保存仍可用（依赖 W6 控制投影），详情区说明受限原因。

### U7：导航、恢复弹窗、视觉与无障碍

- [x] “引擎”标签改为“诊断”，“记录”提升为一级“历史”；路由 ID 不变。
- [x] 诊断集合优先显示实体名；“决策 slot”改为“决策序号”。
- [x] 恢复弹窗三层化，首层包含检查点完整度。
- [x] 空日历移出概览英雄区；全空列隐藏；状态轨道加图例；分页显示位置。
- [x] 窄屏侧栏抽屉、头部两行、表格卡片行；详情标题焦点样式。
- [x] 降低装饰强度，尊重 reduced-motion 与 reduced-transparency。

## Alternatives considered

**由后端返回合成好的运行状态。** 所有客户端可共享同一说法，但 D2 要求各来源独立表达并携带各自 revision，后端合成会在来源未同切面时伪装原子快照。合成留在展示层，并在来源不一致时显式显示“正在核对”。

**把合成函数放进 simulation-product 的共享模块供 SDK 复用。** 会把展示判断变成产品契约，SDK 消费者需要的是原始事实。只有出现第二个需要同一文案判断的 GUI 消费者时再评估。

**在浏览器中串联“暂停”与“保存检查点”。** 关闭浏览器即中断，且在两步之间没有服务端保证；D1 已定义检查点策略，合并操作应由后端表达。

**为每个领域写前端渲染插件。** 表现力更强，但需要把更多原始数据交给浏览器再裁剪，违背 D3 的读取前授权；新领域也需改前端。

**在前端根据修订变化推断“最后有效进展”和活动步骤。** 页面关闭期间无法得知，重新打开时会给出错误时间，也会把日志增长误当成业务进展。

**整体改名导航（事项→业务、引擎→诊断并新增业务时间线）。** 业务时间线需要后端尚未提供的读取；只改标签与层级即可解决记录入口被埋没的问题，路由不受影响。

**把结构拆分与行为修复放在同一个 PR。** 回归难以定位；先做零行为变化的拆分。

## Acceptance criteria

- [x] 同一暂停回执之后，目录与详情最终显示同一已确认状态；读取失败或断线时显示“当前状态未知”和上次观测时间，不显示为运行中。
- [x] 任意状态最多一个主按钮，且与 `run-state.ts` 派生表一致；已暂停时不出现暂停，运行中不出现继续。
- [x] 停止目标只在后端回执确认后显示为已生效；关闭浏览器后重新打开仍显示同一目标；触达目标后普通继续不可用。
- [x] 保存完整、部分、失败三者可区分；失败后重试不启动推理。
- [x] 故障卡片在不读原始日志的情况下回答四个问题；原始诊断不出现在普通 DOM。
- [x] 事项列表不打开详情即可区分业务动作与控制操作；`committed + ok=false` 不显示为成功；无投影器时显示“未提供”而非零或“未知领域”。
- [x] 无权限、撤权、未提供、不适用、未知、零值在 UI 上可区分，撤权后不残留受限内容。
- [x] 窄于 768px 可完成查看状态、暂停和打开事项；键盘可完成全部控制；reduced-motion 下无环境动效；对比度用实际取色测量。
- [ ] 每个 PR 按实际 diff 运行 [pre-push 检查](../../../skills/dsh-pre-push-checks/SKILL.md)：相关组件测试、`pnpm run typecheck`、`pnpm run lint`、`CLOCKY_SNAPSHOT=replay pnpm run test:web`；文档变更运行 `pnpm run doc-sync`。
- [ ] 产品可见的 GUI 变化在 PR 中附真实服务流程 GIF；更新 [ui-simulation README](../../../../packages/client/ui-simulation/README.zh.md) 双语与 Config 文档。
- [x] 实施时更新 [Web UI 重设计提案](2026-10-02-web-ui-redesign.zh.md) 阶段 6 中被本提案细化或替代的条目并互相链接。

## Risks

**后端字段晚于 UI 落地。** U1 先用现有字段，待 W2/W6 落地后换源；换源前目录的不可用原因仍较粗，`reconciling` 判断也只能依据现有 revision 与 observedAt。

**合成规则误判。** 展示层合成可能把边缘组合归入错误状态。派生表需全覆盖单测，未覆盖组合落入 `unknown` 而不是任何“正常”状态。

**默认 `drain-admitted` 被误解为立即停止。** 弹窗与头部必须显示收尾集合和预算；需要立即停止的用户可选 `at-boundary`。

**提升“历史”而不提供业务时间线。** 首版历史仍是原始记录视图，业务用户的定位成本只部分降低，直到后端提供时间线读取。

**新鲜度阈值误报。** 阈值过短会频繁显示“上次观测”。默认值由刷新间隔推出，并作为 Config 可调。
