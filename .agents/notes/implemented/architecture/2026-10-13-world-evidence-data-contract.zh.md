# Agent Note：World 补证数据合同

Status: implemented

[English](2026-10-13-world-evidence-data-contract.md) | 中文

## 问题

同一事项内的补证需要先有不可变记录格式，Native 才能保留问题、回答及后续规划输入。任意 JSON patch 可能改写已接受请求；可变的领域字段说明则可能在原 schema 身份下改变待回答问题的含义。

## 决策

[补证 schema](../../../../packages/simulation/simulation/src/world-evidence.ts)定义品牌 challenge、revision 和字段身份、唯一缺失字段、有归属的文本回答及作用域上下文引用、规范模拟期限、安全整数修订/次数上限，以及终态结算。模型询问/回答正文不包含 actor、binding 或响应者授权；保留记录另有 Native 来源字段。answered challenge 引用其唯一接受修订，所有终态结算序号均晚于创建。

[共用引用解析器](../../../../packages/simulation/simulation/src/context-reference.ts)保留原 run-event/team-envelope 来源规则，不导入 World/context 聚合模块。现有上下文请求和新回答共用它，避免产生不同的来源字段集合。

领域定义可声明有限的补证字段集合。[注册表](../../../../packages/simulation/simulation/src/world-domain-registry.ts)复制并冻结字段记录，拒绝空集合、重复码和额外字段。schema tombstone 同时保留 parser 身份和字段定义；即使注销后，改名、改写说明或移除字段仍需新的 schemaRef。

## 考虑过的替代方案

**通用 JSON 回答 patch。** 这会混合澄清与修改权限。本合同只接受有归属的文本及来源引用，Native 业务载荷继续独立验证。

**每个功能复制来源引用联合。** 新变体或规则变更可能发生分歧。一个叶模块解析器服务两个消费者，并避免运行时循环导入。

**注册后继续信任可变 provider 数组。** 后续修改可能在不更换 artifact 身份时改变待回答问题。注册保留独立冻结副本。

## 影响

严格 parser 和注册表测试覆盖字段/来源结构、伪造身份字段、重复码/响应者、状态/序号一致性、独立注册副本及 schema tombstone 变更。上下文回归保持原物化行为。包提供浏览器安全的 schema 与类型入口，供后续 Native 和 SDK 工作使用。

Native 在原接受批次中以独立 `run/world-evidence` 记录保留问题和回答。真实私有 Channel 消费将回答绑定至原请求人、问题及输入修订。后续导演规划消费修订通知，并在读集中包含不可变输入 hash。询问需要剩余规划容量，不能打断原结构或资金职责。原请求及所有此前方案保持不变。

已准备的回答决策消耗冻结的案件额度，包括放弃回答或取消。同一决策重试保留原展开。实际消费截止事件或最后一次回答尝试关闭后，以真实事件或决策为来源生成唯一信息不足拒绝。案件取消关闭待处理问题/修订唤醒及截止事件。投影检查拒绝改写声明、回答来源、修订链及终态证据。Native stream 94 与 compiler 9 拒绝旧保留格式，不通过迁移合成证据。

Driver 根据实际投递选择补证上下文；执行 handler 只接受 apply 方案。TypeScript/Python 案件投影提供有界的当前证据并保持既有正文权限。UI 显示保留状态，不提供尚无支持的行政回答入口。Native/Team 测试覆盖问答、录用、取消、到期、耗尽、非法输入及冷重放；Loader 场景覆盖模型工具 schema 和独立冷进程。
