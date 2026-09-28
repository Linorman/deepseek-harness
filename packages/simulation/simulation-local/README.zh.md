# 本地模拟 run

[English](README.md) | 中文

挂载 `clocky-simulation` 和本显式启用的提供方。配置必须包含 `name`、专用本地文件系统目录 `root`、`backend`（`json` 或 `sqlite`）以及正整数 `replayPageSize`。[Loader fixture（测试前置数据）](../../../examples/headless-agent/tests/fixtures/simulation/simulation-local/cordis.yml)是最小可执行组合。

`inspectEntity(id)` 返回独立的实体快照及同次观察的 run 身份和全局 revision，不复制无关历史。未知身份不包含实体；写入仍校验预期 revision 和权限。

待追加批次与重放页在连续实体变更之间复用私有实体字典；每条记录仍校验 schema、序号与因果关系，批次拒绝不会修改已发布投影。创建时记录精确的 run 配置，并从暂停状态开始。状态写入校验调用者观察到的 revision，按 run 串行化，追加到一个带版本的 Storage 日志，持久化完成后才发布独立投影。重开时先验证全部记录和配置，再返回句柄。非法格式、缺失前缀、后端变更与重复创建均拒绝。关闭时拒绝新写入、排空已接受操作，先释放存储，再释放协调器所有权；清理失败可重试。

每个 run 目录包含独立于 JSON 或 SQLite 日志的 `owner.sqlite` 数据库。覆盖整个存活期的 `BEGIN EXCLUSIVE` 事务在日志写入之间也会排斥另一个本地进程。操作系统在进程退出时释放锁；接管不使用过期时间或 PID 猜测。只要进程仍可能访问 run，就不得删除或替换所有权文件；所有协调器必须使用同一个规范化存储根目录。JSON 日志同样需要 SQLite 支持。专用模拟存储不提供破坏性保留清理 API。

日志记录决策 slot、已接受意图批次和原子本地结算。转移保持资源守恒，发布任何效果前校验完整读取集、权限、授权和最终余额。部分交付保留证据，取消不能抹掉这些效果。writer 撤销会取消开放 slot，已接受操作仍由 run 持有。 公平队列已认领的 wake 必须通过其预留分配进入窗口，手动决策或窗口不能换一个身份将其消费。重放在暴露投影前校验决策与意图的引用及指纹。 重放还拒绝跳过决策 slot／操作 index 顺序中较早未结算本地操作的记录；实时执行使用同一折叠检查。

日志保存精确调度键与分配计数器。回复过期、defer 唤醒和承诺违约定时事件与业务效果原子追加。消费事件在同一条目中推进模拟时间并记录后果。同刻后果进入下一 microstep。零时间链溢出时保留事件，并以 `SIM_MICROSTEP_LIMIT` 停滞；取消该事件后显式恢复即可解除停滞。真实传输 TTL 不作为业务期限。

日志版本 36 保留组织作用域关系、完整发布引用（run、Team、接收者与频道位置）、通信就绪与发布尝试；打开时拒绝更早的日志格式。目标 IO 在 run 队列之外执行，允许在发布进行期间撤销 writer。关闭会排空已受理派发，再释放存储。新尝试与派发前拒绝要求 run 正在运行、没有冻结决策窗口且全部前置操作已终结；已受理传输的完成结果仍可在暂停时记录。传输实现必须按操作 id/指纹原子去重；`publishAllowed` 为 false 时只能对账既有结果，不能重新发布。发布回执不证明接收者 Session 已持久化，也不代表业务接受。

`recordDeliveryFailure()` 保留精确 Hub 放弃投递记录并停滞，阻止时间继续前进，同时保留输入与 wake 责任。`resolveDeliveryFailure()` 要求已有持久输入、活跃 writer 的输入缺失证据或不可逆的实体终止；不会改变承诺或伪造回执。恢复运行仍需单独显式切换阶段。

根 Team 的预留与确认都是持久 run 事件。重试不能改变创建载荷；未确认的预留不能接受实体绑定或进入运行阶段。

仅用于检查重放状态的句柄可关闭而不退役历史 writer；一旦受理变更、恢复或注册退役所有者，关闭就必须等待 writer 完全停稳。准入前校验失败会释放 run 锁而不修改持久 writer 记录，允许原样修复来源后重试。

## Model Experience

### Run administration

#### What the model sees

不直接提供模型输入、不触发推理，也不改变 token 成本或 KV-cache。`simulation/committed` 向运行时观察者报告持久投影及对应日志尾游标。 事件对实时写入携带追加前 revision，初始重放时省略。invariant 据此检查每个新接受决策是否属于活动 writer epoch；重放按日志顺序检查历史权限。

#### Token effect

无直接 token 消耗。

#### KV Cache effect

不修改模型请求前缀。

## Known Limitations and Deferred Work

- 支持本地 create/open、快照、状态写入、Entity profile/生命周期和时态组织关系。运行状态不会启动调度器或模型。经授权的 Team 发布由 `simulation-team` 提供；驻留接收者投递在同一日志中保留 wake 与目标回执。分布式执行尚未实现。恢复重放保留的历史并核对已发布 manifest 的日志身份；跨所有者恢复由 `simulation-team` 负责。存储必须位于本地，且 SQLite 文件系统锁必须正常工作。

`managePhase()` 保留调用方指定的暂停／恢复请求 id、处理中状态及唯一终态。中断请求使用同一身份继续，变更载荷会被拒绝。重试已完成请求只返回历史结果，不改变当前阶段。失败的恢复请求保留失败原因和停滞状态；解决原因后应使用新 id。此接口只控制调度，不负责完整检查点所需的其他所有者排空和持久化。

`getPersistenceReference(expectedRevision)` 在 run 队列内读取实际日志描述、保留起点及完整状态指纹。预期 revision 和物理日志尾必须与投影一致。这是收集所需的读取接口，不是完整检查点或历史固定机制。

`acquireCheckpointCut(maxDrainRounds, signal?)` 阻止新的 run 写入和派发，排空已受理尝试与清理写入，然后要求调度已停止且 writer／窗口已释放。持有切点时只接受读取；释放是幂等的，不会恢复调度。取消获取会解除屏障，但不取消已受理工作。切点仅在当前进程有效，不固定其他所有者，也不发布检查点 manifest。
