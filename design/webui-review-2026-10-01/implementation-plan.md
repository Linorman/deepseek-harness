# Team 与 Simulation WebUI 分阶段开发计划

状态：本轮实现与验收已完成（2026-10-02，Asia/Shanghai）。依据为[设计方案](design-proposal.md)、[实测审查](audit.md)及当前源码；完成范围、证据及适用限制见执行 Checklist 和文末验收记录。原 A–E 计划按阶段 0–7 追踪。

进度追踪见文末[执行 Checklist](#14-执行-checklist)，按现有任务编号逐项勾选。

## 1. 目标、范围与组织方式

目标是让用户能够快速回答“当前在哪个团队／运行、发生了什么、需要我做什么、如何查看依据”，并在完成操作后保留位置和输入。实现沿用 React、CSS Modules、Cordis slots、framework hooks、共享 primitives 和现有 client runtime，不更换前端框架或业务状态管理。

本轮包含工作区框架、全局导航、Team 概览／任务／频道／会话入口、Simulation 目录／创建／概览／集合／详情／请求记录，以及相关恢复和可访问性行为。关系图、拖动看板、跨运行指标平台、跨域统一待办服务、调度算法、持久格式迁移不在本轮范围。需要新增读取字段的增强先独立确认，不阻塞可用现有 DTO 完成的布局与流程。

| 责任角色 | 主要负责 | 交付边界 |
|---|---|---|
| 页面与设计负责人 | 布局、信息层级、共享组件、文案与响应式 | 按声明的 props／slots 使用业务事实，不在 React 保存第二份权威状态 |
| client runtime 负责人 | 导航读取生命周期、命令回执对账、取消与授权代际 | 不引入 React 依赖，不用新 key 掩盖未知结果 |
| Host/API 负责人 | 经确认必要的 bounded summary、解析与授权 | 只有现有 DTO 不足时介入，不将页面重构扩展为后端重写 |
| 验收负责人 | 真实 Host 场景、几何／交互验证、双语与无障碍、证据归档 | 区分已通过、失败和未验证；静态检查不替代浏览器 |

角色可由同一开发者承担。若并行开发，按文件和责任分工，而不是多个人同时改 `Workspace.tsx`：布局／导航、runtime、独立叶组件可以分别开发；Simulation 组装入口、route 编解码和共享 store 每阶段只有一个集成人。本文提出并行安排，不创建开发任务或启动实现。

## 2. 路线图、依赖与工作量

| 阶段 | 优先级 | 主要交付 | 必须先完成 | 初步工作量 |
|---|---|---|---|---|
| 0 | 前置 | 基线、字段矩阵、页面结构与验收样本 | 无 | 0.5–1 人日 |
| 1 | P1 | 统一工作区宽度、仿真页头和窄屏结构 | 0 | 2–3 人日 |
| 2 | P1 | 目标身份正确的导航、拒绝页与来源返回 | 0；集成依赖 1 | 2–3 人日 |
| 3 | P1 | 原请求与持久回执一致、可解释的展示 | 0；UI 集成依赖 1 | 3–5 人日 |
| 4 | P2 | 仿真目录、创建表单、运行概览 | 1、3 | 3–4 人日 |
| 5 | P2 | Team 概览、任务、频道与会话语义 | 1、2 | 2–4 人日 |
| 6 | P2 | 仿真领域列表、详情、记录与证据导航 | 2、4 | 4–6 人日 |
| 7 | 发布门槛 | 跨页回归、无障碍、性能、清理与文档 | 1–6 | 2–3 人日 |

按上述估算，基础范围约 19–29 人日；加约 25% 的评审与不确定性余量，排期暂按 24–37 人日。它是基于当前功能与复用程度的规划区间，不是实测承诺；阶段 0 完成后重估。估算包含各阶段的开发和针对性验证，阶段 7 负责跨模块问题。新增 Host API、大规模性能优化和外部模型服务等待另计，不通过删验收挤入原工期。

实施后重估：既有业务 owner、API 和脚本场景均可复用，原人日区间不再代表剩余工作量。本轮完成的新增读取字段仅为保留创建配置的执行模式；没有引入新的 Host 服务或状态框架。布局实现后的主要收口工作是请求读取生命周期、极端缩放、模态层和旧测试定位；这些回归已关闭。当前无待实施工作，后续 GUI PR 的真实 provider 录制属于发布动作的独立条件。

推荐串行路径为 `0 → 1 → 2 → 3 → 4 → 5 → 6 → 7`。多人协作时，阶段 2 与阶段 3 的 runtime 工作可在阶段 0 后并行；阶段 1 完成后集成它们。阶段 5 可与阶段 4 并行，但共享 primitives 变更先落地，两个功能只消费其稳定接口。阶段 6 的只读列设计和字段核对可提前，组装待阶段 4 完成。

里程碑 M1 是阶段 1–3：主要布局能用、导航不误认对象、请求状态不误导。M2 是阶段 4–5：日常创建、观察、沟通流程完整。M3 是阶段 6–7：领域阅读、追溯和完整发布验收通过。每个里程碑都能独立交付，不要求等待全部页面重写。

## 3. 阶段 0：确认实现基线与交付约束

目标：避免依据旧截图或假定接口进入开发。读取[当前取证](audit.md)，在开始实施时重新确认相关源码是否发生变化；不重复审查无关模块。

| 任务 | 具体工作 | 产出 |
|---|---|---|
| P0-01 | 记录分支、HEAD、相关未提交改动、构建版本；确定实现使用的 checkout，保留现有工作 | 可复现的实施基线和改动归属 |
| P0-02 | 重建并启动隔离真实 Host，复现 F01、F07、F09、F10、F12 | 每个 P1 的当前画面、路径和源码位置 |
| P0-03 | 核对列表 DTO、控制提示、原请求与回执类型，标明已有／可派生／缺失字段 | 字段与权限矩阵，见第 11 节 |
| P0-04 | 确定 Team、Simulation、长表单、窄屏详情的结构稿；复用现有 token，记录滚动和焦点责任 | 4 类结构及关键状态，不创建新的视觉体系 |
| P0-05 | 选择已有场景和测试入口；准备短／长名称、空／多页、未知请求、拒绝目标样本 | 后续各阶段可复用的隔离样本 |

通过条件：每项 P1 都有可复现步骤或明确的“当前已修复”证据；字段来源可追到声明；首次实施不修改真实用户数据或启动不必要的推理。只在基线仍有问题时实现相应修复。

计划 PR：R0，仅在需要持久化新的验收样本或明确设计决定时建立；现有场景足够则不制造一个纯计划 PR。Agent Note 保持 `proposed`，不提前更新当前设计规范为已实现。

## 4. 阶段 1：修复工作区几何与页面框架

对应 F01、F07、F09。先让现有内容处在正确的容器里，再调整业务模块。

| 任务 | 具体工作 | 完成标准 |
|---|---|---|
| P1-01 | 修复 `AppFrame.productStage` 到 Team 根节点的 flex 伸展和最小尺寸链 | 概览、频道、任务及仿真的工作底覆盖同一可用宽度，不随数据量改变 |
| P1-02 | 拆开仿真身份行、操作区、紧凑状态、模块导航；状态标签和值成组 | 标题与刷新按钮不被状态词流挤压；长名称可换行／展开 |
| P1-03 | 每类页面明确滚动 owner：概览自然纵向、表格内部、频道历史与输入分离 | 长表单不被裁剪，列表／详情不产生无意义的多重纵向滚动 |
| P1-04 | 根据实际内容余宽切换列表＋详情或单主面板；窄屏诊断默认折叠 | 390×844 常规状态下约顶部 240px 内可见身份、主操作与模块入口 |
| P1-05 | 明确主次按钮、稳定 busy 尺寸与导航选中状态；只补必要共享能力 | 同类操作强调一致，不为每个页面复制按钮与断点规则 |

主要文件：[AppFrame.module.css](../../packages/client/ui-layout/src/client/AppFrame.module.css)、[TeamWorkspace.module.css](../../packages/client/ui-team/src/client/TeamWorkspace.module.css)、[Workspace.tsx](../../packages/client/ui-simulation/src/client/Workspace.tsx)、[Workspace.module.css](../../packages/client/ui-simulation/src/client/Workspace.module.css)、[RunStatus.tsx](../../packages/client/ui-simulation/src/client/RunStatus.tsx)。建议的 `RunHeader` 仅为包内组件，不增加公开插件导出。

验证：扩展 [app-frame](../../packages/client/ui-layout/tests/app-frame.client.spec.tsx)、[run-status](../../packages/client/ui-simulation/tests/run-status.client.spec.tsx) 的行为覆盖；在 [team-workspace](../../apps/web/tests/team-workspace.snapshot.ts) 与 [simulation-workspace](../../apps/web/tests/simulation-workspace.snapshot.ts) 的真实页面中增加容器边界、按钮可见性和滚动检查。CSS 几何不得只用 jsdom 证明。至少检查桌面、窄屏、长标题、打开详情和长表单。

PR 拆分：R1 工作区伸展与滚动；R2 仿真紧凑页头与响应式。R2 依赖 R1。阶段完成后更新相应 `DESIGN.md` 几何说明；其余尚未完成的视觉规则继续留在提案中。

## 5. 阶段 2：修复导航目标与来源恢复

对应 F10，同时保护所有 Team／Simulation 深链。目标是让地址、标题与正文始终属于同一对象，而不破坏保留草稿的能力。

| 任务 | 具体工作 | 完成标准 |
|---|---|---|
| P2-01 | 区分“请求打开的目标”“成功显示的对象”和“来源上下文” | 加载新目标期间不把旧正文标成新目标 |
| P2-02 | 为拒绝访问、对象不存在、历史绑定失效、网络失败设计明确状态 | 拒绝／不存在显示目标错误主体；网络失败提供重试；不泄露被拒绝对象正文 |
| P2-03 | 增加有界的来源导航上下文，仅保存允许的 route 与视图定位 | “返回来源”恢复 run／module／object；私有输入不进入 URL |
| P2-04 | 处理无来源的直接深链、刷新和 Back／Forward | 无来源时提供可用的目录返回，不跳到猜测的 Team |
| P2-05 | 保留旧草稿而隔离旧业务正文，恢复来源焦点 | 错误页切换不清空输入；账号替换／撤权仍按原规则清理 |

实现分工：共享 [navigation.ts](../../packages/client/ui-layout/src/client/navigation.ts) 负责受支持的同文档导航；[TeamWorkspace.tsx](../../packages/client/ui-team/src/client/TeamWorkspace.tsx) 和两个领域 route owner 分别处理目标读取。页面显示授权失败，但不在 `ui-layout` 内重建授权规则。来源页已失权时，返回同样经过鉴权，不能从内存重新显示被撤销正文。

验证：扩展 [workspace-navigation](../../packages/client/ui-team/tests/workspace-navigation.client.spec.ts)、[layout navigation](../../packages/client/ui-layout/tests/navigation.client.spec.ts)、[team-reference](../../packages/client/ui-simulation/tests/team-reference.client.spec.tsx) 和 [team-child-navigation](../../apps/web/tests/team-child-navigation.snapshot.ts)。真实 Host 必须覆盖：来源 Team A 已显示 → 请求拒绝的 B → B 错误主体 → 返回 A／仿真实体；以及历史 Session 绑定变化拒绝、Back／Forward、断线后重新读取。

PR 拆分：R3 目标与失败状态；R4 来源返回与焦点。R4 依赖 R3 和阶段 1。退出条件是 F10 不再复现，且草稿和授权代际回归通过。

## 6. 阶段 3：统一原请求与回执的阅读模型

对应 F12，属于语义修复而非单纯组件重排。先定义可比较的事实，再合并展示；不把 journal revision 与 world revision 当作同一时钟。

| 任务 | 具体工作 | 完成标准 |
|---|---|---|
| P3-01 | 梳理 create／prepare／manage／checkpoint／restore／ingress／review 等命令与 receipt 范围 | 明确哪些能按持久 command ID 对应，哪些只能保留独立原命令记录 |
| P3-02 | 在 runtime 中定义可订阅的只读请求展示事实：身份、来源、状态、新鲜度、是否需核对 | 不在组件间通过渲染先后决定结果，不复制原命令到 UI store |
| P3-03 | 明确旧 accepted、新 completed、查询失败、未知结果及账号更换的显示规则 | 结果冲突有解释；旧回执不能覆盖已确认的较新终态 |
| P3-04 | 统一持久请求、原命令和回执的 UI 入口；保留未入当前页的本地未知命令入口 | 去重展示不导致分页外／仅内存请求不可恢复 |
| P3-05 | 调整查询／重试动作与 busy、错误状态；新增请求记录路由只携带不透明身份 | 显式同原操作重试；终态不触发新执行；URL 无输入正文 |

状态规则至少覆盖以下组合：

| 已取得事实 | UI 结论 | 下一动作 |
|---|---|---|
| 只有内存 accepted 回执 | 已受理，完成状态待核对 | 查询原结果 |
| 持久 metadata completed，内存 accepted | 已完成；本地回执较旧，详情待核对 | 查询详情，避免突出旧重试 |
| 结果未知，查询暂时失败 | 结果仍未知，保留原身份 | 重试查询；满足准入时显式重试原操作 |
| 同身份出现无法解释的终态冲突 | 结果不一致，需要重新核对 | 禁用依赖该结论的动作；不以时间字符串自行排序 |
| 当前页没有对应持久记录 | 该记录不在此页，不能据此判断不存在 | 保留原命令入口，进行精确查询 |
| 授权代际已替换 | 旧私有结果不可继续使用 | 清理并在新授权下重新发现 |

主要文件：[runtime administration](../../packages/client/runtime/src/client/simulations/administration.ts)、[runtime service](../../packages/client/runtime/src/client/simulations/service.ts)、[PersistentRequests.tsx](../../packages/client/ui-simulation/src/client/PersistentRequests.tsx)、[CommandRecord.tsx](../../packages/client/ui-simulation/src/client/CommandRecord.tsx) 与 Workspace 的保留操作区。新增读取模型的稳定身份、通知及释放遵循现有 snapshot source 约定。

验证：扩展 [simulation-request-recovery](../../packages/client/runtime/tests/simulation-request-recovery.client.spec.ts)、[simulation-administration](../../packages/client/runtime/tests/simulation-administration.client.spec.ts)、[persistent-requests](../../packages/client/ui-simulation/tests/persistent-requests.client.spec.tsx)、[simulation-process-restart](../../apps/web/tests/simulation-process-restart.snapshot.ts) 和 [simulation-operation-retry](../../apps/web/tests/simulation-operation-retry.snapshot.ts)。断言命令身份和执行次数，不只断言“已完成”文字出现。

PR 拆分：R5 runtime 请求读取模型与测试；R6 请求记录 UI 与端到端对账。R6 依赖 R5、阶段 1；跨工作区链接同时依赖阶段 2。退出条件：同一请求不再无解释地显示冲突状态，所有原请求恢复途径保持可达。

## 7. 阶段 4：完成 Simulation 的主要工作流程

对应 F05、F06、F07。用户路径为“选运行／新建 → 检查配置 → 创建暂停运行 → 理解准备结果 → 显式开始或处理阻塞”。此阶段完成的是完整路径，不能只替换几个静态页面。

| 任务 | 具体工作 | 完成标准 |
|---|---|---|
| P4-01 | 将 Team 与仿真作为并列工作区入口，目录保留各自浏览状态 | 切换不丢选择与草稿；可选插件未安装时不显示虚假入口 |
| P4-02 | 提取包内 `RunDirectory`；名称、场景、调度状态和模拟时间优先；模型池折叠 | 空目录以创建／部署说明为主体；搜索失败与无结果分开 |
| P4-03 | 增加共享 Modal 的明确表单尺寸变体，或沿已有模式做完整表单视图 | 不全局放大确认框；窄屏字段和底部按钮均可达 |
| P4-04 | 创建表单按场景、基本输入、额度、确认分组；高级额度按需展开 | 首屏可开始填写；默认值来自 catalog；预检失败定位字段 |
| P4-05 | 创建受理后的准备状态、初始检查点及未知结果连接到阶段 3 | 同一 run 不被重复创建；无初始检查点时不能开始 |
| P4-06 | 提取包内 `RunOverview`，先展示阻塞／审核／未知结果，再显示少量关键指标 | 无待办时紧凑呈现；不支持自动任务的模式不显示完整任务控制模块 |
| P4-07 | 将开始／继续／暂停整理为按真实 control 准入的主次动作 | 保留成本确认；paused 且 inFlight 时同时解释收尾状态 |

主要文件：`ui-simulation` 的 Workspace、[CreationDialog](../../packages/client/ui-simulation/src/client/CreationDialog.tsx)、[Controls](../../packages/client/ui-simulation/src/client/Controls.tsx)、[Navigation](../../packages/client/ui-simulation/src/client/Navigation.tsx)、[RunStatus](../../packages/client/ui-simulation/src/client/RunStatus.tsx)、store 与 locale；共享 [Modal](../../packages/client/ui-primitives/src/Modal.tsx) 及侧栏入口 owner。只拆包内组件，保持一个清晰的 watch／轮询与 route 副作用 owner。

验证：扩展 [creation-preflight](../../packages/client/ui-simulation/tests/creation-preflight.client.spec.tsx)、[administration UI](../../packages/client/ui-simulation/tests/administration.client.spec.tsx)、[simulation-administration browser](../../apps/web/tests/simulation-administration.snapshot.ts)、[administration acceptance](../../apps/web/tests/simulation-administration-acceptance.snapshot.ts)。覆盖预检不写入、创建不推理、关闭再开保留输入、字段错误、响应丢失、显式调度确认、预算不允许和暂停仍有收尾。新布局复用现有脚本模型场景，不把纯 DOM 模拟结果当作执行闭环。

PR 拆分：R7 目录与工作区入口；R8 创建表单完整流程；R9 运行概览与控制。R8 先落共享 Modal 变体再落消费者，R9 依赖 R6。退出条件：基本创建与运行观察流程在桌面／窄屏均可完成，原安全语义保持不变。

## 8. 阶段 5：收敛 Team 的日常操作体验

对应 F02、F03、F04、F13。维持现有较清楚的任务列表＋摘要结构，把术语、动作与空态统一。

| 任务 | 具体工作 | 完成标准 |
|---|---|---|
| P5-01 | 区分根对象“新建团队工作”和 Team 内“新建任务”；统一页面中的团队／频道术语 | 同一词不同时代表根 Team、执行 task 与工作目录 |
| P5-02 | 人类 attention 改为“需要你处理”，pending task 改为“待执行” | 顶部 0 与任务 3 的统计语义各自清楚，计数来源不变 |
| P5-03 | 概览先放任务执行和人类待办；空待办收紧，成员／活动／产物按需预览 | 不拿 Tokens 和空卡片挤占主要任务区域 |
| P5-04 | 任务摘要按状态、执行者、依赖、结果、下一步排序；明确刷新语义 | 当前 API 只能回第一页时显示“刷新到第一页”，不伪装保留页刷新 |
| P5-05 | 频道的普通文本输入简化；多块顺序、接收者和投递方式可展开 | 草稿、附件顺序、身份与幂等 key 保留，受理／投递／处理不混淆 |
| P5-06 | coordinator 可写沟通与 worker 只读执行记录使用不同标题／空态 | 保留同一 conversation 容器；关闭不取消执行 |

主要文件：[TeamOverview](../../packages/client/ui-team/src/client/TeamOverview.tsx)、[TaskWorkspace](../../packages/client/ui-team/src/client/TaskWorkspace.tsx)、[ChannelHub](../../packages/client/ui-team/src/client/ChannelHub.tsx)、[TeamHeader](../../packages/client/ui-team/src/client/TeamHeader.tsx)、[session-inspection](../../packages/client/ui-team/src/client/session-inspection.ts)、侧栏及 conversation 的既有 slot／locale owner。完整任务编辑、依赖冲突核对与权限逻辑继续复用现有实现。

验证：扩展 [team-overview](../../packages/client/ui-team/tests/team-overview.client.spec.tsx)、[task-workspace](../../packages/client/ui-team/tests/task-workspace.client.spec.tsx)、[channel-draft](../../packages/client/ui-team/tests/channel-draft.client.spec.tsx)、[task-conflict](../../packages/client/ui-team/tests/task-conflict.client.spec.tsx)，并覆盖 [team-attention](../../apps/web/tests/team-attention.snapshot.ts)、[team-task-draft](../../apps/web/tests/team-task-draft.snapshot.ts)、[team-channel](../../apps/web/tests/team-channel.snapshot.ts) 的组装路径。用真实“部分草稿 → 切模块 → 返回”验证，不只断言 store 数值未变。

PR 拆分：R10 概览／任务／全局命名；R11 频道与会话上下文。阶段 5 可与阶段 4 的独立叶组件并行，但侧栏与共享 Modal 的变更需先明确归属。退出条件：旧功能均可发现，用户看到的动作对象及状态含义一致。

## 9. 阶段 6：建立领域列表与可追溯详情

对应 F08、F11，进一步解决 F09。先交付已有 summary 字段能支持的版本；不在一个 PR 中同时更换布局、增加全量查询和重写原文授权。

| 任务 | 具体工作 | 完成标准 |
|---|---|---|
| P6-01 | 提取共享 collection 外框：筛选、读取反馈、页脚与选中行为；各领域自己定义列 | 不建立一个吞掉所有业务差异的通用业务表格 |
| P6-02 | 实体显示名称、类别、认知、状态；决策显示实体身份、模拟时间／slot、提交状态 | 使用已有 summary；不可见名称回退 ID，不逐行请求全详情 |
| P6-03 | 操作分开业务结果、发布和送达；检查点分开保存、发布时间、来源验证 | accepted 不写成业务成功；not-performed 不写成验证通过 |
| P6-04 | 详情先显示对象摘要，再提供领域分区和技术信息；命名每个对象动作 | 关闭恢复焦点；窄屏直接进入对象层而非重读长页头 |
| P6-05 | 已知记录类型增加可读标签与选择器，保留原类型精确检索 | 未知扩展类型仍可显示；元数据／原文及导出权限不混合 |
| P6-06 | 连接实体 → 决策 → 操作 → 来源／Team／Session 路径 | 保留精确引用、来源返回、冻结版本和各目标独立授权 |
| P6-07 | 核对性能及必要字段缺口；仅对已确认需求提交 Host 增强 | 页面无全量扫描、无新增逐行 inspect；缺口不产生假数据 |

主要文件：[Workspace](../../packages/client/ui-simulation/src/client/Workspace.tsx)、[ObjectDetails](../../packages/client/ui-simulation/src/client/ObjectDetails.tsx)、[RecordsView](../../packages/client/ui-simulation/src/client/RecordsView.tsx)、[SourceDetails](../../packages/client/ui-simulation/src/client/SourceDetails.tsx)、[ContextAndRelations](../../packages/client/ui-simulation/src/client/ContextAndRelations.tsx)、[KnowledgeDetails](../../packages/client/ui-simulation/src/client/KnowledgeDetails.tsx)、store 与 selection。Host 增强如有必要，单独修改 `simulation-product` 的 collections types/schema/provider 及其 API owner，而不在 UI 里绕过缺口。

验证：复用 [object-details](../../packages/client/ui-simulation/tests/object-details.client.spec.tsx)、[context-and-relations](../../packages/client/ui-simulation/tests/context-and-relations.client.spec.tsx)、[knowledge](../../packages/client/ui-simulation/tests/knowledge.client.spec.tsx)，以及 [simulation-workspace](../../apps/web/tests/simulation-workspace.snapshot.ts)、[read-lifecycle](../../apps/web/tests/simulation-read-lifecycle.snapshot.ts)、[records](../../apps/web/tests/simulation-records.snapshot.ts)、[sources](../../apps/web/tests/simulation-sources.snapshot.ts)。保留原文撤权、旧响应退休、游标过期和导出中断的回归。

PR 拆分：R12 实体／决策／操作／检查点列表；R13 对象详情与跨模块来源；R14 记录阅读与类型筛选。必要的 Host 字段增强按依赖单独评审，不能隐藏在纯视觉 PR 中。退出条件：可从列表定位对象、解释其状态并追溯授权来源，且读取边界与性能没有退化。

## 10. 阶段 7：整体验收、清理与交付

| 任务 | 具体工作 | 完成标准 |
|---|---|---|
| P7-01 | 跑完整关键流程与第 12 节矩阵，补此前阶段未覆盖的组合 | P1 全部关闭；剩余问题有明确影响和后续归属 |
| P7-02 | 检查中英、浅深色、键盘、读屏名称、对比度、缩放与 reduced-motion | 页面可用性由浏览器证明；不把静态 audit 的零报告当合规 |
| P7-03 | 检查读取数量、重复订阅、DOM 规模、列表和切换表现 | 样本规模增加不导致逐行请求或全量渲染；阈值由基线确定 |
| P7-04 | 移除已迁移的旧呈现分支与无用样式；确认无双份轮询／路由 owner | 同一能力只有一个稳定实现；不留下永久兼容分支 |
| P7-05 | 更新 DESIGN、UX-CONTRACT、README、双语文档与 owning Agent Notes | 只写已实现行为；未完成内容继续保持 proposed |
| P7-06 | 归档当前构建截图、测试结果和 GUI PR 要求的真实流程 GIF | 每个证据写明构建、样本、尺寸、模式和未覆盖范围 |

PR 拆分：R15 剩余整合修复与最终规范收敛。每个前序 PR 已经需要自身测试与截图，阶段 7 不承担第一次验证的责任。真实模型／跨 Host 证据必须单独标明；keyless browser 场景不替代项目要求的真实 server／model flow GIF。

交付包括完整路径演示、变更前后截图、测试命令与结果、未关闭问题及风险。没有完成真实执行、权限变更或恢复场景时，不得宣称整个运行闭环通过。

## 11. 已核对的数据能力与技术边界

以下字段已从 [collections-types.ts](../../packages/simulation/simulation-product/src/collections-types.ts) 核对，设计不要为已有字段新增 API：

| 对象 | 当前 summary 已有 | 本轮直接使用 | 暂不承诺 |
|---|---|---|---|
| 实体 | `id`、可选 `name`、`kind`、`phase`、`cognition`、`writer` | 业务名称优先的领域列与状态 | 跨实体的完整拓扑、关系总览 |
| 决策 | `entityId`、`slot`、精确 `time`、`snapshotRevision`、`status`、`operationCount` | 实体身份、模拟时刻、提交状态和操作数 | 决策列表上直接显示完整模型输入或业务最终成功 |
| 操作 | `entityId`、`decisionId`、`kind`、`status`、`publication`、`delivery`、`deliveryFailure`、`task` | 业务结果与消息状态分别展示 | 未经授权的关联对象名、完整任务结果正文 |
| 检查点 | `startedSequence`、可选 `finishedSequence/time/publishedAt`、`latestSuccessful`、`sourceValidation` | 时间、保存状态、最近成功标记 | 由列表中的 `not-performed` 推断当前恢复有效性 |

有界 summary 没有的关联显示名可先使用可复制 ID；若用户确需名称且当前页面没有已授权的身份映射，再设计批量有界投影。不得为了补列发 N 个 inspect，也不得将本页排序称为全量排序。

Team attention 与 pending task 的计数继续分开；模拟时间是精确字符串，不能转 `Number` 损失精度；Host modelPool 与单 run 预算继续分开。世界 revision、请求 journal revision、授权 read version 只能在各自范围内使用。UI 拆组件不能增加轮询订阅、改变读取代际或把私有正文迁入持久前端存储。

## 12. 验收矩阵与执行方式

| 场景 | 必须验证的结果 | 阶段 |
|---|---|---|
| 概览 → 列表 → 详情 → 返回 | 几何稳定；原选择、筛选和焦点可恢复 | 1、5、6 |
| 频道／任务表单输入 → 切换 → 返回 | 文本、附件顺序、投递方式、原命令身份保留 | 2、5 |
| 预检失败 → 修正 → 创建 | 字段错误可定位；预检无写入；创建无推理且身份稳定 | 4 |
| 创建响应丢失 → 查询／重试 | 不产生第二运行，不覆盖用户后来修改的草稿 | 3、4 |
| 持久 completed＋旧 accepted | 显示可解释的新旧关系，不误导用户重新执行 | 3 |
| 已暂停且仍有在途工作 | 调度与收尾状态同时可见，按钮依当前控制准入 | 4 |
| 来源实体 → 拒绝的 Team → 返回 | 错误目标不展示旧对象；恢复来源且重新鉴权 | 2、6 |
| 历史 Session 绑定不匹配 | 明确拒绝，不替换为当前其他 Session | 2、6 |
| 列表下一页读取失败 | 保留本页；游标／revision 不被错误覆盖 | 6 |
| 详情撤权／旧响应晚到 | 清除受保护正文；旧响应不能复活内容 | 2、3、6 |
| 导出中断／撤权／版本变化 | 不生成不完整文件，保留当前授权与完整性约定 | 6 |
| 未知扩展记录类型 | 可阅读原始类型，不崩溃、不伪造业务标签 | 6 |

尺寸检查包含 1440×900、1280×720、1024×768、390×844、320 CSS px，以及原生 200%／400% 缩放。共享 shell／Modal 变更检查所有主要页面类型；每个功能页至少有桌面、窄屏、空／非空、长内容、中文／英文和浅色／深色证据。高风险创建、原请求恢复与权限拒绝路径补充错误、慢网、断线及焦点。使用风险组合覆盖，不机械执行全部状态的笛卡尔积；未执行组合明确列出。

无障碍检查包括操作名称、可见焦点、Tab／Shift+Tab、Escape、模态焦点隔离与返回、非模态详情不陷阱、屏幕阅读状态、IME 输入不误提交、按钮目标尺寸及数值对比度。只改布局的阶段不增加镜像实现细节的单元测试；真实问题用几何或用户行为断言覆盖。

命令按实际 diff 选择并执行：

| 变更范围 | 必要检查 |
|---|---|
| 纯计划／文档 | `pnpm run doc-sync`、变更 note 的配对检查、`git diff --check`；新文件另查换行与链接 |
| UI／runtime TypeScript | `pnpm exec tsc -b tsconfig.client.json --pretty false`、所属 lint 与行为测试 |
| 样式／组件输出 | 真实构建后的浏览器几何、状态与可访问性检查；相关 keyless snapshot |
| 浏览器组装行为 | 遵守客户端规则执行 `CLOCKY_SNAPSHOT=replay pnpm run test:web`；记录失败归属 |
| Host DTO／解析／权限 | 对应 Host tests、拒绝路径、schema／API 文档及必要 SDK 消费者验证 |
| GUI PR 交付 | 当前构建截图及项目规定的真实 server／model flow GIF；与测试证据分开说明 |

采用 [dsh-pre-push-checks](../../.agents/skills/dsh-pre-push-checks/SKILL.md)选最小充分检查，通过后仅在输入变化、失败或风险未解决时重跑。共享组件变化必须扩到直接消费者。不要为通过新截图而跳过授权、草稿或原请求恢复测试。

## 13. 风险、变更控制与回滚

| 风险 | 预防与触发处理 |
|---|---|
| 现有大量未提交工作持续变化 | 阶段 0 确认归属；每个 PR 开始复核 owner diff；发现相同文件在改时调整边界 |
| CSS 修一个页面、裁剪另一页面 | 共享约束与内容滚动分开；R1 回归表格、长表单、频道、Session |
| 新旧请求事实不能比较 | 留在“待核对”；不将 wall-clock 或不同 revision 强行排序；必要时单独补 API |
| 拆组件重置草稿／重复订阅 | 业务 source 和注册 store 保持身份；检查卸载、重新挂载和授权更换 |
| 合并请求入口遗漏分页外原操作 | 持久页和内存命令分别保留发现路径，统一展示不等于截断全集 |
| 领域列增加查询成本 | 先消费已有 summary；新增字段需批量有界 owner，不逐行查详情 |
| 提升展示可用性意外扩大授权 | 所有目标独立校验；拒绝态改呈现，不改权限去消除拒绝 |
| 工期被可选可视化或 API 扩展拖长 | 延后关系图、全量排序和新聚合；不削减 P1 或恢复验证 |

每个 PR 只改变一个可描述的完整行为，依赖分支遵循项目 PR 与栈规则。计划 R0–R15 是评审边界建议，可合并低风险相邻项；不得为凑编号拆成无法单独验证的中间状态。每个 PR 说明修复的 F 编号、入口路径、数据与权限影响、截图、检查结果及剩余范围。

回滚回退 UI 或新增读取投影，不撤销已受理命令、不改变 durable 身份、不逆写历史。不保留永久兼容层；若为了分阶段集成短期保留旧分支，必须指定移除 PR 和条件。`DESIGN.md`、`UX-CONTRACT.md` 与 Agent Note 随实际完成的阶段同步，整体提案仅在所有必需交付与验证完成后改为 implemented。

## 14. 执行 Checklist

以下清单仅追踪进度；各任务的范围、依赖和完成标准以对应阶段正文为准。完成实现及相关验证后才勾选，并在条目后附 PR、检查结果或截图路径；进行中、阻塞或未验证的条目保持未勾选并注明原因。不适用项保留条目并记录理由。此前的设计审查和文档检查不代表开发阶段已完成。

### 阶段 0：基线与交付约束

- [x] P0-01 确认实现基线、checkout 与现有改动归属。使用原 checkout 的 `master@dbfb6e25b915`；既有已跟踪改动及完整状态清单已保存到 `.tmp-webui-improvement/baseline.patch` 与 `baseline-status.txt`，本轮增量不覆盖原工作。基线构建及 Team／Simulation 浏览器 3 项测试通过（`baseline-build.log`、`baseline-browser.log`）。
- [x] P0-02 在当前构建复现或确认已修复全部 P1 问题。F01/F07/F09 的几何与表单、F10 的目标隔离及 F12 的请求对账均有真实场景或运行时回归；完整回放及末次 Team 样式清理复验通过。
- [x] P0-03 核对 DTO、控制提示、请求与回执的字段和权限。已核对 collections-types、administration-types、control 和 runtime 原命令类型；领域列直接消费 summary，manage／ingress 保留独立身份，不新增 Host API。
- [x] P0-04 确定页面结构、token、滚动与焦点责任。DESIGN、UX-CONTRACT 及对应组件明确工作区／集合／表单／Session 的边界；沿用既有 token，来源与非模态详情焦点由当前授权视图恢复。布局和所有者测试证据见各阶段。
- [x] P0-05 准备后续可复用的隔离场景和验收样本。真实 Host 场景覆盖长名称、空／多页、未知原请求、撤权与精确绑定拒绝；新增 20／200 实体同页规模对照和 Session 内图片预览场景，不使用生产数据。
- [x] 阶段验收：基线可复现、字段来源可追溯，完成工作量重估。

### 阶段 1：工作区几何与框架

- [x] P1-01 修复工作区伸展链及模块宽度不一致。Team 根容器填满内容区，`team-workspace.snapshot.ts` 几何断言及完整任务／Session 流程通过；证据 `.tmp-webui-improvement/stage1-team-browser.log`。
- [x] P1-02 拆分仿真身份、操作、状态与模块导航。标题、状态和导航分别布局，标签与值成组，诊断折叠；两种后端的 `simulation-workspace.snapshot.ts` 通过，中英／浅深色／390px／原生 200% 证据位于 `.tmp-simulation-plan/web-browser/`。
- [x] P1-03 明确各页面滚动区域并消除长表单裁剪。目录／概览／请求页随工作区滚动，集合表与非模态详情各自滚动，表单正文滚动且操作页脚可达；保留原频道与 Session 滚动 owner。真实长表单及集合／请求缩放验证见 `requests-final-browser.log`、`request-layout-browser.log` 和既有 Team／worker 证据。
- [x] P1-04 完成窄屏单主面板与诊断折叠。详情替换集合主面板，诊断默认折叠，共享菜单选择模块；收紧窄屏标题及状态间距。390px 常规运行页的模块入口在顶部 240px 内，原生 200%／400% 及中英／浅深色检查通过（`request-layout-browser.log`，6 项）。
- [x] P1-05 统一按钮强调、busy 尺寸与选中状态。主调度动作遵循 Host 准入，原请求终态仅保留查询；模块及 More 标出当前选择。真实延迟创建保持 126×36px 及同一纵向位置，IME 组合输入不提交；两后端／两模式通过（`modal-layer-browser.log`、`busy-geometry.json`）。
- [x] 阶段验收：桌面／窄屏、长标题、详情与长表单的真实浏览器检查通过。

### 阶段 2：导航目标与来源恢复

- [x] P2-01 分离请求目标、成功显示对象和来源上下文。真实来源导航、缺失／拒绝目标均使用独立主体，旧 Team 不冒充目标；见 `source-focus-browser.log` 的 Team workspace 通过项及 `source-focus-recheck2.log`。
- [x] P2-02 完成拒绝、缺失、绑定失效与网络失败状态。错误分类与本地化由 Team 路由 owner 提供；网络失败重试、历史绑定拒绝和撤权场景在两后端通过（`source-focus-recheck2.log`）。
- [x] P2-03 实现有界来源返回，URL 不携带私有输入。history 只保留允许的同文档视图参数并绑定精确 Team 目标；异常／外部／超长 history 由单元测试拒绝。
- [x] P2-04 覆盖直接深链、刷新及 Back／Forward。真实浏览器覆盖无来源历史绑定错误、来源刷新、前进／后退及返回目录；见 `source-focus-browser.log` 的 Team workspace 项和 `source-focus-recheck2.log`。
- [x] P2-05 保留草稿，隔离旧正文并恢复来源焦点。失败目标不会清空另一 Team 草稿；真实撤权清除相应私有数据。Team 浏览器验证表单输入穿过错误／Back／Forward，来源两后端验证返回焦点；相关 runtime／store／layout 112 项验证通过。
- [x] 阶段验收：F10 不再复现，精确引用、草稿和授权代际回归通过。

### 阶段 3：请求与回执对账

- [x] P3-01 明确各类命令与持久请求的对应范围。行政请求按 commandId 对应并核对 runId；manage／ingress 保持独立。见 `request-presentation.ts` 与 `simulation-request-recovery.client.spec.ts`。
- [x] P3-02 实现 runtime 拥有的只读请求展示事实。保留回执与请求日志观察分开；页外观察保留并标记，只有成功查询替换回执。相关 runtime／UI 单元验证通过（`.tmp-webui-improvement/reconcile-team-unit.log`）。
- [x] P3-03 覆盖新旧回执、冲突、未知、查询失败和账号更换。终态冲突仍可查询、不可释放或重发；账号替换清空。新增对账测试及既有行政测试通过，另见 `request-conflict.log`。
- [x] P3-04 统一请求入口，保留分页外及仅内存原命令的恢复路径。“更多 → 请求记录”合并持久页与对应原命令，分页外／管理／输入原操作独立保留；尚无运行身份的未知创建仍在目录可恢复。持久页去重呈现，读取由 Workspace 统一拥有；进入概览仍核对原请求，移走 UI 入口不改变对账生命周期。四项原操作恢复及相关导航共 16 项真实流程复验通过（`full-regression-fixes-browser.log`）。
- [x] P3-05 完成精确查询／重试及其忙碌、错误与路由状态。请求模块路由只选择运行及模块，原输入不入 URL；查询／重试沿用同一身份，终态仍可查询。超出容量的对账显式标记并阻止重发／释放，分页外不清除该标记。两后端冷恢复、检查点／输入原结果及浏览器重载通过（`requests-final-browser.log`），类型与 lint 通过。
- [x] 阶段验收：F12 不再复现，命令身份、执行次数与重启恢复回归通过。

### 阶段 4：Simulation 主要流程

- [x] P4-01 完成并列工作区入口与各自浏览状态保留。新增可选 `sidebar.workspaceNavigation`，仿真不再位于设置旁；Team 目录隐藏但不卸载。真实浏览器验证精确对象路由返回，以及未提交创建草稿跨工作区切换保留（`session-browser.log`、`domain-draft-browser.log`）。
- [x] P4-02 完成运行目录、搜索及空／错误状态。RunDirectory 保留原目录读取 owner，名称与场景／调度／模拟时间前置，ID／注册时间及主机资源按需展开。两后端目录、状态读取失败／恢复与窄屏／原生缩放通过（`directory-browser.log`）。
- [x] P4-03 完成表单尺寸变体并回归现有小确认框。`Modal size="form"` 桌面 800px、窄屏全高；表单正文滚动、操作固定。两种后端 × 两种执行模式的创建及原尺寸启动确认框通过（`.tmp-webui-improvement/form-browser.log`，4 项）。
- [x] P4-04 重组创建表单、默认额度、预检与字段错误。基本输入前置、默认额度摘要、配置与额度按需展开；字段错误展开并聚焦，预检结果后置，创建动作明确暂停状态。组件验证与两后端 × 两执行模式真实创建流程通过（`current-browser.log` 中 administration 文件）。
- [x] P4-05 接通准备状态、初始检查点和未知创建结果恢复。初始检查点仍约束开始准入；创建响应丢失保留原 ID，核对或重试不创建第二运行。两后端创建／初始准入／进程重启恢复场景通过，见 `control-restart-browser.log` 与 `domain-draft-browser.log`。
- [x] P4-06 重组运行概览、待处理事项与关键指标。四项主指标、额度及主机资源分层，审核和未知结果前置。Host 从保留创建 driver 投影执行模式，仅已确认 cognition-only 隐藏自动任务控制，错误／未知仍保留刷新。Host／UI 74 项及两后端 × 两执行模式 4 项真实流程通过（`execution-unit.log`、`execution-browser.log`）。
- [x] P4-07 完成基于真实准入的开始／继续／暂停操作。按 Host 准入强调主操作，执行历史提示决定继续文案；成本确认、暂停仍有收尾、原身份与忙碌标签保留。组件及创建／暂停／重启浏览器场景通过；旧操作结束不刷新新运行（`control-unit.log`、`control-browser.log`、`control-restart-browser.log`）。
- [x] 阶段验收：桌面／窄屏创建与观察流程通过，预检无写入、创建无推理及原请求恢复保证不变。

### 阶段 5：Team 日常体验

- [x] P5-01 统一根 Team、执行任务、工作目录和频道命名。全局为团队工作、创建为新建团队工作，目录分组为工作目录；Team 内任务与频道各自命名。侧栏快照、类型检查及真实导航／草稿／子团队流程通过。
- [x] P5-02 分开“需要你处理”与“待执行”及其计数。计数仍来自各自权威投影；overview／attention 组件及 Team workspace／attention 浏览器流程通过。
- [x] P5-03 重组概览主次信息与空待办呈现。三项主指标、独立任务区域、紧凑空待办，用量移到次级展开区；相关 56 项组件验证及真实 Team workspace 流程通过。
- [x] P5-04 优化任务摘要并明确刷新／分页含义。状态、执行者、依赖与最近结果在前，审核／执行记录动作先于完整说明与历史；刷新明确返回第一页。18 项拥有者测试及真实任务／草稿流程通过（`task-summary-unit.log`、`task-session-browser.log`、`round2-browser.log`）。
- [x] P5-05 简化频道常规输入，保留完整内容块与投递配置。单文本隐藏排序说明，多内容块按需展开，空历史显示尚无消息；四项真实频道流程通过，包含重连、顺序图片、草稿、邀请及协议（`recheck-browser.log`）。
- [x] P5-06 区分协调者沟通和 worker 只读执行记录。当前可写协调会话使用目标上下文空态；worker／历史／非成员视图不显示直接输入与模型控件。真实 worker 执行记录、关闭返回焦点与协调者沟通通过，原输入 owner 不变（`worker-record-browser.log`、`session-browser.log`；组件 50 项通过）。
- [x] 阶段验收：任务、频道、会话的真实路径及草稿／冲突／权限回归通过。

### 阶段 6：领域列表与追溯

- [x] P6-01 提取集合外框，保留领域自己的列定义。CollectionWorkspace 负责筛选、分页、详情与滚动／焦点，读取生命周期仍由原 Workspace 拥有；118 项组件验证、6 项真实浏览器流程通过（`collection-frame-unit.log`、`collection-frame-browser.log`）。
- [x] P6-02 完成实体／决策列表，复用已有 summary。领域列及具名对象动作由 CollectionTable 渲染；精确模拟时间不转换为 Number。组件测试与两种后端的 workspace 浏览器检查通过。
- [x] P6-03 完成操作／检查点列表，保留各状态的独立含义。业务结果、发布、送达与检查点保存、时间、来源验证分列，未执行验证保持明确标签；组件及浏览器阅读流程通过。
- [x] P6-04 完成对象摘要、详情分区、动作名称和窄屏详情层。授权名称与领域摘要前置，技术字段折叠；长名称可展开，查看／关闭动作具名并恢复行或筛选焦点。两后端 workspace 浏览器覆盖窄屏、展开及焦点（`collection-frame-browser.log`）。
- [x] P6-05 完成可读记录类型及精确筛选，保留未知扩展类型。14 类原生记录提供双语名称与快捷选择；未知／截断类型保留原值，手输筛选不裁剪空白。类型单元及真实 records 浏览器检查通过（`detail-record-unit.log`、`collection-frame-browser.log`）。
- [x] P6-06 接通实体、决策、操作、来源与关联执行导航。精确对象／Team／频道／Session 引用保留独立权限和来源焦点；两后端 sources、workspace、records 路径共 6 项通过（`directory-browser.log`），关联对象组件覆盖见 `collection-frame-unit.log`。
- [x] P6-07 验证读取性能，确认必要 Host 增强或记录无需增强的结论。20 与 200 实体均只渲染 16 行、119 个表格节点，首次列表读取各 1 次、逐行 inspect 为 0；翻页及三轮切换共 5 次列表读取。领域列无需新查询；执行模式是已验证的唯一新增投影。见 `reading-scale/measurements.json`、`final-simulation-acceptance.log`。
- [x] 阶段验收：领域阅读与追溯路径通过，分页、撤权、旧响应退休及导出回归通过，无新增 N+1 读取。

### 阶段 7：整体验收与交付

- [x] P7-01 完成关键流程和验收矩阵，关闭全部 P1。`CLOCKY_SNAPSHOT=replay pnpm run test:web` 最终 94 文件通过、1 文件按条件跳过；282 项通过、14 项按条件跳过，无失败（`final-web-confirmation.log`）。此前失败已逐项修复；清理无引用样式后 Team 浏览器复验通过（`cleanup-browser.log`）。
- [x] P7-02 完成双语、主题、键盘、读屏名称、对比度、缩放及 reduced-motion 验证。真实 Chromium 覆盖中英／浅深色、320/390px、桌面与原生 200%/400%；极矮表单字段可滚动进入视口，IME 不提交，模态焦点隔离／返回及图片子模态关闭通过。名称由可访问性树检查，不声称人工读屏器或全浏览器认证。
- [x] P7-03 完成读取数量、订阅、DOM 规模和切换性能检查。十倍实体规模保持相同页 DOM，重复切换没有累加列表请求或 inspect；真实断连／重连／插件重挂与旧响应退休通过，观察 owner 单元测试验证共用／释放。证据 `final-simulation-acceptance.log`、`final-layout-owner-unit.log`；耗时为本机观测，不作为跨设备性能承诺。
- [x] P7-04 清理旧呈现分支、无用样式及重复订阅／路由 owner。移除旧悬浮导航错误、旧会话入口和进度条样式；集合和请求呈现分离且保留原业务 owner。请求页初读仅由 Workspace 拥有；scale 场景与观察生命周期测试验证读取不累加。
- [x] P7-05 同步设计规范、UX 约定、README、双语文档与 Agent Notes。工作区层级 note 移入 implemented；原 Team／Simulation 决策保留并交叉链接，独立权限和持久语义未被替代。配对及 doc-sync 验证见最终证据。
- [x] P7-06 归档构建截图、检查结果和适用范围。证据位于 `evidence/implementation/`，含最终构建记录、全量结果、视口／对比度及读取规模数据。本轮未创建或发布 GUI PR，故 PR 的真实 provider GIF 条件不适用；keyless 回归不被当作实模录制。
- [x] 阶段验收：交付演示、证据和遗留风险清单齐全，未验证范围明确标出。

### 里程碑交付

- [x] M1：阶段 0–3 验收完成，布局、导航身份与请求对账可独立交付。
- [x] M2：阶段 4–5 验收完成，创建、观察、任务处理和沟通流程可交付。
- [x] M3：阶段 6–7 验收完成，领域追溯、整体验收与最终文档可交付。

## 15. 最终验收记录

最终证据见 [verification.json](evidence/implementation/verification.json)；原构建不是干净 HEAD，而是保留既有工作后的增量实现。未创建提交、PR 或部署。

| 要求 | 证据 |
|---|---|
| 工作区几何、长名称、窄屏单面板、表单 | workspace／administration acceptance 场景；原生缩放截图；提交按钮前后位置与尺寸相同 |
| 目标隔离、来源返回、历史绑定、草稿及授权 | sources／team-workspace／read-lifecycle；失败目标没有旧正文；来源重验后恢复焦点 |
| 对账、原身份、响应丢失及进程恢复 | request-recovery runtime、operation-retry、task-review、process-restart；概览和请求记录共享同一读取 owner |
| 创建、预检、暂停／继续、预算与执行模式 | administration、administration acceptance、model-pool；两后端／两模式及创建无推理断言 |
| Team 任务／频道／协调者与执行记录 | team-workspace、channel、task-draft、worker record、conversation 回放；私有草稿与权限边界保留 |
| 集合、记录、来源及导出 | workspace、records、sources、read-lifecycle；未知类型保持原值，撤权及不完整导出不交付文件 |
| 读取与渲染规模 | [reading-scale.json](evidence/implementation/reading-scale.json)：20/200 实体均 16 行、119 表格节点，1 次初读、0 次逐行 inspect |
| 模态层、键盘与焦点 | image-inspection、adminDialogMatrix；400% 字段可见，图片预览关闭后父会话与草稿保留 |
| 组装与静态检查 | 最终全量 Web 282 通过／14 条件跳过；doc-sync 29 项；构建、所有者 lint、静态 UI audit 与 diff 检查 |

验收采用风险组合，未机械穷举全部尺寸×语言×主题×业务状态。浏览器证据来自 Chromium；真实 Host 使用隔离数据，执行场景的外部推理由脚本提供。没有声称真实 provider 吞吐、生产负载、人工读屏器认证、跨浏览器一致性或跨重载持久化私有草稿。条件跳过保留测试自身的 record／平台／配置条件，未为消除失败新增跳过。
