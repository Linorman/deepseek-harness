# @clocky/clocky-client-ui-layout

[English](README.md) | 中文

`simulation.workspace` 是独立的 root seat。`ctx.layout.showWorkspace('team' | 'simulation')` 只改变临时查看选择，不启动或取消执行。URL 键 `workspace` 恢复此选择；没有 Simulation occupant 时显示本地化返回操作。Session 与 Team 子树保留原所有者。见 [Simulation UI](../ui-simulation/README.zh.md)。

`ctx.layout.navigate(href)` 追加同源查看 URL，不重载内存草稿，并通知目标路由所有者。浏览器前进／后退恢复产品可见性。`teamInspectionUrl()` 构建精确 Team／任务／频道／Session 读取链接，清除继承的表单及无关筛选，保留应用设置。Session 目标始终携带原参与者和 Session；Team 所有者重新核对当前绑定及权限。

来源返回在浏览器历史中保存一条同文档路由，仅含允许的视图参数及其精确 Team 目标。来源 owner 重新校验后，Back 或返回动作恢复发起链接的焦点，找不到链接时回到标题。隐藏工作区不能消耗该焦点标记。请求 Team 路由时，在明确选择 Session 之前隐藏初始会话界面，目标读取失败时也保持错误页可操作。

工作台外壳插件：`AppFrame` 注册到 `root`，并声明 `sidebar`、`team.workspace`、`conversation`、`details` 和 `shell.overlay`。Team 内容与 Session 选择相互独立。稳定的原生 dialog 容器在 Team 创建前以具名内联区域呈现会话，在 Team 检查期间作为页内模态子页面呈现；返回操作只清除查看选择，不取消执行。Session 来源、展开、键盘关闭和焦点恢复由外壳负责。收起的工具详情子树保持挂载，但从键盘及辅助技术导航中隐藏。

瞬时布局 store 以 224px 侧边栏和关闭的详情栏启动。侧边栏可在 208px 至 420px 之间拖拽调整，并收起为 56px 轨道。会话与工具详情占用者在 Session 容器中保持固定组件位置。详情栏宽度仍是偏好值：没有 Session 或 Session 为空时渲染宽度为零，切换到另一个非空 Session 时在绘制前关闭详情。让步求解器先收缩详情栏，再减少会话可用宽度。

主题呈现器消费解析后的 `ctx.theme` 快照，更新原生配色方案、body 主题属性、别名及其拥有的 theme-color 元数据，并在释放时移除这些写入。业务值通过标准框架 hook 和占用者自己的注入回调传递。AppFrame、SessionStage、布局 store 和列求解器保持包内私有；公开客户端接口包含加载入口、布局服务和 owner-share 类型。

侧栏 owner share 包含当前产品工作区。Session 标题区分经授权的当前协调者沟通与执行记录检查；worker、历史会话和仿真管理视图不会因呈现方式获得写入权限。

## 模型体验

无。布局外壳管理浏览器查看状态；这里没有任何内容进入模型请求。

#### KV Cache 影响

无；该包既不组装也不发送提供方请求。

## 已知限制与暂缓事项

- **面板几何信息是瞬时状态**：重新加载会恢复侧边栏默认值，并使详情栏保持关闭；在不同会话 id 之间切换同样会关闭详情栏，并忘记拖动后的宽度，而未选中表面会以零宽度渲染详情栏，但不会修改几何信息。
- **让步链自动关闭通过推导零宽度实现，不会改动宽度偏好**：窗口变宽时面板会自行恢复；消费方禁止把 store 中的详情宽度当作实际渲染状态。
- **挤压重排期间不提供滚动锚定**：布局变化可能移动读者的 viewport。
