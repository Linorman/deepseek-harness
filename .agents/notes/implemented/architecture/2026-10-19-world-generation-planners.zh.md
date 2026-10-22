# Agent Note: 隔离生成与 director 所有的规划选择

Status: implemented

[English](2026-10-19-world-generation-planners.md) | 中文

## 问题

生成不能继承隐藏的 director context，也不能成为另一个 world writer。模型响应丢失不能隐式触发另一次计费尝试。

## 决策

[生成契约](../../../../packages/simulation/simulation/src/world-generation.ts) 保留实际披露字节及不可变 audience/scope。专用 canonical Session 接收一个无工具请求，与 director 历史独立。Native 拥有 job 接受、原身份、未知责任和共享 token 计费；Session 拥有精确输入和原始输出事件。输出先 flush，再进行 Native 验证。恢复复用原 Session 结果，不隐式重新生成。

planner assignment 绑定已有领域请求。Native 在接受时冻结真实读集，并限制 effect 和披露 scope、单次尝试、深度、子任务数及父任务总预算。准入检查当前分配的子树及所有祖先，因此子任务超支会阻止根 planner 的下一次推理，同时保留已接受责任。director 在真实 context 收到已验证输出，并显式选择 generation ID。Native 在保留普通 director 计划前核验精确已消费结果、payload 和读集。原单一 mutation 队列保留 stale 与后继历史。就绪计划按接受序号执行；阻塞计划保留责任，不阻止无关就绪工作。

## 考虑过的替代方案

复用 director 历史会产生隐蔽输入泄漏，即使后续 prompt 要求保密。专用 Session 拒绝已有认知历史及跨 scope 复用。助手直接 mutation 会新增授权来源，因此选择仍来自真实 director 决策。Product 桥接经过 A2 preview 和真实用户草稿接受，保留 generation 来源和精确草稿 revision/hash，不绕过有限模板审核规则。Host 提供披露策略与助手身份准备；不自动为每个角色分配助手，也不宣称生产 provider 性能改善。

## 影响

原 Native 与 Session 日志共同保留输入、输出、费用及选择来源。助手仍是显式启用能力，不绕过既有领域授权或有限 Persona 审阅。

## 验证

[Native 测试](../../../../packages/simulation/simulation-local/tests/world-generation.spec.ts)、[Team 测试](../../../../packages/simulation/simulation-team/tests/generation.spec.ts) 与[planner 测试](../../../../packages/simulation/simulation-local/tests/world-planners.spec.ts) 覆盖 JSON、SQLite。内容包括 scope/canary 隔离、共享计费、撤权、输出响应丢失、不重新生成、卸载责任、真实 director 消费和读集冲突。固定延迟外部 provider fixture 测量两个独立请求的并行/串行执行；证据说明有界机制，不代表真实模型吞吐。Stream 100 拒绝旧 Native journal；Session 格式仍为零，使用 required typed events。

生成任务与规划分配 ID 在内部使用品牌类型，线上仍保留原字符串表示。Checkpoint、restore 与重试共享 Native 到 Session 的精确输入/输出验证；已分派任务的文件丢失不能被认作未物化 Session。没有输出的未知尝试保留原有责任。只读静止归档拒绝仍在推理中的助手。
