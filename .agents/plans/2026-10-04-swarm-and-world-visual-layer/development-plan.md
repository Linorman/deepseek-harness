# 蜂群与世界可视化层开发计划

本计划落实 [蜂群与世界可视化层提案](../../notes/proposed/feature/2026-10-04-swarm-and-world-visual-layer.zh.md)。提案负责设计决定；本计划负责工作包、依赖、交付顺序、开发方法和验收方式；逐项勾选见 [checklist.md](checklist.md)。计划日期为 2026-10-04，规划基线为 `b6fd164589` 加上已完成的 [2026-10-02 Web UI 重构](../../notes/proposed/feature/2026-10-02-web-ui-redesign.zh.md)。文中新增的组件、文件和读取接口都是拟议名称，以落地 PR 为准。

## 当前实施状态

| 工作包 | 状态 | 已交付与剩余验收 |
|---|---|---|
| V0 基线与测量 | 进行中 | 动效探针与测试已交付（V0-c）；视觉基线夹具（V0-a）与 CI 性能测试（V0-b）待补 |
| V1 token 与动效层 | 待验收 | token、对比度/色相测试、门禁结构规则与文档已交付；待 PR 与视觉基线评审 |
| V2 `ui-viz` 包 | 待验收 | 包、布局、渲染器、交互、基础组件与测试已交付；本地探针 p95 9.2 ms；CI 性能测试待 V0-b |
| V3 外壳与模式身份 | 进行中 | 模式切换器、环境背景、模式卡片已交付；e2e 与 GIF 待补 |
| V4 Team 读取 T1–T4 | 未开始 | 需要 `core/team`、Host、SDK 协议与授权评审，本轮 UI 开发未涉及；依赖它的视图以有界回退形态交付 |
| V5 Team 视图 | 进行中 | 横幅、拓扑、流图（工作流计划）、泳道（当前状态）、看板 FLIP、动态流已交付；依赖邻域、T1/T2/T3 相关形态与 e2e 待补 |
| V6 Simulation 读取 R1–R4 | 未开始 | 需要 `simulation-product` 与 runtime 读取及授权评审，本轮 UI 开发未涉及；依赖它的视图以有界回退形态交付 |
| V7 Simulation 视图 | 进行中 | 运行控制台驱动器环、席位图、实体星图、决策时间线、效果看板、检查点轨道已交付（表格/可视化切换）；R1–R4 相关形态、涟漪、规模预览与 e2e 待补 |
| V8 里程碑时刻 | 进行中 | 五个时刻与实时检测已交付；e2e 断言待补 |
| V9 质量收尾与发布 | 未开始 | — |

状态取值：未开始、进行中、待验收、已验收、延期。只有本计划列出的退出条件全部满足、证据写入本表后，才能标记为“已验收”。

## 1. 交付层级

| 层级 | 必须包含 | 暂不包含 |
|---|---|---|
| M1 基础 | 新 token、动效层级规则与门禁例外、`ui-viz` 包与布局函数、性能与“加载后无动画”测量 | 任何页面变化 |
| M2 第一画面 | 模式切换器、模式卡片、环境背景、任务横幅、蜂群拓扑（基于现有读取）、看板 FLIP、动态流、Simulation 运行控制台与席位图 | 依赖新读取的视图 |
| M3 新读取与完整视图 | T1–T4、R1–R4 及其视图：任务流图、agent 泳道、吞吐曲线、加速比、世界关系图、连续时间线、效果看板、检查点轨道 | R5 资源余额 |
| M4 时刻与发布 | 五个里程碑时刻、性能与无障碍审计、文档、note 转为已实现 | — |

每个层级都必须可以单独发布：后一层尚未完成时，前一层不能留下半成品视图或断开的入口。

## 2. 已核对的基础与缺口

| 所有者 | 可复用 | 缺口 |
|---|---|---|
| [ui-theme](../../../packages/client/ui-theme/README.zh.md) `tokens.css` | 角色色、7 种状态、分类色、字体、间距、圆角、层级、动效与全局减少动效 | 没有模式身份、光晕、玻璃材质、可视化和大号数字 token |
| [ui-primitives](../../../packages/client/ui-primitives/README.zh.md) | `Avatar`、`StatusBadge`/`StatusGlyph`、`StateDot`、`FactValue`、`SimClock`、`Skeleton`、`HoverCard` | 没有图、泳道、数字滚动、进度环、迷你曲线 |
| [ui-team](../../../packages/client/ui-team/README.zh.md) | `TeamHeader` KPI 行、`TaskBoard`（每列 4 张）、`TeamOverview`、`TeamActivity`、`WorkflowWorkspace`（`blockedBy` 文字） | 任务摘要只有 `dependencyCount`；成员当前活动没有读模型 |
| [ui-simulation](../../../packages/client/ui-simulation/README.zh.md) | `RunStatus`、`RunOverview` 的 `BudgetMeter` 与 `SlotDots`、`CollectionWorkspace`、`ContextAndRelations` | 没有世界、时间线、效果视图与检查点轨道 |
| `core/team` 类型 | `TeamSnapshot.createdAt`、`TaskAttemptSnapshot` 的 `assignedAt`/`startedAt`/`settledAt`、`childTeamId`、`ownerId`/`reviewerId` | 没有不逐行读取就能拿到全 Team 尝试区间和依赖边的接口 |
| [simulation-product](../../../packages/simulation/simulation-product/README.zh.md) | 实体、决策（`time`/`slot`）、操作（发布/投递阶段）、检查点摘要；逐实体 `SimulationProductRelation` | 没有运行级关系、决策时间范围筛选、操作目标实体、区间聚合 |
| 门禁 | `verify-client-style-tokens`、`verify-client-packages`、视觉基线 `ui-baseline.snapshot.ts` | 门禁不允许 `stroke-dashoffset` 动画；没有可视化性能测试 |

开发前必须知道的环境事实：

- `.claude/launch.json` 中的 `clocky-web` 使用项目内的 `CLOCKY_HOME=.tmp/ui-review-home`，浏览器认证依赖 handoff。自动化验证使用 `apps/web/tests/scaffold.ts`，它通过真实的本地 product-principal provider 签发 cookie。
- `pnpm` 不在全局 PATH 中时，使用 `.tmp/tools/node_modules/.bin/pnpm`，并通过 `pnpm run` 调用脚本。
- 所有临时文件、数据目录、截图和 GIF 放在项目内被忽略的目录（`.tmp/`、`.artifacts/`）。

## 3. 工作包

规模为粗略估计：S ≈ 1–2 人日，M ≈ 3–5 人日，L ≈ 6–10 人日。PR 编号格式为 `Vx-y`，按原生 GitHub stack 组织。

### V0 基线与测量

| PR | 内容 | 规模 |
|---|---|---|
| V0-a | 视觉基线扩展：为 Team 概览（含多成员、多任务、子 Team）、Simulation 概览（含驻留槽位与预算）准备夹具，浅色/深色 × 1440×900 与 390×844 | M |
| V0-b | 性能测试骨架 `apps/web/tests/swarm.perf.ts`：注入 150 节点 + 24 粒子的视图模型，记录第 95 百分位帧时间与隐藏标签页下的动画工作量 | M |
| V0-c | e2e 辅助函数：断言加载/刷新后无运行中的 L2/L3 动画（`document.getAnimations()` 按 `data-motion-tier` 过滤）、减少动效下无非不透明度动画 | S |

退出条件：基线连续两次运行零差异；性能测试能在 CI 上输出数值；辅助函数对一个故意加入的入场动画报错。

### V1 token 与动效层

依赖：V0-c。

| PR | 内容 | 规模 |
|---|---|---|
| V1-a | `tokens.css` 新增模式身份、光晕、玻璃材质、可视化、`hero`/`metric` 字体与 `orbit`/`flow`/`celebrate`/`emphasized`/`stagger` 动效 token；循环 token 接入减少动效块 | M |
| V1-b | token 测试：两种主题下的对比度；Simulation 身份色与 `waiting` 状态色的色相距离 | S |
| V1-c | [web-styling.md](../../../docs/web-styling.zh.md) 中英文版增加动效四层规则、“只对实时变化动画”与 `ui-viz` 的 `stroke-dashoffset` 窄例外；`verify-client-style-tokens` 只为 `ui-viz` 放行，并新增“模式身份 token 不得用于状态选择器”的检查 | M |

退出条件：门禁对功能包中的 `stroke-dashoffset` 动画和状态标记上的模式 token 报错；`ui-theme` README 中英文版更新。

### V2 `ui-viz` 包

依赖：V1-a。

| PR | 内容 | 规模 |
|---|---|---|
| V2-a | 按 [adding a package](../../../docs/cookbook/adding-a-package.zh.md) 建立 `@clocky/clocky-client-ui-viz`：编译器聚合、Web 组合、resolver 依赖、README 中英文版；声明 `d3-force` | S |
| V2-b | 布局纯函数：`layoutLayered`（最长路径 + 重心排序）、`layoutRadialSwarm`（带种子 `d3-force`、稳定即停、增量放置）、`layoutLanes`（注入位置函数，支持 `BigInt` 时间）；确定性单测 | L |
| V2-c | 渲染器：SVG 与约 500 标记以上的 canvas，统一命中检测；视口平移缩放；隐藏或离屏时暂停 | L |
| V2-d | 交互：节点空间漫游焦点、无障碍描述构建器、列表视图约定（同一组条目）；jsdom 测试 | M |
| V2-e | 基础组件：`Odometer`、`RadialProgress`、`Sparkline`、`PulseHalo`、`FlowParticles`（WAAPI `translate` 采样关键帧）、`AmbientBackdrop` | M |

规则：组件只接收 props，不接触 Cordis 上下文和服务；导出只包含有消费方的组件，没有消费方的随第一个消费 PR 导出；动画状态只放在 ref 中，React 不逐帧渲染。

退出条件：布局函数对相同输入产生字节相同的坐标；新节点加入时已稳定节点位移不超过阈值；性能测试达到 18 ms 的第 95 百分位帧时间；包体积增量写入 PR 描述。

### V3 外壳与模式身份

依赖：V1、V2-e。

| PR | 内容 | 主要包 | 规模 |
|---|---|---|---|
| V3-a | 分段模式切换器：滑动指示条、键盘与 `aria-current`、折叠 rail 形态；只有一个工作区注册时保持单入口 | `ui-sidebar`、`ui-team`、`ui-simulation` | M |
| V3-b | 环境背景：随模式变换色调；隐藏、离屏、减少动效时静止 | `ui-layout`、`ui-viz` | S |
| V3-c | 启动器模式卡片：实时缩略预览与最近的 Team/运行；文案经 ux-copy 评审 | `ui-conversation`、`ui-team`、`ui-simulation` | M |

退出条件：未部署 Simulation 时外观与行为与现在一致；e2e 覆盖模式切换与浏览器后退；GIF。

### V4 Team 读取 T1–T4

依赖：无（可与 V1–V3 并行）。每项读取都在 `core/team` 提供者、Host、SDK 协议与 `client/runtime` 中落地，并遵循 R 系列读取规则：授权、`maxPageSize`/`maxBytes`、绑定版本的游标、拒绝路径测试、README 中英文版。

| PR | 读取 | 规模 |
|---|---|---|
| V4-a | T1 成员当前活动：推送式有界读模型，不轮询 | L |
| V4-b | T2 任务依赖分页：Team 内任务之间的依赖边 | M |
| V4-c | T3 执行时间线：每个参与者的尝试区间与按区间统计的完成数 | L |
| V4-d | T4 频道流量：每个频道按区间统计的消息数 | M |

退出条件：每项读取有 Host 测试、授权拒绝测试与字节上限测试；读取不产生会话事件，不改变模型可见输入；SDK 两侧更新（如协议变化）。

### V5 Team 视图

依赖：V2；V5-c 依赖 V4-a；V5-e 完整形态依赖 V4-b；V5-f 依赖 V4-c。

| PR | 内容 | 规模 |
|---|---|---|
| V5-a | 任务横幅：分阶段进度环、正在运行、耗时（`createdAt`）、token 数字滚动；吞吐曲线在 T3 前不显示 | M |
| V5-b | 看板 FLIP 换列与计数滚动；动态流错峰进入与突发合并 | M |
| V5-c | Agent 舱：状态环、T1 当前活动、陈旧降亮 | S |
| V5-d | 蜂群拓扑：参与者节点、子 Team 簇、归属/审核/频道连线、已加载/总数；已打开频道的消息粒子，其他日志推进只让节点脉冲；视图切换与列表视图写入视图 store 与 URL | L |
| V5-e | 任务流图：工作流计划、所选任务依赖邻域、幽灵节点、完整加载时的关键路径；T2 后支持全 Team 图 | L |
| V5-f | Agent 泳道：尝试区间条、现在线；加速比只在 T3 覆盖整个窗口时显示 | M |

退出条件：1440×900 首屏验收（横幅、拓扑、需要你处理条）；每个视图的编码与领域状态对应关系有组件测试；只读检查与 Simulation 托管的 Team 不出现任何可执行操作；`team-*` e2e 通过；GIF。

### V6 Simulation 读取 R1–R4

依赖：无（可与 V4 并行）。规则与 V4 相同，落在 `simulation-product` 与 `client/runtime`。

| PR | 读取 | 规模 |
|---|---|---|
| V6-a | R1 运行级关系分页（模拟时间、作用域） | L |
| V6-b | R2 决策模拟时间范围筛选 | M |
| V6-c | R3 操作摘要的目标实体 | M |
| V6-d | R4 按预算区间的聚合序列（决策、消息、已占用 token） | M |

退出条件：同 V4；`simulation-workspace` 与 `simulation-reading-scale` 的请求数断言不变；R5 只记录为延期。

### V7 Simulation 视图

依赖：V2；V7-c 完整形态依赖 V6-a；V7-d 连续滚动依赖 V6-b；V7-e 因果箭头依赖 V6-c；脉搏行依赖 V6-d。所有编码按 2026-10-02 重构的规定原样实现。

| PR | 内容 | 规模 |
|---|---|---|
| V7-a | 运行控制台：驱动器状态环（只在观察到活跃时转动）、点火序列入口、预算仪表 | M |
| V7-b | 席位图（活跃/已预留/等待释放/空闲）与创建时的规模预览 | S |
| V7-c | 世界：R1 前为实体星图（按类别聚合、认知体发光、当前时刻决策涟漪）与所选实体的自我关系图；R1 后为全局关系图、节点上限、按作用域/类别聚类、时间滑块 | L |
| V7-d | 时间线：实体泳道、决策状态标记、槽位堆叠、操作刻度、检查点竖线、现在游标；`BigInt` 坐标、密集分桶；R2 前两端显式加载更多 | L |
| V7-e | 效果看板：待处理 → 已应用/已拒绝 → 已发布 → 输入已持久化 → 已回执，已阻塞与结果未知侧泳道；“回执不等于业务接受”说明常驻；表格切换 | L |
| V7-f | 检查点轨道：进行中/失败（阶段与代码）/完成（`publishedAt`），突出最近成功 | M |

退出条件：1440×900 首屏验收（控制台、时钟、额度、席位图、世界）；1000 实体运行在世界、时间线、效果视图中流畅（记录帧率）；`simulation-*` e2e 在 json 与 sqlite 下通过；GIF。

### V8 里程碑时刻

依赖：V5、V7。

| PR | 内容 | 规模 |
|---|---|---|
| V8-a | 实时变化检测：从推送游标前进判断“实时观察到的转换”，首次加载、刷新、回放、导航一律静默 | M |
| V8-b | 集结、收敛、停滞（Team） | M |
| V8-c | 点火、封存（Simulation） | M |

退出条件：每个时刻不超过 1.2s、任意输入可跳过、刷新不重播、减少动效下只淡入淡出；e2e 用 V0-c 辅助函数断言；GIF。

### V9 质量收尾与发布

| PR | 内容 | 规模 |
|---|---|---|
| V9-a | 性能：全部视图在性能测试中达标；包体积与延迟加载评估 | M |
| V9-b | 无障碍：对比度测量表、键盘遍历、读屏描述、触控目标；窄屏（< 960、< 600）降级 | M |
| V9-c | 文档：各包 README 中英文版、`web-styling.md`；note 转为已实现并更新职责表 | S |

## 4. 依赖顺序

```text
V0 ─► V1 ─► V2 ─┬─► V3
                ├─► V5 ◄── V4 (T1–T4, parallel)
                └─► V7 ◄── V6 (R1–R4, parallel)
                     V5 + V7 ─► V8 ─► V9
```

V4 与 V6 改动 Host 与 SDK，可以在 V1 开始时并行推进。V5 与 V7 先交付不依赖新读取的部分，再在读取落地后补齐完整形态。

## 5. 开发方法

- **只对实时变化动画。** 视图模型携带 `observedLive` 标记：数据首次到达或因刷新、导航、回放到达时为假，由推送游标前进触发时为真。只有为真时才启动 L2/L3。
- **布局确定性。** 种子来自 Team 或运行 ID；已稳定节点的位置保存在注册的视图 store 中，避免切换模块后重排。
- **诚实标签。** 所有视图模型都携带 `loaded`、`total`、`stale`、`unavailable`，由 `ui-viz` 统一渲染为标签、幽灵节点、降饱和和虚线空槽。
- **测试分层。** 布局函数用单元测试；组件用 jsdom 断言可见行为、ARIA 和键盘；页面用 `apps/web/tests` e2e 与视觉基线；性能用 `swarm.perf.ts`。
- **证据。** 每个 GUI PR 用 `record-browser-gif` 技能从真实服务流程录制 GIF；动效 PR 使用 `review-animations` 技能自查。

## 6. 验证命令

```sh
pnpm run typecheck
pnpm run lint
pnpm run test -- packages/client/ui-viz
pnpm run verify-client-style-tokens
pnpm run verify-client-packages
CLOCKY_SNAPSHOT=replay pnpm run test:web
pnpm run doc-sync
```

按 [dsh-pre-push-checks](../../skills/dsh-pre-push-checks/SKILL.md) 为每个 PR 选择最小充分的检查集。

## 7. 风险对策

| 风险 | 对策 |
|---|---|
| 视觉夸大 | 编码对应关系测试；已加载/总数标签；完整加载前不显示关键路径和加速比 |
| 动效疲劳 | 层级上限；只对实时变化动画；L0 每屏一个 |
| 包体积 | V2-a 记录基线；V9-a 评估延迟加载 |
| 布局抖动 | 带种子布局、保存稳定位置、增量放置、位移阈值测试 |
| 新读取的授权面 | V4、V6 每项读取独立 PR、独立授权评审与拒绝测试 |
| 浅色被忽视 | 视觉基线对每个新视图采集两种主题 |

## 8. 交接记录

| 日期 | 工作包 | 分支 | 提交状态 | 已跑检查 | 已知问题与下一步 |
|---|---|---|---|---|---|
| 2026-10-04 | — | — | 计划与提案已创建，未提交 | 文档门禁 | 待确认后从 V0 开始 |
| 2026-10-04 | V1、V2、V3、V5、V7、V8（UI 部分）、V0-c | master 工作区（未提交） | 未提交 | 相关包 `tsc -b`、oxlint、`vitest`（client 触及包全部通过）、`verify-client-style-tokens`、`verify-client-packages`、`constraints`、README/翻译配对/链接/预算/JSDoc 门禁 | V4/V6 读取、V0-a 基线、CI 性能测试、e2e 与 GIF、依赖邻域、Simulation 涟漪/规模预览待做；本地评审用 `.tmp/viz/gallery`（launch: `viz-gallery`） |
| 2026-10-04 | 布局与动效打磨（V5/V7/V3 补充） | master 工作区（未提交） | 未提交 | client 全部 `vitest`、oxlint、`verify-client-style-tokens`；浏览器探针：加载后无 L2/L3，仅 L0/L1 运行 | Team 概览改为“可视化 + 关注栏 / 看板 + 成员”两列；图节点悬停/键盘聚焦邻域高亮、缩放按钮视口滑动、运行中连线流动（L1）；运行卡片扫光（L1）；卡片/模式卡/轨道悬停与按压反馈；视图切换淡入（仅用户切换后） |
