# Web UI 重构开发计划

本计划落实 [Web UI 信息架构、视觉系统与交互重构提案](../../notes/proposed/feature/2026-10-02-web-ui-redesign.zh.md)。提案负责设计决定，本计划负责工作包、依赖、交付顺序、开发方法和验收方式；逐项勾选清单见 [checklist.md](checklist.md)。计划日期为 2026-10-02，规划基线为 `dbfb6e25b9`；工作树中其他未提交修改不属于本计划的输入。文中新增组件、文件和读取接口均为拟议名称，以落地 PR 为准。

## 当前实施状态

| 工作包 | 对应提案阶段 | 状态 | 已交付与剩余验收 |
|---|---|---|---|
| WP00 基线与护栏 | 阶段 0 | 进行中 | 起始提交 `b6fd164589`。样式棘轮门禁 `verify-client-style-tokens`（86 文件/776 处，含未定义 token 检查，接入 hygiene 与 CI 静态门禁，`vitest` 22+51 通过）；未定义 token 10 处已修复；视觉基线 `ui-baseline.snapshot.ts`（42 张，`before-redesign` 参考，复跑对比在噪声阈值内）。剩余：停滞 Team、对话细分状态与仿真创建的像素基线 |
| WP01 设计 token 基础 | 阶段 1 | 待验收 | `tokens.css` 角色层（颜色/状态/字体/间距/圆角/层级/图层/动效、全局减少动效）；旧色板与 alias/static/workspace/navigation/尺寸字体 token 全部删除并迁移消费方；样式门禁 776→4；`tokens.client.spec.ts` 对比度断言；`pnpm run typecheck` 通过、client 333 文件 4204 测试通过、改动文件 oxlint 通过、文档门禁（note-format、translation-pairing、md-links、doc-refs）通过；基线 `.artifacts/ui-baseline/wp01/` 已评审。剩余：真实服务 GIF |
| WP02 基础组件 | 阶段 2 | 进行中 | Button/IconButton、Tabs、StatusBadge/Glyph、Card/Section/EmptyState/Skeleton/KeyValue、Avatar/Kbd/Popover/Sheet/SplitPane、FactValue/SimClock、CommandPalette 已实现并有 jsdom 测试（ui-primitives 565 测试通过）。剩余：随首个消费方导出并更新 README |
| WP03 外壳与导航 | 阶段 3 | 进行中 | 文案统一；侧边栏行（状态图形/短标题/相对时间/悬停操作/稳定排序）与收件箱计数；401 横幅（runtime `useConnection` + `rpcErrorFrom`）；对话面板取代模态（`computePane`、键盘分隔条、展开、sheet）；空状态启动器。证据：`pnpm run typecheck` 通过、`shell-navigation.snapshot.ts` 与 team-workspace/team-channel/team-member-readiness/ui-baseline/settings-chrome e2e 通过、基线 `.artifacts/ui-baseline/wp03/`。剩余：仿真侧边栏分组、面板浏览器后退专项 e2e、全量 web 通道金样评审 |
| WP04 Team 任务控制台 | 阶段 4 | 进行中 | 头部（面包屑/短标题/状态徽标/阶段主操作/⋯菜单/停滞诊断弹层/KPI 行/带计数导航）、需要你处理条、成员泳道（无当前活动）、任务看板、实时动态流已完成，ui-team 199 测试通过。剩余：成员当前活动读模型、依赖图、其余集合页刷新、e2e 首屏断言 |
| WP05 对话区 | 阶段 5 | 进行中 | 阅读排版（body-reading、悬停/聚焦显示操作）、发送者身份 chip（无需改事件）、过程分组、工具耗时、遥测 ⓘ 弹层、输入框 chip 编组已完成；ui-conversation/ui-tool 单测通过。另完成：DiffBlock 与 ReadBlock 共用标题栏、输入框运行状态行、轨迹类型 chip 改用分类色与句首大写、相关 e2e 金样已评审刷新。剩余：generic 卡片标题栏与块标签本地化、Trajectory 缩略导航 |
| WP06 仿真观测台 | 阶段 6 | 进行中 | 运行头部阶段/驱动器分离、SimClock、FactValue 不可用、中性过期提示、目录刷新与复制 ID 进入菜单已完成，ui-simulation 75 测试通过。另完成：主机全局模型池 chip、窄屏头部压缩、e2e（workspace/administration/acceptance/process-restart）通过。剩余：额度预留段、需要你处理条、效果看板、时间线、世界、检查器、检查点、日志、创建向导、后端读取 R1–R4 |
| WP07 关注事项与全局交互 | 阶段 7 | 进行中 | 快捷键服务、`?` 浮层、命令面板外壳及 Team／仿真提供方 |
| WP08 动效 | 阶段 8 | 进行中 | Popover 触发器原点缩放；Modal/Menu 原地淡入；减少动效移除入场；主题切换暂停过渡一帧；Toast 生命周期改由动画结束驱动 |
| WP09 次要界面 | 阶段 9 | 未开始 | — |
| WP10 质量收尾与发布 | 阶段 10 | 未开始 | — |

状态取值：未开始、进行中、待验收、已验收、延期。只有当本计划列出的退出条件全部满足、证据写入本表后，才能标记为"已验收"。

## 1. 目标与交付层级

| 交付层级 | 必须包含 | 暂不包含 |
|---|---|---|
| M1 基础可用 | 视觉基线、样式棘轮门禁、统一 token、基础组件、`FactValue`/`SimClock` | 任何页面级信息架构变化 |
| M2 新外壳 | 新侧边栏、对话面板取代模态框、401 横幅、空状态启动器、文案统一 | Team 与仿真页面内部重排 |
| M3 核心界面 | Team 任务控制台、对话区过程分组、仿真观测台（基于现有读取） | 需要新增后端读取的可视化（全局关系图、时间范围滚动、因果箭头、迷你折线） |
| M4 交互与动效 | 统一收件箱、命令面板、快捷键、动效规范落地；仿真新增读取与对应可视化 | 资源余额视图 |
| M5 发布 | 次要界面、无障碍与对比度审计、窄屏、性能、文档与 Agent Note 转为已实现 | — |

每个层级都必须可以单独发布：后一个层级尚未完成时，前一个层级不能留下半迁移的视觉混杂或断开的入口。

## 2. 已核对的基础与不能假设的能力

| 所有者 | 可复用 | 必须补齐或注意 |
|---|---|---|
| [ui-theme](../../../packages/client/ui-theme/README.zh.md) 样式表 | 主题运行时、浅色/深色切换、滚动条重绑定约定 | 两套色板（`workspace-*`、`alias-*`）、深色块重复的静态色板、缺少间距/圆角/层级/图层/动效刻度 |
| [ui-layout](../../../packages/client/ui-layout/README.zh.md) `AppFrame`、`columns.ts` | 三栏网格、`DragHandle`、让位求解器、折叠动画 | `SessionStage[data-inspecting]` 模态需要改为右侧面板；求解器需增加对话面板列 |
| [ui-primitives](../../../packages/client/ui-primitives/README.zh.md) | `Button`、`Menu`、`Modal`、`HoverCard`、`Tooltip`、`Toast`、`ConnectionBanner`、`JsonTree`、`DisclosureRow` | 缺 `Tabs`、`StatusBadge`、`Card`、`EmptyState`、`Avatar`、`Sheet`、`SplitPane`、`CommandPalette`、`FactValue`、`SimClock` |
| [ui-team](../../../packages/client/ui-team/README.zh.md) | 视图模块 `overview/tasks/channels/members/artifacts/workflows/audit/attention`、草稿保留、注意力查询 | 41 条手动刷新文案；成员当前活动没有读模型 |
| [ui-conversation](../../../packages/client/ui-conversation/README.zh.md)、[ui-tool](../../../packages/client/ui-tool/README.zh.md) | 节点渲染注册、工具行视图、上下文计量 | Think/上下文/工具行视觉权重相同；遥测行常驻 |
| [team-agent-client](../../../packages/team/team-agent-client/README.zh.md) | Team 投递 | "Direct message from participant-…" 写进了模型可见文本；不能为了展示去改模型输入 |
| [ui-simulation](../../../packages/client/ui-simulation/README.zh.md)、[simulation-product](../../../packages/simulation/simulation-product/README.zh.md) | 目录、状态批量读取、集合浏览、对象检查、原始命令保留、导出 | 只有逐实体关系；决策浏览无时间范围筛选；操作摘要无目标实体；无区间聚合；资源余额未暴露 |
| [client AGENTS](../../../packages/client/AGENTS.md) | slot/props 纪律、导出纪律、CSS Modules | 组件只接收 props；业务数据留在 runtime；新公开能力需要现有消费方 |

开发前必须知道的环境事实：

- 本机默认 `~/.clocky` 中的 `team-storage.sqlite` 为 schema 2（当前构建要求 3），并含已移除的会话头字段 `delegationDepth`，`clocky web` 会直接启动失败。开发时使用项目内的隔离目录，不要修改或删除用户数据。
- 使用 `--no-open` 时，不会生成浏览器 handoff，所有 `/api` 请求返回 401。本地开发应允许自动打开浏览器，或者使用测试脚手架。
- `pnpm` 需要在 PATH 中；脚本运行器（例如 `run-gates.ts`）依赖 `npm_execpath`，必须通过 `pnpm run` 调用。

## 3. 开发环境

```sh
pnpm install
pnpm run build                       # 首次必需；dev:web 只做增量
pnpm run dev:web                     # 监听源码，重建 lib 与 apps/web/dist
CLOCKY_HOME=.tmp/ui-dev-home node apps/cli/lib/bin.js web --port 4317
```

- Team 数据：通过 UI 新建团队任务，或运行相关 web 快照套件生成数据（`pnpm run test:web:built -- apps/web/tests/team-workspace.snapshot.ts`）。
- 仿真数据：将 `examples/headless-agent/tests/fixtures/simulation/simulation-web/cordis.yml`（只读浏览）或 `simulation-administration/cordis.yml`（含管理与调度）复制到 `.tmp/`，把其中的 `root` 改为 `.tmp/` 下的绝对路径，再通过 `--patch <复制后的路径>` 启动。管理组合依赖同目录的 `model.ts`，需要一并复制或改为引用原路径。
- 视觉对照：`.artifacts/` 与 `.tmp-simulation-plan/` 下现有截图是改造前的参考，不作为验收基线；验收基线由 WP00 生成。
- 所有临时文件、数据目录和截图都放在项目内被忽略的目录（`.tmp/`、`.artifacts/`）。

## 4. 工作包

每个工作包拆为若干可独立评审的 PR。PR 编号格式为 `WPxx-y`，按原生 GitHub stack 组织。规模为粗略估计：S ≈ 1–2 人日，M ≈ 3–5 人日，L ≈ 6–10 人日。

### WP00 基线与护栏（阶段 0）

目标：先锁定"改造前"状态，并让后续每个 PR 的样式退化可以被机器发现。

| PR | 内容 | 主要文件 | 规模 |
|---|---|---|---|
| WP00-a | 视觉基线快照：固定状态矩阵 × 浅色/深色 × 1440×900 与 390×844 | `apps/web/tests/ui-baseline.snapshot.ts`（新）、复用 `scaffold.ts` 与现有 replay 夹具 | M |
| WP00-b | 样式棘轮门禁：扫描功能包 `*.module.css` 中的字面颜色、`font-size`、`border-radius`、`z-index` 与时长；按文件计数写入白名单，计数只能下降 | `scripts/verify-client-style-tokens.ts`、`scripts/verify-client-style-tokens.spec.ts`、`scripts/client-style-tokens.allowlist.json`、`run-gates.ts` 接入 | M |
| WP00-c | 修复调查中发现的确定缺陷：`ui-simulation` 中未定义的 `--clocky-alias-text-primary` | `ui-simulation/src/client/Workspace.module.css` | S |

状态矩阵：空状态、Team 运行中/停滞/完成、协调者对话（含工具、思考、审批、提问、计划评审）、设置、仿真目录、仿真概览/实体/决策/操作/检查点/日志、仿真创建与开始确认、窄视口。

退出条件：基线截图可在 replay 模式下稳定复现（连续两次运行零差异）；门禁在 `pnpm run lint` 或 `hygiene` 中执行，故意加入一个字面颜色时会失败；白名单记录当前全部违规。

### WP01 设计 token 基础（阶段 1）

依赖：WP00。

| PR | 内容 | 规模 |
|---|---|---|
| WP01-a | 新增角色 token 层：颜色角色、7 种智能体状态、字体角色阶梯、间距、圆角、层级、图层、动效时长与缓动、全局减少动效映射；与现有 alias 并存 | M |
| WP01-b | 迁移 `ui-primitives`、`ui-layout`、`ui-sidebar` 到新 token；提供一次性迁移脚本，把字面值映射为最近的 token，并输出无法映射的清单供人工判断 | M |
| WP01-c | 迁移 `ui-conversation`、`ui-tool`、`ui-trajectory`、`ui-attachment` 及其余对话相关包 | L |
| WP01-d | 迁移 `ui-team`、`ui-simulation`、设置类包；删除 `[data-team-workspace-page]`、`[data-simulation-workspace-page]` 的 alias 重映射 | L |
| WP01-e | 删除 `workspace-*`、`navigation-*` 色板与深色重复静态块，侧边栏改为同色调；删除按尺寸命名的字体 token 与导出残留名称；统一品牌强调色 | M |

规则：

- 每个迁移 PR 必须让白名单计数下降，并附受影响状态的浅色/深色基线差异。
- 迁移只改样式，不改布局和结构；有意的视觉变化单独说明。
- 删除旧名称时，在同一 PR 中更新全部消费方，不保留兼容别名（预发布立场）。
- 同步更新 [web-styling.md](../../../docs/web-styling.zh.md) 及英文版、`ui-theme` README 中英文版；新建已实现的 token 决策 Agent Note，并更新样式系统注记。

退出条件：只剩一套色板；深色模式静态块无重复；`--clocky-workspace-*` 与 `--clocky-navigation-*` 在源码中零引用；对比度抽查达标；白名单只剩待后续页面重构处理的条目，并在表中注明其归属工作包。

### WP02 基础组件（阶段 2）

依赖：WP01-a（只需要新 token 层，可与 WP01-b 至 e 并行）。

| PR | 组件 | 规模 |
|---|---|---|
| WP02-a | `Button` 尺寸与变体扩展、`IconButton`（强制无障碍标签） | S |
| WP02-b | `Tabs`（下划线/分段、计数徽标、roving focus、可溢出到"更多"） | M |
| WP02-c | `StatusBadge`、`StatusGlyph`（状态 token 驱动，运行态弧形动画） | S |
| WP02-d | `Card`、`Section`、`EmptyState`、`Skeleton`、`KeyValue` | M |
| WP02-e | `Avatar`、`Kbd`、`Popover`、`Sheet`、`SplitPane` | M |
| WP02-f | `FactValue`（已观察/不可用/未知/过期/已隐藏/已截断）、`SimClock`（十进制字符串分组与本地化，不经 `Number`） | M |
| WP02-g | `CommandPalette` 外壳（分组、模糊匹配、预览区、键盘模型；数据经 slot 提供） | M |

规则：组件只接收 props；样式只用角色 token；每个组件都有 jsdom 测试（首行环境注释），断言可见行为、键盘操作和 ARIA；按 [export discipline](../../../packages/client/AGENTS.md) 只导出有现有消费方的能力，没有消费方的组件随第一个消费 PR 一起导出。

退出条件：组件测试覆盖所有状态与键盘路径；`FactValue` 为六种状态各提供可区分的视觉与可读文本；`SimClock` 能正确显示超过 2^53 的值；`ui-primitives` README 中英文版更新。

### WP03 外壳与导航（阶段 3）

依赖：WP01、WP02-a/b/c/e。

| PR | 内容 | 主要包 | 规模 |
|---|---|---|---|
| WP03-a | 文案统一：团队任务 / 工作文件夹 / 收件箱（中英 locale） | `ui-sidebar`、`ui-team`、`locale` | S |
| WP03-b | 侧边栏信息架构：按文件夹分组、两行条目、状态图形、相对时间、悬停操作、带计数的收件箱；仿真分组复用同一行结构 | `ui-sidebar`、`ui-team`、`ui-simulation` | L |
| WP03-c | 产品组合移除旧版 `sidebar.workspaces` 树（保留给显式旧组合） | `bundle/web-app`、`ui-workspace` | S |
| WP03-d | `ConnectionBanner` 增加 401/403 凭据失效状态；侧边栏与设置页不再内联显示传输错误 | `ui-primitives`、`connection`、`ui-sidebar`、`ui-settings-general` | M |
| WP03-e | 对话面板：`columns.ts` 增加第三列与让位规则，`SessionStage` 改为右侧可调宽面板，"展开"为全宽，窄视口为 sheet；删除 inspecting 模态变体 | `ui-layout` | L |
| WP03-f | 空状态启动器：hero 输入框直接创建 Team 任务，附文件夹与预设 chip 和建议起点 | `ui-conversation`、`ui-team` | M |

退出条件：e2e 覆盖导航、面板打开/拖拽/展开/关闭、浏览器后退恢复、401 横幅、从空状态创建 Team；`navigation-panes`、`details-session-lifecycle`、`team-workspace` 等现有快照更新且差异逐项评审；1280px 宽度下打开对话后 Team 页面仍可见。

### WP04 Team 任务控制台（阶段 4）

依赖：WP03-e（对话面板）。

| PR | 内容 | 规模 |
|---|---|---|
| WP04-a | 页面头部：派生短标题、可展开目标、状态徽标、按阶段变化的主操作、溢出菜单、诊断弹层（人话摘要 + 复制详情） | M |
| WP04-b | 标签计数与"更多"收纳；紧凑 KPI 行取代四个大卡片 | S |
| WP04-c | "需要你处理"条，取代侧栏待处理卡片 | M |
| WP04-d | 成员泳道：`client/runtime` 新增成员当前活动读模型（推送投影、有界窗口、不轮询），UI 展示活动与近期步骤 | L |
| WP04-e | 任务看板（按阶段分列）与依赖图切换 | L |
| WP04-f | 动态流实时推送；手动刷新移到溢出菜单；术语映射与 tooltip | M |

退出条件：`team-acceptance`、`team-attention`、`team-collections`、`team-member-readiness`、`team-channel` 等套件通过；首屏（1440×900）显示状态、全部待处理事项、成员活动和任务进度；不需要手动刷新即可看到推送的变化。

### WP05 对话区（阶段 5）

依赖：WP01、WP02。WP05-b 依赖调查结论。

| PR | 内容 | 规模 |
|---|---|---|
| WP05-a | 阅读布局（栏宽、`body-reading`、柔和用户气泡）；消息操作改为悬停与 focus-within 时出现 | S |
| WP05-b | 发送者身份：先调查会话事件是否已带结构化发送者。若没有，在 Team 包中为会话事件增加字段，同步两个 SDK 所有方，并补可运行示例快照；之后 UI 渲染身份 chip 并隐藏协议前缀。模型可见文本不变 | L |
| WP05-c | 过程分组：连续的 think/上下文/工具行折叠为"工作了 Ns · M 步"，运行中显示当前步骤，失败时保持展开 | M |
| WP05-d | 工具行：状态图形、耗时、`diff`/`terminal`/`generic` 块统一标题栏 | M |
| WP05-e | 轮次元数据弹层；输入框加状态行、停止按钮、排队插话 chip、上下文环形图 | M |
| WP05-f | Trajectory 缩略导航与 Chat 可折叠侧栏；角色 chip 改用色板 | M |

退出条件：`CLOCKY_SNAPSHOT=replay pnpm run test:web` 通过；`chat-scroll-contract`、`steering`、`queue-actions`、`message-actions`、`trajectory-virtualization` 等套件差异已评审；若 WP05-b 修改了事件，`pnpm run test:snapshot` 和两个 SDK 的验证都通过。

### WP06 仿真观测台（阶段 6）

依赖：WP02-f（`FactValue`/`SimClock`）、WP03-b（侧边栏仿真分组）。06-a 至 06-i 只使用现有读取；06-R1 至 06-R4 是后端读取，分别解锁对应的增强视图。

| PR | 内容 | 规模 |
|---|---|---|
| WP06-a | 运行头部与控制条：阶段徽标与驱动器指示分离、`SimClock`、区间额度分段条、驻留槽位圆点、主机池 chip、单一主操作、启动面板、溢出菜单 | L |
| WP06-b | 运行目录：新行结构、单一"不可用"标签、自动状态刷新（现有 `runStatuses` 批量）、复制 ID、分页紧邻列表 | M |
| WP06-c | 概览："需要你处理"条（审核、取消、未知操作、调度停止、冲突、额度、投递失败）附人话摘要；脉搏行（先用现有计数） | L |
| WP06-d | 效果流水线看板与表格切换；未知卡片打开现有精确重试表单 | M |
| WP06-e | 时间线：基于已加载决策分页的泳道、状态标记、检查点竖线、两端"加载更多"；`BigInt` 坐标；超过约 500 个标记时用 canvas | L |
| WP06-f | 世界：实体列表（类别图标、认知 chip、驻留指示、Team 绑定入口）与所选实体的自我关系图（时间滑块） | L |
| WP06-g | 决策检查器（双时钟、上下文堆叠条、来源链接）与知识卡片（来源类型、前提图、可见性徽标、锁定正文） | M |
| WP06-h | 检查点轨道与恢复分步面板；日志虚拟化、类别 chip、导出进度；创建向导 | L |
| WP06-i | Team 桥接：受管 Team 横幅、实体与参与者双向链接、actor 会话 chip、仿真工具行的提案状态 chip | M |
| WP06-R1 | `simulation-product`：给定时间与作用域的运行级关系分页 → 全局关系图 | M |
| WP06-R2 | 决策浏览的模拟时间范围筛选 → 时间线滚动 | M |
| WP06-R3 | 通信与转移操作摘要中的目标实体 → 因果箭头 | M |
| WP06-R4 | 按区间聚合的序列 → 迷你折线 | M |

每个 R 系列 PR 都必须：在 `simulation-product` 中定义 DTO 与 schema；遵循授权、`maxPageSize`/`maxBytes` 与版本绑定游标；在 `client/runtime` 中接入；补充 Host 测试与拒绝路径测试；更新 README 中英文版与配置目录生成产物。资源余额（R5）需要先做授权决策，本计划不安排实现。

退出条件：`apps/web/tests` 下全部 `simulation-*` 套件在 json 与 sqlite 下通过，其中 `simulation-workspace` 与 `simulation-reading-scale` 的请求数断言不变（不逐行检查）；1000 个实体的运行在世界、时间线和效果视图中流畅；每种真实性状态都有组件测试断言其与领域状态的一一映射。

### WP07 关注事项与全局交互（阶段 7）

依赖：WP02-g、WP04-c、WP06-c。

| PR | 内容 | 规模 |
|---|---|---|
| WP07-a | 外壳快捷键服务：统一注册、注册时冲突检测、输入法组合态保护；`?` 浮层 | M |
| WP07-b | 命令面板接入：Team、成员会话、仿真运行与实体、设置、斜杠命令、新建 Team 任务；提供方经 slot 注册 | M |
| WP07-c | 统一收件箱：Team 与仿真事项单一队列，`J`/`K`/`Enter`/`A`/`R`；仿真事项打开现有表单，保留原始命令语义 | L |
| WP07-d | 任务、成员、产物、实体引用的悬停预览 | S |

退出条件：纯键盘完成收件箱分拣、面板导航、新建 Team；快捷键在输入框和输入法组合态中不误触发。

### WP08 动效（阶段 8）

依赖：WP01-a，以及各页面工作包落地后的对应组件。

内容：按提案的动效规范表逐项落地（面板开合、弹层、对话框、状态变化、运行指示、列表插入、实时提示、标签切换、toast）；只动画 `transform` 与 `opacity`（grid 行高模式除外）；离屏与隐藏标签页暂停循环动画；全局减少动效验证。可使用 `animate` / `review-animations` 技能审查。

退出条件：减少动效 e2e 通过；每个涉及动效的 PR 附 GIF；无布局抖动（标签切换、实时提示）。

### WP09 次要界面（阶段 9）

依赖：WP02。内容：设置（通用、模型、插件、预设）、Team 对话框（`TeamTaskDialog`、`TeamManagementDialog`）、引导页、目录选择器统一字段结构与吸底页脚。退出条件：`settings-chrome`、`models-settings`、`plugin-config`、`agent-preset-authoring`、`team-task-draft` 等套件通过。

### WP10 质量收尾与发布（阶段 10）

内容：两种主题的对比度审计；点击目标与焦点环检查；减少动效；中英文长度在 1280px 与 768px 下的检查；窄视口（抽屉侧边栏、sheet 对话）；`pnpm run test:web:perf` 与 `test:web:stress` 对比基线；样式白名单清空；把提案 Agent Note 从 `proposed/` 转为 `implemented/`，并更新受影响的 README、`web-styling.md` 与架构文档。

退出条件：提案全部验收标准逐项附证据；本计划状态表全部为"已验收"或经确认的"延期"。

## 5. 里程碑与依赖

```text
WP00 ──► WP01-a ──► WP01-b…e ─────────────────────────────┐
              └──► WP02 ──► WP03 ──┬──► WP04 ──┐            │
                                   ├──► WP05   ├──► WP07 ──► WP08 ──► WP10
                                   └──► WP06 ──┘                      ▲
                                        └──► WP06-R1…R4               │
                       WP02 ─────────────────────────► WP09 ──────────┘
```

| 里程碑 | 完成条件 |
|---|---|
| M1 基础可用 | WP00、WP01、WP02 已验收 |
| M2 新外壳 | WP03 已验收 |
| M3 核心界面 | WP04、WP05、WP06-a 至 i 已验收 |
| M4 交互与动效 | WP06-R1 至 R4、WP07、WP08 已验收 |
| M5 发布 | WP09、WP10 已验收 |

可并行的工作：WP01 迁移 PR 之间（按包划分）；M2 之后的 WP04、WP05、WP06（包互不相交）；WP06-R 系列与 WP06 前端 PR；WP09 在 M1 后任意时间。不可并行：同时修改 `ui-theme` 样式表的 PR；同时修改 `ui-layout/columns.ts` 的 PR。

## 6. 分支、PR 与协作规则

- 使用原生 GitHub stack；每个 PR 只做一件事，问题在引入它的 PR 中修复后再向上传播（见 [历史策略](../../notes/implemented/process/2026-08-02-native-github-stacks-and-optional-rebases.md)）。
- 标签：一个 `kind/*`（通常为 `kind/feature`，迁移类为 `kind/cleanup`），所有相关 `area/*`（至少 `area/web`），并设置原生 Issue Type（见 [标签体系](../../notes/implemented/process/2026-08-08-unified-github-label-taxonomy.md)）。
- 每个改变 GUI 行为的 PR 都附一个从真实服务端流程录制的 GIF（`record-browser-gif` 技能）。
- 推送前按 [dsh-pre-push-checks](../../skills/dsh-pre-push-checks/SKILL.md) 选择检查；评审使用 `dsh-code-review`。
- 公开行为变化同步更新包 README 中英文版并重新记录翻译配对；新增导出需要现有消费方；新增依赖须通过 `verify-client-packages`。
- 非平凡变更更新所属 Agent Note；本计划只记录状态与证据，不重复设计理由。

## 7. 验证矩阵

| 变更类型 | 必跑 | 视情况 |
|---|---|---|
| 样式与 token | `pnpm run lint`（含样式门禁）、基线快照 | `pnpm run test:web` 中受影响套件 |
| 基础组件 | `pnpm run test packages/client/ui-primitives`、`pnpm run typecheck` | 消费包的组件测试 |
| 页面与组装输出 | `pnpm run build`、`CLOCKY_SNAPSHOT=replay pnpm run test:web` 中受影响套件 | `pnpm run test:web:perf` |
| `client/runtime` 读模型 | 运行时单测、`pnpm run test:coverage:changed` | 相关 e2e |
| `simulation-product` 读取 | Host 单测与拒绝路径、`pnpm run test:snapshot`、双后端 simulation e2e | `pnpm run gen-config-catalog`、`gen-client-catalog` |
| 会话事件（WP05-b） | `pnpm run test:snapshot`、两个 SDK 的验证 | `pnpm run test:snapshot:record`（需凭据时注明） |
| 文档 | `pnpm run doc-sync` | `verify-translation-pairing --write <pair>` |

每个工作包"待验收"时，在状态表中写明：命令、结果、基线差异评审结论、GIF 链接、未覆盖项。原始日志放在 `.tmp/ui-redesign-evidence/`。

## 8. 风险与应对

| 风险 | 影响 | 应对 |
|---|---|---|
| token 迁移覆盖面大 | 大量快照差异，评审疲劳 | 按包拆 PR；迁移不改布局；基线差异逐项评审；棘轮只降不升 |
| 对话面板改动列求解器 | 拖拽、折叠和窄屏回归 | WP03-e 单独成 PR，复用现有拖拽测试并补充三列场景 |
| 发送者身份需要改事件 | 牵动 SDK 与快照 | 先调查；若需要，Team 包事件变更单独成 PR 并先于 UI 合入 |
| 成员泳道读模型开销 | 推送频率与内存 | 有界窗口、节流到每秒最多 4 次、离屏暂停 |
| 仿真新增读取扩大接口面 | 授权或字节上限遗漏 | 每个读取单独 PR，强制拒绝路径测试与 Host 授权测试 |
| 可视化夸大事实 | 用户误判送达或完成 | 每种编码映射一个具名领域状态，并有组件测试；评审清单逐项核对 |
| 大数值模拟时间 | 坐标溢出、显示错误 | `SimClock` 与坐标计算只用字符串和 `BigInt`；测试覆盖 2^53 以上的值 |
| 快捷键冲突 | 输入框、输入法、浏览器快捷键被吞 | 统一注册服务、冲突检测、组合态保护、e2e 覆盖 |
| 本地环境数据格式过旧 | 开发者无法启动 | 使用隔离 `CLOCKY_HOME`；文档写明，不修改用户数据 |

## 9. 交接记录格式

每完成一个 PR，在对应工作包状态单元格追加一行："PR 链接 · 范围 · 关键命令与结果 · 基线差异结论 · GIF · 未覆盖项"。跨会话交接时，交接方须写明当前分支、stack 位置、未推送提交、正在进行的检查和下一步。

### 交接记录

- 2026-10-03 · 分支 `master`，未建 stack、未提交（全部改动在工作区，等待拆分为 stack PR）· 已跑：`pnpm run typecheck`、`pnpm run build`、改动文件 oxlint、文档门禁（`verify-translation-pairing`、`verify-agent-note-format`、`verify-md-links`、`verify-doc-refs`、`verify-client-style-tokens`、`verify-client-packages`）、客户端单测（359 文件）、全量 `CLOCKY_SNAPSHOT=replay pnpm run test:web:built`（最近一次 95/96 文件通过，唯一失败为负载下 `simulation-administration-acceptance` sqlite 超时，单独运行 30 秒通过）· 金样变化已逐项评审 · 已知：`simulation-process-restart` 在交互变慢时稳定暴露 Team 调度竞态（`TASK_NO_ELIGIBLE_OWNER`），已另开任务 · 下一步：按工作包拆分 PR；WP06 可视化模块与 R1–R4、WP07 统一收件箱、WP08 列表插入与实时提示、WP09 设置类表单错误聚焦、WP10 审计。
