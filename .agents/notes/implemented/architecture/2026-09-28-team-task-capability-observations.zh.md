# Agent Note: 已认证的任务编写能力观察

Status: implemented

[English](2026-09-28-team-task-capability-observations.md) | 中文

## Problem

浏览器枚举中存在工作区模式，并不证明人工主体获准使用、provider 已提供该模式，或 scheduler 能分配它。Team 日志通知也不能反映 provider 卸载。为回答这些问题反复读取完整 Team 快照，会复制无关任务和 activation 历史。

## Decision

人工 proof 签发者通过 `resolveHumanActor()`，在 Hub 串行队列内选择唯一的 active principal-owned 成员及其操作名称。`getTaskCapabilities()` 要求准确的 `task-capabilities-read` 成员资格 proof，检查当前 grant，复用任务创建规则规范化输入路径，并投影生命周期、任务数量、真实时间和尝试次数限制，不暴露 grant 或获准路径前缀。

Host `team.capabilities` 将该投影与真实 workspace registry 及 `team/task-scheduling-modes` waterfall 合并。运行中的 scheduler 通过 effect 管理的监听器报告配置模式，并先委派再合并结果。缺少 provider 与不支持的调度模式具有不同 reason code。观察摘要涵盖 principal credential generation、Team 投影和实际观察到的运行时可用性；它不是写凭证，也不保证后续分配成功。现有 Team 读取检查让同一精确身份 proof 跨越 scheduler／provider 观察，并在成功或失败后重新验证。该 IO 期间持久成员资格结束时，即使传输凭据仍有效，也不返回先前能力提示。任务创建仍重新检查全部授权、任务图、预算、placement 和 policy。

Client runtime 拥有单个表单观察及其取消、失败和重连状态。UI 插件提供经过校验的轮询间隔，使可用性在没有 Team WAL 变化时也会更新。关闭表单释放读取和 timer。网络失败保留展示提示但阻止提交，授权拒绝清除提示。路径编辑、provider 变化和重试都不改写表单草稿。高级控件解释不可用模式，并允许显式移除过期的路径选择。

[有界控制面决策](2026-09-01-bounded-team-control-plane-pages.zh.md) 继续拥有集合与检查职责。[Team/Simulation 产品提案](../../proposed/architecture/2026-09-28-web-team-simulation-product-integration.zh.md) 保留成员就绪度、身份解析、待处理事项和 Simulation 要求；这些能力观察不实现上述功能。

## Alternatives considered

**筛选浏览器拥有的模式枚举。** 浏览器没有当前 grant、provider 注册和 scheduler 配置，猜测默认值会导致可预见的拒绝，或隐藏已支持选项。

**暴露完整 grant 和 Team 快照。** 这会披露获准路径前缀，并复制与编写任务无关的历史。Proof 签发者只需要成员身份和操作名称，表单只需要针对所提供路径的判定。

**仅按 Team 日志更新失效。** Workspace 和 scheduler 注册会独立变化。可配置轮询重新检查实际所有者，不要求 Team 发生变更或刷新整个页面。

## Consequences

表单能解释已知的编写限制，同时不扩大任何变更权限。查询是跨独立所有者的只读观察，不是原子资源预留或 policy 预批准。细粒度预算、placement 和自定义 policy 失败仍由写路径处理。轮询仅在表单打开时增加有界请求，断线时暂停，销毁时结束。成员执行就绪度仍需独立查询，因为工作区模式可用不表示存在匹配成员或空闲容量。
