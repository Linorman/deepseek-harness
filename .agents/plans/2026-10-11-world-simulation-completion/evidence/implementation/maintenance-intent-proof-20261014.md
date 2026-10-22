# R04：维护控制意图与旧 cut 失效

2026-10-14，Asia/Tokyo。Native94、checkpoint manifest4、compiler9。完成原 R04，清单89/112，没有新增 item。

## 实现

旧 Native cut 在跨 Team/Session 读取 IO 期间拒绝新 pause/cancel。产品取消可能已 durable accepted，而 Native 没有记录，自动继续因控制历史未变化而继续运行。现在仅两类控制通过内部 `control` queue mode 准入；生产性 mutation/running 仍被屏障拒绝。控制改变 revision，旧 cut 保留原 reference、不能发布变化后的 prefix。Native pause 也可与 in-progress checkpoint 共存，因此 stream 升到94，旧格式拒绝。

`checkpointSource` 按 `SimulationRevisionConflictError` 类型报告 run/source-moved。维护用原 maxAttempts 做整轮新 cut 收集，每轮 collect 一次，不把内外重试相乘。Team/Session movement 保留原重试；Native movement 只有实际 management/cancellation 历史变化才可重取。缺证据、无控制变化的 Native movement 及次数耗尽仍失败并保留 draining 责任。已有最后 `setPhase` 的 revision CAS 保持。

## 当前证据

公司/实验室×JSON/SQLite×source/plain Node lib，共160案/320PID：128新意图案例、32无新意图自动resume对照；160 cold保持paused、模型0。同control身份重试不新增效果或resume。招聘、mediated代表、transfer/depart实际维护，retirement response、sealed Team reference response、最后resume三个窗口均有原件。新意图在 IO release 前进入 Native；sealed新意图重取2cut，无新意图1cut。全部最终checkpoint实际completed。

[原件审计](maintenance-intent-audit-20261014.json)逐案核对实际Native WAL控制事件、revision顺序、无新running事件、原reservation及结果、sealed状态完整fingerprint、实际最终manifest、runtimepaths和PID。84cold保存并逐项比较完整state；早期76source cold比较World、Entity、resources、management，准确保留范围差异。retirement barrier扣住已确认stop后的reply，不声称物理停止未知；代表v3与Actor v2共用helper，但未单跑v2；depart sealed未单独组合。没有新的SIGKILL或真实provider质量宣称。

source首轮76/80，保留4失败；未加deadline，在隔离负载及稳定idle对照后四案通过，80selector成功目录由 `source-roots.json` 指定。lib完整80/80。Native checkpoint/management/诊断/重试边界56通过。相邻World/restore/product原545回归首轮539/6失败、隔离543/2 timeout，再跑原terminal两行为×双后端4通过，唯一测试合计545；旧日志保留，未加timeout/额度。

Host类型、12文件scoped lint、完整build197 Client artifacts、最终doc-sync29/29、TS wire82/Python wire79通过。当前Native94四组source/lib版本矩阵2+2通过，768旧/未来流inspect/open拒绝，8未知必需记录拒绝，model0；原件目录见 `version-roots.json`。

## 准确命令及原件

项目根设 `TMPDIR="$PWD/.local/world-completion/tmp"`、`BASE="$PWD/.local/world-completion/r04-maintenance-intent"`。全部日志、数据库、Session、进程输出和Python cache在本项目。

```sh
WORLD_MAINTENANCE_EVIDENCE_ROOT="$BASE/matrix-source" pnpm exec vitest run --config vitest.snapshot.config.ts examples/simulation-company/tests/world-maintenance-intent.snapshot.ts --maxConcurrency=2
WORLD_MAINTENANCE_ONLY=transfer:sealed:pause,transfer:sealed:cancel WORLD_MAINTENANCE_EVIDENCE_ROOT="$BASE/source-company-final" pnpm exec vitest run --config vitest.snapshot.config.ts examples/simulation-company/tests/world-maintenance-intent.snapshot.ts -t 'json.*company' --maxConcurrency=1
WORLD_MAINTENANCE_ONLY=transfer:sealed:none,depart:resume:none WORLD_MAINTENANCE_EVIDENCE_ROOT="$BASE/source-lab-final" pnpm exec vitest run --config vitest.snapshot.config.ts examples/simulation-company/tests/world-maintenance-intent.snapshot.ts -t 'json.*laboratory' --maxConcurrency=1
pnpm run build
CLOCKY_EXAMPLE_MODE=lib WORLD_MAINTENANCE_EVIDENCE_ROOT="$BASE/matrix-lib" pnpm exec vitest run --config vitest.snapshot.config.ts examples/simulation-company/tests/world-maintenance-intent.snapshot.ts --maxConcurrency=2
pnpm exec vitest run packages/simulation/simulation-local/tests/checkpoints.spec.ts packages/simulation/simulation-local/tests/management.spec.ts packages/simulation/simulation-team/tests/checkpoint-failure.spec.ts packages/simulation/simulation-team/tests/maintenance-intent.spec.ts --maxWorkers=2
pnpm exec vitest run packages/simulation/simulation-team/tests/world.spec.ts packages/simulation/simulation-team/tests/restore.spec.ts packages/simulation/simulation-product/tests/world-administration.spec.ts packages/simulation/simulation-product/tests/world-preparation.spec.ts --maxWorkers=2
pnpm exec vitest run packages/simulation/simulation-team/tests/world.spec.ts -t 'exact terminal window inputs|altered result notification content' --maxWorkers=1
pnpm exec tsc -b tsconfig.host.json
pnpm run doc-sync
pnpm exec vitest run --config vitest.snapshot.config.ts examples/simulation-company/tests/world-version-policy.snapshot.ts
CLOCKY_EXAMPLE_MODE=lib pnpm exec vitest run --config vitest.snapshot.config.ts examples/simulation-company/tests/world-version-policy.snapshot.ts
pnpm exec vitest run packages/sdk/client/tests/sdk-client.spec.ts -t 'wire payload validation'
PYTHONPATH="$PWD/python/sdk/src" PYTHONDONTWRITEBYTECODE=1 .local/world-completion/c29-public-v1/python-env/bin/python -m pytest python/sdk/tests/test_channel_view.py --basetemp "$BASE/python-wire-tmp" -o cache_dir="$BASE/pytest-cache"
PYTHONDONTWRITEBYTECODE=1 python3 "$BASE/audit.py"
```

初轮Native sealed pause拒绝的两个红例在 `native-before.log`；公开checkpoint的fold拒绝红例在 `native-after.log`；实现后56通过。首个Loader pilot拆除错误使用 `lease.dispose()`，改为真实 `lease.revoke()`；一次fixture错误把产品management receipt当作Native operation.request，类型检查捕获并修正。提前暂停无新意图对照的后继生产批次产生 driver-failed，原件在 `source-recheck-lab/`。raw WAL 独立审计定位：新 pause 已持久化，但 driver 在等待 resident IO 后仍提名，并以新 revision 分配窗口，收到普通 paused 拒绝。现在三个等待后重新读 phase，不吞无关 IO 错误。driver-revision8通过；`WORLD_MAINTENANCE_EARLY_STOP=true` 重现原提前停止，公司/实验室×transfer/depart×JSON/SQLite×source/lib 额外16案/32PID通过，原件在 `early-stop-source/`、`early-stop-lib/`，两个日志各8通过；额外cold完整state相等、model0。

Native允许公开checkpoint中的pause已由unit证明；公开产品checkpoint仍占managementTail，其产品pause串行化与本矩阵driver结构维护不同。具体决策在[Agent Note](../../../../notes/implemented/architecture/2026-10-14-world-maintenance-control-cut.md)。没有新增checklist item、PR或提交，复用同一个只读audit agent。

主160案矩阵先于最后driver等待后phase检查运行，其维护准入/控制/cut代码一致。该补充改变由新的双后端owner反例、原无关IO错误负对照和source/lib额外16真实产品案例验证；最终build使用补充后代码。全部输入捕获在验证后，不宣称执行前冻结。没有提高旧测试deadline或预算。

补充后最终doc-sync仍29/29；14文件scoped lint和最终完整build197通过。4585 份最终相关输入共 55,399,736 字节，BASE `inputs.json` SHA-256 `3e8e251c6e0f791d0d2411055d24251f9c76521b7bd6c8d11a9a8b4ff8d21096`；副本与live bytes相等，捕获在验证后。SDK wheel、GUI、真实provider和更广故障矩阵仍由原未完成条目负责。
