# Agent Note: Web 运行稳定性与默认启用 Simulation

Status: implemented

[English](2026-10-07-web-runtime-stability-and-default-simulation.md) | 中文

## 问题

原生视图捕获会在更新回调到达前暂停绘制。在回调中等待动画帧造成约四秒导航超时；把逻辑路由也延后到捕获回调，会让迟到回调覆盖浏览器后退。侧栏中的 Settings 继承祖先层叠上下文。持续环境动效增加空闲开销，认证拒绝又错误触发成功重连的批量刷新。默认 Simulation 部署还要求已安装模板在没有模型配置时保持可用。

## 决策

标准 Web bundle 在 Team 旁安装真实 Simulation 产品。启动和浏览不分配世界或 writer，也不推理。明确创建会准备暂停世界与完整初始检查点；明确启动才准入模型工作。冷恢复需要确认，完成后仍暂停。[Bundle 配置](../../../../packages/bundle/web-app/README.zh.md)持有稳定 group、生产模板、actor 预设、资源边界与自定义部署接管流程。原生仿真定义归该预设所有；普通 agent 的进程全局目录保持空白。加入预设的 actor 将继承能力限制为三种原生操作。

### 呈现与认证

[导航](../../../../packages/client/ui-viz/src/motion/view-transition.ts)在返回前同步提交 React 呈现。原生回调共享幂等提交，不能在后退／前进后再次执行旧意图。可选捕获可能观察到已提交视图，因此不保证新旧元素之间的变形。instant 时间 token 限定视觉生命周期，新的指针／键盘输入和文档隐藏会结束它；Promise 拒绝仅清理自己的过渡。React 保持在呈现代码中。

Settings 使用共享的 body portal 原生 Modal，保留 slot 与外部分类请求，并以稳定后备控件限制和恢复焦点。宽度至少 720px 使用分类侧栏，更窄窗口使用带标签的分类选择器与全宽字段。Menu、HoverCard、Popover 的 portal 留在活跃原生祖先内，内层 Escape 不取消祖先。Swarm 自动布局保存不取消精确目标授权或成员／Session 核验。环境光晕和空／静止轨道保持静态；实时动效要求真实活动、可见性和动态效果许可。

只有成功通过认证的握手发布 `connection/reset`。独立的 `connection/authorization-cleared` 信号对每个授权代际仅清退一次主体投影和在途读取。保护读取停止，直到用户更新访问凭据并明确重查；一次重查仅允许一轮握手，再次拒绝仍保持终止。普通网络失败保留退避，领域 forbidden 不使整个客户端登出。凭据不进入 URL、日志或 localStorage。

### 安装就绪与不可变受理

已安装模板包含显式路由或 `agent-default` 选择器。[模型解析](../../../../packages/simulation/simulation-product/src/template-model.ts)在预检和受理时读取现有 Agent 默认模型，将 `model` 映射为 driver 的 `name`，并只解析元数据、不推理。结构错误仍拒绝加载。目录／预检以严格 `ready`、`needs-model`、`unavailable` 表示独立于字段有效性的就绪状态。公司 driver 支持提供方默认推理强度，对不支持的显式强度报告原因，不静默丢弃。

创建携带用户确认路由的 `expectedModel`。准入在持久队列位置重新核对模型、主体和容量；路由改变会在分配前以 `simulation-product-model-changed` 拒绝。受理后冻结完整 driver／spec／template 与原始命令。同命令重试先协调保留结果，再考虑当前就绪状态。路由确认在持久数据中是冗余信息，从冻结 driver 重建；命令日志保持 format 2，不加入选择器、隐式迁移或兼容 shim。TypeScript 与 Python 契约共享这些严格 DTO。

空目录展示已安装模板和创建操作；缺少模板报告部署配置问题，缺少能力的深链提供返回 Team。共享 `settings.model-setup` slot 挂起创建页、保留有界私有草稿、打开模型设置，返回时重读就绪状态。默认提供方和模型需要明确选择；返回仅预检，不提交。授权替换按照现有所有者清退私有草稿和原始操作状态。

### 决策归属与验证

[产品登记](2026-09-29-simulation-product-directory.zh.md)和[持久创建](2026-09-29-persistent-company-creation.zh.md)保留授权、删节、不可变身份与所有权理由。本决策局部替换默认部署和模板就绪行为。[Web 布局](../../proposed/feature/2026-10-02-web-ui-redesign.zh.md)与[可视化](../../proposed/feature/2026-10-04-swarm-and-world-visual-layer.zh.md)保留各自独立范围。没有任何记录完全过时或归档。[开发记录](../../../plans/2026-10-07-web-runtime-stability-and-default-simulation/development-plan.md)和[checklist](../../../plans/2026-10-07-web-runtime-stability-and-default-simulation/checklist.md)持有确切命令、结果及证据边界。

## 考虑过的替代方案

**由捕获决定逻辑导航。** 即使渲染回调同步执行，也需要等待捕获后才能到达。逻辑历史立即提交；可选视觉捕获可以损失变形保真度，却不能改变目标。

**提高 Settings z-index 或删除侧栏过渡名称。** 这些做法无法跨祖先上下文建立原生焦点／inert 所有权；共享原生模态提供该边界。

**只默认显示按钮、部署 fixture 或假模型。** 这些做法既不提供生产模板，也不能诚实表达模型就绪，还可能引入加速定时器或启动推理。发布 group 使用原生所有者与生产默认值。

**改写所有 profile 或自动启动样例。** Bundle 安装覆盖已初始化标准 profile 并保留用户 patch；暂停创建与明确恢复／启动保留执行及计费所有权。

## 后果

可选视觉过渡不延后路由，空闲装饰不造成循环动画／布局。受控空首页测量中，默认 group 增加约 500KB 到可用启动的传输与约 0.8MB 浏览器堆。SwiftShader 和真实 Apple M4 Pro Metal 采样分别报告，启动／空闲差异低于 10% 调查阈值；Headless 指标不代表设备 FPS。

提供方元数据就绪不能证明远程凭据有效，第一次明确真实请求仍可能失败。无模型确定性离线执行、自动迁移、自动恢复和替换引擎不在本决策范围。自定义根目录与日志保留，接管前明确关闭默认 group。已有运行进程在正常重启时加载新组合；只读 smoke 不静默重启用户工作或认证另一个浏览器。Replay 适配器仅替换外部模型行为，证据明确标注此边界。
