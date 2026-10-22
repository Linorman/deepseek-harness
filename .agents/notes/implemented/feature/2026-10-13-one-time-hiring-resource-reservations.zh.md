# Agent Note: 一次性录用资源预留

Status: implemented

[English](2026-10-13-one-time-hiring-resource-reservations.md) | 中文

## 问题

招聘权限不等于资金权限。只预留岗位与身份，会让并发普通转账花掉以后招聘所需的资金。另发资源操作付款会拆开支付与任职；身份清理未知时提前释放资金，会丢失原责任。

## 决策

严格[费用声明](../../../../packages/simulation/simulation/src/world-hiring-resources.ts)属于原 World 定义及可移植 v1 编写输入，选择单一录用操作/岗位、既有资金账户、单位、正数量、精确 grant 与正模拟预留期限。省略表示免费操作。未知原语、资源不匹配及不支持的边界均拒绝；director 理由不能决定价格或付款人。获准目标及规划视图在真实 Session 中保留这些条款。

[招聘资源 owner](../../../../packages/simulation/simulation-local/src/world-hiring-resources.ts)使用[唯一守恒台账](../architecture/2026-10-13-native-resource-reservation-ledger.zh.md)。World hold 保存实际请求者、原 accepted plan/resolve 操作、费用、批准依据、冻结账户读集及真实 Native reserve sequence。窗口 accepted plan 可以先于本地操作结算，但仍是实际已接受计划，不冒充 applied 转账。真实 reserve 记录拥有其到期调度责任。

生成录用在目标 IO 前同批预留 canonical 身份及资金。既有人物录用只保存原资金/岗位承诺，不创建身份。两条提交路径均重验作用域权限、委员会批准、资金账户/grant/hold 依赖及模拟有效期。同一 Native 批次结算支付、任职/readiness、结果与 wake/deadline 责任。已消费 grant 指向真实 World commit sequence，不伪造 transfer 操作。普通资源工具拒绝 World owner 的 hold。

typed read-set 比较准确账户权限/值、grant 记录与支出账户 hold 集合；排除原事项自己的 hold，不刷新冻结交易版本。两路径都把未确认预留计入岗位容量；开放任职还必须满足持久未来占用峰值。全局历史额度包括本地及 World hold 的全部终态。完整资金/scheduler 批次遵守原 UTF-8 字节额度。

实际消费的模拟到期可以释放尚未准备的本地承诺，但身份准备 IO 未知时，资金/grant 仍是 active 责任，并保存精确到期消费 marker；过期承诺不能提交。显式业务取消释放已知安全的预留；准备中取消等待 canonical 清理证据，同批释放资金、保留原 abandoned 身份及结果。已提交支付不回退。quiescent 维护冻结模拟时间，墙钟延迟不使业务资金到期。

## 考虑过的替代方案

**第二套资金台账。** 普通转账与招聘可能对可用资金及 grant ownership 得出不同结果。

**信任 director 的付款字段。** 招聘权限会变成选择别人账户、价格或 receipt 的权限。

**允许普通 commit/cancel 结算付款人的全部 hold。** 合法请求者也能绕过原子任职，或提前释放未知身份 IO。

**把全部超期准备标为 expired。** 未确认的目标效果会在清理证实前丢失资金及 grant 锁。

**重试刷新账户版本或 TTL。** stale 的原承诺会被静默换成新交易或更长有效期。

## 后果

Native stream83 与 v1 compiler7 拒绝旧格式/编译结果。委员会批准依据放在独立 leaf，供原批准 API 与资金 hold 共享，避免 operation/scheduler 初始化循环。既有人物 executor 保留并对账原 hold；冷检查保持 paused，不从恢复的承诺自动录用。

范围是一次性守恒支付，不包含循环薪酬、税务、真实支付 provider 或任意资源更改。[持久模拟提案](../../proposed/architecture/2026-09-17-durable-simulation-coordination.zh.md)仍覆盖更广范围并保持 active。原台账决策继续拥有本地预留；本 feature 扩展它，不替代任何 active note。

## 验证

[Native owner 测试](../../../../packages/simulation/simulation-local/tests/world-hiring-resources.spec.ts)使用真实 Team、Agent、Session 和 Channel，核查两后端、资金不足、stale、grant 撤销/消费、历史、到期、append 拒绝及未知清理。[Compiler 测试](../../../../packages/simulation/simulation-scenario/tests/v1-hiring-fees.spec.ts)核查严格引用及复核承诺。[Loader 工作流](../../../../examples/simulation-company/tests/hiring-resources.snapshot.ts)通过实际 World driver 与三个模型工具运行两种录用，再进行 paused 新进程 checkpoint 恢复。SDK parser 保留显式编写条款及固定资源停止分类。

[收费重试测试](../../../../packages/simulation/simulation-local/tests/world-paid-idempotency.spec.ts)在已有人员实际付费入职后，验证原命令字段重排、变更载荷拒绝、同业务键的 goal 决策及 Native 句柄重开。测试对照原资金、hold、身份、任职、结果和通知，不以再次返回成功替代效果唯一性的证明。这里的句柄重开不是新进程或 SDK 分发测试。
