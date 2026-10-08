# Agent Note: 共享 Team 协议构造

Status: implemented

[English](2026-10-03-team-protocol-recipes.md) | 中文

## Problem

Team 解析器、channel adapter 和生命周期 provider 重复定义相同的 payload 字段、日志投影和 disposal 等待。独立副本可能在可选字段、属性顺序、来源归属或计时器清理上产生分歧。共享整个权限和变更流水线则有另一类风险：不同操作必须验证自己的 proof，并在策略或 provider 工作让出执行后重新验证。

## Decision

Team Service Definition 拥有共享的 Envelope payload 解析字段、不可变摘要来源字段、Simulation 执行绑定字段和 participant 邀请描述符。每个解析器保留自己的严格性、判别字段和操作专用字段。复用字段对象保留现有解析属性顺序和 JSON 合同。

配置目录通过 workspace 重导出跟踪共享验证字段工厂，不执行模块。工厂必须声明固定的 Schemastery 验证成员，并只返回一个键集合完全一致的普通字面量对象。未知或带索引签名的字段集合、计算键、可选成员、动态返回和递归组合均使门禁失败。嵌套对象和数组验证路径仍接受已声明配置类型的子集检查。

`channelEnvelopeMessages()` 只按 WAL 顺序投影已接受 Envelope 的 id、sender、kind 和原始 payload。调用者继续选择记录、验证协议状态并实施可见性。Basic 和 workflow adapter 共享冻结的消息列表投影；direct policy 保留自己的元数据和 payload 选择。Workflow provider 为 Definition 中完全相同的 condition 词汇提供别名，同时保留 participant-id target 词汇，因为它与 plan 的 role target 不同。

Channel 恢复解析器只共享精确自有键检查、JSON 对象判定和非空文本检查；各协议提供自己的固定键集合和诊断主题。Discussion 和 workflow 各自验证 manifest、state 和 Envelope 后才共享 audience 投影。投影保留 audience 顺序，只在广播时排除 sender，并冻结每个 delivery intent。Adapter 的拒绝和投递测试覆盖这些共享函数的全部分支。

`teamEventOwnerId()` 为调度和关闭消费方提供通知归属。Provider 为分离快照复用已有 LLM（大语言模型）深冻结实现。`withTeamOperationTimeout()` 共享 Team provider 等待的计时器所有权，保留各 provider 的超时错误，把取消和排空留给调用者。

`trackTeamOperation()` 对 provider 已接受的 Promise 只观察一次，在结算时从集合移除同一个 Promise，再调用 provider 的诊断回调。它不包装或替换调用者可见的结果。诊断异常会被承接，避免报告产生另一个未观察的拒绝；取消、关闭期间的诊断抑制和排空仍归 provider 所有。

Workspace allocation publisher 按实际的同进程 owner object 唯一注册。同步 Cordis contribution 保留该 owner key，直到只执行一次的 effect cleanup 删除它；重复 disposal 不会撤销后续 replacement。Registry operation 拒绝不可用 capability、无效 preparation 或 recovery 身份，以及 foreign publication provenance，再接受结果。Mismatch cleanup 失败时同时保留原始 ownership refusal 和 cleanup failure。

TeamRun 通过纯本地 helper 构造重复的关闭目标和完成 payload。Workflow terminal-result 验证消费前一步 compilation 检查在同一 Team serializer 下同步证明的 binding 和 task。它保留精确 projection 顺序、terminal phase 及已存 result/failure 比较；不完整 compilation 和矛盾 terminal fact 均在 journal mutation 前被拒绝。每个调用者授权并重新验证自己的关闭来源后，Hub 共享最终 stalled 状态提交。其 goal 编辑和 phase transition 共享相同的 revision、策略和策略后权限检查，同时保留操作专用的下一状态验证。工具 schema 复用已有 artifact 和 failure carrier。这些 helper 不签发权限，也不把验证移出执行变更的操作。

## Alternatives considered

**共享整个权限和变更流水线。** 不同操作选择不同的不透明 proof、cursor 或 revision fence、策略事实和清理保证。共享这些决策会隐藏 `await` 后的精确重新验证点；操作继续拥有这些工作。

**让所有解析器和投影保持内联。** 同一协议字段或视图必须在多处更新。共享字段对象和纯投影保留单份实现，不合并独立协议状态或 provider。

## Consequences

Provider 配置、错误码、disposal 所有权和协议格式保持不变。超时不表示工作已停止。共享视图不授予可见性，共享 payload 不授予变更权限。[Team Definition 决策](2026-08-27-durable-storage-logs-and-team-service-definition.zh.md)和 [Hub 权限决策](2026-08-27-local-team-hub-durable-authority.zh.md)继续拥有独立的持久化和锁保证。[Client 合同决策](2026-10-03-client-shared-contracts.zh.md)拥有 client reader 状态，不替代这些 provider 操作。

## Verification

Core 协议、scheduler、closure、activation、Link、artifact 和 Agent-client 单元测试通过。Basic、direct 和 workflow channel 测试保留现有投影。共享超时和 channel-message helper 的聚焦覆盖率为 100%。TeamRun 和工具测试保留完成 payload 及 artifact/failure schema；统一构建后，真实 Loader 回放比较已有模型可见输出和持久输出。
