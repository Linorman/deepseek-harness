# Agent Note: Simulation 通知来源

Status: implemented

[English](2026-10-13-simulation-notification-attribution.md) | 中文

## 问题

Direct renderer 有意从 Team Envelope 中只选择模型可见内容。因此，渲染消息相同不代表发布来源相同：audience、trace 与原接受 operation 的关联可能不同。Checkpoint 必须证明与实时接收准入相同的跨 owner 来源。

## 决策

[统一来源校验器](../../../../packages/simulation/simulation-team/src/accepted-envelope.ts)比较 Native 保留的发布 receipt、已接受决策、canonical binding 和全部原 draft 字段与实际 Team Envelope。实时投递在准入接收者输入前调用它；checkpoint 与 writable restore 在校验保留 Channel 前缀时调用它。不支持的 causation、task 和 lifetime 元数据被拒绝；Hub 解析的优先级及接受时间仍由 Hub 拥有。

Session 消费仍是独立证明。当前选定通知必须连同精确准备上下文及控制输入，在 canonical Session 中恰好进入一次，并在 Native 接受证明前 flush。后续补证修订选择自己的通知，原请求已消费不能替代该修订的消费。Receipt、inbox 准入和消费保持独立。

## 考虑的替代方案

**只比较渲染文本。** 渲染有意省略传输元数据，不能证明发布来源。

**只依赖发布时 Hub proof。** 该 proof 约束原 append；投递与恢复仍须验证实际读取的保留跨 owner 引用。

**实时与恢复分别比较。** 独立字段清单可能使一条路径静默遗漏新增的相关字段。

## 影响

不一致的保留来源在模型执行前拒绝实时输入或可写恢复。这加强了既有发布字段的校验，不新增事件或迁移历史。双后端测试篡改 Envelope 元数据、拒绝复制请求索引及缺少消费的情况，随后允许精确原件重试。真实补证流程还证明，排队中的修订通知不能授权新方案；消费并 flush 同一原通知后，原保留提交可以继续。
