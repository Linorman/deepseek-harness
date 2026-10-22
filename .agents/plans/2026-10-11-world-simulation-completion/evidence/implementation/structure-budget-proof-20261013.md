# S12：冻结结构额度与统一停止原因

2026-10-13，Asia/Tokyo。Native84、v1 compiler8。本记录对应原 S12，不新增 checklist items；不代表完整 World、真实 provider 或 SDK 发行验收完成。

## 合同与实现

[World 定义](../../../../../packages/simulation/simulation/src/world.ts)要求显式 `maxBirthsPerInterval`、`maxExternalExpansionsPerInterval` 和 `maxPendingMutations`。前两项为非负安全整数，零禁止动态出生或外部代表展开；MVP pending mutation 固定为一，不支持任意并发数。作者输入可请求目录允许的降低，原 defaults/ceilings、resolved/preview 与编译 hash 保留这些值。缺字段、非法值和旧编译结果拒绝；Native84拒绝旧流，不为旧记录补造额度。SQLite schema 和 Session envelope 版本不变。

[结构预算 owner](../../../../../packages/simulation/simulation-local/src/world-structure-budget.ts)使用 Native 模拟时间和共用 `budgetInterval`。生成招聘消耗出生额度；新外部代表同时消耗出生与展开额度；初始人员由 Native/Team 初始容量约束。既有人物录用、调岗、离职和代表复用不产生出生。预留保存 `reservedAt`，首次准备保存 `prepared.time/sequence`；预留、准备和终态结果所在周期均保留该业务身份的消耗，同身份同周期只计一次。未完成预留跨周期继续占用容量，取消结算当期不退款。原件重试复用已有责任，不追加扣额。

同一 pending 槽位覆盖生成身份、外部代表、人事预留、World 招聘资金 hold 与未结外部联系，按原 intent 去重。业务已提交或已取消而原 maintenance 尚未结束时继续占位；未知清理结果不能提前释放。准入在随机身份或资金 hold 分配前检查，权威 fold/reducer 再检查；原 owner 续办可排除自身。投影验证独立核对历史周期额度和当前 pending 数量。共同检查补齐不同结构 owner 之间原先不对称的拒绝路径。

模型 `worldContext` 包含冻结 `worldLimits`，继续通过原 Session `simulation/context-view` 保存可重建输入。`SIM_WORLD_LIMIT` 的 `births/expansions/mutations` 分别映射到 `world-birth-limit/world-expansion-limit/world-mutation-limit`，组织、外部和人事执行器共用穷尽映射；人事错误不再把其他额度误报成 byte limit。产品 DTO、Python 与界面中英文状态同步。模型提交拒绝合同仍只有 bytes/requests/plans，没有把执行器责任混入提交错误。

## S12 各额度的证据

| 范围 | 冻结 owner 与拒绝/停止 | 本轮或已有明确证据 |
| --- | --- | --- |
| 请求 | World actor/interval、全局 request 历史与 plan 数量 | [P06 原始验收](actor-request-quota-proof-20261013.md)；本轮 compiler 与原收费幂等回归 |
| 出生、外部展开 | World 周期额度；三个独立结构停止原因中的前两项 | 零额度真实 Loader；额度一生成招聘成功；跨周期取消不退款；精确重试 |
| pending mutation | World 固定一；`world-mutation-limit` | 双后端真实跨招聘 owner 4项；commit 后 maintenance 保持占位；原owner续办 |
| 模型、token | Native token/decision预算、Team历史与模型池容量 | 真实 director/representative token、pool 与activation-history故障矩阵；预算/token单测 |
| 字节 | World request/plan、Native ingress/context及Team channel字节界限 | reserve/commit完整batch字节故障矩阵；相关schema/原owner回归 |
| 历史、驻留 | World request、Native人口/resource历史、Team participant/channel/activation与resident owner | entity/participant/channel/activation历史与resident owner实际故障矩阵；population单测 |
| microstep | Native `maxMicrostepsPerTime`；`SIM_MICROSTEP_LIMIT` / driver `microstep-limit` | scheduler精确上限及持久stall测试，本轮38项预算/人口/token/scheduler回归 |

## 冻结矩阵与原件审计

[正式矩阵](../../../../../.local/world-completion/thread-01a1336a-structure-budget/final-matrix)对 source 和 plain Node lib 各运行60个外部额度案例及4个收费招聘案例，共128案、384个独立PID。外部案例为公司/实验室 × JSON/SQLite × 15种额度故障，包括本轮新增出生/展开零额度；每案warm后两次独立冷恢复。收费招聘涵盖两种操作和两种介质；生成操作明确出生额度一，既有操作出生额度零，二者展开额度均零。没有提高模型、时间、重试或原业务预算以通过测试。

共1,056次真实keyless adapter调用；全部256个cold进程零模型调用、保持paused。lib断言实际包路径为`/lib/`且无tsx启动参数；测试入口本身仍为Node执行的`.ts`文件，不冒称已编译成JS。原暂停责任、资金及唯一身份/结果在恢复后保持。

运行前后5,969份输入、65,949,195字节副本SHA-256一致：`e12fd4d167fcd43850bdf96b520c124a64db62a3f514c15f599f797f267a9ee6`。完整source/lib副本、进程参数、stdout/stderr和原库留在项目内。最终doc-sync后当前5,969份文件仍逐项相同。

[独立审计](structure-budget-audit-20261013.json)按runId选择JSON/SQLite原库，核对84版日志与导出journal完全相同，真实Session事件前缀与保存证据相同，所有进程结果、source/lib路径、零额度拒绝无新代表/结果，以及实际模型上下文中的冻结limits。占位模型池实验另有辅助运行；审计不会把辅助库当成业务主库。

## 命令与结果

所有命令在项目根运行，临时文件、模型/Session原件、编译产物和日志均在项目内。

```sh
TMPDIR="$PWD/.local/world-completion/tmp" pnpm exec tsc -b tsconfig.host.json tsconfig.client.json
TMPDIR="$PWD/.local/world-completion/tmp" pnpm run gen-cordis-catalog
TMPDIR="$PWD/.local/world-completion/tmp" pnpm run build
sh .local/world-completion/thread-01a1336a-structure-budget/run-final.sh
/opt/homebrew/opt/python@3.14/bin/python3.14 .local/world-completion/thread-01a1336a-structure-budget/audit.py
TMPDIR="$PWD/.local/world-completion/tmp" node --import tsx/esm .local/world-completion/thread-01a1336a-structure-budget/projection-check.ts
TMPDIR="$PWD/.local/world-completion/tmp" pnpm run doc-sync
```

[日志目录](../../../../../.local/world-completion/thread-01a1336a-structure-budget)保留以下结果，测试集合有重叠，不将其相加作为唯一测试数：

- `regression.log`：11文件318项，首轮317通过，唯一失败为旧手写fixture缺`reservedAt`；修复后`personnel-retry.log`该文件19项全部通过。
- `boundary-tests.log`：21项通过，包含10项双后端结构额度及外部代表限制测试。
- [跨owner日志](../../../../../.local/world-completion/cross-owner-test.log)：4项通过；[原harness回归](../../../../../.local/world-completion/cross-owner-harness-regression.log)：28项通过。
- `existing-bounds.log`：38项；`scenario-final.log`：67项；`schema/ts-tests.log`：124项；`schema/stops-ts-tests.log`：204项；`schema/stops-ui-tests.log`：83项，均通过。
- `schema/python-tests.log`：68项；`schema/stops-python-tests.log`：27项通过。定向lint完成；build记录197个客户端产物。
- `doc-sync-final.log`：29/29通过；`projection-check.log`：基于实际Loader快照的8次超额/重复pending责任损坏探针全部按`SIM_WORLD_INTEGRITY`拒绝。
- `types-retry.log`通过；后续正式build覆盖更新的编译版本断言、harness和fixture。

首轮失败原件保留：新增测试最初把`failure.limit`误写为顶层`limit`；snapshot误用普通Vitest配置因而未发现文件；旧compiler7断言与一个fixture字面量推断导致typecheck失败；lint自动修复引入分号后已纠正；doc-sync首次28/29通过，唯一失败为生成API目录过期，已使用生成器更新。原件审计首次按目录首库选择时读到辅助占位运行，改为按runId选择后全量通过。这些失败没有通过放宽约束绕过。

S12 不包含未完成的provider实验、其他领域故障矩阵或最终全仓验收；这些仍由原 checklist 各项跟踪。
