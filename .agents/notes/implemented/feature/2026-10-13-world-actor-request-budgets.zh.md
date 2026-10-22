# Agent Note: World 请求与结构准入预算

Status: implemented

[English](2026-10-13-world-actor-request-budgets.md) | 中文

## 问题

全局历史额度不能为每个模拟周期内的 actor 单独限制请求。若历史检查仅位于可信调用者预建 intent 的路径，普通 goal 仍能创建超出上限的新业务身份。更换业务键或取消已接受案件，都不应恢复已消耗的准入额度。动态身份准备还需要有界速率与共享结构所有权：业务结算本身不能证明 canonical maintenance 或清理已完成。

## 决定

[冻结 World 定义](../../../../packages/simulation/simulation/src/world.ts)要求正整数 `maxRequestsPerActorPerInterval`。场景目录提供显式默认值/上限；可移植输入可请求获准的降低值。V1 compiler8 将选定值与 Native `budgetInterval` 一并保留，不以运行时默认值补齐旧记录。

[预算 owner](../../../../packages/simulation/simulation-local/src/world-request-budget.ts)从每项保留请求的真实已接受决策、actor 和模拟时间派生用量，跨领域计入 open、committed、rejected 和 cancelled 案件。精确原件重试保留同一请求，不新增费用。周期使用统一的 BigInt 模拟时钟计算，不依赖墙钟、Session 身份或可变角色文本。模型可见用量按原决策 snapshot 选择并归因到该 Native 前缀；接受时使用最新完整投影。

[共同准入](../../../../packages/simulation/simulation-local/src/world.ts)在插入请求前及权威 fold 时核验 actor 配额，投影验证独立检查全部保留的 actor/周期组。全局 `maxRequests` 检查属于新业务身份的创建，因此可信预建 intent 和普通 goal 共享同一边界。跨周期不释放历史、岗位、资金或原清理责任。

超额模型提交保留既有 `SIM_WORLD_LIMIT/requests` 硬停止及 Session 输入证据。该硬停止需要检查和新场景，不随墙钟流逝自动解除；额度内调度可正常抵达后续模拟周期。模型决策和 token 保留独立上限，包括失败尝试。

Native stream85 拒绝旧记录，不虚构新增冻结限额。SQLite schema 和 Session envelope 版本不变。当前场景 fixture 显式声明新额度；原先声明较高全局工作量上限的用例为 actor 显式保留相同数值，不增加原全局、模型或资源额度。

[结构 owner](../../../../packages/simulation/simulation-local/src/world-structure-budget.ts)从保留预留派生出生与外部展开用量。`maxBirthsPerInterval` 和 `maxExternalExpansionsPerInterval` 为非负安全整数，零禁用对应动态创建。生成招聘和外部代表消耗出生额度，仅外部代表消耗展开额度。原 intent 在包含 Native `reservedAt`、首次 `prepared.time` 或终态 `result.time` 的每个模拟周期中各计一次，包括取消结果。跨期未结预留继续占用当前周期。精确重试不新增计费，取消不退还其结算周期的额度。

`maxPendingMutations` 仅接受 `1`。生成招聘、外部代表、人事预留、活跃 World 资金预留及未结 contact 按原 intent 去重后共享该槽位。业务已终态但原 maintenance 仍活跃的预留继续占用。原 owner 可以继续，其他 owner 必须等待 canonical 结算。既有人物录用和 contact 复用不产生新出生，但仍遵守共享结构准入。已记录模型上下文携带冻结 `worldLimits`，了解限额不授予执行器权限。

## 考虑过的替代方案

**按 decision ID 而非业务请求计费。** 精确收据重试和规划轮次会消耗无关配额，而已接受案件历史已有持久唯一身份。

**取消或重开时重置计数器。** 新业务键或进程重启会恢复已消耗容量。用量应从不可变接受历史派生。

**仅在管理 seed 方法中检查历史。** 普通模型 goal 同样创建 intent，必须经过同一 owner 的准入边界。

**业务提交或请求取消时立即释放容量。** 业务状态变化后 canonical maintenance 与未知拓扑清理仍可能活跃，下一结构变更不能与其重叠。终态结果保留其模拟周期计费。

**任意配置 pending 并发度。** 当前 maintenance 与恢复串行处理结构所有权。字面量上限一拒绝不支持的并发，而非提供误导性的配置项。

## 影响

[Native owner 测试](../../../../packages/simulation/simulation-local/tests/world-request-budget.spec.ts)覆盖真实独立 actor、取消、精确重试、snapshot 选择、损坏来源拒绝、99/100 周期边界、历史持续耗尽及重开。[Compiler 测试](../../../../packages/simulation/simulation-scenario/tests/v1-actor-request-limit.spec.ts)覆盖显式默认值/上限、非法输入、复核承诺及 JSON/YAML 等价。[Loader 预约流程](../../../../examples/simulation-company/tests/world-booking.snapshot.ts)的显式 actor 配额探针通过真实模型工具和 Session 证据，在历史仍有余量且目标时段空闲时拒绝新键，并在暂停状态零推理恢复。该 Loader 证据覆盖 actor 请求额度，不代表结构额度矩阵。

[公共 schema 测试](../../../../packages/simulation/simulation/tests/world.spec.ts)与[结构编译测试](../../../../packages/simulation/simulation-scenario/tests/v1-structure-limits.spec.ts)验证零值、固定并发度、缺字段、准备证据及 JSON/YAML 承诺。[适配器测试](../../../../packages/simulation/simulation-world/tests/structure-stops.spec.ts)保持精确额度停止原因，不扩大决策提交拒绝种类。Python 额度与 SDK 停止测试、产品控制解析及双语状态渲染均通过。正式[外部额度](../../../../examples/simulation-company/tests/world-external-limits.snapshot.ts)与[收费招聘](../../../../examples/simulation-company/tests/hiring-resources.snapshot.ts) Loader 矩阵通过 source/lib、公司/实验室和 JSON/SQLite 共 128 案：384 个进程、1,056 次 keyless warm 模型调用，cold 模型调用为零。执行前后输入清单保持不变。这验证结构额度/恢复矩阵，不代表全部 World 完成要求或真实 provider 验证。
