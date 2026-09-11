# @clocky/clocky-client-ui-team

[English](README.md) | 中文

`@clocky/clocky-client-ui-team` 在侧边栏中渲染 Team 任务导航器，并在右上角提供类似 Environment 的全局详情浮层。浮层默认尺寸更紧凑，可从触发器或关闭控件隐藏，并支持受视口限制的拖拽或键盘调整大小以及重置。它读取浏览器持有的 `ctx.teamTasks` 投影，展示持久化 Team 的目标与阶段，并且只把所选 Team 的协调者 Session 作为其转录后代打开。它不会从 Session 行推导 Team 状态。

该插件通过声明感知的 `slots.inject()` 贡献到 `sidebar.teamTasks` 和 `shell.overlay`。选择操作先经由 `ctx.teamTasks.open()` 解析 Team，刷新 Session 投影，然后打开 Team 状态返回的协调者 Session。侧边栏只保留工作区列表和添加工作区操作；所选详情显示在右上角浮层中。浮层紧凑展示 objective、lifecycle 诊断、worker 分配、task result、channel record、可见 artifact 和 audit entry；原始上限、channel payload 与 audit fact 按需展开。无 lease 的 task 可以删除，assigned/running task 可以停止，二者都通过 authenticated confirmation；mutation 失败时对应对话框保持打开。读取由 owner 提供且可取消；读取失败以内联错误显示，不替换当前选择的 Team。

收起状态的轨道提供一个带标签的按钮来展开侧边栏；展开后的列表延续熟悉的侧边栏行和基于 token 的状态。`TeamPage` 可用于显示持久 objective、roster、task graph、channel、stalled 诊断和生命周期控制。运行时通过 Team/channel change frame，并由 browser owner 执行有界刷新循环，因此来自其他 host 或 remote activation 的更新会收敛，不会从 Session transcript 抓取 Team 状态。

详情表单通过已认证的 Host 命令邀请和管理成员、创建直接通道、发送定向消息、编辑任务依赖、记录审阅决定，以及创建产物整合任务。命令失败时保留草稿；任务版本变化后，编辑和审阅需先明确核对最新版本。Team 列表、通道记录和审计记录均提供显式续页控件，读取失败保留已显示记录。

所选 Team 的成员、任务、工作流计划和产物集合分别通过有界 page 独立读取。每个集合独立拥有 cursor、loading、续页、error 和 newer 状态；Load more 与 Refresh 都是显式操作。旧 Team selection 的迟到 response 会被丢弃。读取失败保留已加载 rows 和 newer 标记；取消读取会清除 loading，首次读取失败也提供 Refresh。Authoritative Team snapshot 继续作为 mutation fallback。产物视图只展示 provider 允许且非 private 的 references。

Child task 详情展示持久化的 execution/delegation phase、failure、已接纳的 result text 和可见 result artifact。`openTeam(childTeamId)` 以只读方式打开 child，绝不会自动 resume。已加载的 task 和 workflow row 会接收 Team snapshot 中相同 id 的更新 revision。Workflow task 与 dependency 链接每次最多额外展示并聚焦一条尚未加载的 task。Workflow plan 只读展示 phase、bounds、ordered template、binding、dependency、result count 和 failure；authoring 仍由 `team_workflow_*` tool 拥有。

## 模型体验

无，因为该 UI 只读取持久化 Team 投影，并通过已认证的 Host 命令发送管理 mutation。

#### KV Cache 影响

通道消息使用既有的日志化投递投影。导航和未提交表单不改写模型历史。通道表单通过持久化 Team Envelope 路径发送用户文本；所选接收者以及 context、turn 或 steer 投递方式决定哪些 Participant 接收已记录的输入，其他管理表单通过对应 Host 命令修改持久化 Team 状态。

## 已知限制与暂缓事项

- **产物 provider**——整合需要已配置的工作区 provider 和有效的来源 attempt；无 provider 的引用仅显示 metadata，private artifact 不会列出。
- **approval/question 路由**——页面列出带 provenance 的 live 与 durable request；回答 control 仍由 Host interaction API 和 coordinator transcript 拥有。
- **transport/browser 验证**——collection race、remote transport 以及完整 child/workflow mutation journey 仍需要独立的 browser 和 multi-host evidence lane。
