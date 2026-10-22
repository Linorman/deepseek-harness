# Agent Note: 联邦资源所有权与一致 cut

Status: implemented

[English](2026-10-20-world-federation-ownership.md) | 中文

## Problem

持久消息不能单独决定哪个分区可以支配共享资源。确认丢失不能产生两份可用副本；仅 mailbox 的 checkpoint 也缺少分区恢复所需的 Native 与认知历史。

## Decision

显式启用的[所有权协调者](../../../../packages/simulation/simulation-product/src/federation-ownership.ts)拥有独立的联邦 credit 资源、数量、唯一 home 和单调递增 generation，不镜像现有 Native 资源。全部消费和完整资源转移经过这一持久权威。分区 principal 不能铸造资源或结算所有权。预留资源双方均不可用；目标确认仍保留责任，直到协调者结算并递增 generation。旧 home 和旧目标 generation 被拒绝。未知投递不因超时释放；协调者不可用时不授予本地回退写权。该集中权威不声称提供分布式共识或任意 Native 效果之间的事务。

消费重试返回原操作当时派生的余额，在所有权转移和重启后仍然如此；旧所有者不能通过旧 operation ID 查询新 home 的后续余额。

Registry 记录精确分区/principal 策略，重开时拒绝策略变化。已接受的来源预留、目标确认和结算具有原 ID 和严格重放关系。存储追加失败关闭准入，直到所有者重新加载持久结果；不推断成功或释放未知责任。

[一致 checkpoint 捕获](../../../../packages/simulation/simulation-product/src/federation-checkpoint.ts)按 run ID 排序，持有每个真实 mailbox 队列和封闭静止 Native/Team/Channel/Session collection，最后持有协调者队列。它保留完整原始流、每个运行的完整 D1 归档、版本、hash 和在途预留/消息。调用者必须提供实际 Team connection，不能用 callback 替换任意世界快照。读取者在隔离的严格所有者重放前校验完整字节/条目预算、策略分区、generation、原始来源消息和目标 receipt。原 mailbox 日志同时保留发出和接收的时间承诺。Collection 与队列按逆序释放。

Native 联邦时间证据包含必需的 `sourceSequence` 和精确原 mailbox 日志前缀的 SHA-256。Checkpoint 按对应 owner/run/generation 校验全部历史 Native fence 和最终投影，再通过 mailbox owner 共用的纯时间 reducer 核对 limit/stop 事实。前缀哈希使用增量 hash copy，长 fence 历史不会导致平方扫描。Mailbox 可在最新 Native cut 后继续保存记录。缺失祖先 mailbox 依赖时拒绝，不补造历史权限。按来源限定的消息身份和 receipt cursor 保持私密 peer 隔离。Mailbox 返回的边界对象与保留状态隔离。即使本地时钟尚未推进，新接收消息也必须同时满足本地时钟及已接受的来源时间承诺；严格重放执行相同规则。

## Alternatives considered

**各本地独立决定所有权**会使分区主机同时消费同一资源；写入必须能够访问协调者。

**超时释放**会把未知目标结果误当拒绝；预留持续到明确目标确认和协调者结算。

**以 mailbox 投影作为 checkpoint**会遗漏 Native、Team、Channel、Session、附件证据以及发出的时间承诺；原所有者归档和 mailbox 日志保留这些证据。

## Consequences

[双运行资源测试](../../../../packages/simulation/simulation-product/tests/federation-ownership.spec.ts)在 JSON 与 SQLite 验证消费去重、预留阻塞、协调者重开、确认恢复、单调接管及旧 generation fence。Mailbox 回归修改返回的边界对象，并在已接受时间承诺后注入更早消息，验证持久化前拒绝及重放拒绝。[Checkpoint 测试](../../../../packages/simulation/simulation-product/tests/federation-checkpoint.spec.ts)捕获两个带根 Team 的真实 paused Native run、已投递但回执丢失的消息、未投递消息和未结资源转移。实际 Native append 屏障证明并发时钟同步与 checkpoint 准入完成，不颠倒 mailbox 到 Native 的锁序。Registry/mailbox 原流在空存储重开；每个完整运行归档通过实际所有者 parser 恢复到新隔离根。

这是显式单协调者部署和独立资源类型。现有 Native 资源必须显式接入领域才能使用该协调者。不支持协调者复制、自动分区成员变化、任意对象迁移、源/目标 Native 效果原子事务或生产联邦发布。独立授权与分区安全审查仍是单独发布门槛。引用回归还覆盖：重算包 hash 后仍拒绝改变的 owner/run/generation、缺失或越界 cursor、错误前缀 hash 及伪造的 limit/stop 事实；普通 bundle 拒绝联邦祖先。
