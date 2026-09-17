# @clocky/clocky-team-delegation

[English](README.md) | 中文

`@clocky/clocky-team-delegation`驱动 shared-workspace child-Team saga。它发现持久 parent delegation，在创建前预留 child identity，绑定 child consult endpoint，接纳 parent-service result，并且只有在 child state 与 usage charge 持久化后才结算或取消 parent task。

## Delegation 生命周期

该 Consumer 使用有界的事件驱动 drive 与 restart discovery。`maxOperationsPerDrive`限制单个 parent 的推进次数，`channelPageSize`限制 child-result read，`teamPageSize`限制每个 pulse 发现的 Team 数量，`pulseIntervalMs`控制 restart-safe discovery interval。`drive()`完成一个有界轮次后返回；剩余推进与合并事件对每个 parent 最多排队一个后续轮次。Close 取消排队轮次，失败轮次等待新事件、显式 drive 或 discovery pulse。Child 终态 snapshot 移除 parent/channel 路由，但仍用其 ancestry 唤醒 parent 结算；stalled child 保留路由。Discovery 不缓存终态历史，close 释放剩余路由缓存。Parent delegation proof、child-creation proof、channel-consent proof、request-post proof 和 child-result proof 只在选定 operation 仍然 live 时保留。

Child creation 使用 parent task 冻结的 authority grant、budget 与 workspace path。Child task 不会申请 Participant activation lease。Child runtime 绑定一个 consult channel，其中 parent-service 是 initiator、child coordinator 是 respondent；parent objective 是唯一 request，coordinator response 通过其因果 Envelope identity 接纳。Child 不能通过 root Team final-result sink 完成。

Pending child usage charge 会在 child 继续或完成前修复。Parent result admission 先持久化，然后 child 才记录 service receipt、terminal closure 和 parent settlement。缺少 endpoint、delegation state 过期、workspace root 不可用、policy denial 或 result provenance 变化都会 fail closed。

## 模型体验

### Delegated child work

#### 模型看到的内容

Child coordinator 会收到一条包含 parent task retained objective 的 consult request。Parent coordinator 通过 Team task state 读取已接纳的 `delegation_result` text 与非 private artifact reference。

#### Token 影响

Child request 与 response 只在 child coordinator 的 Session 中消耗 model context；parent settlement record 不会添加 model input。

#### KV Cache 影响

Delegation 不会改写 parent coordinator 的 static prompt prefix。Child consult 使用独立 channel 与 Session input。

## 已知限制与暂缓事项

- 该 Consumer 支持每个已预留 parent task 的一个 shared-workspace child generation。Non-shared child root、child workflow node、多 generation、parent review、placement 与 integration 仍是独立范围决定。
- Parent task 必须使用 `reviewPolicy: { kind: 'none' }` 与 child-Team execution descriptor；Participant task placement 与 worker lease 不会替代 child execution。
