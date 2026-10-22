# R01：完整 checkpoint 责任引用

2026-10-14，Asia/Tokyo。完成 R01，清单 86/112，无新增 item。Native stream 92、checkpoint manifest 4；compiler 9、通用 SQLite/Session 格式不变。

## 内容与责任索引

原完整 World 和 run-prefix 指纹已绑定业务内容，不存在本轮发现的数据丢失。缺口是逐条责任索引没有覆盖补证 challenge/revision、外部 adjudication 和延迟 event。现在四类都有独立 record kind。回答保留原 revision 序号；延迟事件使用原 adjudication sequence，完整 fingerprint 包含 scheduled/blocked/consumed 状态、全部 block 和实际 consumption，不用当前时间或最后一次阻塞替代原来源。

原有 definition/projection commitment 和完整 journal 保留全部模板/Persona、事实、制度、投票、resolution、accepted/stale plan、mutation/reservation、取消、外部 registry、人员 fence、通知和清理责任。初始 Persona 在 Native Entity profile；生成/代表 Persona 同时保留其原计划/准备记录和 Entity profile。完整 run-prefix 与 canonical Session references 绑定这些数据及实际模型上下文，manifest 不复制第二份私密正文。原 published checkpoint 的 cross-owner references 不变，新格式明确拒绝旧 manifest 和 Native stream；不根据当前部署补出丢失引用。[实现决策](../../../../notes/implemented/architecture/2026-10-14-world-checkpoint-reference-coverage.md)说明 sequence 与保留合同。

## 实际验证

公司/实验室/协会完整链、生成与既有人员补证招聘、延迟及阻塞裁决、制度修订/撤销、外部 availability、代表 channel-IO 取消，均使用实际 Loader/Agent/三工具/Native/Team/Session/Channel。JSON/SQLite × source/plain Node lib 总计 60 case、156 PID，96 cold PID 模型调用 0。

独立 Python 审计从各原 owning table 重新计算每个 reference 的 identity/version/sequence/SHA-256，再核对整个 definition 和 World/bootstrap commitment；两种 launch face 各自覆盖全部 26 类非空记录，没有用空表代替取消、撤销或清理验证。实际代表清理包括原 Participant left、unmaterialized Session、一个关闭 Channel 和一个 absent Channel；它的完整原证据受 representative fingerprint 保护。实际 blocked delayed duty 保留原 scheduler event 和 block history，consumption 缺失仍有责任；consumed leaf 保留实际消费证据。完整公司/实验室 checkpoint 各有 6 个 Persona Entity/canonical Session，协会有 4 个，模板与原计划也同时保留。

[真实 sealed-cut probe](../../../../../examples/simulation-company/tests/checkpoint-world-coverage.ts)在已完成的真实跨 owner checkpoint 后，沿用其原规范 reference 并取得新 Native cut。对四类新增记录逐个尝试删除、改变 fingerprint、改变 sequence，共 216 次实际 `cut.publish()` 拒绝；完整 projection hash 保持不变，不能掩盖责任索引删改。每次拒绝 revision 不变。正确完整向量发布后，World/bootstrap/Entity/Relation/resource/operation/Decision 与原业务状态逐项相等。冷恢复比较原 state、Session 和 journal，或各场景原完整 material/topology，保留新 probe checkpoint，原身份、结果和责任不重建。

[原件及内容 hash 审计](checkpoint-reference-coverage-audit-20261014.json)保存全部 process 命令、PID、实际模式、全 26 类计数、216 个拒绝和每个原件目录的 hash。无新的真实模型、随机重采样、outside-world IO 或 SIGKILL 宣称；R02/R06 继续负责更广的跨 owner 损坏与危险边界。

当前双后端源码/lib 再跑版本策略，752 次旧/未来 stream 的 inspect/open 拒绝和 8 次未知必需 Native 记录拒绝，旧两条记录保留，模型 0。Checkpoint schema 对 0/1/2/3/5 版本拒绝，只有 4 通过。TS/Python 当前真实 stdio wire corpus 82/79 通过，未新增 Session event 或 SDK wire 字段；严格未知必需事件规则保持。

## 命令与门禁

所有命令在项目根，设置 `TMPDIR="$PWD/.local/world-completion/tmp"`。日志、所有 Source/lib/Native/Session 原件、Python cache 与输入副本位于 `.local/world-completion/r01-checkpoint-coverage`；版本矩阵新目录由 `version-roots.json` 指定，仍在本项目。

```sh
pnpm exec vitest run packages/simulation/simulation-local/tests/checkpoints.spec.ts packages/simulation/simulation-team/tests/restore.spec.ts packages/simulation/simulation-product/tests/collections.spec.ts --maxWorkers=2
WORLD_CHECKPOINT_COVERAGE=true WORLD_EVIDENCE_ROOT="$PWD/.local/world-completion/r01-checkpoint-coverage/evidence-source" pnpm exec vitest run --config vitest.snapshot.config.ts examples/simulation-company/tests/world-evidence.snapshot.ts
WORLD_CHECKPOINT_COVERAGE=true WORLD_MEDIATED_ONLY=delayed,delayed-blocked WORLD_MEDIATED_EVIDENCE_ROOT="$PWD/.local/world-completion/r01-checkpoint-coverage/mediated-source" pnpm exec vitest run --config vitest.snapshot.config.ts examples/simulation-company/tests/world-external-mediated.snapshot.ts
WORLD_CHECKPOINT_COVERAGE=true WORLD_COMPLETE_EVIDENCE_ROOT="$PWD/.local/world-completion/r01-checkpoint-coverage/complete-source" pnpm exec vitest run --config vitest.snapshot.config.ts examples/simulation-company/tests/complete-world.snapshot.ts
pnpm run build
pnpm run doc-sync
WORLD_CHECKPOINT_COVERAGE=true WORLD_CHECKPOINT_HISTORY_EVIDENCE_ROOT="$PWD/.local/world-completion/r01-checkpoint-coverage/history-source" pnpm exec vitest run --config vitest.snapshot.config.ts examples/simulation-company/tests/world-norm-history.snapshot.ts
WORLD_CHECKPOINT_COVERAGE=true WORLD_CHECKPOINT_EXTERNAL_EVIDENCE_ROOT="$PWD/.local/world-completion/r01-checkpoint-coverage/availability-source-final" pnpm exec vitest run --config vitest.snapshot.config.ts examples/simulation-company/tests/world-external.snapshot.ts
WORLD_CHECKPOINT_COVERAGE=true WORLD_CHECKPOINT_CANCEL_ONLY=channel-io WORLD_CHECKPOINT_CANCEL_EVIDENCE_ROOT="$PWD/.local/world-completion/r01-checkpoint-coverage/cleanup-source" pnpm exec vitest run --config vitest.snapshot.config.ts examples/simulation-company/tests/world-external-cancel.snapshot.ts
pnpm exec vitest run packages/simulation/simulation-world/tests/providers.spec.ts packages/simulation/simulation-product/tests/world-preparation.spec.ts packages/simulation/simulation-product/tests/world-administration.spec.ts --maxWorkers=2
pnpm exec vitest run --config vitest.snapshot.config.ts examples/simulation-company/tests/world-version-policy.snapshot.ts
CLOCKY_EXAMPLE_MODE=lib pnpm exec vitest run --config vitest.snapshot.config.ts examples/simulation-company/tests/world-version-policy.snapshot.ts
pnpm exec vitest run packages/sdk/client/tests/sdk-client.spec.ts -t 'wire payload validation'
PYTHONPATH="$PWD/python/sdk/src" PYTHONDONTWRITEBYTECODE=1 .local/world-completion/c29-public-v1/python-env/bin/python -m pytest python/sdk/tests/test_channel_view.py --basetemp .local/world-completion/r01-checkpoint-coverage/python-wire-tmp -o cache_dir="$PWD/.local/world-completion/r01-checkpoint-coverage/pytest-cache"
pnpm exec tsc -b tsconfig.host.json
pnpm exec tsc -b tsconfig.client.json
pnpm run doc-sync
PYTHONDONTWRITEBYTECODE=1 python3 .local/world-completion/r01-checkpoint-coverage/audit.py
```

六个场景矩阵另以 `CLOCKY_EXAMPLE_MODE=lib` 和对应 `*-lib` evidence 目录执行相同命令；准确 argv 在审计中，lib 不使用 import/loader/require flag。scoped lint 覆盖 15 个受影响 source/test 文件。177 个 checkpoint/restore/collection 回归和 227 个相邻 World/provider 回归通过，两个计数分别报告。Host/Client 类型、lint、完整 build 及最终 doc-sync 29/29 通过；构建实际记录 197 个 Client artifacts。SDK wheel/GUI/全仓所有回归仍待 U13/R11，不以本部分的 focused 结果替代。

保留初轮失败：新 probe 的 union table 经 `Object.entries` 推导出 any，改为显式 sequence contract，不加 suppression；availability fixture 原本没有 `root` 局部变量，新增 opt-in probe 首轮四案 ReferenceError，改用原环境的项目目录后 source/lib 各四案通过。Agent Note 的标题 `Consequences and verification` 不符合机械格式，改成准确 `Consequences`，双语配对更新，最终门禁通过。阈值、预算、业务 outcome 和模型脚本不调整。

4,538 份相关 source/lib/config/SDK/Python 输入、54,979,495 字节保存于 `inputs/`；manifest SHA-256 为 `c669ff31b5f5b066e86bd26757c64159073ae302a506264e1f60f464b21cb2a0`，副本和最终 live bytes 独立核对。捕获发生在验证后，不宣称执行前或全发行冻结。全程无新 subagent、item、PR 或远端发布。
