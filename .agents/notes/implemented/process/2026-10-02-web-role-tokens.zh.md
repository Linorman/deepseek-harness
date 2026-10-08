# Agent Note: Web 角色 token——一套色板与基于角色的刻度

Status: implemented

[English](2026-10-02-web-role-tokens.md) | 中文

## Problem

Web 客户端曾有两套并行色板。`--clocky-workspace-*` 为 Team 与仿真页面着色，`--clocky-alias-*` 为其余界面着色，`[data-team-workspace-page]` 作用域再把前者映射到后者，因此 Team 页面与 Session 页面使用不同的画布、文字、边框与强调色。石墨色的 `--clocky-navigation-*` 色板让侧边栏看起来像另一个产品。深色块逐字重复静态色板，`brand-primary-new-colorprimary-new-color`、`accent-700-delete` 等导出残留仍然存在，字体 token 按尺寸命名（`xs-13`，`m-18` 实为 16px）。系统没有间距、圆角、层级、图层或动效刻度，于是 99 个功能 CSS Module 中共有 776 处字面字号、圆角、z-index、时长与颜色，另有 10 处 `var(--clocky-*)` 引用了不存在的 token。[重构提案](../../proposed/feature/2026-10-02-web-ui-redesign.zh.md)要求在任何页面级改动之前先建立统一体系。

## Decision

`packages/client/ui-theme/src/styles/tokens.css` 是唯一的语义层与唯一的色板：

- **颜色角色：** `bg-{canvas,surface,raised,sunken,overlay,sidebar,control,inverse}`、交互底色 `bg-{hover,active,scrim}`、`fg-{primary,secondary,tertiary,disabled,on-accent,inverse}`、`border-{subtle,default,strong,focus}`，以及一条强调色阶 `accent-{fg,bg,bg-hover,subtle,subtle-border}`。浅色值位于 `body`，深色覆盖位于 `body[data-ds-dark-theme]`。色阶（`--clocky-neutral-*`、`--clocky-blue-*`）只在该样式表内部使用。
- **智能体状态：** `status-<state>-{fg,bg,border}`，状态为 `running`、`waiting`、`needs-you`、`blocked`、`done`、`failed` 与 `idle`。
- **字体角色：** `display 28/36`、`title 20/28`、`heading 16/24`、`body 14/22`、`body-strong`、`body-small 13/20`、`body-reading 15/26`、`label 13/20 500`、`caption 12/18`、`micro 11/14`、`mono 13/20` 与 `mono-small 12/18`，每个角色都提供 `font` 简写及 `-size`、`-line-height`、`-weight`。在提案的阶梯之外增加 `body-strong` 与 `body-small`，因为现有界面使用常规字重的 13px 文字和中等字重的 14px 文字，若不改字重，提案中的角色都无法对应。
- **刻度：** 4px 基数的间距、`xs`–`xl` 加 `full` 的圆角、0–4 的层级，以及 `base`、`sticky`、`dropdown`、`overlay`、`modal`、`popover`、`toast`、`tooltip` 图层。`popover` 高于 `modal`，因为从对话框打开的传送门菜单与面板必须位于其上。`local-1`…`local-8` 与 `behind` 只在同一层叠上下文内为兄弟元素排序，不与页面图层竞争。
- **动效：** 时长 `instant 80`、`fast 140`、`base 200`、`slow 280`、`deliberate 400`，另有 `fade`、`spin`、`shimmer`、`sweep`、`dwell`；缓动 `standard`、`enter`、`exit`、`linear`，以及以 `linear()` 近似的 `spring`。在 `prefers-reduced-motion: reduce` 下，所有位移时长变为 `0.01ms`，`animation-iteration-count` 强制为 1，只有 `fade` 保留原时长。

按照预发布立场，所有旧 token 族及其消费方在同一变更中删除：`design-platform.css`（静态、alias、specific、workspace 与 navigation 色板及作用域重映射）、按尺寸命名的字体 token、`--clocky-shadow-lv*`、`--clocky-control-radius`，以及 `--ds-ease-in-out` / `--ds-transition-duration*` 动效变量。侧边栏改为同色调：浅色模式比画布深一级，深色模式再深一级。`ThemeRuntime.overrideTokens` 与已注册主题覆盖角色 token，可检视的 token 清单列出角色 token。

`pnpm run verify-client-style-tokens` 以机械方式执行这套体系。它扫描 `packages/client/*/src` 与 `packages/*/*/src/client` 下的功能 CSS Module，拒绝超出逐文件白名单的字面颜色、字号、圆角、z-index 与时长；计数下降时也会失败，直到 `-- --write` 记录新值；并拒绝引用未定义名称的 `var(--clocky-*)`。它在 `hygiene` 以及 CI 静态与产物门禁中运行。把字面值与旧名称映射为角色的两个一次性迁移脚本位于[开发计划](../../../plans/2026-10-02-web-ui-redesign/development-plan.md)旁的 `tools/` 目录。

## Alternatives considered

**保留角色正确的 `--clocky-alias-*` 名称作为公开层。** 提案允许这样做。但这会让同一角色有两个名称，因为新的刻度与智能体状态没有对应的 alias；第三方主题覆盖 alias 时也无法影响读取角色 token 的消费方。一次性重命名所有消费方后，作者、评审与主题覆盖只使用一套词汇。

**让角色 token 引用 alias。** 这能让旧的覆盖名称继续有效，但会把 alias 层保留为真正的色板，并让每个角色都成为评审必须追溯的间接引用。

**按[样式系统注记](2026-07-19-web-styling-system.zh.md)的决定，不对字号与间距做 token 化。** 字号与行高配对的约定并未收敛：功能 CSS 中有 361 处字面字号，而字体 token 只被使用 89 次，层级随之扁平。角色让机械门禁有了可以要求的对象。

**把所有 z-index 映射到提案的七个页面图层。** 组件用较小的整数在自身层叠上下文内为兄弟元素排序；把它们统一折叠到 `sticky` 会破坏相对顺序，因此由 `local-*` 显式承载。

## Consequences

Team、Session、仿真、设置与侧边栏在两种主题下使用同一套色板，品牌强调色只有一条色阶。功能 CSS 中的字面值从 776 处降到 4 处；剩余条目（8px 的侧边栏徽标、两处 8–9px 的轨迹缩略标签，以及标题内行内代码使用的相对 `0.875em` 字号）分别归侧边栏、对话区与轨迹工作包处理。`tests/tokens.client.spec.ts` 断言两种主题下的角色完整、刻度有序、减少动效映射与对比度下限（文字角色在所有表面上 ≥ 4.5:1，控件边界与焦点 ≥ 3:1）。

代价：石墨色侧边栏的外观不再保留；原先使用近黑色品牌填充的主按钮改用强调色；迁移把部分值取整到最近的刻度（例如 24px 圆角变为 16px，18px 文字变为 20px 的 title 角色），浅色/深色基线评审已接受这些变化。按 alias 名称编写的第三方主题需要重命名其键。
