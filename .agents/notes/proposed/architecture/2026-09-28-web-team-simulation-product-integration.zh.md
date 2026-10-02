# Agent Note: 感知能力的 Team 控件与 Simulation 产品所有权

Status: proposed

[English](2026-09-28-web-team-simulation-product-integration.md) | 中文

## Problem

Team 展示可能把当前分页缺少信息误认为权威记录不存在，表单也提供默认人工授权或执行配置无法满足的选项。Simulation 已有持久世界与协调服务，但缺少完整的 Web 运行管理所有者；普通 Team 控件不能表达其调度、检查点与恢复语义。

## Proposal

保留 Team、Simulation 与 Session 各自的权威所有权。为 Team 控件增加已认证的能力与就绪度投影，使身份与已选依赖独立于列表分页，并让空集合和失败集合保留可操作入口。每次写入仍必须通过后端授权。

增加显式启用的 Simulation 产品服务，负责运行发现、访问控制、每个 provider/run 身份的唯一活动句柄以及有界、版本化场景调度器。复用持久 phase 管理、ingress、checkpoint 和 restore 操作。浏览不启动推理；恢复验证保留历史和当前后缀并返回暂停状态，不回滚世界。独立 UI 消费有界授权投影，而不是完整世界快照。

Simulation 自动任务执行需要单独验证的 executor、持久 task/attempt/decision 关联与严格限定的 Hub 权限。继续关闭普通 Team 交付旁路并限制 actor 工具。现有任务创建与对账不能证明自动执行。[产品设计](../../../../design/webui-team-simulation-2026-09-28/design.md)、[API/运行时设计](../../../../design/webui-team-simulation-2026-09-28/api-and-runtime.md) 和 [实施计划](../../../../design/webui-team-simulation-2026-09-28/implementation-plan.md) 承载详细方案及验收矩阵。

## Relationship to existing decisions

[产品目录决策](../../implemented/architecture/2026-09-29-simulation-product-directory.zh.md) 实现不可变登记、已认证 Host 元数据/历史读取和分区对象元数据集合。本提案保留私有上下文与事件历史读取、Web/SDK 接入、活动所有者合并、行政控制和自动执行要求。

[Team 工作台决策](../../implemented/architecture/2026-09-11-team-workspace-ui.zh.md) 继续有效，其导航、只读检查和 UI 所有权仍适用。[持久 Simulation 提案](2026-09-17-durable-simulation-coordination.zh.md) 继续有效，其世界、writer、outbox 和恢复规则是本方案前提。[Team 产品收敛提案](2026-09-04-native-multi-agent-p1-product-convergence.zh.md) 保留更广的协议范围。本提案增加产品适配和执行就绪度，不取代这些独立决策；不归档或拒绝现有记录。

[持久创建决策](../../implemented/architecture/2026-09-29-persistent-company-creation.zh.md)定义公开分配、原请求结果及 paused 准备句柄；调度、ingress、恢复和自动执行仍由独立 owner 负责。

## Alternatives considered

**直接复用普通 Team 控件管理 Simulation。** Team 生命周期操作不拥有 Simulation 调度或跨所有者检查点采集，容易暗示不存在的权限。产品服务必须将操作路由到实际所有者。

**每个 HTTP 请求各自打开和关闭 run。** 这与长期执行所有权及协调器互斥冲突。Host 持有的句柄应独立于浏览器请求，发现则使用安全读取投影。

**为 Simulation actor 开启普通 Team 工具和交付。** 这会绕过已接受操作、受限模型工具和持久发布证明。自动任务需要明确的 executor 权限与恢复责任。

**同时重写 UI 与运行时。** 现有生命周期和重放测试提供了有价值的保证。先修复已观察到的行为，再按职责拆分模块，只优化测得的开销。

## Acceptance criteria

跨页负责人和依赖行为、空态入口、默认授权控件和成员就绪度通过组件与真实 Host 浏览器检查。Simulation 支持已认证有界检查、幂等管理、生产场景调度器以及 keyless JSON/SQLite 检查点与恢复流程。自动任务模式必须在分配、持久输入、真实决策执行、完成/审核和对账不依赖测试 helper 完成任务的情况下通过，才可启用。executor 新增责任纳入检查点和崩溃恢复。

## Risks

运行目录引入需要恢复的跨所有者创建工作；HTTP 取消不能遗弃已接受操作。能力数据可能过期，不能替代授权。私有世界和模型上下文需要明确的读取投影。executor 权限增加协议和持久化工作，因此与只读检查分阶段交付。性能优化需要测量证据，并保留重放和旧身份隔离检查。
