# Agent Note: Durable storage logs and Team service definition

Status: implemented

[English](2026-08-27-durable-storage-logs-and-team-service-definition.md) | 中文

## Problem

实验性 Team runtime 把 Team 事实存入 Lead Session，并通过回放该 Session 推导状态。稳定的 Team 提供方需要独立于活跃 Agent 的持久化根，以及用于 Team journal 和 channel WAL 的持久预期序列操作。现有 storage KV 分面提供原子的当前记录写入，但不能原子地比较流尾序列、追加完整事件批次并保留投影检查点。

产品还需要不能把 Team、participant、channel、activation、envelope、task 或 attempt 与 Session 混淆的 Team 词汇。复用实验性 `TeamId(SessionId)` 转换会保留原生工作系统设计所移除的身份耦合。

## Decision

`@clocky/clocky-storage` 在 `kv` 旁公开可选的 `log` 分面。`LogStream` 只会在调用方预期尾序列匹配持久尾序列时追加非空批次，读取有界的有序页面，并保存不晚于该尾序列的单调检查点。每个值都作为分离的 JSON 快照跨越持久化边界。`@clocky/clocky-storage-log` 挂载 `ctx.storage.log` 和 `ctx.storageLog`，按不透明名称路由每个调用方拥有的流句柄，只列出仍归其配置路由所有的流，并在 dispose 时关闭准入后排空已接受的 open 和句柄。

JSON 后端把每个日志流存入编码后的文件名下，并为所有日志操作持有一个根目录范围的所有者记录。存活的同主机或异主机所有者会拒绝另一个 Hub；已证实死亡的同主机所有者会在恢复前被原子地隔离。SQLite 后端在其 schema 中保存流元数据、条目和检查点。`BEGIN IMMEDIATE` 覆盖尾序列比较、完整批次插入、尾序列推进和提交，因此独立打开的 SQLite 后端不能同时接受同一个预期尾序列。其物理 schema 版本为 `2`；预发布数据库标记为其他版本时会明确失败。

`@clocky/clocky-team` 定义独立的带品牌 Team 身份、持久和协议记录的解析器、带纯转换检查的封闭生命周期词汇、带版本的 channel 适配器注册、Team 策略 waterfall，以及 `ctx.teams` 上受包含的提交后观察者。channel manifest 冻结适配器配置，而 WAL 单独记录生命周期边。它不导入 AgentLoop 或实验性 Team runtime。它是抽象 Service Definition。[`@clocky/clocky-team-hub`](../../../../packages/team/team-hub/README.zh.md)是其本地提供方，负责 Team journal、channel WAL、投影、恢复、成员／任务变更和游标 watch；投递、调度、Agent placement 和产品操作仍是独立工作。

Phase 0 清单在 `.agents/inventory/direct-session-entrypoints.json` 中记录每个当前直接 Session 创建、恢复、fork 和模型可见编排路径。其校验器随静态 package 检查运行，因此后续切换从经过检查的源码位置而不是纯文字清单开始。

## Alternatives considered

**把 Team 状态保留在 Lead Session，并为实验性服务增加方法。** 不予采纳，因为稳定 Team 身份、持久排序、授权和恢复仍会依赖活跃 Lead Session 和直接子代谱系。

**从 KV 分面构造预期尾序列追加。** 不予采纳，因为独立的加载和写入调用无法提供后端级 compare-and-set 批次或检查点水位；提供方会错误宣称原子恢复语义。

**使用 Session 标识符作为 Team 标识符。** 不予采纳，因为 Session 是一个 participant 可选的本地 transcript，而 Team 是持久协作和授权根。跨边界 id 保持为不同品牌，只在持久或协议边界解析。

**在该基础中挂载不使用日志数据形式的 Team Hub，或替换产品 Session 入口。** 不予采纳，因为本地 Hub 需要持久预期尾部流、回放和检查点后才能拥有 Team 状态。[本地 Team Hub](2026-08-27-local-team-hub-durable-authority.zh.md)使用该基础；Agent runtime placement、channel 投递、task scheduler 和产品 API 仍是独立工作。

## Consequences

JSON 和 SQLite 消费方共享一份追加日志约定。JSON 明确拒绝并发 Hub 所有权，而不是静默接受最后写入者胜出的流更新；SQLite 提供事务化的预期尾序列行为。日志数据形式保持在主机侧，不贡献模型可见提示词、工具或 Session 事件。

Team Service Definition 向提供方公开。本地 Hub 只在显式挂载时创建持久 Team，不改变当前任何 Session、Goal、workflow、SDK、Web、ACP 或 CLI 操作。在产品切换完成替换前，实验性 Team 包仍是已发布的显式启用协作实现。

[原生多 agent 工作系统提案](../../proposed/architecture/2026-08-27-native-multi-agent-work-system.zh.md)保持 proposed，因为其中的调度器、workspace 和产品工作尚未发布；[本地 Team Hub 决策](2026-08-27-local-team-hub-durable-authority.zh.md)记录已经完成的本地持久化部分。[领域 KV 存储提案](../../proposed/architecture/2026-07-24-domain-kv-storage-and-workspace.zh.md)仍因领域和 workspace 决策保持活跃。[隐式 Lead Team 退役决策](../simplification/2026-08-29-retire-implicit-lead-agent-teams.zh.md)拥有已移除的 legacy 实现。

## Verification

JSON 和 SQLite 后端针对预期尾序列冲突、原子批次、分页、检查点单调性、重启、畸形尾部、关闭和流列举运行同一套日志 conformance suite。提供方专有测试覆盖 JSON 单 Hub 所有权、编码的不透明流名称、同主机陈旧锁恢复、SQLite 独立后端 compare-and-set 和关闭准入。日志数据形式测试覆盖路由解析、流发现、类似 HMR 的挂载／卸载、进行中的 open 的 dispose，以及聚合清理。Team 包测试 runtime schema、身份隔离、适配器注册释放、策略 waterfall 和提交后观察者包含。本地 Hub 测试覆盖真实 JSON 和 SQLite 重启恢复、检查点回退、task CAS/DAG 验证、channel WAL 读取／watch 和提交后不变量。
