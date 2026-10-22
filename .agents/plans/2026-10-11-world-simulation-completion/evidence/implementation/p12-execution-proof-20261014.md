# P12 原计划执行观察：实现与部分验收

2026-10-14，Asia/Tokyo。P12 保持未勾选，清单仍 90/112；没有新增 item。所有中间产物在项目 `.local/world-completion/p12-execution/`，以下为可保留的日志和输入索引。

## 当前实现

Native 的 `recordWorldExecution` 保存绑定原 plan/request/intent/pin 的严格观察及序列 CAS。dispatcher 在调用实际 executor 前写 armed；类型化拒绝为 blocked，未确认回调为 outcome-unknown，确认结案为 settled。业务结果与回调责任、通知均独立；已 committed 的业务也可以仍有未确认清理。新的 execute 不得重发 armed/unknown 回调，只能由原实现对账。原 provider 确认没有任何 Native 预留责任时，对账不发新 IO。新 pause 在 admission 落盘后、回调前重验。

Native 还核验实际预留、maintenance 和资金 hold，不能用 settled 隐藏未清责任。未知执行阻止同案新 resolve/scenario-resolve 上下文、已准备但尚未接受的新提交及实际 plan fold；原 accepted decision 精确重试保持幂等。观察拒绝伪造引用、倒退序列、旧 CAS、非法转换和字节超限。重复同状态/模式/原因零 append。

每 plan 观察总限额为 `4 × maxOperationsPerDecision × maxPlansPerRequest`。execute arm 留四槽、reconcile arm 留两槽；无待清责任的 blocked 更新须另留四槽。四槽是新观察协议完整 admission/disposition 及一次 reconciliation 的固定记录开销，不调整既有业务或模型额度。超限保留未知责任，不退款。原按单倍计算的早期版本不能保证极小配置结案，已经修正；相关早期失败日志保留。

Native stream **95**、checkpoint manifest **5**，Session 与场景 compiler 版本未机械同步。checkpoint 引用及指纹包含 execution 记录；writable 旧格式拒绝。产品独立执行区新增 observation，armed 显示为未确认 callback，原因使用固定枚举，不复制私密异常。TS/Python 同步严格 DTO，settled 的必需 `reason: null` 在 Python wire dump 保留。首次行动通知按实际 scheduled/wake 投影，不再只认新建招聘预留。

## 当前证据与范围

- [最终输入](p12-execution-20261014/inputs.json)：1,140 份相关 source/test/lib，hash `6bef383691290e7d10950e6ebd59dcc7f1e4cbd8770d4a0505c91e14d3f238ca`。最终 Host build 后捕获；三场景 source 的生产过程早于最后配额和准入防线细化，后者有专项测试及最终 lib 公司流程。
- [Native owner](p12-execution-20261014/unknown-replan.log) 14/14：JSON/SQLite CAS、close/reopen armed、引用拒绝、原资金/并发责任、cap8 与乘积1纯 fold 边界、未知后新规划拒绝及原重试。乘积1是明确调整输入的 fold 单元向量，不宣称实际 composition 可以用不足以展开请求的额度创建运行。
- [focused](p12-execution-20261014/focused.log) 7 files/101 通过；随后[暂停/执行观察](p12-execution-20261014/dispatcher-pause.log) 17 通过；[相邻分类和 bundle purity](p12-execution-20261014/adjacent.log) 28 通过；[Python](p12-execution-20261014/python-wire.log) 33 通过。这些结果有重叠，不求和为唯一测试数。
- Native schema 5/5、checkpoint 36/36 通过；[综合原始日志](p12-execution-20261014/focused-reserved-final.log) 58/59，唯一既有 P01 三工具反例 5 秒超时。未改时限，随后该文件完整包含在相邻 28 通过。早期 bounds 磁盘循环超时改用真实 cap8 和纯 fold 验证固定生命周期，不更改生产额度或放宽断言。
- [三场景 source](p12-execution-20261014/loader-source.log) 6/6：公司/实验室/协会 × JSON/SQLite，实际 Loader/Agent/Team 后两次新进程零模型恢复。
- [最终 plain Node lib 公司](p12-execution-20261014/loader-lib.log) 2 通过、4 未选：两后端实际生产流程及两次冷恢复，不宣称编译产物验证了另外两场景。
- [逐原件审计](p12-execution-20261014/actual-projection.json)：24 PID、234 个真实产品执行 DTO 和原 Native 观察相符，Python 逐份解析通过，冷进程 model=0，读取完整 Native snapshot 不变。此处都是完成流程的观察，不将其冒充真实未知回调故障。
- [source 拒旧](p12-execution-20261014/versions-source.log)与 [lib 拒旧](p12-execution-20261014/versions-lib.log)各 2 通过，stream95，未知必需记录拒绝，model=0。
- [完整 build](p12-execution-20261014/build.log) 197 client artifacts；最新 Native/dispatcher 防线后[最终 Host build/类型检查](p12-execution-20261014/host-final.log)通过；[最终 doc-sync](p12-execution-20261014/doc-sync-final.log)29/29，分工及 root scoped lint、diff 空白检查通过。

## 准确命令

项目根设置 `BASE="$PWD/.local/world-completion/p12-execution"`、`TMPDIR="$BASE/tmp"`。Python 设置 `PYTHONDONTWRITEBYTECODE=1`；未加载秘密或调用真实 provider。

```sh
pnpm exec vitest run packages/simulation/simulation-local/tests/world-execution.spec.ts --maxWorkers=1
pnpm exec vitest run packages/simulation/simulation-world/tests/execution.spec.ts packages/simulation/simulation-world/tests/driver-revision.spec.ts packages/simulation/simulation-world/tests/providers.spec.ts packages/simulation/simulation-product/tests/case-schema.spec.ts packages/sdk/protocol/tests/simulation-world-results.spec.ts packages/sdk/client/tests/simulation-world.spec.ts packages/sdk/server/tests/simulation-world.spec.ts --maxWorkers=1
pnpm exec vitest run packages/simulation/simulation-world/tests/execution.spec.ts packages/simulation/simulation-world/tests/driver-revision.spec.ts --maxWorkers=1
pnpm exec vitest run scripts/client-bundle-purity.spec.ts packages/simulation/simulation-local/tests/world-parser-boundaries.spec.ts packages/simulation/simulation-team/tests/checkpoint-failure.spec.ts --maxWorkers=1
PYTHONPATH="$PWD/python/sdk/src" .local/world-completion/c29-public-v1/python-env/bin/python -m pytest python/sdk/tests/test_simulation_world_cases.py --basetemp "$BASE/python-wire-tmp" -o cache_dir="$BASE/pytest-cache"
WORLD_CASE_DUTIES=true WORLD_COMPLETE_EVIDENCE_ROOT="$BASE/loader-source" CLOCKY_SNAPSHOT=replay pnpm exec vitest run --config vitest.snapshot.config.ts examples/simulation-company/tests/complete-world.snapshot.ts --maxWorkers=1
pnpm run build
pnpm run build:lib:host
CLOCKY_EXAMPLE_MODE=lib WORLD_CASE_DUTIES=true WORLD_COMPLETE_EVIDENCE_ROOT="$BASE/loader-lib" CLOCKY_SNAPSHOT=replay pnpm exec vitest run --config vitest.snapshot.config.ts examples/simulation-company/tests/complete-world.snapshot.ts -t company --maxWorkers=1
CLOCKY_SNAPSHOT=replay pnpm exec vitest run --config vitest.snapshot.config.ts examples/simulation-company/tests/world-version-policy.snapshot.ts --maxWorkers=1
CLOCKY_EXAMPLE_MODE=lib CLOCKY_SNAPSHOT=replay pnpm exec vitest run --config vitest.snapshot.config.ts examples/simulation-company/tests/world-version-policy.snapshot.ts --maxWorkers=1
pnpm run gen-cordis-catalog
pnpm run doc-sync
```

## 尚未验收

P12 仍需真实产品/Agent composition 中的独立案件 blocked/unknown、业务 committed 而通知未知，以及 armed/IO 危险窗口的 barrier/SIGKILL/新进程原实现对账证据。close/reopen 单元测试和 mock callback 异常不能替代这些故障证明。UI、完整 wheel 分发、真实模型、R07 宽回归及整体 MVP 也没有由本报告验收。下一轮延续这些原条目，不另建 checklist item。
