# Web UI 样式参考

[English](web-styling.md) | 中文

本文规定浏览器客户端包的样式职责归属与组件规则。当前 token 值位于 [`packages/client/ui-theme/src/styles/`](../packages/client/ui-theme/src/styles/)；本文不重复这份清单。

## 职责归属

[`ui-theme`](../packages/client/ui-theme/README.zh.md) 在 `tokens.css` 中负责唯一一套色板与共享刻度：颜色角色、智能体状态角色、字体角色、间距、圆角、层级、图层与动效，另负责 Markdown 字体组合、滚动条样式、语法高亮色板以及明暗主题偏好。[`ui-layout`](../packages/client/ui-layout/README.zh.md) 将解析后的主题快照应用到文档。功能包使用角色 token，不得另行定义全局主题。

全局样式表归 `ui-theme/src/styles/` 所有。组件样式以 CSS Modules 形式放在组件旁。当某个值属于该组件的布局或呈现约定时，组件可以定义局部自定义属性；共享颜色、排版、层级、图层和动效属于主题包。

## 角色 token

| 类别 | Token | 用途 |
|---|---|---|
| 表面 | `--clocky-bg-{canvas,surface,raised,sunken,overlay,sidebar,control,inverse}`、`--clocky-bg-{hover,active,scrim}` | 页面画布、卡片、嵌套与浮层表面、交互底色 |
| 文字 | `--clocky-fg-{primary,secondary,tertiary,disabled,on-accent,inverse}` | 文字与图形 |
| 线条 | `--clocky-border-{subtle,default,strong,focus}` | 分隔线、控件边界（`strong` 达到 3:1）、焦点环 |
| 强调色 | `--clocky-accent-{fg,bg,bg-hover,subtle,subtle-border}` | 唯一品牌色阶：链接、主操作、选中 |
| 智能体状态 | `--clocky-status-<state>-{fg,bg,border}`，状态为 `running`、`waiting`、`needs-you`、`blocked`、`done`、`failed`、`idle` | 徽标、泳道、侧边栏图形、工具行 |
| 分类色 | `--clocky-tint-{teal,fuchsia,olive,slate}-{fg,bg,border}` | 角色或记录类型的身份（头像、轨迹类型 chip）；从不表示状态 |
| 字体 | `--clocky-type-<role>` 及其 `-size`、`-line-height`、`-weight`，角色为 `display`、`title`、`heading`、`body`、`body-strong`、`body-small`、`body-reading`、`label`、`caption`、`micro`、`mono`、`mono-small` | `font: var(--clocky-type-label)` 或分项使用 |
| 间距 | `--clocky-space-{0,1,2,3,4,5,6,8,10,12}`（4px 基数） | 间隙与内边距 |
| 圆角 | `--clocky-radius-{xs,sm,md,lg,xl,full}` | 圆角 |
| 层级 | `--clocky-elevation-{0..4}` | 平面、卡片细线、弹层、对话框或 sheet、toast |
| 图层 | `--clocky-layer-{base,sticky,dropdown,overlay,modal,popover,toast,tooltip}`、`--clocky-layer-local-{1..8}`、`--clocky-layer-behind` | 页面叠放；`local-*` 只在同一层叠上下文内排序 |
| 动效 | `--clocky-duration-{instant,fast,base,slow,deliberate,fade,spin,shimmer,sweep,dwell,orbit,flow,celebrate}`、`--clocky-ease-{standard,enter,exit,spring,emphasized,linear}`、`--clocky-stagger-step` | 过渡、动画与下文的动效层级 |
| 模式身份 | `--clocky-mode-{team,simulation}-{fg,bg,subtle,glow,gradient}` | 标识当前工作区，只用于外壳：背景、模式切换器、标题光晕 |
| 光晕 | `--clocky-glow-{running,needs-you,failed,done}` | 由状态角色组合出的实时状态光晕 |
| 材质 | `--clocky-surface-glass`、`--clocky-blur-glass` | 可视化之上的浮动面板与浮层 |
| 可视化 | `--clocky-viz-{grid,edge,edge-active,edge-ghost,node-ring,halo}` | 图网格、连线、幽灵引用、节点环 |
| 表现型字体 | `--clocky-type-{hero,metric}` | 横幅数字与仪表；`metric` 使用等宽表格数字 |

浅色值位于 `body`，深色覆盖位于 `body[data-ds-dark-theme]`。`--clocky-neutral-*`、`--clocky-blue-*` 等色阶只用于让 `tokens.css` 对每种颜色只命名一次，功能 CSS 不得读取。在 `prefers-reduced-motion: reduce` 下，所有位移时长缩为 `0.01ms`，循环动画只运行一次，只有 `--clocky-duration-fade` 保持原时长，因此组件通过 token 自动继承减少动效。

## 组件规则

- 使用 CSS Modules 和 `clsx`；不得添加组件库或 Tailwind。
- 功能组件使用角色 token。不得写入字面颜色、字号、圆角、z-index 或时长；`pnpm run verify-client-style-tokens` 以只减不增的白名单强制执行，并拒绝引用未定义的 `--clocky-*` 名称。
- 功能组件 CSS 不得包含主题选择器。明暗主题覆盖属于主题所有方。
- 字号与行高通过同一个字体角色配对。
- 当组件约定要求保留列结构时，源码文本、终端输出和 diff 行不得换行；使用共享滚动条样式，不得定义组件专用滚动条选择器。
- 呈现规则写在 CSS 中。React 内联样式可以传递组件局部自定义属性值，但不得编码主题分支。
- 只对 `transform` 和 `opacity` 做动画（`grid-template-rows` 高度模式除外），并使用时长与缓动 token，使减少动效生效。
- 因操作而出现的控件（如对话框和菜单）只用透明度入场：移动的盒子在稳定前会推迟指针可操作性。减少动效时用 `animation: none` 去掉非淡入的入场，而不是依赖压缩后的时长。
- 模式身份 token 只在外壳上标识当前工作区。编码领域状态的选择器（`[data-status]`、`[data-phase]`、`[data-state]`，或含 `status`/`phase`/`state` 的类名）不得读取它们，门禁会拒绝。
- 不对主题切换做动画。主题呈现器在快照落地时暂停过渡一帧（根元素上的 `data-clocky-theme-switching`），颜色过渡只服务于状态变化。
- 保留清晰可见的键盘焦点；悬停时出现的控件在 `:focus-within` 时同样出现。

## 动效层级

跟随实时数据的动效使用四个层级之一。运行分层动效的元素带有 `data-motion-tier="L0|L1|L2|L3"`，测试据此找到它的动画。

| 层级 | 示例 | 时序 | 上限 | 减少动效 |
|---|---|---|---|---|
| L0 环境 | 静态模式背景与目录图形 | 不播放持续动画 | 每屏一个背景 | 静态 |
| L1 实时信号 | 运行节点光晕、频道消息粒子、运行卡片扫光 | 每次飞行 `--clocky-duration-flow` | 同时 24 个粒子；超出部分合并为一个“+N”脉冲 | 一次不透明度闪烁 |
| L2 状态转换 | 看板卡片换列、节点阶段变化、数字滚动、进度环 | `--clocky-duration-base` 到 `--clocky-duration-deliberate`，使用 `--clocky-ease-spring` | 同一时间一组编排；可被打断 | 立即变化 |
| L3 时刻 | 集结、收敛、点火、封存、停滞 | 不超过 `--clocky-duration-celebrate`，只播一次 | 只在实时观察到的转换上播放；任意输入跳过 | 只淡入淡出 |

- 只对实时观察到的变化做动画。首次加载、刷新、回放和导航直接渲染稳定状态，不运行 L2 或 L3 动效，因为把历史变化表演成正在发生会误报它发生的时间。
- React 只在数据变化时渲染。逐帧工作通过 ref 和 Web Animations API 完成，并在文档隐藏或元素离屏时停止。
- `needs-you` 只脉冲一次，不循环；运行指示在减少动效下静止；对话框和菜单保持原地淡入。
- [`ui-viz`](../packages/client/ui-viz/README.zh.md) 内的 SVG 连线绘入可以对 `stroke-dashoffset` 做动画。这是 `transform`/`opacity` 规则的唯一例外；`verify-client-style-tokens` 拒绝其他所有包中的 `stroke-dashoffset` 过渡和关键帧。

## 变更系统

在 `ui-theme/src/styles/tokens.css` 中添加或修改共享 token，然后在功能包中使用。第三方主题通过 `ThemeRuntime.overrideTokens` 覆盖角色 token，覆盖值以内联自定义属性写在 `body` 上。公共样式约定发生变化时，更新所属包的参考文档。视觉行为遵循[测试策略](testing.zh.md)；`apps/web/tests/ui-baseline.snapshot.ts` 采集浅色/深色状态矩阵供评审。[样式系统 Agent Note](../.agents/notes/implemented/process/2026-07-19-web-styling-system.zh.md) 记录框架依据，[角色 token Agent Note](../.agents/notes/implemented/process/2026-10-02-web-role-tokens.zh.md) 记录 token 决策。
