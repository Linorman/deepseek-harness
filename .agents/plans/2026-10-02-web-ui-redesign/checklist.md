# Web UI 重构开发清单

本清单配合[开发计划](development-plan.md)使用，设计依据见[重构提案](../../notes/proposed/feature/2026-10-02-web-ui-redesign.zh.md)。勾选一项时，在该项后补充证据：PR 链接、命令结果或截图/GIF 路径。不适用的项写明"不适用：原因"，不要直接删除。

## A. 开工前

- [x] `pnpm` 在 PATH 中，`pnpm install` 成功，Node 版本满足 `^22.19.0 || >=24.0.0`（Node v25.9.0；本机无全局 pnpm，按 `packageManager` 安装 pnpm 11.7.0 至项目内 `.tmp/tools` 并加入 PATH；`pnpm install --frozen-lockfile` 成功）
- [x] `pnpm run build` 成功（`dev:web` 依赖首次完整构建）（exit=0，日志 `.tmp/ui-redesign-evidence/build-initial.log`）
- [x] 使用隔离数据目录启动：`CLOCKY_HOME=.tmp/ui-dev-home node apps/cli/lib/bin.js web`，未修改 `~/.clocky`（替代：验证经 `apps/web/tests/scaffold.ts` 启动真实 Host 组合，每次运行使用工作区内独立 harness home，从未读取或修改 `~/.clocky`；不调用会打开系统默认浏览器的 handoff）
- [x] 浏览器通过 handoff 完成认证（未使用 `--no-open`），`/api` 请求不再返回 401（替代：脚手架通过真实 local product-principal provider 签发 `clocky_product_auth` cookie，基线套件全部 `/api` 请求成功）
- [x] 准备好仿真组合：复制 `simulation-web` 或 `simulation-administration` 夹具到 `.tmp/` 并修正 `root`，用 `--patch` 启动（`ui-baseline.snapshot.ts` 将 `simulation-web` overlay 复制到 `.tmp/ui-baseline/simulation/world-*` 并修正 `root`，经 `extraOverlayPath`（与 `--patch` 同序）加载）
- [x] 阅读 [client AGENTS](../../../packages/client/AGENTS.md)、[web-styling.md](../../../docs/web-styling.zh.md)、提案中对应阶段
- [x] 在开发计划状态表中把工作包标为"进行中"，并记录起始提交（起始提交 `b6fd164589`）

## B. 每个 PR 的完成定义

### B1 代码

- [ ] 只做一件事；与 stack 中上下游 PR 边界清晰
- [ ] 组件只接收 props，不读取 `ctx`、服务或 React context
- [ ] 业务数据留在 `client/runtime`；组件不把外部快照复制进本地 state 或 store
- [ ] 订阅留在 `ui-renderer`；读取外部可变数据使用框架 hook
- [ ] 新增导出有现有消费方；内部组件和辅助函数不导出
- [ ] 跨功能通信经由 slot 或服务，不新增绕过组合的导出
- [ ] 联合类型按判别字段分支：封闭联合以 `assertNever` 结尾，可扩展联合有文档化的默认分支
- [ ] 空 catch 写明吞掉的失败及原因
- [ ] 新增依赖通过 `pnpm run verify-client-packages`

### B2 样式

- [ ] 只使用角色 token；没有字面颜色、字号、圆角、z-index、时长
- [ ] 样式门禁的白名单计数没有上升（迁移 PR 必须下降）
- [ ] 没有在功能 CSS 中写主题选择器（浅色/深色分支只属于 `ui-theme`）
- [ ] 字号与行高成对出现，并使用字体角色
- [ ] 只对 `transform`、`opacity` 做动画（grid 行高模式除外）；已接入全局减少动效
- [ ] 焦点环可见；纯悬停控件在 focus-within 时同样出现

### B3 文案与本地化

- [ ] 产品文案中文优先，英文 locale 同步
- [ ] 统一术语：团队任务 / 工作文件夹 / 收件箱 / 仿真 / 实体 / 决策 / 操作 / 检查点 / 日志
- [ ] 主内容区没有原始 ID、传输错误或协议文本；需要时放在"详情/复制"入口后
- [ ] 中英文在 1280px 和 768px 下都不溢出、不截断关键信息

### B4 测试与证据

- [ ] 组件测试断言可见行为、键盘路径和 ARIA（jsdom 规格首行有环境注释）
- [ ] 改动了拒绝路径或错误路径时，有对应测试
- [ ] 受影响的 `apps/web/tests` 套件通过：`CLOCKY_SNAPSHOT=replay pnpm run test:web`
- [ ] 视觉基线差异逐项评审，并在 PR 中说明是有意变化还是回归
- [ ] 改变 GUI 行为时，附从真实服务端流程录制的 GIF
- [ ] 按 `dsh-pre-push-checks` 选择并运行检查；PR 描述列出命令与结果

### B5 文档与流程

- [ ] 公开行为变化已更新包 README 中英文版，并重新记录翻译配对
- [ ] 非平凡变更已更新所属 Agent Note
- [ ] `pnpm run doc-sync` 通过
- [ ] 标签：一个 `kind/*`、所有相关 `area/*`（至少 `area/web`）、原生 Issue Type
- [x] 开发计划状态表已追加交接记录行（`development-plan.md` §9“交接记录”，含分支、提交状态、已跑检查、已知问题与下一步）

## C. 工作包清单

### WP00 基线与护栏

- [x] 新增 `apps/web/tests/ui-baseline.snapshot.ts`，复用 `scaffold.ts` 与 replay 夹具（输出 `.artifacts/ui-baseline/<label>/`，改造前参考为 `before-redesign`，共 42 张图 + 2 份 SHA-256 清单）
- [x] 覆盖状态：空状态（`01-empty`）
- [ ] 覆盖状态：Team 运行中 / 停滞 / 完成（部分：已覆盖运行中 `02`/`03` 与已结束（取消）`05`；停滞状态需要协调者失败夹具，待补）
- [ ] 覆盖状态：协调者对话（思考、上下文注入、工具行、审批、提问、计划评审）（部分：已覆盖协调者对话面板 `04`；工具/审批/提问/计划评审由 `seeded-history`、`approval-composer`、`question-composer`、`plan-review` 的 ARIA 金样覆盖，像素基线待补）
- [x] 覆盖状态：设置弹窗（通用、模型、插件）（`07`–`09`）
- [x] 覆盖状态：仿真目录、概览、实体、决策、操作、检查点、日志（`20`–`26`）
- [ ] 覆盖状态：仿真创建对话框、开始确认（待补：需要 `simulation-administration` 管理组合；现有 `simulation-administration.snapshot.ts` 已输出 `00-preflight-desktop.png`、`02-start-budget-desktop.png` 作为参考）
- [ ] 每个状态 × 浅色/深色 × 1440×900 与 390×844（部分：全部状态 × 浅色/深色；固定几何的对话框与次级模块只采集 1440×900）
- [x] 连续两次 replay 运行零差异（排除时间、随机 ID 和动画）（`CLOCKY_UI_BASELINE_COMPARE=wp00-run1` 对比第三次运行：2 passed；容差为字体抗锯齿噪声 ≤64 像素、通道差 >48；仿真 18 张逐字节一致。Team 发现顺序按不透明 ID 排列，第二个 Team 出现后的状态遮罩导航栏，该缺陷归 WP03-b）
- [x] 新增 `scripts/verify-client-style-tokens.ts` 与 `.spec.ts`（22 个测试通过）
- [x] 规则：字面颜色（hex、`rgb()`、`hsl()`、命名色）、`font-size`、`border-radius`、`z-index`、`ms`/`s` 时长（另检查未定义的 `var(--clocky-*)` 引用，零容忍）
- [x] 例外：`ui-theme` 样式表、`web/src/boot-page.module.css`（启动页 token 早于主题加载）（门禁只扫描 `*.module.css`，全局样式表天然不在范围内）
- [x] 白名单按文件记录当前计数；计数上升或出现新文件时失败（`scripts/client-style-tokens.allowlist.json`：86 个文件 776 处；计数下降也失败，直到 `-- --write` 锁定降低值；`--write` 拒绝提高）
- [x] 接入 `run-gates.ts`（lint 或 hygiene），并有一个故意违规的失败测试（接入 `hygiene`、CI 共享静态门禁与 artifact 门禁；`run-gates.spec.ts` 已更新；51+22 测试通过）
- [x] 修复 `ui-simulation` 中未定义的 `--clocky-alias-text-primary`（同时修复其余 9 个未定义引用：`alias-bg-default`、`alias-stroke-default`、`alias-fill-l2`、`alias-fill-tsp-secondary`、`alias-label-error`、`alias-label-quaternary`、`alias-line-secondary`、`alias-separator-primary`、`font-mono`）

### WP01 设计 token 基础

- [x] 颜色角色：`bg/*`、`fg/*`、`border/*`、`accent/*`，浅色与深色各一套（`ui-theme/src/styles/tokens.css`，另含 `bg-sidebar`/`bg-hover`/`bg-active`/`bg-scrim`）
- [x] 状态角色：`running`、`waiting`、`needs-you`、`blocked`、`done`、`failed`、`idle`，各含 `fg`/`bg`/`border`（`tokens.client.spec.ts` 断言两种主题完整）
- [x] 字体角色：`display`、`title`、`heading`、`body`、`body-reading`、`label`、`caption`、`micro`、`mono`、`mono-small`（`--clocky-type-<role>` 简写及 `-size`/`-line-height`/`-weight`）
- [x] 间距 4px 基数刻度；圆角 `xs`–`xl`、`full`；层级 0–4；图层 `base`–`tooltip`（图层另含 `behind`、`local-1…8`（同一层叠上下文内排序）与 `popover`（需高于模态的传送门浮层），有序性有测试）
- [x] 动效时长 `instant`–`deliberate`；缓动 `standard`、`enter`、`exit`、`spring`（`linear()` 近似）（另含循环指示用 `spin`/`shimmer`/`sweep` 与 toast 停留 `dwell`）
- [x] 全局 `prefers-reduced-motion` 映射（透明度渐变除外）（时长 token 归零，`--clocky-duration-fade` 保留；循环动画只跑一次）
- [x] 两种主题下正文对比度 ≥ 4.5:1、UI 图形 ≥ 3:1（附测量记录）（测量表 `.tmp/ui-redesign-evidence/wp01-contrast.md`；`tokens.client.spec.ts` 以门限断言，ui-theme 96 测试通过）
- [x] 迁移脚本：字面值 → 最近 token，输出无法映射清单（`tools/migrate_style_literals.py` 与 `tools/rename_legacy_tokens.py`；未映射项：8–9px 字号 3 处）
- [x] 迁移 `ui-primitives`、`ui-layout`、`ui-sidebar`
- [x] 迁移 `ui-conversation`、`ui-tool`、`ui-trajectory`、`ui-attachment`、`ui-user-questions`、`ui-plan`、`ui-jobs`、`ui-model-selection`、`ui-permission-presets`、`ui-message-feedback`、`ui-deliverables`、`ui-input-trigger`、`ui-commands`
- [x] 迁移 `ui-team`、`ui-simulation`、`ui-workspace`、`ui-settings-*`、`ui-agent-preset`、`ui-skill`、`locale`、`ui-theme` 客户端组件、目录选择器（另含 `extensions/ui-cordis`、`session-log-export` 的客户端 CSS；白名单 776 → 4，剩余归 WP03-b/WP05）
- [x] 删除 `[data-team-workspace-page]`、`[data-workspace-form]`、`[data-simulation-workspace-page]` 的 alias 重映射（`design-platform.css` 整体删除）
- [x] 删除 `--clocky-workspace-*`、`--clocky-navigation-*`；源码零引用（`packages`/`apps`/`scripts`/`docs` 中零引用；同时删除全部 `--clocky-alias-*`/`specific`/`static` 与 `--ds-ease`/`--ds-transition-*`，消费方改用角色 token）
- [x] 删除深色块中重复的静态色板
- [x] 删除导出残留名称（`brand-primary-new-colorprimary-new-color`、`accent-700-delete` 等）及按尺寸命名的字体 token
- [x] 统一品牌强调色为一个色阶（`--clocky-blue-*` 一条色阶，`accent-*` 角色）
- [x] 侧边栏改为同色调（浅色比画布深一级，深色再深一级）（基线 `.artifacts/ui-baseline/wp01/02-team-active--{light,dark}--desktop.png`）
- [x] 第三方主题仍可通过 alias 覆盖（有测试）（决定改为通过角色 token 覆盖，见 role-token 注记；`ui-theme/tests/theme.client.spec.ts` 注册与叠加覆盖、`ui-layout/tests/theme-presenter.client.spec.ts` 内联应用均有测试）
- [x] 更新 `web-styling.md` 中英文版、`ui-theme` README 中英文版（翻译配对已重新记录）
- [x] 新建已实现的 token 决策 Agent Note；更新样式系统注记（`.agents/notes/implemented/process/2026-10-02-web-role-tokens.md`；样式系统注记标明第 3 条被取代）

### WP02 基础组件

- [x] `Button`：`sm/md/lg` × `primary/secondary/ghost/danger`；禁用与加载态（`outline` 统一改名为 `secondary`，52 处消费方同步）
- [x] `IconButton`：缺少无障碍标签时类型报错（`@ts-expect-error` 断言）
- [x] `Tabs`：下划线/分段；计数徽标；方向键 roving focus；溢出到"更多"（含输入法组合态保护）
- [x] `StatusBadge` / `StatusGlyph`：7 种状态；运行态动画在减少动效下静止（7 种形状互不相同，测试断言）
- [x] `Card` / `Section`：标题、操作区、可折叠空状态
- [x] `EmptyState`：图标 + 一句话 + 一个操作
- [x] `Skeleton`、`KeyValue`、`Avatar`（首字母、角色色调）、`Kbd`
- [x] `Popover`：触发器原点、Esc 关闭、焦点返回、外部点击关闭
- [x] `Sheet`：焦点陷阱、Esc、遮罩、窄视口全屏（原生模态 dialog 负责焦点包含与背景惰性）
- [x] `SplitPane`：拖拽、键盘调整、最小宽度、复用 `DragHandle` 逻辑（指针捕获 + rAF 节流与 AppFrame `DragHandle` 同构，WP03-e 改由其承载）
- [x] `FactValue`：六种状态各有可区分外观与可读文本（屏幕阅读器可读）
- [x] `FactValue`：不可用永远不显示为 `0`（测试断言）
- [x] `SimClock`：保留十进制字符串；分组与本地化单位；tooltip 显示精确值
- [x] `SimClock`：2^53 以上的值显示正确（测试断言）
- [x] `CommandPalette` 外壳：分组、模糊匹配、预览、↑↓/Enter/Esc、输入法组合态保护
- [ ] 每个组件都有 jsdom 测试；导出随第一个消费 PR 发布（jsdom 测试已完成：ui-primitives 29 文件 565 测试通过；按导出纪律，新组件在 WP03 起的首个消费方中导出）
- [x] `ui-primitives` README 中英文版更新（随首个导出一起更新）（中英文 README 列出已导出的 Avatar、Kbd、Popover、FactValue、SimClock、CommandPalette、ConnectionBanner，说明未导出组件待首个消费方，并更新 DiffBlock 标题栏、Toast 生命周期与 Modal/Menu 入场；翻译配对已记录）

### WP03 外壳与导航

- [x] 中英 locale 统一术语，删除"New Task / Tasks / Workspaces"等旧文案（团队工作→团队任务、工作目录/工作区→工作文件夹；主导航 aria 名改为"主导航 / Main navigation"；英文 `Tasks` 仅保留为 Team 内任务标签页）
- [x] 侧边栏：品牌 + 搜索触发器 + 唯一主操作 + 收件箱计数徽标（品牌、唯一强调色主操作"新建团队任务"、带未读数的收件箱入口；搜索触发器 `searchTrigger` 打开命令面板，轨道态为带 tooltip 的图标按钮）
- [x] Team 按工作文件夹分组；两行条目（短标题、相对时间）；状态图形；悬停操作（`ui-team/src/client/team-row.ts` + `TeamBrowser`；按最近更新稳定排序，修复了 WP00 发现的随机顺序；`team-row.client.spec.tsx` 7 测试）
- [ ] 仿真分组复用同一行结构（阶段图形 + `SimClock`），未部署时不显示（待做：需 ui-simulation 注册侧边栏分组）
- [x] 折叠为 56px 图标栏时，图标、徽标和 tooltip 正确（收件箱在轨道中为带计数徽标与 tooltip 的图标按钮）
- [x] 产品组合移除 `sidebar.workspaces`；显式旧组合仍可挂载（`bundle/web-app` 客户端名单本就不含 `ui-workspace`；e2e 脚手架 `legacyWorkspaceSurface` 显式挂载仍可用）
- [x] `ConnectionBanner` 401/403 状态：说明凭据失效及如何从终端重新打开（runtime 新增 `sessions.connection` 与 `useConnection` 标准 hook；`rpcErrorFrom` 保留访问拒绝错误码；横幅位于 `shell.overlay`；`shell-navigation.snapshot.ts` 以真实凭据轮换验证）
- [x] 侧边栏与设置页不再内联显示传输错误（侧边栏隐藏访问拒绝、其他失败显示产品文案并悬停保留原文；Agent 预设行/区块同样处理）
- [x] `columns.ts` 增加对话面板列及让位规则（单测覆盖）（`computePane`：首选 480、380–880、Team ≥480，之后 sheet；7 个单测）
- [ ] 对话面板：打开、拖拽调宽、展开全宽、关闭、浏览器后退恢复（部分：打开、指针/键盘调宽、展开、Escape/按钮关闭已由 jsdom 与 e2e 覆盖；浏览器后退恢复沿用既有 Team 路由，尚无面板专项 e2e）
- [x] 窄视口下对话以 sheet 呈现（< TEAM_MIN+PANE_MIN 时；基线 `04-coordinator-session--*--narrow`）
- [x] 删除 `SessionStage[data-inspecting]` 模态变体及三层叠加标题（改为非模态 `section[data-conversation-pane]`，单行面板头；e2e 选择器同步）
- [x] 1280px 宽度打开对话后，Team 页面仍可见（e2e 断言）（`shell-navigation.snapshot.ts` 断言 Team 宽度 ≥480 且不与面板重叠）
- [x] 空状态启动器：输入框可直接创建 Team 任务；文件夹 chip、预设 chip、建议起点（`HeroLauncher`；e2e 用纯键盘从启动器创建团队任务）
- [x] 不再出现禁用的"从侧边栏开始"输入框（存在 Team 草稿时输入框始终可用，产品组合启动即有草稿）
- [x] 更新 `navigation-panes`、`details-session-lifecycle`、`team-workspace`、`rail-search-expand`、`sidebar-scrollbar` 快照并评审（全量 web 通道：这些套件通过；`navigation-panes` 轨迹金样只因类型标签改为句首大写而变化，`sidebar-scrollbar` 金样因搜索触发器变化，逐项评审为有意变化）

### WP04 Team 任务控制台

- [x] 头部：面包屑（文件夹 › Team）；派生短标题；可展开的完整目标（`TeamHeader`：`nav` 面包屑、`deriveShortTitle`、`<details>` 完整目标）
- [x] 头部：单一状态徽标；按阶段变化的主操作；溢出菜单（`StatusBadge`；停滞/离线时主操作为恢复，否则为与协调者沟通；取消在 ⋯ 菜单并以 danger 确认）
- [x] 原始诊断移入状态弹层：人话摘要 + 复制详情（停滞原因进入"查看原因"弹层，含人话摘要与复制详情；测试断言原文默认不可见）
- [ ] 标签显示计数；无内容模块收进"更多"（部分：任务/成员/产物显示计数徽标，工作流/审计/待处理在"更多"；按内容动态隐藏尚未实现）
- [x] 紧凑 KPI 行取代四个大卡片；为零的模块折叠（头部 KPI 行：完成/总数、执行中、需要你处理、Tokens；概览大卡片删除；待处理为零时折叠为一行）
- [x] "需要你处理"条：审批、提问、计划评审、阻塞项，带内联主操作（`TeamAttention` 预览移到概览顶部整行，取代侧栏卡片；条目沿用既有内联打开动作）
- [ ] 成员泳道读模型：推送投影、有界窗口、无轮询（runtime 单测）（待做：当前活动需要新的 runtime 读模型）
- [ ] 成员泳道 UI：头像、角色、状态、当前活动、近期步骤；点击在对话面板打开会话（部分：头像、角色、执行状态徽标（协议术语在 tooltip）、打开 Session 已完成；当前活动与近期步骤待读模型）
- [x] 任务看板按 `TeamTaskSnapshot['phase']` 分列；卡片含主题、负责人、阻塞项（`TaskBoard`：待执行/执行中/待审核/已完成/失败或取消，列头为权威计数，卡片含负责人头像与依赖数）
- [ ] 存在 DAG 数据时可切换依赖图（待做）
- [x] 动态流实时推送，带相对时间（Team 游标推进后 400ms 合并重读，保留当前行；相对时间，绝对时间在 tooltip）
- [ ] 所有手动刷新按钮移入溢出菜单"从服务器重新加载"（部分：概览动态流移入 ⋯ 菜单；待处理预览只在有更新/失败/断线时提供重读；其他集合页的显式刷新尚未处理）
- [x] 执行与参与状态改用人话标签，tooltip 保留协议术语（成员泳道徽标显示执行状态人话标签，参与阶段与协议术语进 tooltip；头部状态徽标 tooltip 为协议阶段名）
- [x] 首屏（1440×900）同时可见：状态、全部待处理、成员活动、任务进度（`team-workspace.snapshot.ts` 在 1440×900 断言头部状态徽标、需要你处理条、团队成员与任务执行区均在首屏内，截图 `01b-first-screen-1440x900.png`；成员泳道改为名称独占首行、角色与就绪徽标同在第二行，修复窄栏中名称被截成“c…”且与徽标重叠的问题；“打开 Session”统一为“打开会话”）
- [ ] `team-*` 系列 e2e 通过，差异已评审

### WP05 对话区

- [x] 阅读栏宽 720–760px；助手正文使用 `body-reading`（栏宽 748px；Markdown 正文改为 15/26 `body-reading`）
- [x] 用户气泡改用 `accent/subtle`（WP01 迁移后气泡背景为 `--clocky-accent-subtle`）
- [x] 消息操作在悬停和 focus-within 时出现，键盘可达（`MessageIconActions` 在 `data-time-hover-root` 内悬停/focus-within/focus-visible 时显示）
- [x] 调查：会话事件是否已带结构化发送者（记录结论）（结论：`team-agent-client` 生成的 user message 已带 `source: { kind: 'team-envelope', senderId, channelId, envelopeId, delivery }`，无需新增事件字段）
- [x] 如需修改事件：在 Team 包中修改，同步 TS 与 Python SDK，补可运行示例快照（不适用：无需修改事件，见上一项结论）
- [x] 身份 chip 渲染；协议前缀隐藏；模型可见文本不变（快照断言）（`chat/team-sender.ts` 只在展示层去掉精确前缀；单测断言记录内容不被修改；模型可见文本由 `team-agent-client` 原有测试固定）
- [x] 过程分组："工作了 Ns · M 步"；运行中单行实时提示（每秒最多 4 次）（`chat/process-groups.ts` + `ProcessGroup`：连续 ≥2 个工具/上下文/纯思考步骤合并；运行中显示"正在运行 {tool}"与耗时，250ms 节流；最新分组默认展开以便观察当前回合，较早分组折叠）
- [x] 失败步骤使分组保持展开，并使用 `failed` 状态色（失败分组强制展开、禁用折叠，标题使用 failed 色与图形）
- [x] 工具行：前置状态图形、右对齐耗时（前置槽在失败/中断时显示状态点；`toolDurationMs` 右对齐显示已结算调用耗时）
- [ ] `diff`/`terminal`/`generic` 块统一标题栏（路径、语言、复制）（部分：`DiffBlock` 改用与 `ReadBlock` 相同的标题栏——单文件显示路径、多文件显示文件数，`+A −R` 摘要与复制并排，去掉浮动复制按钮和页脚；`TerminalBlock` 原本就是命令标题栏；generic 卡片与标签本地化待做）
- [x] 遥测行改为每轮次"ⓘ"弹层（输入框下仅保留轮数/步数，计时、速度、缓存与 token 收进"ⓘ"弹层；当前为会话级，逐轮弹层待做）
- [x] 输入框：状态行（当前步骤 + 停止）、排队插话 chip、上下文环形图（运行中在输入框工具栏显示状态：正在运行的工具名、思考/回复/处理，以及第几步，`role="status"`；放在工具栏内而非新增一行，避免回合中输入框高度变化使对话记录失去贴底；停止仍是主按钮；`composer-activity.ts` 纯函数与 InputBar jsdom 测试覆盖；排队插话行与上下文环形图此前已完成）
- [x] 模型、权限、预设 chip 在左侧编组，发送在右（模型座位移入左侧 modes 组，右侧为上下文环与发送）
- [ ] Trajectory 缩略导航；Chat 中的可折叠缩略侧栏
- [x] 角色 chip 改用色板，去掉大写彩色文字（`tokens.css` 新增分类色 `--clocky-tint-{teal,fuchsia,olive,slate}`，避开状态色相并有对比度测试；轨迹类型 chip 与时间线标签改为句首大写、中等字重，按类型取分类色，工具行不再借用“需要你处理”的琥珀色；`Avatar` 同步改用分类色；轨迹表格文案本地化另行处理）
- [x] `chat-*`、`steering`、`queue-actions`、`message-actions`、`trajectory-virtualization`、`question-composer`、`plan-review`、`approval-composer` 套件通过（全量 `CLOCKY_SNAPSHOT=replay pnpm run test:web:built`；金样变化逐项评审：Team 发送者 chip、过程分组、工具耗时、统计弹层、运行状态行、类型标签大小写、答案输入框 6 行上限改用行高计算）

### WP06 仿真观测台

前端（仅用现有读取）：

- [x] 头部：已保存阶段徽标与驱动器指示分离；"已请求运行、未观察到驱动器"为空心圆环（`phaseStatus`/`driverStatus`；运行阶段为 waiting 徽标，驱动器未观察到工作时为空心环并附说明；单测断言）
- [x] 头部：`SimClock` 显示当前模拟时间（分组显示，精确值与单位在 tooltip；单测覆盖 2^53 以上值）
- [ ] 额度分段条：已知占用、预留、未知（斜纹）、追加额度；区间进度；"占用不等于实际用量"说明（部分：已占用/上限 meter、未知尝试斜纹标记、既有"占用不等于实际用量"说明已完成；预留与追加额度需要新读取字段）
- [x] 驻留槽位圆点：活跃、预留、已撤销待释放（空心）、空闲（按现有字段映射：已占用=活跃、需恢复=空心描边、空闲；预留态待读取字段）
- [x] 主机模型池为独立 chip，标明主机全局（概览标题旁的“主机全局 · 模型池 a / b · 排队 q”chip，悬停说明其按真实时间观察并包含其他运行；未观察到时为虚线“模型池未观察到”；完整明细仍在“主机资源”折叠中；单测覆盖中英文）
- [x] 单一主操作遵循 Host 开始/暂停提示；待定时保留标签并显示进度（Host 允许的动作为唯一主按钮；进行中的开始/暂停按钮保留原标签并以 `loading` 显示进度与 `aria-busy`；`administration.client.spec.tsx` 覆盖）
- [ ] 启动面板以卡片展示模型路由、单次预留、区间额度、驻留上限、主机并发
- [x] 未知结果只提供查询与精确重试（`CommandRecord` 在结果未知时只渲染“查询原结果”与“重试原操作”，并加 `data-outcome-unknown` 斜纹未知样式，与 `FactValue` 未知态一致；单测断言按钮集合）
- [ ] 溢出菜单：检查点、恢复、实体输入、日志导出、请求历史（部分：请求历史在模块“更多”菜单；检查点、恢复、实体输入、准备仍在“更多操作”折叠区，因为每项需内联显示不可用原因，改为菜单需同时设计禁用原因呈现并改写约 31 处 e2e 交互，暂缓）
- [ ] 目录：新行结构；单一"不可用"标签及原因（部分：不可用值统一为 `FactValue` 虚线空槽并附原因；行结构仍为状态摘要列表）
- [x] 目录：状态随 `controlRefreshMs` 自动刷新；删除"刷新运行状态"按钮（既有轮询保留；手动刷新移入列表 ⋯ 菜单作为恢复操作）
- [x] 目录：复制 ID 进入溢出菜单；分页紧邻列表（每行 ⋯ 菜单"复制 ID"，技术详情折叠移除；分页保持在列表下方）
- [ ] 概览"需要你处理"：审核、取消、未知操作、调度停止、冲突确认、额度/容量追加、投递失败（部分：概览顶部 `NeedsYou` 条汇总待审核、结果未知操作、待核对请求（含冲突）并分别打开对应处理面，无事项时为一行说明；取消、调度停止、额度/容量追加、投递失败需要额外读取，待接入）
- [ ] 每项都有人话摘要；任务与操作 ID 可在展开项中复制
- [ ] 审核、重试、取消打开现有表单，草稿与原始命令语义不变
- [ ] 脉搏行：人口仪表、决策队列、效果流水线计数
- [ ] 效果看板：待处理 → 已应用/已拒绝 → 已发布 → 输入已持久化 → 已回执；已阻塞与结果未知侧泳道
- [ ] 效果卡片：类别、实体、决策链接、任务引用；"回执不等于业务接受"说明常驻
- [ ] 效果表格视图保留为切换
- [ ] 时间线：实体泳道（虚拟化）、决策状态标记、槽位堆叠、操作刻度、检查点竖线、当前时间游标
- [ ] 时间线：`BigInt` 坐标；密集时分桶；超过约 500 个标记切换 canvas
- [ ] 时间线：两端显式"加载更多"（R2 落地前）
- [ ] 世界：类别图标、认知 chip、驻留指示、名称两行截断
- [ ] 世界：Team 绑定在对话面板中打开 actor 会话
- [ ] 世界：所选实体的自我关系图 + 时间滑块（基于现有 `relationships` 分区）
- [ ] 决策检查器：模拟时间与真实推理时间双时钟
- [ ] 决策检查器：上下文按分区字节的堆叠条（必选/可选）；"本地冻结视图，不是完整模型请求"标签常驻
- [ ] 决策检查器：来源链接到确切 Team 频道
- [ ] 知识卡片：来源类型图标、前提推导图、可见性徽标、锁定正文及所需权限
- [ ] 检查点轨道：进行中/失败（阶段与代码 chip）/完成（`publishedAt`）；突出最近成功
- [ ] 恢复分步面板：选择 → 分页引用 → 确认；写明后果
- [ ] 日志：虚拟化；类别 chip；"序号（非时间）"列；`JsonTree` 原文（有权限时）
- [ ] 导出：后台进度条、最终校验步骤、可取消；失败不产生文件
- [ ] 创建向导：左侧步骤、右侧摘要、内联预检问题、暂停创建说明
- [ ] 创建：放弃/保留输入改为关闭行为并需确认
- [x] 过期改为中性"有更新 · 刷新 (R)"标签；红色只用于真实失败（文案"有更新 · 请刷新首页"，`stalePill` 中性样式；`Feedback` 只把 alert 染红；快捷键 R 随 WP07 接入）
- [ ] Team 桥接：受管 Team 横幅与返回链接；实体与参与者双向链接
- [ ] actor 会话 chip；仿真工具行的已暂存/已提交/已接受提案 chip
- [ ] URL 深链与浏览器后退在新模块（世界、时间线、效果）中保持

后端读取（每项单独 PR）：

- [ ] R1 运行级关系分页（时间、作用域）：DTO、schema、授权、`maxPageSize`/`maxBytes`、版本绑定游标、拒绝路径测试、README 中英文版
- [ ] R1 前端：全局关系图；节点上限；按作用域/类别聚类；表格回退
- [ ] R2 决策时间范围筛选：同上全部要求
- [ ] R2 前端：时间线连续滚动替代"加载更多"
- [ ] R3 操作摘要目标实体：同上全部要求
- [ ] R3 前端：因果箭头线型 = 虚线已接受 / 实线已发布 / 实心箭头已回执
- [ ] R4 区间聚合序列：同上全部要求
- [ ] R4 前端：脉搏行迷你折线
- [ ] R5 资源余额：仅记录为延期，未做授权决策前不实现

验收：

- [ ] 全部 `simulation-*` e2e 在 json 与 sqlite 下通过
- [ ] `simulation-workspace`、`simulation-reading-scale` 的请求数断言不变（无逐行检查读取）
- [ ] 1000 实体运行在世界、时间线、效果视图中流畅（记录帧率或交互耗时）
- [ ] 每种可视化编码与领域状态一一映射，并有组件测试（见附录 E）

### WP07 关注事项与全局交互

- [x] 外壳快捷键服务：统一注册、冲突检测（注册时报错）、输入框与输入法组合态保护（`ui-layout/src/client/commands.ts`：`ctx.layout.registerShortcut` 返回 disposer，同一规范化组合键再次注册抛 `ShortcutConflictError`；`isComposing`/`Process` 与可编辑目标保护；`commands.client.spec.ts` 4 测试）
- [x] `?` 快捷键浮层列出全部已注册快捷键（AppFrame `ShellOverlays`：按所有者分组，`Kbd` 显示平台按键；jsdom 与 `shell-navigation.snapshot.ts` 覆盖）
- [ ] 命令面板 `⌘K`/`Ctrl+K`：Team、成员会话、仿真运行与实体、设置、斜杠命令、新建 Team 任务（部分：面板外壳、Team、新建 Team 任务、当前 Team 的成员会话、设置及其各分区、打开仿真与已加载运行已接入，侧边栏搜索触发器打开面板；设置经 `openRequests` 外部请求只为面板的本地开合状态提供初值；仿真实体与斜杠命令待接入）
- [x] 命令面板提供方经 slot 注册，无新增跨功能导出（实现为 `ctx.layout.registerCommands(provider)` 注册表 + `ctx.effect()` 释放，而非 slot：条目是数据与回调、不是组件；ui-team 与 ui-simulation 只用既有 `ctx.layout` 依赖，没有新增跨功能导出；`apply.client.spec.tsx` 断言释放后条目消失）
- [ ] 统一收件箱：Team 与仿真事项合并为单一队列，按优先级排序
- [ ] 键盘：`J`/`K` 移动、`Enter` 打开、`A` 批准、`R` 拒绝或跳过（部分：收件箱内 `J`/`K` 在条目间移动、`Enter` 打开焦点条目所属 Team，输入框与输入法组字不受影响，`human-inbox.client.spec.tsx` 覆盖；`A`/`R` 需要统一收件箱队列后接入审批表单）
- [ ] 乐观 toast 与撤销（仅后端允许时）
- [ ] 仿真事项打开现有表单，保留原始命令与当前栅栏语义
- [ ] 任务、成员、产物、实体引用的悬停预览（部分：成员引用在身份已解析时悬停显示头像、名称与参与阶段，点击仍打开成员检查器，`member-reference.client.spec.tsx` 覆盖；任务、产物、实体引用待做）
- [x] e2e：纯键盘完成分拣、导航、新建 Team（`shell-navigation.snapshot.ts`：从启动器纯键盘新建 Team、`⌘K` 面板跳转 Team、`?` 浮层；`action-window.snapshot.ts`：收件箱内 `K`/`J` 移动与 `Enter` 打开所属 Team；`A`/`R` 随统一收件箱另行覆盖）

### WP08 动效

- [x] 面板开合、侧边栏折叠：`slow` + `standard`；拖拽时无动画（框架列与侧边栏折叠原本使用 `slow` + `standard` 并在拖拽时 `transition: none`；对话面板的展开／恢复现在同样以 `slow` + `standard` 过渡列宽，指针拖拽面板分隔条时暂停（键盘调宽每步按同一过渡缓动）；减少动效经 token 生效）
- [ ] 弹层/菜单：scale 0.97→1 + 淡入（`fast` + `enter`）；退出 `instant` + `exit`；原点位于触发器（部分：`Popover` 从触发器缩放淡入，`transform-origin` 由 `useAnchoredPosition` 按触发器计算；`Menu` 改为原地淡入——缩放会推迟指针可操作性，并使 `simulation-process-restart` 稳定暴露一个 Team 调度竞态，已另开任务；退出动画未做）
- [ ] 对话框/sheet：translateY 8px + 淡入（`base` + `enter`）（部分：`Sheet`、命令面板为位移淡入；`Modal` 为原地淡入加遮罩淡入，原因同上）
- [x] 状态变化：颜色交叉过渡；`needs-you` 只脉冲一次（`StatusBadge`/`StatusGlyph` 的颜色、底色与边框按 `base` 交叉过渡；`needs-you` 徽标在进入该状态或挂载时以伪元素外环 `scale`+`opacity` 脉冲一次（`deliberate` + `exit`），减少动效时移除）
- [ ] 运行指示：1.2s 线性旋转；离屏或标签页隐藏时暂停
- [ ] 列表插入：grid 行高 0fr→1fr + 淡入（`base` + `spring`）；移除 `fast` + `exit`
- [ ] 实时提示：4px 位移 + 淡入；每秒最多 4 次
- [ ] 标签切换：指示器滑动；无布局抖动
- [ ] Toast：右下滑入；5s 自动消失，悬停或聚焦时暂停（部分：生命周期改由淡出的 `animationend` 结束，修复 token 迁移后 JS 4s 卸载与 CSS 5s 停留不一致的问题；现有 Toast 是不可交互的公告，右下可交互 Toast 随撤销功能实现）
- [ ] 减少动效 e2e：所有非透明度动效被移除（部分：Modal、Menu、Popover、Sheet、命令面板在 `prefers-reduced-motion` 下 `animation: none`；`simulation-administration-acceptance` 断言减少动效时对话框内无运行中的动画并通过；尚无覆盖全站的专项 e2e）
- [ ] 每个 PR 附 GIF；用 `review-animations` 技能审查

### WP09 次要界面

- [ ] 设置：通用、模型、插件、预设统一字段结构（标签、控件、帮助、错误）与吸底页脚
- [ ] `TeamTaskDialog`、`TeamManagementDialog` 同上
- [ ] 引导页、目录选择器（浏览/原生）同上
- [ ] 所有表单输入法安全提交；错误聚焦到第一个出错字段（部分：团队任务与团队管理表单新增输入法组字保护（组字中的 Enter 不提交，`channel-draft.client.spec.tsx` 覆盖），两者原本即聚焦首个出错字段；仿真创建表单原有组字保护；设置、模型、插件、预设编辑器只经页脚按钮提交、没有隐式 Enter 提交，因此对输入法安全；这些编辑器的错误聚焦待逐个核对）
- [ ] `settings-chrome`、`models-settings`、`plugin-config`、`agent-preset-authoring`、`team-task-draft`、`workspace-management` 通过

### WP10 质量收尾与发布

- [ ] 对比度审计（浅色/深色）附测量表（部分：令牌层测量表见 [evidence/contrast-tokens.md](evidence/contrast-tokens.md)，全部达到下限；组件叠放抽查待做）
- [ ] 点击目标 ≥ 24px；每个控件焦点环可见
- [ ] 屏幕阅读器抽查：侧边栏、标签、收件箱、命令面板、仿真头部
- [ ] 窄视口：抽屉侧边栏、sheet 对话、仿真单面板检查器
- [ ] 中英文长度在 1280px 与 768px 下检查
- [ ] `pnpm run test:web:perf` 与 `test:web:stress` 对比基线，无显著退化
- [ ] 样式门禁白名单清空
- [ ] 提案全部验收标准逐项附证据
- [ ] 提案 Agent Note 从 `proposed/` 转为 `implemented/`（中英文与配对同步）
- [ ] 更新受影响 README、`web-styling.md`、`docs/architecture.md`（如涉及）
- [ ] 开发计划状态表全部为"已验收"或经确认的"延期"

## D. 设计质量检查（每个页面级 PR）

- [ ] 首屏回答三个问题：现在什么状态？哪里需要我？下一步做什么？
- [ ] 每页只有一个主操作；次要操作在溢出菜单中
- [ ] 数量为零或为空的模块折叠或显示紧凑空状态，不占大面积
- [ ] 层级：标题、区块标题、正文、说明使用不同字体角色，不靠颜色区分层级
- [ ] 间距只用刻度值；同类元素间距一致
- [ ] 状态始终"颜色 + 图形 + 文字"三者并用，不只靠颜色
- [ ] 浅色与深色都检查过；深色模式用表面亮度表达层级
- [ ] 长文本（目标、实体名、路径）有截断与展开方式
- [ ] 加载、空、错误、过期、不可用状态都有设计
- [ ] 破坏性操作有确认；可撤销操作提供撤销
- [ ] 键盘可完成主要流程；焦点顺序合理；Esc 行为一致

## E. 仿真真实性检查（WP06 及所有涉及仿真的 PR）

- [ ] 不可用显示为 `FactValue` 不可用状态，绝不显示 `0`
- [ ] 观察成功且为空的集合显示总数 0，与"不可用"区分
- [ ] 未知结果（outcome-unknown、未知 token 尝试）使用斜纹未知样式，并只提供查询/精确重试
- [ ] 过期观察变暗并带时钟图标；版本变化使用中性"有更新"标签
- [ ] 已隐藏内容显示锁形图标及所需权限，不显示为空文本
- [ ] 已截断名称或文本标明截断，并提供展开
- [ ] 已占用 token 额度标注"不等于实际模型用量"
- [ ] 持久化的运行阶段不显示为"调度中"，除非观察到驱动器活跃
- [ ] 发布回执不显示为业务接受；接收方处理另行确认
- [ ] 检查点完成不暗示来源已校验（`sourceValidation: not-performed`）
- [ ] 日志序号不显示为时间
- [ ] 上下文视图始终标注"不是完整模型请求"
- [ ] 模拟时间与真实时间使用不同图标，不混用
- [ ] 模拟时间只以十进制字符串和 `BigInt` 处理
- [ ] 引用（Team、频道、会话）只是导航，目标页面自行鉴权；未物化的会话引用保持不可点击
- [ ] 不发起逐行检查读取；所有读取都是有界分页
- [ ] 草稿与原始命令在导航、断线后保留；凭据替换后清除

## F. 发布前

- [ ] 所有 stack PR 已合入，基线快照为新版本
- [ ] `pnpm run build`、`pnpm run typecheck`、`pnpm run lint`、`pnpm run test`、`pnpm run test:snapshot`、`CLOCKY_SNAPSHOT=replay pnpm run test:web`、`pnpm run doc-sync` 全部通过
- [ ] CI 平台矩阵（含 Windows）通过
- [ ] 发布说明列出可见变化、移除的能力（石墨侧边栏、旧工作区会话树、尺寸命名字体 token）及迁移说明
- [ ] 用干净的隔离 `CLOCKY_HOME` 做一次完整冒烟：新建 Team → 对话 → 审批 → 完成；仿真创建 → 开始 → 审核 → 检查点 → 恢复
