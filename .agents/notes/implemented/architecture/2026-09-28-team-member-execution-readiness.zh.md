# Agent Note: 从实际所有者读取成员执行就绪度

Status: implemented

[English](2026-09-28-team-member-execution-readiness.md) | 中文

## Problem

已允许参与的成员可能没有匹配执行路由，持久 idle binding 也可能比 writer 活得更久。当前页任务行不能证明另一成员正在执行。这些事实需要不同处理方式，统一称为 active 会掩盖配置失败和恢复责任。

## Decision

`getMemberReadiness()` 使用绑定完整输入的成员资格 read proof。Hub 只读取指定身份，投影当前参与资格、active attempt、live-activation 与任务并发容量、待处理 reservation 和保留的 binding 证据。响应受字节上限约束，保留请求顺序，并用 Team cursor 限制续页。查询不激活、恢复、隔离或停止 actor。

带作用域的 `team/member-execution-observe` waterfall 在 Hub 串行队列内读取真实生命周期所有者。监听器委派给后续监听器，不重新进入 Hub 读取，也不返回 handle 或启动选项。Activation controller 报告保留的 entry、待启动操作和未完成清理。TeamRun 用保留的成员表和冻结配置识别受管成员，placement 则匹配与生产激活路径相同的描述字段。准确的受管所有权优先于配置路由，所有者冲突会失败，不依赖插件顺序。

AgentRuntime provider 声明 `participantKinds`，registry 在调用 provider 前执行该约束；in-process 支持 local agent，SDK 和 ACP 支持 remote agent。就绪度读取同一声明，不按 provider 名称猜测。Controller 将类型不支持归为确定的启动前拒绝，并释放已有 startup reservation。Provider 注销时，已接受 handle 的所有权仍保留。

只有与持久 epoch 一致的 live controller 观察才能确认 resident 或 busy。没有当前所有者或尚未收尾的 epoch 要求恢复；不能仅因 epoch 为 offline 就释放容量。Human、service 和 Simulation 管理的成员有各自解释，不套用本地模型角色。Ready 只表示观察到的路由与当前准入事实，不保证后续任务、模型调用或远端进程成功。

Runtime 在有界分页全部成功后，原子发布有限的请求成员集合，并保留每行观察版本。它与任务能力共享轮询、取消和重连所有权。网络失败保留明确标记过期的旧观察，授权拒绝清除观察。UI 将参与资格与执行分开，并按配置间隔重读独立的运行时变化。[能力观察决策](2026-09-28-team-task-capability-observations.zh.md) 继续拥有任务表单授权；[产品提案](../../proposed/architecture/2026-09-28-web-team-simulation-product-integration.zh.md) 保留更广的 Simulation 工作；[执行配置选择](2026-09-28-team-execution-profile-selection.zh.md) 拥有部署选项。

## Alternatives considered

**根据 active 资格、角色或当前可见任务推断执行。** 这些信息不能证明路由所有权、驻留、离页工作或容量。

**将持久 idle/running binding 当作实时执行。** Host 停止后仍可能保留这些记录。展示驻留前需要当前所有者证据，恢复仍保留未完成责任。

**只检查 provider 名称。** 进程内与远端机制接受不同成员类型。由实际激活操作执行的声明，让观察与真实准入保持一致。

**读取完整 Team 快照或启动 actor 以发现就绪度。** 完整历史与当前成员集合无关，启动工作又会把查看变成执行。有界投影和仅查询所有者的观察避免这两种问题。

## Consequences

成员可以保留参与资格，同时执行配置不可用。Provider 移除、容量变化及恢复所有权独立于当前成员／任务页面可观察。每次查询反映持久与 live 事实的观察时刻，不是全局资源预留。路由、preset 和 model 的启动校验仍在执行时进行。部署选项遵循执行配置选择决策；按主体隔离的名称遵循[身份解析决策](2026-09-28-team-identity-resolution.zh.md)。

## Verification

纯投影及 runtime 测试覆盖所有权不匹配、恢复、容量、类型兼容、续页拒绝、取消及原子发布。JSON 和 SQLite 测试在不改写日志的情况下验证请求顺序及响应字节上限。真实 Web 场景让无路由成员保持未激活，并让有路由成员经生产 scheduler、activation、delivery 和面向模型的报告工具完成任务，结果不由任务完成 helper 提供。
