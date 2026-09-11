# P0-02：Hub 持久化、授权与命令验证

主责：Hub 程序员。归属：[WP01](wp01-lifecycle.md)的 G26，协作 G01/G27。与生命周期和真实组合测试并行；拥有 [Hub](../../../packages/team/team-hub/src/index.ts)、[fold](../../../packages/team/team-hub/src/fold.ts)、[schema](../../../packages/team/team-hub/src/schema.ts)、[invariant](../../../packages/team/team-hub/src/invariant.ts)及其测试。共享 Core 变化需 P0-04 登记。

## 当前输入

Final admission、TTL 资格、human owner、取消后 human-action 新接纳、分支 authority 重验、cancellation quiescedAt，以及 terminal resource 的 journal/checkpoint 校验均已进入主工作区。恢复读取还对照 channel WAL 检查终态、交付结算和 completed final 证据。保留这些实现，旧补丁只作历史比较输入。

旧正向 fixture 已改为通过公开 owner 协议结算任务、activation 和 final；workflow reviewPolicy 类型错误已修复。以[当前状态](current-state.md)指定的共同源码重新生成覆盖率职责表，再分配剩余方法。旧轮次的行号与百分比不能直接当作当前待办，工作区名称也不决定其中代码是否最新。

## 按职责拆分

有两位以上程序员时可以按下表分工。不同测试文件可并行写；相同 source 方法的修改由本任务主责串行集成。分工依据业务关系，不以代码行数分段。

| 子组 | 独占或登记范围 | 重点场景 |
|---|---|---|
| H1：持久投影 | fold/schema/invariant 与专属测试 | checkpoint 与 journal 等价、非法 durable 关系拒绝、fallback、事件投影与资源关系 |
| H2：授权与 CAS | index 的 proof resolver、policy 前后校验与专属 authority 测试 | 来源退休、跨 Team、scope 不匹配、等待后权限撤销、当前 cursor 冲突 |
| H3：频道与关闭 | index 的 final/closure/delivery/retention 方法与测试 | intent/sink/receipt 窗口、TTL、慢消费、close/ack、失败分支聚合、compaction |
| H4：任务与结算 | index 的 task/workflow/allocation/usage/parent charge 方法与测试 | revision/attempt 约束、workflow 双向绑定、重试计费、allocation 处置和失败恢复 |

H2–H4 的生产修复都触及 index.ts，必须登记具体方法，不允许各自交一份不同版本的整个 Hub。第一轮可由 H1 与 H2 并行，后续继续 H3/H4；禁止为了分工把无独立演进需求的内部方法拆成新 package。

## 验证设计

1. 在当前共同源码上运行完整 owning suites，生成按方法分组的 V8 statement/branch/function/line 缺口。记录 include、实际测试清单、跳过项和输入 hash。
2. 区分三类：已有消费者测试但未被纳入、真实行为缺场景、由类型或 owned relationship 保证的不可能分支。先修测试选择，不用重复测试扩大数量。
3. Durable 边界用真实序列化 journal/checkpoint 注入非法输入，分别验证 JSON 和 SQLite。有效的部分 workflow 编译、已结束但仍有 pending receipt 的 channel 不应被误拒绝。
4. Authority 场景通过实际注册来源与有效 proof 进入命令，再触发真实退休、policy 等待、Team/epoch/cursor 改变。证明非法 scope 在 policy 或 append 之前拒绝，合法重试不误判权限错误。
5. 每个真实漏洞先有失败场景，修复保持已有 owner 和格式政策。测试明确观察 durable 事实、资源状态和错误 code，不能仅匹配一条日志。
6. Aggregate cleanup 和 observer 场景证明全部已接纳工作被等待。Checkpoint fallback 不应隐藏无法恢复的 journal 错误；audit 修复不重写业务事实。
7. 每个子组交付后更新未覆盖职责表；最终联合 P0-01/P0-03 当前消费者重算，不能将几份不同源码的覆盖率并集视为通过。

## 特别保留的 final 语义

明确的 channel/delivery-expired 事实且没有 receipt/pending delivery 时，final 在 intent 前拒绝 TEAM_FINAL_INVALID；仅经过 TTL deadline 而没有 expiry 事实不等于已过期。拒绝不占 sink 或 closure key，合法 replacement final 能继续完成。

Closure intent 不是 sink admission；独立 admission 引用精确 Team/channel/Envelope/sequence/content fingerprint/recipient/owner，retention 必须保留其来源。只含 intent 的恢复必须实际接纳 sink，再写 receipt。Pausing、budget 拒绝或不合资格 final 不得产生假接纳。

## 当前证据与完成条件

当前 108 个 owning suites 共 1,562 项通过、1 项跳过。以 index d71301cc、fold 00bbed06 开头的源码 hash 测得：index 四项为 90.04% / 84.02% / 97.63% / 91.87%，fold 为 98.61% / 96.80% / 100% / 98.74%；顺序为 statement / branch / function / line。index 尚有 518 个 statement、671 个 branch、23 个 function 未覆盖；fold 尚有 16 个 statement、39 个 branch。activity、error、schema、invariant 四项均为 100%；types.ts 适用仓库既有类型文件排除，不能称其经过运行时覆盖。原始数据、完整 SHA 与按方法清单位于交接材料 hub-owning-wave-current；后续源码改变后重新测量。

交付标准是全部适用 Hub 源文件的四项 100%、实际 public/durable 路径正负验证、JSON/SQLite 等价性，以及当前消费者兼容。若闭合 union 的 assertNever 需要精确排除，先证明类型闭合、保留外部 JSON 拒绝测试并记录局部依据；不得广泛忽略分支或删除真正安全检查。

交接包含修改方法/事件清单、版本影响、测试选择清单、coverage 原始数据、已修漏洞和仍未覆盖职责。只把可复现的通过证据交给 P0-04；未测、跳过和失败分别登记。
