# 蜂群与世界可视化层开发清单

本清单配合[开发计划](development-plan.md)使用，设计依据见[提案](../../notes/proposed/feature/2026-10-04-swarm-and-world-visual-layer.zh.md)。勾选一项时，在该项后补充证据：PR 链接、命令结果或截图/GIF 路径。不适用的项写明“不适用：原因”，不要直接删除。

## A. 开工前

- [x] 确认四项决定：深色优先评审；引入 `d3-force`；`ui-viz` 的 `stroke-dashoffset` 窄例外；新增读取 T1–T4 与 R1–R4（2026-10-04 用户指示按提案与计划开发，视为确认）
- [ ] 本地可用 `pnpm`，`pnpm install` 与 `pnpm run build` 成功（`pnpm install` 成功；`pnpm run build` 被工作区中他人未跟踪的 `apps/web/tests/browser-native-zoom.e2e.ts` 的 tsc 错误阻断，与本次改动无关；用 `.tmp/viz/build-tolerant.ts` 按相同步骤完成构建）
- [x] 使用项目内隔离数据目录与测试脚手架，未修改 `~/.clocky`（`CLOCKY_HOME=.tmp/ui-review-home`；可视化评审 gallery 在 `.tmp/viz/gallery`）
- [x] 阅读 [client AGENTS](../../../packages/client/AGENTS.md)、[web-styling.md](../../../docs/web-styling.zh.md)、提案对应章节与 2026-10-02 重构中被沿用的编码（已阅读，含重构 Phase 6 Simulation 编码）
- [ ] 在开发计划状态表中把工作包标为“进行中”，并记录起始提交

## B. 每个 PR 的完成定义

[2026-10-02 重构清单](../2026-10-02-web-ui-redesign/checklist.md)的 B 节（代码、样式、文案、测试、文档）全部适用。可视化 PR 另外满足：

- [ ] 可视化有包含相同条目的列表或表格视图，键盘遍历能到达每个节点
- [ ] 视图模型携带已加载/总数、陈旧、不可用标记，并按统一方式渲染
- [ ] 每种视觉编码对应一个具名领域状态，并有组件测试断言
- [ ] 只有 `observedLive` 为真的变化触发 L2/L3 动画
- [ ] 动画只作用于 `transform` 和 `opacity`（`ui-viz` 的 SVG 连线 `stroke-dashoffset` 除外）
- [ ] React 不逐帧渲染；隐藏或离屏时没有动画工作
- [ ] 模式身份 token 只用于外壳，不用于状态标记
- [ ] 视觉基线浅色/深色差异已评审
- [ ] 附从真实服务流程录制的 GIF；动效 PR 已用 `review-animations` 自查

## C. 工作包清单

### V0 基线与测量

- [ ] Team 概览夹具：多成员、多任务、子 Team、频道
- [ ] Simulation 概览夹具：驻留槽位、预算、多实体与决策
- [ ] 新夹具 × 浅色/深色 × 1440×900 与 390×844 基线，连续两次零差异
- [ ] `swarm.perf.ts`：150 节点 + 24 粒子，输出第 95 百分位帧时间
- [x] e2e 辅助函数：加载/刷新后无 L2/L3 动画；减少动效下无非不透明度动画；对故意加入的动画报错（`apps/web/tests/motion-tiers.ts` 的 `runningTransitionAnimations`/`nonOpacityAnimations`，`motion-tiers.spec.ts` 对故意加入的动画报错；浏览器实测 Team 概览加载后 0 个、实时变化中 8 个、稳定后 0 个；尚未接入 e2e 套件）

### V1 token 与动效层

- [x] 模式身份、光晕、玻璃材质、可视化、`hero`/`metric`、动效 token 的浅色与深色值（`ui-theme/src/styles/tokens.css`）
- [x] 循环动效 token 接入减少动效块（`orbit`/`flow`/`celebrate` 收为 `0.01ms`，`stagger-step` 收为 `0ms`）
- [x] 两种主题的对比度测试；Simulation 身份色与 `waiting` 的色相距离测试（`ui-theme/tests/tokens.client.spec.ts`，38 项通过）
- [x] `web-styling.md` 中英文版：动效四层、只对实时变化动画、`stroke-dashoffset` 窄例外（新增“动效层级”节与 token 类别）
- [x] 门禁：功能包中的 `stroke-dashoffset` 动画报错；状态选择器上的模式 token 报错；拒绝路径有测试（`scripts/verify-client-style-tokens.ts` 的 `structuralViolations`；spec 28 项通过；`pnpm run verify-client-style-tokens` ok）
- [x] `ui-theme` README 中英文版（README.md / README.zh.md 已更新）

### V2 `ui-viz` 包

- [x] 包注册：编译器聚合、Web 组合、resolver 依赖；`verify-client-packages` 通过（`tsconfig.client.json`、`PLATFORM_MODULES`/`seed.ts`、`apps/web` 与 `client-web` 依赖；`verify-client-packages` 39 个包通过）
- [x] README 中英文版（含 Model Experience 或豁免、Known Limitations）（`packages/client/ui-viz/README{,.zh}.md`；README 门禁与翻译配对通过）
- [x] `layoutLayered` 确定性与交叉减少测试（`ui-viz/tests/layout.client.spec.ts`）
- [x] `layoutRadialSwarm`：种子确定性、稳定即停、增量放置位移阈值测试（同上；已稳定节点位移 ≤ 0.5）
- [x] `layoutLanes`：超过 2^53 的十进制时间定位正确（`decimalTimeScale` BigInt 定位测试）
- [x] SVG 与 canvas 渲染的命中检测与焦点一致（`components.client.spec.tsx` 两种渲染器参数化断言）
- [x] 空间漫游焦点、无障碍描述、列表视图约定的 jsdom 测试（同上，30 项通过）
- [x] `Odometer`、`RadialProgress`、`Sparkline`、`PulseHalo`、`FlowParticles`、`AmbientBackdrop` 及其减少动效行为（`PulseHalo`/`FlowParticles` 并入 `GraphView` 的 `signals`；减少动效下粒子改为不透明度闪烁、背景静止、数字立即变化）
- [x] 性能测试达到 18 ms 第 95 百分位帧时间；包体积增量已记录（本地浏览器探针：150 节点 + 149 连线 + 24 并发粒子，5 秒 596 帧，p50 8.3 ms、p95 9.2 ms、最大 10.4 ms；`ui-viz` 自身 `lib/index.js` 73.6 KB / gzip 21.6 KB，`d3-force` 作为外部依赖另计；CI 版 `swarm.perf.ts` 仍待 V0-b）

### V3 外壳与模式身份

- [x] 分段模式切换器：键盘、`aria-current`、折叠 rail、滑动指示条（`ui-sidebar` `SidebarRoot`：两个及以上入口时成为分段控件，`useSlidingIndicator` 滑动指示条带当前模式光晕；折叠 rail 保持图标入口）
- [x] 未部署 Simulation 时保持单一入口（`:has(> button ~ button)` 才启用分段样式；web profile 浏览器实测仅显示“团队任务”）
- [x] 环境背景随模式变换；隐藏、离屏、减少动效时静止（`AppFrame` 每个工作区 stage 一个 `AmbientBackdrop`；`data-paused` 与减少动效 `animation: none`）
- [x] 模式卡片：实时缩略预览、最近的 Team/运行、中英文案（新增 `conversation.hero.modes` 列表 slot；`ui-team` `TeamModeCard`（最近 Team 状态环）、`ui-simulation` `ModeCard`（只读已加载目录，不新增请求）；浏览器实测 hero 显示）
- [ ] e2e：模式切换、浏览器后退恢复

### V4 Team 读取

- [ ] T1 成员当前活动：推送式、有界、无轮询
- [ ] T2 任务依赖分页
- [ ] T3 执行时间线：尝试区间与区间完成数
- [ ] T4 频道流量
- [ ] 每项：授权、`maxPageSize`/`maxBytes`、绑定版本游标、拒绝路径测试、Host 测试
- [ ] 每项：不新增会话事件、不改变模型可见输入；协议变化时 SDK 两侧更新
- [ ] 相关包 README 中英文版

### V5 Team 视图

- [x] 任务横幅：分阶段进度环、正在运行、耗时、token 数字滚动（`MissionBanner.tsx`；gallery 实测）
- [x] 吞吐曲线只在 T3 数据存在时显示（T3 未提供，横幅不渲染吞吐曲线）
- [x] 看板 FLIP 换列可被打断；计数滚动（`TaskBoard` FLIP（取消进行中的动画后重放）+ `Odometer`；只对 `useLiveChanges` 标记的卡片执行）
- [x] 动态流错峰进入、突发合并（`TeamActivity`：推送触发的读取才算实时，≤3 条错峰，>3 条合并为“N 条新动态”）
- [ ] Agent 舱：状态环、T1 当前活动、陈旧降亮（状态环与陈旧降亮已交付；T1 当前活动等待 V4）
- [x] 蜂群拓扑：参与者节点、子 Team 簇、归属/审核/频道连线、已加载/总数（`team-viz.ts` `buildSwarm` + `SwarmTopology.tsx`；`team-viz.client.spec.tsx` 断言幽灵、子团队簇、已加载/总数）
- [x] 消息粒子只在已打开实时读取的频道上飞行；粒子上限与“+N”合并（粒子只沿 `liveChannelId` 的 active 连线；`MAX_PARTICLES` 24 与“+N”合并在 `GraphView`；gallery 实测 7 个粒子）
- [ ] 任务流图：工作流计划、依赖邻域、幽灵节点、完整加载才显示关键路径（工作流计划、幽灵、完整加载才显示关键路径已交付并有测试；所选任务依赖邻域尚未接入）
- [ ] 任务流图：T2 后的全 Team 图
- [ ] Agent 泳道：尝试区间条、现在线；加速比只在 T3 覆盖整个窗口时显示（现在线与当前状态标记已交付；区间条与加速比等待 T3）
- [x] 视图切换（拓扑/流图/泳道/列表）写入视图 store 与 URL，刷新可恢复（`overviewViz` 写入 workspace store，`viz` URL 参数（`TEAM_ROUTE_KEYS`）并在恢复时回填）
- [x] 只读检查与 Simulation 托管的 Team 中没有可执行操作（可视化只提供打开成员/任务的导航，不暴露任何写操作）
- [ ] 1440×900 首屏断言；`team-*` e2e 通过

### V6 Simulation 读取

- [ ] R1 运行级关系分页
- [ ] R2 决策模拟时间范围筛选
- [ ] R3 操作摘要目标实体
- [ ] R4 区间聚合序列
- [ ] 每项满足 V4 的读取规则
- [ ] `simulation-workspace`、`simulation-reading-scale` 请求数断言不变
- [ ] R5 资源余额只记录为延期

### V7 Simulation 视图

- [x] 运行控制台：驱动器状态环只在观察到活跃时转动；预算仪表（`DriverRing` 仅在 `driverStatus === 'running'` 时转动，隐藏/离屏暂停；沿用 `BudgetMeter`；`visuals.client.spec.tsx`）
- [ ] 席位图四种状态；创建时的规模预览（`SeatMap` 已交付占用/等待释放/空闲三种；运行状态不报告“已预留”，不臆造；规模预览未做）
- [ ] 世界：实体星图、认知体发光、当前时刻决策涟漪、所选实体自我关系图（实体星图（按类别聚类）与认知体光晕已交付并有测试；决策涟漪与自我关系图未做）
- [ ] 世界：R1 后的全局关系图、节点上限、聚类、时间滑块、表格回退
- [ ] 时间线：实体泳道、决策标记、槽位堆叠、操作刻度、检查点竖线、现在游标（实体泳道、四种决策标记、同刻堆叠、现在游标已交付；操作刻度与检查点竖线未做）
- [ ] 时间线：`BigInt` 坐标、密集分桶、R2 前两端加载更多、R2 后连续滚动（`BigInt` 坐标已交付并测试（> 2^53）；加载更多沿用分页控件；密集分桶与 R2 未做）
- [ ] 时间线：R3 后的因果箭头线型（虚线已接受、实线已发布、实心箭头已回执）
- [x] 效果看板主泳道与侧泳道；“回执不等于业务接受”常驻；表格切换（`EffectsView` + `operationStage`；结果未知为琥珀斜纹；`simulationDisplay` URL 参数切换表格/可视化）
- [x] 检查点轨道三种状态，突出最近成功（`CheckpointRail`；测试断言只高亮最近成功）
- [ ] R4 后的脉搏行迷你曲线
- [ ] 1440×900 首屏断言；1000 实体流畅（记录帧率）
- [ ] `simulation-*` e2e 在 json 与 sqlite 下通过

### V8 里程碑时刻

- [x] `observedLive` 检测：首次加载、刷新、回放、导航一律静默（`ui-viz` `useLiveTransition`/`useLiveChanges`：身份首值与同游标重读都视为稳定；`components.client.spec.tsx` 覆盖）
- [x] 集结、收敛、停滞（集结：`SwarmTopology`（provisioning→active 实时）；收敛/停滞：`MissionBanner` 外的 `Moment`）
- [x] 点火、封存（点火：Simulation 运行控制台在实时观察到驱动器启动时；封存：`CheckpointRail` 实时完成/失败时（失败使用 failed 光晕））
- [x] 每个时刻不超过 1.2s、任意输入可跳过、刷新不重播（`Moment` 时长取 `min(1200, --clocky-duration-celebrate)`，pointerdown/keydown 直接 `finish()`；只在实时转换时递增 generation）
- [ ] 减少动效下只淡入淡出；e2e 断言（`Moment` 与 GraphView 在减少动效下只做不透明度；e2e 断言待 V0-c）

### V9 质量收尾与发布

- [ ] 全部视图性能测试达标；延迟加载评估结论
- [ ] 对比度测量表（浅色/深色）
- [ ] 键盘遍历、读屏描述、触控目标审计
- [ ] 窄屏（< 960、< 600）降级
- [ ] 各包 README 与 `web-styling.md` 中英文版
- [ ] note 移到 `implemented/`，职责表改为已交付状态

## D. 可视化诚实性检查（每个可视化 PR）

- [ ] 未加载的条目从不显示为不存在
- [ ] 不可用值显示为虚线空槽，从不显示为 0
- [ ] 陈旧观测降饱和并带陈旧标签
- [ ] 页外引用显示为幽灵节点
- [ ] 连线、实心节点或动画不暗示数据未断言的完成、送达或因果
- [ ] 加速比与吞吐从不估算
- [ ] Simulation 编码与 2026-10-02 重构的规定一致

## E. 动效检查（每个含动效的 PR）

- [ ] 动效属于且只属于一个层级，并标注 `data-motion-tier`
- [ ] 遵守该层级的时长与并发上限
- [ ] 可被打断，不阻塞指针或键盘操作
- [ ] 主题切换时不动画
- [ ] `needs-you` 只脉冲一次；运行指示在减少动效下静止

## F. 发布前

- [ ] `pnpm run typecheck`、`pnpm run lint`、相关 `pnpm run test`
- [ ] `CLOCKY_SNAPSHOT=replay pnpm run test:web`
- [ ] `pnpm run doc-sync`
- [ ] 所有 GUI PR 附 GIF
- [ ] 开发计划状态表全部为“已验收”或“延期”（附原因）
