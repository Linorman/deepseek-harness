# 世界模拟 Web UI 第二轮：布局重构、组件、动效与留白背景

日期：2026-10-16。[UI 设计](ui-design.md)定义的 U01–U15 已全部交付并勾选（见 [checklist](checklist.md) U 组），本文不重开那些契约。本文以**当前已发布的界面**为起点，处理“功能都在、但读起来累、首屏看不到世界”的问题：布局重构、组件设计、动效编排，以及留白区域的背景动效。

文中组件名、token、配置项和 DTO 字段都是**拟议**。凡与 [DESIGN.md](../../../DESIGN.md)、[UX-CONTRACT.md](../../../UX-CONTRACT.md)、[可视化层提案](../../notes/proposed/feature/2026-10-04-swarm-and-world-visual-layer.md)现行规则不同之处，§11 逐条列出，必须先改 owner 文档再实施，不能在功能 CSS 里先行。验收项 V01–V24 在 §13，**不计入**原 checklist 的 112 项分母。

## 1 现状诊断

依据：本地 `clocky-web-world` 实测（1440×900 深色），以及 U05/U07/U10/U14 浏览器证据截图（`.local/world-completion/u14-product/browser/*/governance.png`、`person-tenures.png`、`external-history.png`、`restored-paused.png`，`u10-actionable/browser/*/handoff-obligations.png`、`original-case.png`，`c32-v1-authoring/*/01-preview-dark-1440.png`）。

| # | 问题 | 观察 | 影响 |
|---|---|---|---|
| D1 | 运行头吃掉首屏 | 1440×1000 下依次是返回、徽标、标题、模拟横幅、状态事实行、“运行详情”折叠、继续/暂停、“维护与输入”折叠、模块 tab；模块内容从 y≈390 开始（39%）。390 宽时案件详情从 y≈690 开始（69%），且维护按钮全部展开 | 世界本身被挤到首屏以下；切模块时头部不变却每次都要越过 |
| D2 | 模拟声明重复且语义色错位 | “外部世界全部为模拟”横幅在每个世界模块顶部占一整行，使用 teal tint，视觉上像“成功”提示 | 噪音；用户逐渐对横幅失明，反而削弱真正需要声明的外部模块 |
| D3 | 整页滚动，检查器跟着跑 | 表格、检查器和运行头在同一个滚动容器；检查器长内容（来源链接、义务 JSON）把页面拉长，表格下方留下大片空白 | 选中行后向下读检查器，表格和模块 tab 一起滚走；空白区既不安静也不承载任何东西 |
| D4 | 机器值直出 | 提案标题显示 `governance-pro…8f2886`；人员次行显示 `world-person:dc25…`；外部表“最近交互”单元格是 `10 contact:committed; reply-post:applied; …`；来源列表是一串等宽原始 ID；义务卡内联原始 JSON | 可读性差；看起来像调试面板而不是产品 |
| D5 | 窄列与重复未知 | “认知”列宽度不足导致“智能/体”逐字断行；“待处理义务”“驻留”整列都是“未知”/“驻留状态未知” | 列宽浪费在无信息的重复值上，真正有差异的列被挤压 |
| D6 | 可视化越界 | 制度检查器中 `VoteTally` 的“▲quorum · 通过线”标签越出检查器右缘；electorate 格在 360px 内两列很挤 | 视觉破损，破坏“精确”的品牌承诺 |
| D7 | 作者台断点按视口而非容器 | 1440 视口减去 224 侧栏后内容宽 1216 < 1280，分节栏退化为横向 tab 并在右侧截断（“Eve…”）；预览列把有效额度键名 `native.maxQueuedDecisions` 断成两行 | 宽屏上反而用了窄屏布局；预览像原始 dump |
| D8 | 运维弹窗无层次 | “验证并恢复运行”把检查点 ID、时间、版本、来源、四个长 ID 平铺为 `dt/dd`，ID 换行三次；主按钮视觉上弱于取消 | 高风险操作缺少“对什么、会发生什么、不会发生什么”的结构 |
| D9 | 概览同权平铺 | 时钟卡只有“18 minute / 没有已排定事件”；人员 6 个数字同字号；事项流是一整条绿色 | 首屏没有焦点；“世界在什么状态”需要逐卡阅读 |
| D10 | 动效只在边角 | 现有：检查器滑入、L3 moments、目录卡 pointer light、模块 view-transition。L0 背景是静态点阵 + 两团模糊光，在大面积留白处显得“空”；行 → 检查器没有空间连续性 | 世界“在运转”的感觉只来自文字；留白区没有被设计 |

已经做得好的、本轮保持不动：五态 `FactValue`、四轨 `StatusTrack`、`[from, until)` 区间、覆盖说明、原命令记录、L3 只播 live 观测、减少动效降级、URL 只含不透明 ID。

## 2 设计目标

1. **首屏是世界，不是控制台。** 1440×900 下运行头 ≤ 112px 展开、滚动后 ≤ 56px；模块内容从 y ≤ 160 开始。390 宽时从 y ≤ 200 开始。
2. **人读名称优先，机器身份可得。** 任何对象先显示服务端提供的显示名，ID 退为可复制的短芯片；原始 JSON 收进“原始数据”。
3. **区域各自滚动。** 运行头、模块 tab、表格、检查器分别拥有滚动或粘性，读检查器不会丢失表格位置。
4. **留白是“世界气候”，不是装饰。** 背景动效只在留白区域可见、低于阅读对比度、可暂停，且它唯一的“节拍”来自真实观测（§7）。
5. **动效讲因果。** 每个 L2 都回答“这个东西从哪里来、变成了什么”；不新增“看起来很忙”的循环。
6. **不越权、不臆造。** 延续 [ui-design §2](ui-design.md#2-设计原则)全部原则；新增可视化全部有等价表格。

## 3 运行外壳重构

### 3.1 紧凑运行头 `RunCommandBar`

把现有六行头部压成两条粘性带：

```text
展开态（页面顶部，112px）
┌─────────────────────────────────────────────────────────────────────────────────────┐
│ ← 运行   SIMULATION  ◎ 模拟世界                                         [⟳] [⋯]       │
│ Product company sqlite                       ⏸ 已暂停 · ◯ 空闲 · ⧗ 18 minute · ● 已连接  [▶ 继续调度] │
├─────────────────────────────────────────────────────────────────────────────────────┤
│ 概览   事项   组织   制度   外部世界   │ 引擎 ▾                已全部加载 · 修订 1614 · 时点 18 │
└─────────────────────────────────────────────────────────────────────────────────────┘

收起态（滚动 > 48px 后，56px + 44px）
┌ ← Product company sqlite  ⏸ 已暂停 · ⧗ 18 minute · ● 已连接          [▶ 继续调度] [⋯] ┐
│ 概览   事项   组织   制度   外部世界   │ 引擎 ▾                                          │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

- **标题行**：返回、模式徽标、`SimulatedChip`（§5.3）、刷新图标按钮、溢出菜单 `⋯`。
- **状态胶囊 `StatusCapsule`**：把调度状态、驱动、模拟时间、已受理工作、连接合成一个分段胶囊。每段仍是 `FactValue` + 文字，段间用 `·`。“已受理工作：当前未观察到在途工作”这类长句缩为短标签“无在途工作”，完整句进 `Tooltip` 与 `aria-describedby`。
- **主动作**：只保留一个当前最可能的主按钮（暂停时“继续调度”，运行时“暂停调度”），另一个进入 `⋯`。按钮可用性仍来自 Host control hints，busy 保持几何。
- **`⋯` 菜单**：运行详情（打开 `Sheet`，内容为现有“运行详情”）、维护与输入（打开现有 `MaintenanceDialog` 的各入口：刷新控制状态、创建检查点、验证并恢复、输入事件、对账并完成准备）、导出定义（JSON/YAML）、背景动效开关（§7.6）、复制运行 ID。不可用项保留并显示原因（例如“此运行已有执行历史，不能按未启动运行重新准备”作为该菜单项的描述行）。
- **模块 tab 行**右侧放覆盖与修订说明（现 `navStatus`），从各模块正文顶部移上来，节省一行。
- **收起**：滚动超过 48px 时标题行收起，名称并入状态行左侧。实现用 `IntersectionObserver` 观察 48px 哨兵并切换 `data-condensed`，用 `grid-template-rows` 过渡（`--clocky-duration-base` / `--clocky-ease-standard`）；**不使用**滚动驱动的连续动画，避免把滚动位置变成高频重排。减少动效下直接切换。

**R1 实际交付（2026-10-16）与上文的差异**：身份行（返回、名称、模式、模拟世界标记、刷新）不粘性，自然滚走；粘性命令带 = 状态胶囊 + 运行详情弹层 + 开始/暂停 + ⋯ 维护弹层 + 模块行。`IntersectionObserver` 观察身份行本身，离开滚动容器时命令带切换 `data-condensed`（不透明底 + 名称淡入），因此没有高度变化，也就没有内容跳动或阈值抖动。开始与暂停**都保持可见**（Host 允许的那个为主按钮），避免阶段切换时控件在命令带与菜单之间移动；运行详情是独立的只读弹层，⋯ 只放操作。两个弹层都是原生 `<details>`，外部按下或 Escape 关闭；< 540px 时命令带不粘性、弹层为底部面板。导出定义与背景动效开关仍在原处，分别留给 R4/R7。1440×1000 下模块内容起点约 y≈180（原 ≈390），390 宽约 y≈330（原 ≈690）。
- 视图过渡名 `clocky-run:<id>` 从整块头部移到“名称”元素，目录卡 → 运行头的 morph 只作用于名称和 sigil，几何更稳定。

### 3.2 工作舞台 `WorkspaceStage`

模块正文改为固定高度的网格，三个区域各自滚动：

```text
┌ RunCommandBar（sticky） ─────────────────────────────────────────────────────────────┐
├ 模块工具条：视角 · 查看时点 · 筛选 · 密度 ──────────────────────────────── 覆盖说明 ──┤
├──────────────────────────────────────────────────────────┬──────────────────────────┤
│ 集合区（自身滚动）                                          ┆ 检查器坞（自身滚动）       │
│  表格 / 时线 / 图                                          ┆  标题 + 分区 tab 粘性      │
│  ……                                                       ┆  分区内容                  │
│ ░░░░░░░░ 留白场（AmbientField，表格结束后的剩余高度）░░░░░░░ ┆                          │
└──────────────────────────────────────────────────────────┴──────────────────────────┘
```

- `display: grid; grid-template-columns: minmax(0, 1fr) var(--inspector); block-size: calc(100dvh - var(--run-header-block))`。集合区与检查器各自 `overflow: auto` 并 `overscroll-behavior: contain`。
- 现有 `.moduleBody`、`.inspector` 的宽度与拖拽规则不变（360px，≥1440 容器可拖到 520px）；拖拽手柄改为全高 8px 命中区 + 中段 2×24px 握把，悬停时握把显示。
- 检查器标题与分区 tab 在检查器内 `position: sticky`；“关闭”从文字改为图标按钮（保留可见文本标签于 `aria-label` 与 Tooltip）。
- 未选择对象时检查器坞**不渲染空栏**，集合区占满；选中时坞从右侧进入（§6.2）。这一点与现行一致，只是空白不再被检查器占位。
- 表格行数少时，集合区剩余高度就是 §7 的留白场；行数多时留白场自然被滚出视口，不与内容竞争。
- 现有 `data-nav-status` 的读失败/陈旧提示移到模块工具条右侧，不再在正文顶部插入横幅，避免内容跳动。

**R2 实际交付（2026-10-16）与上文的差异**：集合区不另设滚动容器，沿用页面滚动；检查器坞 `position: sticky`，顶部偏移取命令带发布的 `--run-band-block`，最大高度为视口减命令带，自身滚动并 `overscroll-behavior: contain`，坞头（标题、操作、分区 tab）在坞内粘性。这样表格下方的留白仍属页面，留给 R7 的环境场。< 880px 时坞与集合放在同一网格单元、右对齐覆盖（`min(85cqi, 560px)`，抬升表面 + elevation-3），< 540px 占满宽度；集合不再被隐藏。三个领域模块用 `WorkspaceStage`/`InspectorDock`；事项与引擎集合的 `.body > .inspector` 以同样的 CSS 规则获得粘性坞与覆盖层，但未换组件。M2 的“行标题 morph 到检查器标题”未实现：共享的 `navigateWithTransition` 在任意指针移动时即退役原生过渡，且全局时长固定为 `instant`，morph 实际不可见；改为坞从边缘进入、正文晚一个 `stagger-step`。M3 用 WAAPI 在同一对象内按分区顺序 ±4px 缓入，不重挂载正文；M4 在关闭前播放 `fast` 退出，再提交导航，新选择会取消待提交的关闭，减少动效下立即关闭。

### 3.3 断点改为容器查询

所有世界模块与作者台以**工作区容器宽度**（`container-type: inline-size`）判断，而不是视口：

| 容器宽度 | 运行工作区 | 作者台 |
|---|---|---|
| ≥ 1180px | 集合 + 检查器坞并列；概览 12 栏网格 | 纵向分节栏 200px + 编辑区 + 检查列 |
| 880–1179px | 并列，检查器 320px | 纵向分节栏收为 48px 图标轨（悬停/聚焦展开标签）+ 编辑区 + 检查列 |
| 540–879px | 选中后检查器以 `Sheet` 覆盖右侧 85%，带返回；概览 6 栏 | 编辑区单栏；检查列变底部抽屉，抽屉把手显示诊断计数 |
| < 540px | 模块经共享 `Menu`；表格转卡片列表；检查器全屏 `Sheet` | 同上；表格编辑器转行卡片 |

这样 1440 视口（容器 1216）回到纵向分节栏，修复 D7。880 以下检查器改为覆盖层，是对 DESIGN“选中详情替换集合”规则的变更（§11）：覆盖层保留集合可见的上下文，并且关闭后滚动位置不丢。

## 4 各模块布局

### 4.1 概览：从“六张同权卡”到“一屏世界”

```text
┌ 世界仪表 WorldDial ─────────────────────────────────────────────────────────────────┐
│   ⧗ 1,240 minute                    ○───●─────────◆───────◆──────▸                 │
│   模拟时间 · 修订 382                 now   1,300 周例会   1,400 提案截止              │
│   ⏸ 已暂停  驱动 ◯ 空闲                                                      ◎ 等时线 │
├ 需要你 ──────────────────────────────────────────────────────────────────────────────┤
│ ⚠ 交接未清 1    ◌ 结果未知 2    ⏸ 退休未确认 1                      全部 0 时收为一行   │
├──────────────────────────────┬────────────────────────────┬────────────────────────┤
│ 制度                          │ 组织与人员                   │ 外部世界                │
│ 「招聘需委员会批准」           │ 在职 12 · 非终止人物 15       │ 身份 6                  │
│ ███▒▒░  2/1/0 · 未投 2        │ 驻留 8/10  ▮▮▮▮▮▮▮▮▯▯        │ 独立代表 ▮▮ 2           │
│ 现行制度 4 · 已可知未生效 1    │ 未释放 writer 1              │ 规则模拟 ▮▮▮ 3          │
│                    查看全部 → │ 历史 Participant 19 · Activation 43 │ 调控者裁决 ▮ 1      │
├──────────────────────────────┴────────────────────────────┴────────────────────────┤
│ 事项流  已记录 2 │ 等待交付 1 │ 待补证 1 │ 规划中 1 │ 已解决 14 │ 已取消 1   查看全部 → │
├────────────────────────────────────────────────────────────────────────────────────┤
│ 本页观察到的变化（WorldPulse）                                                       │
│  1,240  制度「招聘需委员会批准」已生效        seal                                   │
│  1,238  Lin 调岗：Personnel → Leadership      已提交                                 │
└────────────────────────────────────────────────────────────────────────────────────┘
```

- **世界仪表 `WorldDial`** 合并原“时钟与日历”卡并升为横幅：`SimClock` 用 `--clocky-type-metric`，右侧是放大的静态时间轴（只画服务端已排定的有限事件，最多 5 个刻度，菱形 = 事件，圆点 = now）。时间轴不随墙钟移动；新观测到达时 now 点以 spring 跳到新位置（L2），这是现有“时间只随观测跳变”的直接可视化。仪表背后是 §7.3 的等时线。
- **人员卡**按语义分三组，组内并列、组间留 12px：在职/非终止（主数字）、驻留/上限 + 未释放 writer（座位条 `SeatStrip`，`resident` 实心、`limit-resident` 空心，`unreleasedWriters` 以斜纹叠加在实心之上并有图例）、历史 Participant/Activation（次级字号）。六个数字和各自的定义 Tooltip 保持不变，不合并成“人数”。
- **外部卡**把三种来源计数画成水平条，条长按本卡最大值归一（不是占比），每条后跟精确数字。
- **事项流**改为分段胶囊：每段宽度按计数比例、最小 44px（可点击目标），段内显示状态名与数字；配色用 `--clocky-status-*` 对应语义而不是统一绿色。0 计数的段隐藏但在图例中保留“0”。
- **`WorldPulse`** 是新增的“本页打开后观察到的变化”列表：仅收集 `useLiveChanges`/`useLiveTransition` 判定为 live 的观测，标题写明范围；刷新页面后为空并显示“打开此页后尚未观察到变化”。它不是事件历史，历史仍在“记录”模块。最多保留 20 条，溢出合并为“另有 N 条”。
- 网格：≥1180 为 3 列；880–1179 为 2 列（制度/组织一行，外部与事项流一行）；以下单列。卡片保持“同一表面的分区”：12px 圆角、1px 分隔、无阴影。

### 4.2 事项

- 表格首列显示事项**显示名**（Host `summary` 字段；缺失时为“{领域徽章} {操作名}”），业务事项键退为次行 `IdChip`。
- 四轨 `StatusTrack` 的 compact 形态从 4 个小点改为 4 段 6px 高的“轨条”，每段内用形状区分（实心/半实心/空心/⨯/?/⏸），段下方 micro 字号写轨名首字（请/计/执/通），与完整形态保持同一编码。
- 新增“看板”视角（`ViewSwitch`：表格 | 看板）：按**请求状态**分列（已记录、等待交付、待补证、规划中、已解决、已取消），每列显示服务端计数与本页已加载卡片，“已加载 8 / 共 14”写在列头。卡片在 live 观测到状态变化时用 FLIP 移列（L2）。看板只是同一有界窗口的另一种排列，不额外读取。
- 检查器顶部的完整四轨保持；点击一轨滚动到对应分区并让分区标题做一次背景高亮淡出。

### 4.3 组织

- **结构视角**：左侧树表 40%，右侧 `GraphView` 60% 并占满集合区高度（不再只有 360px 高）。图下方叠一条玻璃材质（`--clocky-surface-glass`）的缩放/适配/图例浮条，这正是 DESIGN 允许玻璃材质的唯一场景（浮在可视化画布上）。选中树行时图中对应节点获得 `--clocky-viz-node-ring` 外环并平移到可视中心（L2，`--clocky-duration-slow`）。
- **任职时线视角**：时线全宽，检查器默认以覆盖层出现（时线需要横向空间）；泳道左侧人物列粘性。开放区间右端渐隐 + “至今”保持；调岗菱形新增 hover 连线到 requested 刻度。
- **人员视角**：列重排为 名称（显示名 + 岗位 `IdChip`）、当前岗位、任职状态、认知、驻留、待处理义务。“认知/驻留/义务”三列在整页值相同时折叠为表头上方的一条摘要（例如“全部 6 人：认知 智能体 · 驻留 状态未知 · 义务 未知”），列本身隐藏；只有出现差异时才展开为列。这是基于**当前已加载窗口**的展示折叠，摘要写明“本页”，不推断全量。列宽最小值改为 `max-content` 防止 CJK 逐字断行（修 D5）。
- 人物检查器“义务”分区：每条义务卡显示人读标题（类型 + 对象显示名）、责任 owner 徽章、可用处置按钮；原始 owner 状态与 JSON 收进卡内“原始数据”折叠，默认关闭，等宽字体、最大高度 240px 自身滚动。

### 4.4 制度

- 提案表首列用 Host 的提案标题字段；当前标题缺失时显示“{委员会} 提案 · {短 hash}”而不是截断 ID（需 DTO 确认，§12）。
- 检查器顶部新增 **席位弧 `ElectorateArc`**：冻结 electorate 的每位成员是一枚座位，排成半圆弧（议会图）。座位形状编码票：实心圆 = 赞成、实心方 = 反对、菱形 = 弃权、空心圆 = 未投；颜色只是辅助。弧下方是修正后的 `VoteTally`，再下方是原 `ElectorateGrid`（作为等价列表，默认折叠为“成员与决策链接”）。≤ 3 人时退化为一行座位，> 40 人时退化为 `VoteTally` + 表格。
- `VoteTally` 刻度标签改为“碰撞避让”：quorum 与通过线标签放在条上方与下方两条独立轨道，超出右缘时向左翻转锚点；容器宽 < 280px 时标签收进图例行。修 D6。
- 现行制度与历史：每个制度版本卡左侧加 `EnforcementBadge` 色条（validated 实心、advisory 描边），四时间 `TemporalFacts` 改为一条迷你时间轴：可知三角、生效区间、通知点同轴排布，文字列表保留在下方。

### 4.5 外部世界

- 模拟声明在这里保持**常驻全文**（DESIGN 要求），但从横幅改为模块工具条左侧的说明行，配 `SourceKindBadge` 图例；其他模块只在运行头显示 `SimulatedChip`。
- 身份表改为“身份卡网格 / 表格”可切换。卡片：显示名、来源徽章、代表 generation、最近一次交互的**结构化结果芯片**、外部 key `IdChip`。
- 交互记录在检查器内是竖向时间线：每条左侧时间、来源图标，正文是“请求方 → 结果芯片组”，依据（policyRef）作为次行；“无权查看此内容”保持锁形占位。
- 结果芯片依赖 Host 发布结构化结果数组（例如 `[{step: 'contact', state: 'committed'}, …]`）。当前单元格里分号拼接的字符串**不在前端解析**（违反“UI 不从文本推断业务状态”），DTO 未提供前维持原文本但放进单行省略 + Tooltip。

### 4.6 作者台

- 分节栏（纵向）每项：状态圆点 + 名称 + 诊断计数；底部固定“检查定义”快捷说明（`⌘↵`）。滚动高亮保持 IntersectionObserver。
- **分节标题粘性**：编辑区每节标题 `position: sticky; top: 0`，带半透明底，长表格滚动时始终知道在哪一节。
- 空表格：去掉“组织单位：暂无”+“＋ 添加行”的两行重复，改为表格内的一条虚线空行“还没有组织单位 · ＋ 添加第一行”，点击即新增并进入编辑。
- 检查列上半“诊断”保持；下半“预览”顶部新增**定义体检卡**：6 个小统计格（人物、岗位、委员会、制度、外部身份、事件），每格数字 + 名称；validated 与 advisory 计数并排。下面才是可折叠分组。有效额度表改为两列网格，键名用 `overflow-wrap: anywhere` 且字号 caption，值右对齐 tabular，来源（安装默认/定义覆盖）用 micro 徽章。
- **草稿结构缩略图**：检查列底部可展开“结构草图”，用 `layoutLayered` 渲染草稿中的组织单位/岗位（仅草稿本地符号），标题写明“草稿结构，未经检查”；有诊断的节点显示 ⚠ 并可点击定位。不调用 Host、不推断运行事实。
- 创建锁定后，整台编辑区覆盖一层 4% 中性遮罩 + 顶栏锁形“已提交原件”，主按钮变为“打开运行”。

### 4.7 运维与确认弹窗

以“验证并恢复运行”为样板，所有维护/确认弹窗采用三段结构：

```text
┌ 验证并恢复运行 ──────────────────────────────────────────── ✕ ┐
│ 对象   Product company sqlite                                   │
│        检查点 ⓘ product-checkpoint/5f75…0741 ⧉   模拟时间 18      │
│        检查点版本 1619 → 当前持久版本 1620                       │
├────────────────────────────────────────────────────────────────┤
│ 会发生  ✓ 验证检查点与当前保留后缀                                │
│         ✓ 退休旧 writer 并回到暂停 owner                          │
│ 不会发生 ✕ 不回滚历史  ✕ 不重放已完成模型请求                      │
├────────────────────────────────────────────────────────────────┤
│ 待验证来源  Run 1 · Team 1 · Channel 8 · Session 6   [展开 ID]    │
├────────────────────────────────────────────────────────────────┤
│                          [关闭并保留输入]   [验证并恢复运行]       │
└────────────────────────────────────────────────────────────────┘
```

“会发生/不会发生”文案来自现有 locale 句子拆分，不新增语义；长 ID 一律 `IdChip`；来源 ID 默认折叠为计数摘要。主按钮视觉权重高于次按钮，危险操作沿用 `RiskConfirmation`。

## 5 组件设计

### 5.1 新增与改造清单

| 组件 | 位置 | 职责 | 关键 props | 状态 / 变体 |
|---|---|---|---|---|
| `RunCommandBar` | ui-simulation | 两段式粘性运行头 | `run`、`control`、`condensed`、`actions` | 展开、收起、断连（主按钮禁用并说明） |
| `StatusCapsule` | ui-simulation | 分段状态事实 | `segments: {id, fact, label, hint}[]` | 每段五态；窄屏只保留前三段，余下进 Tooltip |
| `SimulatedChip` | ui-simulation | 模拟世界标记 | `scope: 'run' \| 'external'` | run：短芯片 + Popover 全文；external：说明行全文 |
| `IdChip` | ui-primitives（Team 也有原始 ID 直出，第二消费者成立） | 短 ID + 复制 + 全文 Tooltip | `id`、`label?`、`kind?`、`head`、`tail` | 默认、已复制（1.2s 对勾）、不可复制（withheld） |
| `DisplayName` | ui-simulation | 显示名解析与回退 | `name?`、`kind`、`id` | 有名称、回退为“类型 + 短 ID”、已隐藏 |
| `WorkspaceStage` | ui-simulation | 集合 + 检查器坞网格 | `inspector?`、`ambient` | 无选择、并列、覆盖层、全屏 |
| `InspectorDock` | ui-simulation | 粘性头、分区 tab、自身滚动、拖拽宽度 | `title`、`eyebrow`、`sections`、`width` | 进入、切换对象、关闭 |
| `WorldDial` | ui-simulation | 模拟时间 + 有限事件轴 | `now`、`unit`、`events`、`revision` | 有事件、无事件、未发布（unavailable） |
| `SeatStrip` | ui-viz | 驻留座位条 | `filled`、`limit`、`overlay?` | 正常、满、数据异常（filled > limit 显示错误） |
| `ElectorateArc` | ui-viz | 冻结 electorate 半圆座位图 | `seats: {id, label, vote}[]` | ≤3 一行、4–40 弧、>40 退化；每座位可聚焦 |
| `VoteTally` v2 | ui-simulation | 票况条 + 避让刻度 | 现有 + `labelPlacement` | 投票中、已结案、规则无效 |
| `CaseBoard` | ui-simulation | 按请求状态分列的看板 | `columns: {status, total, items}[]` | 已加载/总数、空列、live 移列 |
| `WorldPulse` | ui-simulation | 本页 live 变化列表 | `entries`、`max` | 空、溢出合并 |
| `ResultChips` | ui-simulation | 结构化结果步骤 | `steps: {step, state}[]` | 依赖 DTO；缺失时回退原文本 |
| `DraftStructureSketch` | ui-simulation | 草稿组织缩略图 | `units`、`positions`、`diagnostics` | 空、有诊断、过大（> 80 节点只显示统计） |
| `AmbientField` | ui-viz（替代 `AmbientBackdrop` 内部实现） | 留白背景场 | `mode`、`variant`、`pulse?`、`tone` | 见 §7 |
| `ConsequenceList` | ui-primitives | 弹窗“会发生/不会发生” | `will[]`、`wont[]` | — |

### 5.2 组件约束

- 全部只接收已解析视图模型；读取仍由 `Workspace` 与 runtime 拥有。
- `IdChip` 截断规则：保留前缀类型（`world-person:`）+ 前 4 + `…` + 后 4；`aria-label` 读完整 ID；复制成功用 `aria-live="polite"` 播报，不弹 toast。
- `ElectorateArc` 每个座位 ≥ 24×24px 命中区，方向键在弧上顺序移动（复用 `nextSpatialFocus`），Enter 跳到该成员的 Decision；提供 `describeVisualization` 摘要“5 席：赞成 2、反对 1、未投 2”。
- `CaseBoard` 列使用 `role="list"`，卡片可聚焦；FLIP 只在 live 观测触发，页面切换、刷新直接落位。
- 封闭联合（座位票型、轨道节点、组件状态）`switch` 结尾 `assertNever`；领域状态等可扩展值显示原值 + “未知类型”。

### 5.3 视觉细节

- **领域色**：每个领域用一个分类 tint 作为徽章与卡片左缘 2px 色条——组织 teal、制度 olive、外部 slate；事项保持中性。fuchsia 不用于领域，避免与 Simulation 品红身份色混淆。领域色只表示“属于哪个领域”，不表示状态。
- **模拟声明配色**：`SimulatedChip` 用 `--clocky-mode-simulation-subtle` 底 + `--clocky-fg-secondary` 字，不再用 teal（D2）。
- **密度**：表格新增“舒适 48px / 紧凑 36px”两档（记忆在 store，不进 URL）；紧凑档行内次行隐藏，显示名后跟 `IdChip`。
- **数字**：所有计数 tabular；模拟时间十进制分组；大计数（≥ 10,000）在卡片中用分组而不缩写，避免“1.2万”这类精度损失。
- **图标**：沿用现有 outline 图标族；`⚠ ◌ ⏸ ⛔ ✎` 等字符字形逐步替换为同族 SVG 图标（字符在不同字体下宽度不一，导致芯片抖动）。

## 6 动效设计

### 6.1 原则

只用 `transform`/`opacity`（例外：头部收起和表格行增删用 `grid-template-rows`）；时长与缓动全部取 `tokens.css`；首次加载、刷新、回放、导航到已处于某状态的对象一律直接落位；同屏一次只有一个 L2 编排、一个 L3；任何输入可打断。

### 6.2 编排表

| # | 动效 | 层 | 触发 | 编排 | 时长 / 缓动 | 打断 | 减少动效 |
|---|---|---|---|---|---|---|---|
| M1 | 运行头收起/展开 | L2 | 越过 48px 哨兵 | 标题行 `grid-template-rows: 1fr → 0fr` + opacity；名称从标题行淡入状态行 | `base` / `standard` | 反向滚动立即反向 | 直接切换 |
| M2 | 行 → 检查器 | L2 | 选中行 | 选中行显示名经 view-transition（`clocky-inspect-title`）morph 到检查器标题；检查器坞 `translateX(16px→0)` + opacity，坞内正文延迟 `stagger-step` 淡入 | `base` / `enter` | 再选另一行：标题 morph 到新标题，正文交叉淡化，坞不重复滑入 | 仅正文 `fade` |
| M3 | 检查器分区切换 | L2 | 点击分区 / `[` `]` | 指示条滑动（`useSlidingIndicator`）；内容 `translateY(4px→0)` + opacity，方向与分区顺序一致 | `fast` / `standard` | 新切换取消旧的 | `fade` |
| M4 | 检查器关闭 | L2 | Esc / 关闭 | 坞 `translateX(0→8px)` + opacity；焦点回原行，原行背景高亮淡出一次 | `fast` / `exit` | — | 立即 |
| M5 | 世界仪表 now 跳变 | L2 | live 观测到模拟时间前进 | now 圆点沿轴 spring 到新位置；`SimClock` 数字用 `Odometer` 滚动；已过事件菱形淡为空心 | `slow` / `spring` | 连续观测合并为一次到最新值 | 立即更新 |
| M6 | 席位落票 | L2 | live 观测到新票 | 对应座位从空心 `scale(0.6→1)` 填充为票型；`VoteTally` 段 `scaleX` 过渡；未投计数 Odometer | `base` / `spring`，多张票每座位错开 `stagger-step` | 合并 | 立即 |
| M7 | 座位/岗位占用 | L2 | 预留 → 占用 / 释放 | 斜纹块淡出、实心块 `scaleX` 从左展开 | `base` / `spring` | 合并 | 立即 |
| M8 | 看板移列 | L2 | live 观测到事项状态变化 | FLIP：旧位置 → 新列，期间卡片带 `--clocky-elevation-2` 阴影，落位后去掉 | `slow` / `emphasized` | 新变化先让在途卡瞬间落位 | 立即移动 + 新列卡片 `fade` |
| M9 | 结构图聚焦 | L2 | 选中树行 | 视图变换平移/缩放到节点；节点外环 opacity 0→1 | `slow` / `standard` | 新选择接续当前变换 | 直接定位 |
| M10 | live 行标记 | L1 | `useLiveChanges` | 左侧 3px 色条 opacity 0→1→0.4 驻留 | `fade` | 同行只保留最后一次 | 保留（仅 opacity） |
| M11 | WorldPulse 新条目 | L1 | live 变化 | 新条目自顶插入：高度 `grid-template-rows` + opacity；1s 内多条合并为一次插入 | `base` / `enter` | 合并 | `fade` |
| M12 | 骨架加载 | L1 | 首次读取 > 300ms | 按模块形状的骨架（表格行、卡片块、弧形座位）+ 现有 shimmer | `shimmer` | 数据到达立即替换，无淡入 | 静态骨架 |
| M13 | 诊断定位 / 跨层跳转到达 | L2 | 点击诊断或引用 | 目标单元格/行 outline 或背景 accent-subtle 淡出 | `slow` / `deliberate` | 新定位取消旧的 | 静态 1s |
| M14 | 弹窗步骤推进 | L2 | ActionFlow 下一步 | 内容 `translateX(12px→0)` + opacity，步骤点填充 | `base` / `standard` | 返回反向 | `fade` |
| M15 | L3 时刻 | L3 | 现有映射：seal 制度生效、assemble 录用完成、converge 代表就绪、stall 未知/未确认；ignite 开始 | 现有编排；新增：seal 与 ignite 结束时向 `AmbientField` 发送一次 `pulse`（§7.3） | ≤ `celebrate` | 任意输入完成 | 淡出 |

### 6.3 预算与守卫

- 主线程每帧 ≤ 4ms（含背景场），150 节点图 + 24 粒子下 p95 帧时间 ≤ 18ms，沿用可视化层验收门槛。
- 页面隐藏、元素离屏、原生模态打开、外壳标记 `data-behind-pane="true"` 时暂停 L1/L0（即现有 `useAnimationActive` 的判定）。
- e2e 断言：加载与刷新后 `document.getAnimations()` 中不存在 L2/L3（沿用现有断言，扩展到新组件）；减少动效下不存在非 opacity 动画。
- 新增断言：滚动 0→2000px 期间运行头只触发一次 M1，且没有每帧样式写入（用 `PerformanceObserver` 的 long-animation-frame 计数）。

## 7 留白背景动效：世界气候层 `AmbientField`

### 7.1 定位

现有 `AmbientBackdrop` 是 L0 静态层（点阵 + 两团模式色光），覆盖整个工作区。新设计把它升级为“气候场”：仍是装饰性的 chrome，但只在**留白**里可见，并且它唯一的节拍来自真实观测。它回答一个问题：“这个世界此刻是醒着还是睡着”，而状态本身始终由运行头的文字说明。

### 7.2 四层构成

| 层 | 内容 | 动 / 静 | 不透明度（深 / 浅） |
|---|---|---|---|
| A 坐标层 | 现有 22px 点阵（`--clocky-viz-grid`） | 静止 | 现值 |
| B 地形层 | 以 `hashSeed(runId)` 生成的等高线 SVG（6–9 条闭合曲线，纯函数、确定性），每个运行有自己的“地形指纹” | 极慢漂移：`translate` ≤ 24px、`rotate` ≤ 1.5°，周期 `--clocky-duration-drift`（拟议 90s），`alternate` | 0.10 / 0.05 |
| C 气团层 | 现有两团模式色光 | 极慢呼吸：`scale(1→1.04)`，周期 drift × 1.3，与 B 不同相 | 现值 |
| D 脉冲层 | 以锚点（概览的 `WorldDial`、目录页空态图形）为圆心的等时线环 | **默认静止**；仅在 live 观测事件时扩散一次 | 峰值 0.18 / 0.10，扩散后归零 |

目录页与空作者台没有运行 ID，B 层用固定种子，并换成“星图”变体：约 40 个星点 + 稀疏连线的静态图，C 层呼吸照常。

### 7.3 由观测驱动的脉冲

D 层是唯一与数据相关的层，规则：

- **触发源**只有三种 live 观测：模拟时间前进（M5）、L3 seal、L3 ignite。每次触发一圈环：`scale(0.2→1.6)` + opacity 峰值 → 0，时长 `--clocky-duration-celebrate`，缓动 `ease-out`（`--clocky-ease-enter`）。
- 1.2s 内的多次触发合并为一圈，环宽略加粗；不排队、不补播。
- 首次加载、刷新、回放、导航都不触发——与 L3 规则相同，复用 `useLiveTransition`。
- 两次观测之间完全静止。因此背景**不会**暗示模拟时间在连续流动，遵守“不在观测之间动画模拟时间”。
- 运行 `running` 被观测到时整体色调为“全色”，`paused`/`idle` 时 B、C 层去饱和 40% 并降不透明度 30%，切换用 `--clocky-duration-deliberate` 交叉淡化。这是可视化层提案 ignite“世界由 muted 到 full tone”的延续；状态仍以运行头文字为准，色调只是氛围，且在 `prefers-contrast: more` 下关闭。

### 7.4 只在留白可见

- `AmbientField` 放在 `WorkspaceStage` 集合区的底层（`z-index: var(--clocky-layer-behind)`），表格、卡片、检查器使用实色表面 `--clocky-bg-surface`，天然遮挡。
- 集合区内容之上不加任何半透明背景动效；表格之下的剩余高度用 `mask-image: linear-gradient(to bottom, transparent 0, #000 64px)` 从内容底边向下渐显，避免在最后一行下方出现硬边。
- 概览卡片之间的 gutter（16px）不显示 B 层（mask 掉），只在仪表背后与页面底部大块留白显示，防止“纹理从缝里透出”的脏感。
- 检查器坞与弹窗下方不渲染 D 层脉冲。

### 7.5 实现

```css
/* ui-viz/src/AmbientField.module.css（拟议） */
.field { position: absolute; inset: 0; overflow: hidden; pointer-events: none;
  contain: strict; z-index: var(--clocky-layer-behind); }
.terrain { position: absolute; inset: -32px; opacity: var(--ambient-terrain-opacity);
  background-image: var(--ambient-terrain); /* 由 JS 一次性写入的 SVG data URI */
  animation: drift var(--clocky-duration-drift) var(--clocky-ease-standard) infinite alternate;
  animation-play-state: var(--ambient-play, running); }
.field[data-tone="muted"] .terrain { filter: saturate(0.6); opacity: calc(var(--ambient-terrain-opacity) * 0.7); }
.ring { position: absolute; border-radius: var(--clocky-radius-full);
  border: 1px solid var(--clocky-mode-simulation-fg); opacity: 0; }
@keyframes drift { to { transform: translate3d(24px, -16px, 0) rotate(1.5deg); } }
@media (prefers-reduced-motion: reduce) { .terrain { animation: none; } }
@media (prefers-contrast: more), print { .field { display: none; } }
```

- 地形 SVG 由纯函数 `terrainPath(seed, bounds)` 生成一次并缓存为 data URI（≤ 6KB），尺寸变化只在 `ResizeObserver` 结束 200ms 后重算；不使用 canvas、不使用 rAF 循环。
- 脉冲环用 WAAPI 在一个复用的 `<span>` 上播放，`finished` 后清理；同时最多 1 个在途。
- `--ambient-play` 由 `useAnimationActive`（已含隐藏页、离屏、模态判断）驱动；新增“空闲冻结”：60s 无指针/键盘输入后暂停 B、C 层，任意输入恢复——长时间监控时彻底静止，回应可视化层提案的“motion fatigue”风险。
- 星图变体的星点同样是静态 SVG，连线在初次出现（非加载，而是用户首次打开空目录的那次挂载）时不画入，直接显示，保持“加载即落位”。

### 7.6 控制与无障碍

- WCAG 2.2 SC 2.2.2（暂停、停止、隐藏）：自动开始且持续 > 5s 的移动内容必须可暂停。因此：运行头 `⋯` 菜单与 Settings › General 提供“背景动效：跟随系统 / 开 / 关”，默认“跟随系统”（系统减少动效时为关）。该偏好存本地设置，不进 URL。
- 背景对比：B 层与表面背景的对比度 ≤ 1.15:1，保证不与文字竞争；token 测试在两种主题下测量。
- `aria-hidden="true"`；不承载任何可读信息；关闭后界面信息完全不变。

## 8 文案与可读性规则

| 情况 | 显示 | 机器值去向 |
|---|---|---|
| 对象有显示名 | 显示名 | `IdChip` 次行或 Tooltip |
| 无显示名 | “{类型名} {短 ID}”，例如“人物 dc25…4fce” | 完整 ID 在 `IdChip` |
| 状态码（`current-authority`、`native/relation`） | locale 翻译；未知码显示原值 + “未知类型” | — |
| 结构化 payload | 键值表（最多 8 行，余下“查看全部”） | “原始数据”折叠中的 `JsonTree` |
| 长句状态（“当前未观察到在途工作”） | 短标签“无在途工作” | 完整句在 Tooltip / `aria-describedby` |
| 整列相同值 | 列上方“本页”摘要，列隐藏 | 展开列开关 |

所有新文案中英同等覆盖，经 locale 服务；“本页”“已加载/共”等范围措辞必须出现在摘要与看板列头。

## 9 窄屏（< 540px）

- 运行头：第一行“← 名称（单行省略）[⋯]”，第二行 `StatusCapsule` 只保留调度状态、模拟时间、连接三段，第三行主按钮占满宽度；模块选择用 `Menu`。三行合计 ≤ 152px。“维护与输入”整组进入 `⋯`，不再在页面展开（修 D1 的 390 场景）。
- 集合区表格转卡片：卡片顶部显示名 + 状态徽章，中部 2–3 个关键字段，底部 `IdChip`；四轨 compact 轨条横置卡片底部。
- 检查器为全屏 `Sheet`，顶部返回 + 标题，分区 tab 横向滚动并有渐隐边缘提示。
- 背景场只保留 A、C 层（静态），B、D 层关闭，省电并减少小屏视觉噪音。

## 10 主题

- 深色优先评审、浅色同等验收（延续可视化层提案）。浅色下 B 层 0.05、C 层降 30%，避免白底“脏雾”。
- 领域 tint、`SimulatedChip`、`SeatStrip` 斜纹在两主题下测对比度（非文本元素 ≥ 3:1，文本 ≥ 4.5:1）。
- 玻璃浮条只出现在 `GraphView`/`LaneView` 画布之上。

## 11 需要先修改的 owner 规则

| 现行规则（来源） | 本文提议 | 理由 |
|---|---|---|
| L0 ambient “Static”（DESIGN.md Motion 表） | L0 允许 ≥ 60s 周期、位移 ≤ 24px 的漂移，可暂停，空闲 60s 冻结；可视化层提案原本即写“Period of 20s or more” | 两份 owner 文档在此不一致；本文取更保守的 90s 并加暂停控制 |
| “No new visual tokens or motion are introduced”（DESIGN.md World scenario workspace） | 新增 §12 列出的 token 与 M1–M15 | 本轮正是动效与视觉打磨 |
| 选中详情在 < 880px 时替换集合（DESIGN.md Layout） | 540–879px 用覆盖层 `Sheet`，< 540px 全屏 | 保留集合上下文与滚动位置 |
| Simulation 七模块 / 世界五模块 tab（不变）+ 运行头布局（DESIGN.md Layout“separates identity/actions, grouped status facts and module navigation”） | 三者仍分离，但压成两条粘性带；维护入口移入 `⋯` | 首屏空间；运维是低频操作 |
| 外部世界模拟声明（DESIGN.md Interaction rules） | 外部模块常驻全文；其他模块为运行头芯片 + Popover 全文 | 降低横幅失明，声明仍随时可得 |
| [ui-design §5](ui-design.md#5-运行概览世界运行) 概览布局 | 本文 §4.1 | 概览重构 |

R0 已于 2026-10-16 落档：[DESIGN.md](../../../DESIGN.md) 的布局、配色、层级、动效与 World 规则，[可视化层提案](../../notes/proposed/feature/2026-10-04-swarm-and-world-visual-layer.md)中英文配对（L0 层、token、环境场、验收与风险），以及 [UI 设计](ui-design.md) §5.1、§14、§15.1 的取代说明。token 本身仍待 R7 前在 `tokens.css` 加入；代码实施从 R1 开始。

## 12 新 token 与 DTO 依赖

拟议 token（加入 `ui-theme` 的 [tokens.css](../../../packages/client/ui-theme/src/styles/tokens.css)，两主题各一值，减少动效块同步归零）：

| Token | 值（建议） | 用途 |
|---|---|---|
| `--clocky-duration-drift` | 90000ms | 背景 B/C 层漂移周期 |
| `--clocky-ambient-terrain-opacity` | 深 0.10 / 浅 0.05 | 地形层 |
| `--clocky-ambient-pulse-opacity` | 深 0.18 / 浅 0.10 | 脉冲环峰值 |
| `--clocky-run-header-block` | 112px / 收起 100px | 舞台高度计算 |
| `--clocky-domain-{organization,governance,external}-{fg,bg,border}` | 映射到 teal / olive / slate tint | 领域徽章与色条，功能 CSS 不直接读 tint |

Host DTO 依赖（无则保持现状回退，不在前端推断）：

1. 提案标题、事项 `summary`、人物显示名在相关窗口中稳定提供（部分已有，需逐个核对）。
2. 外部交互结果的结构化步骤数组，替代分号拼接文本。
3. 义务项的人读标题字段（类型 + 对象显示名）。

## 13 验收

- [ ] V01 1440×900 下世界五个模块内容起点 y ≤ 160；滚动后运行头 ≤ 100px；390×844 下 ≤ 200。
- [ ] V02 运行头收起只在越过哨兵时切换一次，无滚动驱动的逐帧样式写入。
- [ ] V03 `⋯` 菜单包含运行详情、维护各入口、导出、背景动效开关、复制 ID；不可用项显示原因；键盘可达。
- [ ] V04 模拟声明：外部模块常驻全文；其他世界模块运行头芯片可展开全文；创建预览全文保持。
- [ ] V05 集合区与检查器各自滚动；在检查器中滚动不改变表格滚动位置；关闭检查器焦点回原行。
- [x] V06 容器查询断点：1440 视口（容器 1216）作者台为纵向分节栏，无横向截断。
- [ ] V07 表格、检查器、来源列表中不再直出无标签原始 ID；所有 ID 经 `IdChip`，可复制、可读全文。
- [ ] V08 原始 JSON 仅出现在“原始数据”折叠内，默认关闭。
- [x] V09 整列相同值折叠为“本页”摘要，CJK 列不逐字断行。
- [x] V10 `VoteTally` 标签在 280–520px 检查器宽度内不越界；`ElectorateArc` 有等价列表与键盘遍历。
- [ ] V11 概览：`WorldDial`、需要你、三张领域卡、事项流胶囊、`WorldPulse` 在 1440×900 首屏可见；人员六个计数保持独立。
- [x] V12 `WorldPulse` 仅收 live 观测，刷新后为空并写明范围。
- [ ] V13 事项看板列头显示已加载/共，live 移列为 FLIP，刷新不移动。
- [x] V14 维护与确认弹窗采用对象 / 会发生 / 不会发生 / 来源四段结构。
- [ ] V15 M1–M15 全部只用允许属性，时长缓动取 token；加载与刷新后无 L2/L3 运行（e2e）。
- [ ] V16 减少动效下无非 opacity 动画；背景 B、D 层不渲染动画。
- [ ] V17 背景场只在留白可见：表格、卡片、检查器下方无纹理透出（视觉基线截图）。
- [x] V18 背景脉冲只由模拟时间前进、seal、ignite 的 live 观测触发；1.2s 内合并；加载/刷新/导航不触发。
- [ ] V19 背景动效设置（跟随系统/开/关）生效并持久；空闲 60s 冻结、输入恢复；隐藏页与模态后零动画工作。
- [ ] V20 `prefers-contrast: more` 与打印下背景场关闭；背景与表面对比 ≤ 1.15:1（token 测试两主题）。
- [ ] V21 性能：150 节点 + 24 粒子 + 背景场，p95 帧时间 ≤ 18ms；背景场稳定态主线程每帧 < 1ms。
- [ ] V22 540–879px 覆盖层检查器与 < 540px 全屏检查器：返回、焦点恢复、滚动位置保留。
- [ ] V23 浅/深主题、1440/1024/768/390 四宽度的视觉基线进入 `apps/web/tests/ui-baseline.snapshot.ts`。
- [ ] V24 GUI PR 附真实 server/model 流程 GIF：概览观测时间推进（M5 + 脉冲）、选中行到检查器（M2）、落票（M6）。

## 14 实施拆分

| 包 | 内容 | 主要文件 | 依赖 | 验收 |
|---|---|---|---|---|
| R0 规则（已完成） | DESIGN.md、可视化层提案、ui-design.md 的规则修订与中英配对 | DESIGN.md、`.agents/notes/proposed/feature/2026-10-04-swarm-and-world-visual-layer*.md`、ui-design.md | — | §11 全部落档 |
| R1 外壳（已完成，差异见 §3.1） | `RunCommandBar`、`StatusCapsule`、`SimulatedChip`、`⋯` 菜单、M1 | `RunCommandBar.tsx`、`disclosure.ts`、`Workspace.tsx`、`RunStatus.tsx`、`Controls.tsx`、`Workspace.module.css` | R0 | V02、V04；V01 部分（见 §3.1 实测）；V03 待 R4/R7 补导出与背景开关 |
| R2 舞台（已完成，差异见下） | `WorkspaceStage`、`InspectorDock`、容器查询断点、覆盖层检查器、M2–M4 | `World.module.css`、`WorldInspector.tsx`、各模块组件 | R1 | V05、V22（V06 属 R6 作者台） |
| R3 可读性 | `IdChip`、`DisplayName`、列折叠、原始数据折叠、弹窗四段结构 | ui-primitives、`WorldRefs.tsx`、`WorldFacts.tsx`、`MaintenanceDialog.tsx` | DTO 1、3 可并行 | V07–V09、V14 |
| R4 概览与事项 | `WorldDial`、`SeatStrip`、事项流胶囊、`WorldPulse`、`CaseBoard`、M5、M8、M10–M12 | `WorldOverview.tsx`、`WorldCases.tsx`、`WorldTracks.tsx` | R2 | V11–V13 |
| R5 领域视图 | `ElectorateArc`、`VoteTally` v2、组织图全高 + 浮条、外部卡片与 `ResultChips`、M6、M7、M9 | `WorldGovernance.tsx`、`WorldVotes.tsx`、`WorldOrganization.tsx`、`WorldExternal.tsx` | R2；DTO 2 | V10 |
| R6 作者台 | 纵向分节栏、粘性分节标题、空表格内联、体检卡、`DraftStructureSketch` | `WorldAuthorWorkbench.tsx`、`WorldDraftTable.tsx`、`WorldPreview.tsx` | R0 | V06 |
| R7 气候层 | §12 token 落入 `tokens.css`（两主题与减少动效块）、`AmbientField`、地形生成纯函数、脉冲、色调、设置项、空闲冻结 | tokens.css、ui-viz `AmbientBackdrop.tsx` → `AmbientField.tsx`、`Backdrop.module.css`、ui-settings-general | R0、R4（脉冲锚点） | V16–V21 |
| R8 验收 | e2e 动效断言、性能测试、视觉基线、GIF | `apps/web/tests/*`、ui-viz perf 测试 | R1–R7 | V15、V23、V24 |

R3 与 R6 不依赖 R1/R2，可以并行；R7 的地形生成与设置项可先行，脉冲接线等 R4。每个包同步更新 `ui-simulation` / `ui-viz` README、locale 中英文与组件测试（含拒绝路径：DTO 缺显示名、结构化结果缺失、背景关闭）。

## 15 待决定

1. **背景动效默认值**：本文建议“跟随系统”。若产品希望默认更安静，可默认“关”并在概览首次出现时不做任何提示（不新增引导弹层）。
2. **看板视角**是否首版交付：它依赖事项窗口足够大才有意义；也可以只做概览事项流胶囊，看板留待 post-MVP。
3. **`IdChip` 上移到 ui-primitives** 的时机：Team 的任务与 Session 详情同样有原始 ID 直出；若 Team 侧不在同一轮采用，先留在 ui-simulation。
4. **字符字形替换为 SVG 图标**的范围：可只替换芯片与轨道中的字形，正文说明中的字符暂留。
5. **地形指纹**是否也用于目录卡 sigil 背景，形成“同一运行在目录与运行页有同一张地形”的识别；需要确认不会被误读为运行数据。

## 16 第三轮交付（2026-10-20）

本轮交付 R3、R4、R5、R7 的主体，实测环境为 `.tmp/ui-polish/world.live.ts`（真实 Host + 构建后 Client、无密钥脚本模型的 company 世界），1440×900 明/暗与 390×844 暗色均已目视核查，390 宽无横向溢出。

| 包 | 已交付 | 与上文的差异 |
|---|---|---|
| R7 气候层 | `tokens.css` 新增 `--clocky-domain-*`、`--clocky-ambient-{terrain-ink,terrain-opacity,pulse-opacity}`、`--clocky-duration-drift`（90s，减少动效归零）与 `--clocky-type-hero`；`AmbientBackdrop` 增加种子地形（`terrainContours`）/中性星图、错相呼吸、观测脉冲环（1.2s 合并）、色调、60s 空闲冻结、隐藏页冻结；高对比与打印隐藏地形 | 不新建 `AmbientField` 组件，沿用 `AmbientBackdrop` 导出名；场景与脉冲通过舞台内冒泡 DOM 事件 `AMBIENT_SIGNAL` 传递（各功能包分别打包，不能共享模块单例）。设置是两态开关（目录页头与运行页头各一个图标按钮，存浏览器本地），减少动效始终静止，未进入 Settings › General。对比度规则改为“地形线不强于现有点阵”，1.15:1 对 1px 线条不可行且现有点阵本身已超过 |
| R4 概览 | `WorldDial`（hero 字号模拟时间 + Odometer、最多 5 事件的有限轴、“现在”标记弹性移动、实时前进时脉冲）、三张领域卡（领域色边）、`SeatStrip`、外部来源条、事项流胶囊、`WorldPulse`（仅本页实时观测，刷新清空）；日历编辑器移到流与脉冲之后 | 领域卡为三张独立无阴影卡片而非一张表面的分区；`CaseBoard` 看板与 M8 未做（§15 第 2 条仍待定） |
| R5 制度 | 提案标题回退为“委员会 提案 · 短 ID”；`VoteTally` 标签分轨并向内锚定；`ElectorateArc` 半圆席位图（形状编码票型、实时落票弹入）与原列表并列 | 席位不可单独聚焦，键盘与读屏走等价列表；组织图全高、外部 `ResultChips`（依赖 DTO 2）未做 |
| R3 可读性 | 人员表整列相同值折叠为“本页”摘要、CJK 短列不换行、姓名头像 + 短 ID；来源引用改为芯片云；外部交互摘要与任职关系标识单行截断、全文在 title；维护弹窗改为对象 / 会发生 / 不会发生 / 来源四段，来源标识收进展开项，主操作为主按钮 | `IdChip` 未上移到 ui-primitives，继续用 `CopyId`；“原始数据”折叠（V08）未做 |
| 外壳修复 | 收起态命令带保持单行（隐藏标签与次要段）；`⋯` 维护弹层按可用空间左右展开，不再被侧栏遮挡；空目录改为带星座图形的舞台与模板卡片；运行卡片带所写阶段状态色短边 | — |

仍未完成：V11（1440×900 下事项流与 `WorldPulse` 仍在首屏以下）、R6 作者台、V01 的 390 宽首屏目标、V08、V13、V15/V21 的 e2e 与性能断言、V17/V23 视觉基线、V24 真实模型 GIF。

## 17 第四轮：子页面与滚动态（2026-10-20）

逐页实测（1440×900 暗色、390×844）后修复：

| 范围 | 问题 | 处理 |
|---|---|---|
| 滚动态 | 收起后的命令带粘在滚动容器内边距下方 24px，内容从上方缝隙透出；硬边 | 命令带贴住容器顶部（`top: -var(--root-block)`），半透明表面 + 模糊 + 下方渐隐；检查器坞与结构图偏移同步修正；宽内容下世界表格表头固定在命令带下方 |
| 事项 | 旧引擎布局：表格内嵌滚动、检查器挤压表格横向滚动、标题为原始 ID、分区按钮折两行、每行重复隐藏提示 | 迁到 `WorkspaceStage` + `InspectorDock`；首列为领域标签 + 操作 + 短 ID，路线合并一列，状态轨旁写状态；全隐藏的业务键折叠为本页摘要；打开坞时路线与更新时间让位；手机为卡片 |
| 引擎集合 | 单元格上下不对齐、状态为纯文本、表头随行滚走、手机只露 3 行 | 固定表头、统一行高、状态着色标记（保留原文）、ID 芯片；< 540px 改为带字段标签的卡片并由页面滚动 |
| 引擎检查器 | 文字“返回集合”、超大原始 ID 标题、纯文本分区、标签挤压取值 | 图标关闭、紧凑身份标题、分段式分区、两列事实网格（标签 ≤ 38%） |
| 记录 | 导出区把表格挤到 3 行 | 表格最小高度，导出收为虚线卡片 |
| 组织 | 关系图空框、“人员与录用邀约”单独按钮、时线“—”分组与右缘标签截断 | 未选中时显示根单元邻域，图粘性；邀约改为折叠面板；分组标为“未归属单元”；边缘刻度与“现在”留在泳道内 |
| 制度 | 制度坞眉标过长挤走关闭按钮、来源提案 ID 换行 7 行；历史无刻度 | 徽章截断、来源提案短 ID；历史共用刻度并标出查看时点，版本条写区间 |
| 请求历史 | 多余分隔线、状态埋在句子里 | 页头 + 状态标记 + 时间同行，ID 芯片 |
| 作者台 | 1440 下分节栏横向截断；“已保存草稿 ID”行无边界看似压在表格上 | 纵向分节栏保持到 1100px，标签可换行；分节标题粘性；草稿说明、按 ID 打开与丢弃合并为页脚栏 |

R6 作者台的 V06 由本轮满足（1440 视口为纵向分节栏、无截断）。


## 18 第五轮：降低信息密度（2026-10-20）

原则：默认只展示回答“现在怎样”的事实；解释性句子、低频工具与次要计数按需展开；不删除既有视觉语言与动效（环境场、仪表、玻璃、坞动效均保留），新出现的元素带进入动画。

- **运行头胶囊**：常驻 phase 与模拟时间；调度器只在工作中或未确认运行 phase 时出现，已受理工作只在有待处理工作时出现，连接只在断开时出现（错误底色），三者均以短动画进入；运行详情始终列出三者。平稳暂停态胶囊从 5 段减为 2 段。
- **说明按需**：新增 `InfoHint`（“i” 提示，悬停/聚焦显示，句子作为无障碍描述）。替换概览人员范围、事项流说明、本页变化范围、仪表观测规则，以及制度“仅可观察”横幅与记录排序说明。外部世界模拟声明按 DESIGN 规则保持常驻。
- **概览分组**：覆盖说明只在不完整或过期时出现；未来日历、预算与模型池、执行模式说明、请求记录收进默认折叠的“运行管理”，展开时卡片错峰缓入，各卡片为独立容器查询。
- **目录卡片**：只保留名称、phase 与模拟时间；场景版本与已受理工作移入卡片详情。
