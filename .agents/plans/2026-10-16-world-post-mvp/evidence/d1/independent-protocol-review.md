# E1 / E2 独立协议审查

2026-10-20。只读审查 E1 external-effect owner/schema/sandbox，以及 E2 mailbox 和 Native federation-time。这些实现主要由另一 agent 编写。本人编写的 ownership/checkpoint 仅核对与 mailbox 的集成与锁序，不将其自审声称为独立审查。没有修改产品源码。独立本地 JSON storage 探针使用实际 owner、严格 DTO 和持久流；adapter dispatch 仅递增内存计数，不调用真实 provider。输入 hash 见 [review inputs](independent-protocol-review-inputs.json)，实际输出见 [protocol probes](independent-protocol-probes.json)。

## 发现

### P2：因果前置检查泄漏其他 peer 的私密消息存在性

位置：[federation-mailbox.ts](../../../../../packages/simulation/simulation-product/src/federation-mailbox.ts) 原审查输入第 151–154 行，以及 replay 第 345–348 行。

`receive()` 将 `after` 解释为整个目标 inbox 的 message ID，仅检查 `this.inbox.has(cause)`，没有检查来源 peer 或读取权限。目标 B 同时允许 A、C 发消息时，A 无权 inspect B，却可构造 `after: ['private-c-id']`，从 blocked/accepted 的差异得知 C→B 的私密消息是否存在。返回值不泄漏正文，但突破了独立 peer 的存在性边界；当前二 peer 测试覆盖不到这一情形。

实际探针：A→B 的同一原 `probe` 在 `private-c-id` 尚不存在时返回 `Federation blocked: missing sequence or causal predecessor`；C 将该 ID 投递给 B 后，A 重试原 `probe` 获得 receipt。A 使用自己的 lease inspect B 仍返回 `Federation authorization unavailable`，证明发送权限没有赋予 inbox 读取权限。

建议：首版可将 `after` 限定为同一 `sourceRun` 已提交原消息；如果确需跨 peer 因果引用，则增加显式、持久且可验证的可读引用授权。live 和 fold/replay 必须复用同一检查；缺失与不可访问依赖的拒绝应不可区分。回归使用三个不同 principal：C→B 私密消息存在前后，A 对其不可读引用都应得到相同拒绝；A 对自己之前的消息仍可建立因果链，并在 JSON/SQLite 重开后保持相同结果。

### P2：重放未执行 live grantId 唯一性约束

位置：[external-effect-owner.ts](../../../../../packages/simulation/simulation-product/src/external-effect-owner.ts) 原审查输入第 113 行与第 218–221 行；`load()` 第 66–68 行将 durable 记录送入 `validate()`。

live `grant()` 明确拒绝一个 `grantId` 用于另一个 effect；重放的共享 `validate()` 只校验当前 grant 的 effect/action/target/units/principal，没有检查其 ID 是否已经属于另一个原件。因此，损坏或被替换的持久历史可通过恢复，并使同一个真实批准身份出现在两个不同 effect 上。此问题不要求健康 live API 能写出该历史：durable 读取本来就是必须拒绝不满足关系不变量的边界。

实际探针先用正常 owner 创建两个不同 effect/grant，再仅将第二条已授权 durable 记录的 grant ID 改为第一条 ID，导入新的隔离日志。新 owner 的 `load()` 成功，两个 effect 都显示 `grant-a`；执行第二个 effect 后，测试 adapter 被调用一次且结果为 `confirmed`。因此当前行为不只是宽松的只读检查。

建议：将 grant ID 到原 effect 身份的唯一性检查放入 live/replay 共用的 `validate()`，并在解析源历史时拒绝冲突，而非补造新批准。回归分别覆盖 JSON/SQLite：重复 grant ID 的历史 load 失败且 adapter 调用为零；同一个 effect 的原授权重试仍保留原 ID，独立补偿仍要求不同 grant。

## 其余已核对的边界

E1 的授权来自 Host deployment 的 `authorizedPrincipals` 与可信 `AuthenticatedProductCall`；没有发现从 Persona/模拟 CEO/委员会角色推出真实权限的路径。grant 绑定不可变 effect 原件、动作、目标、额度、有效期和 credential generation；凭证只在 adapter Host closure。`execute()` 先持久 reserved/dispatched，再调用 adapter；dispatched/unknown 仅 query 原 key，不自动重发。撤权不释放已发出或未知占用；取消仅作用于尚未发出的状态，补偿独立受理、独立 grant、独立 idempotency key。`replay/branch/import/inspect` 模式拒绝 grant/dispatch。以上未替代真实 provider 沙盒或正式环境验证。

E2 的 message/receipt/boundary 均有版本、范围、generation 和实际 peer principal；receipt digest 覆盖完整原 message，不同 principal 的 source lease 不能充当 target lease；同一真实用户被显式授权两端时仍属于该用户的 Host 权限范围。创建策略帧固定 principal/peer/generation，恢复不静默改签旧授权。缺 sequence/causal predecessor、迟到至已推进时间之前的消息及永久 stop 均显式拒绝；source 责任在收到真实 target lease 的 receipt 前保持。

Native `bindFederationTime()` 在 Native queue 内重新取得 Host evidence；首次绑定要求 paused，owner/generation 固定，安全时间单调，永久 stop 不可移除。executor 和 scheduler fold 都检查持久 fence，驱动不反向读取 mailbox。`syncNativeClock()` 与 coordinated capture 都遵守 mailbox → Native 的方向，checkpoint 再按稳定 run ID 取得下一分区并最后取得 registry；已存在的实际 Native append 屏障竞赛测试与此顺序一致。该段仅是本人所写 checkpoint 与 mailbox 的集成核对，不是 ownership/checkpoint 的独立审计。

## 范围与退出条件

这次审查提出两个需要修复和回归的协议问题。它不是独立真实业务授权设计、真实 provider 测试、生产网络分区/运维审查或生产发布许可。E15 的外部条件仍未满足；即使本地问题修复、回归通过，也不能据此替代该条件或宣称真实适配器/生产联邦已交付。

## 修复跟踪

Root / e 随后将 grant 唯一性移到共享 live/replay validator，并使失败的 load 关闭准入；mailbox 采用 `(sourceRun, sourceGeneration, messageId)` 身份、同源前置及来源内 receipt cursor，live/replay 都校验实际 target principal 和该 cursor。本人通过同类隔离 JSON owner 探针重新验证：[修复后输出](independent-protocol-probes-after.json) 显示私密消息存在前后均同样 blocked；相同私密别名可由另一来源独立使用，receipt cursor 为其自身的 0；重复 grant 历史 load 和后续 execute 都被拒绝，dispatch 为零。

另依 Root 新任务修改了本人所写的普通 backup / E14 集成：普通完整备份拒绝当前或任意祖先中的联邦 fence；E14 校验 Native 原始 fence 与最终投影，并绑定 mailbox owner/run/generation/sourceSequence、精确原前缀 hash 和共享 pure reducer 的 clock/stop 事实。此部分属于集成自核，不算对本人实现的独立审查。对应五文件 39 个回归通过，见 [引用与权限回归日志](federation-reference-tests.log)。真实 provider、真实业务授权及生产分区审查的范围不因这些本地修复发生变化；E15 仍需要外部条件。
