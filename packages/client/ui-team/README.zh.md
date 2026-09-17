# @clocky/clocky-client-ui-team

[English](README.md) | 中文

`@clocky/clocky-client-ui-team` 根据 `ctx.teamTasks` 渲染 Team 导航和运行工作台。选择 Team 或子 Team 使用只读检查；显式“恢复”操作负责恢复执行。概览汇总完整 Team 的任务数量、子树用量、人工待处理事项、成员、有界最近动态及可见产物，不会从 Session 转录重建 Team 权威状态。

插件通过声明感知的 `slots.inject()` 贡献到 `sidebar.teamTasks` 和 `team.workspace`。任务、频道、成员、产物、工作流计划和审计记录分别拥有独立视图。任务表格打开一个简洁检查栏；完整指令、尝试历史、审核、整合、停止和删除均为显式操作。修改失败保留当前表单及权威 revision 检查。

注册拥有的查看状态 store 保留各 Team 的筛选、任务选择、滚动位置和频道草稿。URL 只包含视图标识与筛选；浏览器导航通过只读 Host 投影恢复状态，并拒绝属于其他 Team 的任务、频道或 Session 标识。Session 按需在布局拥有的子页面中打开。具体任务尝试根据记录的 Participant 及其不可变 Session 绑定打开会话；较早的异步请求不能在后续导航或关闭操作后改变 Session 选择。

详情表单通过已认证的 Host 命令邀请和管理成员、创建直接通道、发送定向消息、编辑任务依赖、记录审阅决定，以及创建产物整合任务。命令失败时保留草稿；任务版本变化后，编辑和审阅需先明确核对最新版本。Team 列表、通道记录和审计记录均提供显式续页控件，读取失败保留已显示记录。

所选 Team 的成员、任务、工作流计划和产物集合分别通过有界 page 独立读取。每个集合独立拥有 cursor、loading、续页、error 和 newer 状态；下一页替换当前窗口，返回首页从头读取，刷新重读当前页。每个集合最多保留一个受 server 上限约束的 page；已选任务查看和未提交输入不因换页丢失。旧 Team selection 的迟到 response 会被丢弃。读取失败保留已加载 rows 和 newer 标记；取消读取会清除 loading，首次读取失败也提供 Refresh。任务表单读取独立详情和有界 attempt 选项；Team 范围的表单选项仍使用 Team 投影。产物视图只展示 provider 允许且非 private 的 references。

Child task 详情展示持久化的 execution/delegation phase、failure、已接纳的 result text 和可见 result artifact。`openTeam(childTeamId)` 以只读方式打开 child，绝不会自动 resume。任务行使用 browse 摘要，当前字段与历史通过版本条件独立读取。Workflow row 会接收 Team snapshot 中相同 id 的更新 revision。页外 workflow task 直接打开详情并聚焦关闭按钮，不伪造列表行。Workflow plan 只读展示 phase、bounds、ordered template、binding、dependency、result count 和 failure；authoring 仍由 `team_workflow_*` tool 拥有。

成员详情通过`team.member.inspect`读取准确身份、角色、非敏感 placement 信息及一页 capability。续页使用已观察的 Team cursor，冲突后需要刷新。页面不包含 grant、启动配置或 attempt 统计，并受 Hub 响应字节额度限制。

跨 Team 频道草稿默认最多保留 32 条，总序列化记录不超过 8 MiB。公开浏览器选项`maxDrafts`、`maxDraftBytes`和`maxViewStates`通过`client-modules.browserConfig["@clocky/clocky-client-ui-team"]`配置。浏览偏好默认保留 128 条，只淘汰没有草稿的旧视图；`maxViewStates`必须大于`maxDrafts`。超限拒绝保留原草稿；无法保存重试身份时不会发送。发送确认和明确确认的丢弃操作释放草稿位置。 图片批次在文件读取前按`maxDraftBytes`检查 base64 膨胀、已有内容与文件名元数据；通过检查的文件依次编码。草稿发布前，store 仍检查全部保留草稿的累计额度。

## 模型体验

无，因为该 UI 只读取持久化 Team 投影，并通过已认证的 Host 命令发送管理 mutation。

#### KV Cache 影响

通道消息使用既有的日志化投递投影。导航和未提交表单不改写模型历史。通道表单通过持久化 Team Envelope 路径发送用户文本；所选接收者以及 context、turn 或 steer 投递方式决定哪些 Participant 接收已记录的输入，其他管理表单通过对应 Host 命令修改持久化 Team 状态。

## 已知限制与暂缓事项

- **产物 provider**——整合需要已配置的工作区 provider 和有效的来源 attempt；无 provider 的引用仅显示 metadata，private artifact 不会列出。
- **approval/question 路由**——页面列出带 provenance 的 live 与 durable request；回答 control 仍由 Host interaction API 和 coordinator transcript 拥有。
- **transport/browser 验证**——collection race、remote transport 以及完整 child/workflow mutation journey 仍需要独立的 browser 和 multi-host evidence lane。
