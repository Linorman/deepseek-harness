# @clocky/clocky-client-ui-sidebar

[English](README.md) | 中文

侧边栏外壳插件：负责品牌行、New Task 操作、布局持有的折叠控件、可感知滚动的 Team 区域，以及固定在底部的 Settings seat。[ui-team](../ui-team/README.zh.md) 持有渲染到 `sidebar.teamTasks` 的 Team 导航器；可选的 `sidebar.workspaces` seat 只供显式 custom composition 挂载 legacy Workspace／Session 浏览器。本包不派生 Team 行，也不持有其视图偏好。折叠到布局拥有的 56px 轨道仍属于本地呈现行为。约定：[slot 系统标准](../../../.agents/notes/implemented/architecture/2026-07-22-slot-type-chain-implementation.zh.md)。

展开的品牌行把 `sidebar.brand.mark` 与 `sidebar.brand.name` 渲染为两个独立的 single slot，收起轨道则渲染同一个 mark slot。没有占位者时，外壳使用机器人回退图形，并把构建版本与字标位置分开。部署包可以单独替换任一值，而无须替换 New Task 控件或轨道几何；声明感知的 `slots.inject()` 让这种包无论先于还是后于侧边栏激活都能生效。

New Task 只创建页面局部 Team 草稿并清空当前转录选择；在首条输入由 `team.start` 接纳之前，它既不会创建 Team，也不会创建 Session。Team 专属导航由 ui-team 持有。

`SidebarRootComponentProps` 组合布局 owner share、全局 Session 与 Workspace 钩子、已声明的品牌、`sidebar.teamTasks`、可选的 `sidebar.workspaces`、`sidebar.settings` 与页脚子 slot，以及注入的 `startTask` 与侧边栏切换回调。这里没有插件 store。

实时收起时，外壳会把展开内容固定在当前宽度，并用 150ms 将其淡出。随后，上方控件——外壳的侧边栏切换、New Task 与 Team 轨道控件——共用一次 150ms 的淡入和 49px 左移，在布局的 300ms 栏滑动结束时一起进入 56px 轨道；每个 36px 控件盒都会沿同一条路径到达轨道左侧 10px 的内边距。固定在底部的 `sidebar.settings` 控件只共用淡入时序，不发生横向位移。页面初始即为收起状态时会静态渲染轨道；减少动态效果模式会禁用两段过渡。

栏内的滚动条是一种指针可供性：只要指针不在栏内，外壳就把 ui-theme 的[滚动条间接层](../ui-theme/README.zh.md)重新绑定为 `transparent`；指针离开后滑块再保留 2 秒，因此没人指向的列表不会带着滚动条。可滚动的 Team 区域自行预留 gutter，因此显示滑块不会引起行重排。

页脚承载 `sidebar.settings`：侧边栏只渲染固定在底部的布局 slot，并共享其栏状态（`wide`）；ui-settings 在此注册触发行和设置面板。

`/client` 导出表层只包含插件主体（`apply`／`inject`）及约定类型；SidebarRoot、行组件和树派生仍由 slot 注册封装在包内。

## 模型体验

无。侧边栏渲染浏览器导航；这里没有任何内容进入模型请求。

#### KV Cache 影响

无；该包（package）既不组装也不发送提供方请求。

## 已知限制与暂缓事项

- **「New task completed」未读标记是本地查看状态**：完成时间 > 上次查看时间这一事实永远不会到达宿主。
