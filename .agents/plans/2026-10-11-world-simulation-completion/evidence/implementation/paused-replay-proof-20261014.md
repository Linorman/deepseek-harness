# R03：暂停回放与新显式 start

2026-10-14，Asia/Tokyo。完成原 R03，清单 88/112，无新增 item。Native93、manifest4、compiler9；本部分不改变持久格式或产品调度语义。

## 回放及继续运行

[探针](../../../../../examples/simulation-company/tests/world-replay-probe.ts)在真实 Loader boot 后观察 `llm/stream` waterfall 和全部八类内建 execution 方法。暂停回放期间这些调用及 `Math.random` 会失败；脚本场景始终拒绝实际 fetch/socket 网络访问。使用 UUID 分配不等于重新采样世界结果；当前 simulated-rule 为确定性实现，没有随机 sampler。原 accepted Persona、计划和外部实际结果由完整状态及日志比较验证。[实现说明](../../../../notes/implemented/architecture/2026-10-14-world-paused-replay-probes.md)。

公司/实验室复用 R02 的真实当前版本 seed，协会新建实际完整流程；JSON/SQLite × source/plain Node lib，每种场景各两轮新冷进程，共 24 个 cold PID。恢复原完整 checkpoint 后保持 paused，再显式调用一次 `driver.advance()`，返回 paused；完整 Native state、Session events 与 journal 均等于原件。模型/领域执行/随机采样/fetch/socket 全为 0。没有重新生成新人或代表、重新计算新的外部裁决或生产性推进。

真实已认证产品 create/restore/control/inspect/export/manage：公司/实验室 × JSON/SQLite × director/newcomer × source/lib，共 16 案、32 PID。冷进程恢复模型池拒绝责任，保留原 World/stall；读取不改变 revision，各副作用计数为 0。提交新的 `explicit-continue-model-pool` management ID 后才开放生产区间；实际 waterfall 与脚本 provider 调用次数严格一致，director 为 15、newcomer 为 12。只产生一个 committed 业务结果，原 plan/proposal/pin、定义/intent 和已接受 Persona 保持，原拒绝决策对应一个后继。相同 start 重试不增加 revision、模型调用或业务效果。

[原件审计](paused-replay-audit-20261014.json)逐案核对保存的 process/stdout、probe、complete round 与原 state/Session/journal，另核对产品原 World、继续后的冻结 plan 内容、唯一结果及原 Persona。审计覆盖 56 个不同 PID；额外四个协会 warm PID 不计入这个冷恢复/产品计数。lib 的包路径全部为 `lib/`，无 import/loader/require flag。证据是 keyless 真实 Agent/tool 流，不是真实外部 provider 质量；探针覆盖 boot 后的恢复与调度，不声称宿主任意启动 IO。

## 命令与检查

在项目根设置 `TMPDIR="$PWD/.local/world-completion/tmp"`；`BASE="$PWD/.local/world-completion/r03-paused-replay"`。准确子进程 argv/PID 在审计内，日志和全部中间输出位于本项目。

```sh
WORLD_REPLAY_PROBE=true WORLD_COMPLETE_REPLAY_SEEDS="$PWD/.local/world-completion/r02-canonical-restore/seeds-source" WORLD_COMPLETE_EVIDENCE_ROOT="$BASE/complete-source" pnpm exec vitest run --config vitest.snapshot.config.ts examples/simulation-company/tests/complete-world.snapshot.ts -t 'company|laboratory'
WORLD_REPLAY_PROBE=true WORLD_COMPLETE_EVIDENCE_ROOT="$BASE/association-source" pnpm exec vitest run --config vitest.snapshot.config.ts examples/simulation-company/tests/complete-world.snapshot.ts -t association
WORLD_REPLAY_PROBE=true WORLD_PRODUCT_POOL_EVIDENCE_ROOT="$BASE/pool-source-final" pnpm exec vitest run --config vitest.snapshot.config.ts examples/simulation-company/tests/world-product-model-pool.snapshot.ts -t 'crash=false'
pnpm run build
pnpm exec vitest run packages/simulation/simulation-local/tests/decision-replay.spec.ts packages/simulation/simulation-local/tests/scheduler-replay.spec.ts packages/simulation/simulation-local/tests/bootstrap-replay.spec.ts --maxWorkers=2
pnpm exec tsx scripts/run-oxlint.ts examples/simulation-company/tests/world-replay-probe.ts examples/simulation-company/tests/complete-world-scenario.ts examples/simulation-company/tests/complete-world.snapshot.ts examples/simulation-company/tests/world-product-model-pool-scenario.ts examples/simulation-company/tests/world-product-model-pool.snapshot.ts
pnpm run verify-translation-pairing --write examples/simulation-company/README.md .agents/notes/implemented/architecture/2026-10-14-world-paused-replay-probes.md
pnpm run doc-sync
PYTHONDONTWRITEBYTECODE=1 python3 "$BASE/audit.py"
```

前三条另以 `CLOCKY_EXAMPLE_MODE=lib`、R02 `seeds-lib` 和 R03 对应 `*-lib` 目录执行。完整 source 日志为 `complete-source-event.log`、`association-source.log`，lib 为 `complete-lib.log`、`association-lib.log`，各 face 4+2 案通过；产品 `pool-source-final.log`/`pool-lib-final.log` 各 8 案通过。Native 三类回放 owner 回归 22 通过。Host 类型和完整 build 通过，记录 197 Client artifacts；5 文件 scoped oxlint 无输出通过。双语 README/Agent Note 已配对。

保留最初失败：四个 complete 冷进程在 probe 拆除时从已 dispose Context 解析 `llm` 失败，改为不再解析该服务；日志与小型 process/probe 原件保存在 `first-complete-source/`。八个产品案例的正向 start 暴露直接绑定服务计数器无效：provider 实际 15/12 次、该计数器却为 0。改为真正 waterfall 后 source/lib 各八案通过，初轮 `pool-source/` 与失败日志保留。未改任何原断言调用数、预算或 timeout。首次错用 ESLint 的无配置失败保留在 `lint.log`；使用项目实际 oxlint，修复 socket method 保存的 unbound-method 报告，最终 `lint-recheck.log` 通过。

本部分没有新 Session event 或 SDK wire 字段；R02 的当前 TS/Python 严格 wire 结果保持，SDK wheel/GUI、真实 provider、R04 竞态与 R06 广泛 SIGKILL 仍由原未勾选项目负责。无新 subagent、item、提交或发布。

最终 doc-sync 29/29 通过。4549 份相关 source/lib/config/SDK/Python/说明输入共 55,053,356 字节，BASE `inputs.json` 的 SHA-256 `0349ebc93c18e7f496e7b89e3da5299249de7e9b780339cac8f9cac3cd05a1fc`，副本与 live bytes 相等；捕获在验证后，不宣称执行前或全发行冻结。
