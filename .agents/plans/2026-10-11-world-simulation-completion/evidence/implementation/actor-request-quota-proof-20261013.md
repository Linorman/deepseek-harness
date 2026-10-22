# P06：actor 周期请求与全局历史额度

2026-10-13，Asia/Tokyo。Native83、v1 compiler7。本记录验收原 P06，不新增 checklist items；S12 的出生、外部展开及 pending mutation 等其他冻结额度仍未完成。

## 实现

[World 定义](../../../../../packages/simulation/simulation/src/world.ts)新增必需正整数 `maxRequestsPerActorPerInterval`。目录默认值/上限必须显式提供，作者可请求获准降低；resolved/preview 保留原值与 Native `budgetInterval`。新增字段缺失、非法或超上限均拒绝。Native83与compiler7拒旧，不给旧运行或旧编译记录填虚构额度；SQLite schema、Session envelope保持原版本。

[预算 owner](../../../../../packages/simulation/simulation-local/src/world-request-budget.ts)从每项真实 accepted request 的原 decision、actor 和 `Decision.time` 计算周期，不用墙钟、Session/Activation ID、profile.role 或可变计数器。跨domain共用该actor额度，取消/拒绝不退款，精确原件重试不新增request。模型材料按原 snapshotRevision 过滤并引用该Native前缀，接受时检查最新完整投影，replay独立核对各actor/周期组。

同时修复[共同准入](../../../../../packages/simulation/simulation-local/src/world.ts)的历史漏洞：`maxRequests` 原本只在可信预建intent路径检查，普通goal直接接受新intent可以绕过。历史检查现位于所有新业务身份的统一创建点；相同原件先精确匹配，新的businessKey必须重新受历史约束。原岗位 occupied/reserved、资金 available/hold、历史人员/驻留约束不被改变；本轮相关收费/失效回归重新执行，而非仅引用旧版本结果。

超额模型提交沿用 `SIM_WORLD_LIMIT/requests` 与持久 `SIM_WORLD_SUBMISSION_BLOCKED` 硬停止，保留原Session输入，需检查和新场景，不承诺自动解除。未提交违规请求的调度可进入下一模拟周期。周期恢复不能释放历史、岗位或资金，也不改变失败尝试的独立model/token计费。无推理的可信owner探针可取消其未接受decision继续测试；这不代表模型硬停止自动恢复。

## 当前验证

[Native双后端测试](../../../../../packages/simulation/simulation-local/tests/world-request-budget.spec.ts)使用真实Team/Agent/Session/Channel owners：两个真实actor独立各接收一个请求；原请求取消后仍收费；新decision原件重试不扣额；新key在同周期拒绝；99仍属旧周期、100允许新业务，200的actor用量虽归零却仍被已满的全局历史上限拒绝。case、资金和身份保持原件，损坏的接受来源拒绝，重开后用量保留。[收费幂等测试](../../../../../packages/simulation/simulation-local/tests/world-paid-idempotency.spec.ts)在actor限额1已满时仍正确返回原支付/任职结果。[compiler测试](../../../../../packages/simulation/simulation-scenario/tests/v1-actor-request-limit.spec.ts)覆盖默认/上限冻结、超限和非法数值、JSON/YAML hash等价及旧compiler6拒绝。

真实[Loader预约流程](../../../../../examples/simulation-company/tests/world-booking.snapshot.ts)以显式 `WORLD_BOOKING_ACTOR_QUOTA=true` 在编译前请求actor限额1。第一个booking成功，原收据重试成功；随后模型依据实际记录的goal提出另一个businessKey与空闲时段30–40。历史额度仍大于1、原时段为10–20，拒绝原因来自actor额度。新的case、mutation、booking、通知均未产生。拒绝时的budget视图、staged body hash、Native world-blocked及Session三工具证据完整保存；显式checkpoint后新进程保持paused/0模型。

公司/实验室 × JSON/SQLite × source/plainNode lib 共8案、16个独立进程通过；每个warm18次真实keyless调用，8个cold全0调用。lib断言实际包路径和空execArgv。fixture的`.ts`由Node执行，不冒称它本身是编译JS。[正式矩阵](../../../../../.local/world-completion/thread-01a1336a-actor-quota/final-matrix)保留5,747份输入、62,999,265字节完整副本，执行前后SHA-256一致：`f561e7176bcb4101d5a5f720f71f9af9cf6db4f133aa217cab3677445f14054a`。doc-sync后当前文件仍逐项相同。

[独立审计](actor-request-quota-audit-20261013.json)核对全部输入hash、40份主要原件、16 PID、实际JSON/SQLite原日志与导出journal一致、83版checkpoint、真实Session前缀、原请求重试、违规新key/空闲时段及原proposalHash。拒绝decision不存在对应新operation；World仍只有一个request/mutation/result和一个booking，原两条通信保持。总144次keyless调用不代表真实provider质量或费用实验。

## 命令与结果

所有命令从项目根执行；所有临时文件、模型/Session/原库、构建产物和日志均在项目内。

```sh
TMPDIR="$PWD/.local/world-completion/tmp" pnpm exec vitest run packages/simulation/simulation-team/tests/world.spec.ts packages/simulation/simulation-local/tests/world-hiring-resources.spec.ts packages/simulation/simulation-local/tests/world-hiring-resource-stale.spec.ts packages/simulation/simulation-local/tests/world-request-budget.spec.ts packages/simulation/simulation-local/tests/run.spec.ts packages/simulation/simulation-scenario/tests/compiler.spec.ts packages/simulation/simulation-scenario/tests/v1-actor-request-limit.spec.ts
TMPDIR="$PWD/.local/world-completion/tmp" pnpm exec vitest run packages/sdk/protocol/tests/schema.spec.ts packages/sdk/protocol/tests/simulation-world-results.spec.ts packages/sdk/protocol/tests/world-hiring-fees.spec.ts packages/client/ui-simulation/tests/world-author.client.spec.tsx packages/client/ui-simulation/tests/world-creation.client.spec.tsx
TMPDIR="$PWD/.local/world-completion/tmp" pnpm exec tsc -b tsconfig.host.json tsconfig.client.json --pretty false
TMPDIR="$PWD/.local/world-completion/tmp" pnpm run build
sh .local/world-completion/thread-01a1336a-actor-quota/run-final.sh
PYTHONDONTWRITEBYTECODE=1 /opt/homebrew/opt/python@3.14/bin/python3.14 .local/world-completion/thread-01a1336a-actor-quota/audit.py
TMPDIR="$PWD/.local/world-completion/tmp" pnpm run doc-sync
```

[证据目录](../../../../../.local/world-completion/thread-01a1336a-actor-quota)保留精确matrix脚本、freeze/audit程序、[lint argv与文件清单](../../../../../.local/world-completion/thread-01a1336a-actor-quota/lint-command.json)及所有日志。7文件311项Native/场景/资金回归通过；5文件65项TS协议/作者界面回归通过；新增额度/收费/编译focused19项与前述存在重叠，不相加。Host/Client emit、scoped lint通过；build197 client artifacts通过；最终doc-sync29 passed/0 failed/0 skipped（48.36s）。source矩阵4项36.50s，lib4项8.33s。

Python SDK同步严格WorldKey，resolved必需/input可选；[新测试](../../../../../python/sdk/tests/test_actor_request_quota.py)包含正安全整数、坏类型/缺字段/未知quota、原preview保留及私有compilerVersion注入拒绝。Python7文件109项通过，日志见[Python目录](../../../../../.local/world-completion/thread-01a1336a-actor-quota/python/sdk-tests.log)；该目录使用项目内venv、pytest临时目录和cache。它是源码SDK证据，不是安装wheel或U13分发验收。

Python执行命令如下，源码环境与cache均限定在项目内：

```sh
TMPDIR="$PWD/.local/world-completion/thread-01a1336a-actor-quota/python/tmp" PYTHONDONTWRITEBYTECODE=1 PYTHONPATH="$PWD/python/sdk/src" .local/world-completion/c29-public-v1/python-env/bin/python -m pytest python/sdk/tests/test_actor_request_quota.py python/sdk/tests/test_simulation_scenario.py python/sdk/tests/test_simulation_scenario_v1.py python/sdk/tests/test_director_events.py python/sdk/tests/test_resource_reservation.py python/sdk/tests/test_hiring_fees.py python/sdk/tests/test_simulation_world_cases.py -q -o cache_dir="$PWD/.local/world-completion/thread-01a1336a-actor-quota/python/pytest-cache" --basetemp="$PWD/.local/world-completion/thread-01a1336a-actor-quota/python/pytest-tmp"
```

首轮Native测试暴露预算引用超出decision snapshot，已改为原前缀过滤；第二轮时间测试误用scheduleWake返回snapshot为event ID，改取原命令ID；首轮模型探针误将既有硬停止阶段断言为paused，修正为stalled并验证原停止原因，随后显式checkpoint才paused。早期类型检查受未重建跨包声明影响，按项目规则emit生产者后修复；格式问题均修复并保留失败日志。测试限时及原global/model/resource预算均未提高。现有较高全局工作量fixture为新actor字段显式沿用原限额；正式探针始终为1。

## 完成判断

P06的新业务键、actor/模拟周期、历史、岗位和资金约束有当前共同准入、严格消费者、实际模型拒绝及双后端恢复证据，故勾选P06。只读复核确认同窗口最新投影、不同domain、精确重试和replay均不绕过计费。S12、真实模型、完整GUI、SDK分发及完整MVP仍保持原未完成范围，不以本次检查替代。
