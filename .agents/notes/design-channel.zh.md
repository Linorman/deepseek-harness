# 模拟通信设计评审

[English](design-channel.md) | 中文

总体方向合理：复用 Team 投递，将持久实体与激活分离，区分信念与世界事实，并按事件调度模拟工作。原设计在实现前需要补强原子持久化、身份绑定、延迟可见性与恢复规则。

持续维护的设计位于[持久模拟协同提案](proposed/architecture/2026-09-17-durable-simulation-coordination.zh.md)。其状态仍是 proposed；本次评审仅修改文档。

| 设计问题 | 修正 |
|---|---|
| Entity 只有一个 Session，却参与多个 Team | MVP 使用唯一规范 Team/Participant/Session；未来多成员身份需要独立 Session 与认知协调 |
| 组织关系无法标识经理端点 | 使用 subject/relation/object 边，验证端点，成员关系只有一个所有者 |
| Request 混合投递、接受与执行 | 独立投影；承诺兑现须具备声明的证据 |
| Decision、World 与 Outbox 暗含分开写入 | 一条 Simulation 流原子接受决策/意图及本地世界事务；Team 派发仍使用 saga |
| 恢复假定任意 system source 可代已停止 Agent 发消息 | 显式受限 Team proof 扩展，验证持久决策证据和当前权限 |
| 固定 slot 与立即执行工具效果并存 | 暂存提案；按 slot 提交效果；记录超时并限制冲突重试 |
| 未来消息可以进入非唤醒上下文 | 到模拟准入时间才向 Team 发布；独占投递并限制全部检索路径 |
| 持久记录包含 bigint | 使用经过验证的十进制字符串，按数值比较 |
| 检查点只收集部分 revision | 记录精确所有者游标、待处理操作、Session 状态、屏障与引用固定 |
| 假定频道 rollover 即可删除历史 | 排空不可变频道；所有者支持 Simulation 引用固定前禁用破坏性 retention |
| 恢复/上下文/激活安全放在后期 | 在第一个无需密钥的纵向场景交付，再扩展规模 |

现有 Team 协议、实现租约和隐式 Lead 退役决策继续有效。未修改运行时代码，未将待实现能力描述为已交付。
