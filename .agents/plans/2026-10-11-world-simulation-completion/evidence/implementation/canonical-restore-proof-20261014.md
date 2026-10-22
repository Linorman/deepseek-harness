# R02：完整后续 canonical owner 校验

2026-10-14，Asia/Tokyo。完成原 R02；清单 87/112，无新增 item。Native stream 93、checkpoint manifest 4、compiler 9。

## 实现与拒绝边界

checkpoint collection 和 restore 共用原 Participant descriptor、已确认 Channel manifest/endpoint consent 校验。实际 Team/Participant/Session/Channel 必须与 Native 原 reservation、binding 和角色、模型配置一致；包括所选旧 checkpoint 后新增的人物和外部代表。合法退休 Participant 与关闭 Channel 保留其历史 phase。原 manifest Session binding 先于后续 Channel traversal 验证；原 protected prefix、Session consumption、activation/cleanup 和 accepted Envelope receipt 的逐项校验继续有效。

已提交生成新人和代表的实际 Persona 必须等于原 accepted plan/preparation profile。通用 profile 替换在 append 前拒绝，replay 也重新验证原件。implementation generation 沿用已安装 schema/provider/lease 的精确 pin 校验。缺证据拒绝恢复，不生成替代身份或 Persona。部分跨 owner 故障在 exclusive Native open 后检测，但全部在 phase 变化、Team attachment 和 writer recovery 前拒绝；不能把底层 open 当作可写世界恢复成功。[实现说明](../../../../notes/implemented/architecture/2026-10-14-world-canonical-restore-suffix.md)。

回归同时发现首次 World definition 的 `undefined → empty evidence` 被误算为补证操作。现在只对两个已有 evidence 状态之间的变化计算补证额度，完整实际 batch 仍受原上限限制。保留原 512 字节测试额度和拒绝/原件重试断言。

## 实际矩阵与独立审计

公司/实验室 × JSON/SQLite × source/plain Node lib：8 个真实完整世界 seed、24 个 seed 生命周期进程；其中 16 个原冷恢复进程保持 paused、模型 0。新增矩阵 136 个新进程：8 个正确恢复保留完整后续 revision，128 个坏引用拒绝。全部矩阵 model/activation/publication 为 0，全部拒绝 attachment 为 0，Native 原 journal before/after 相等。共 160 个不同 PID；1512 次 keyless warm 调用来自真实 Agent/tool/Team/Session 流程，不是外部真实模型验收。

每种 fault 在八组各一次：新人/代表 Session 缺失或 binding 错误、Participant 缺失或 descriptor 改变、Channel 缺失或 invitation Session endpoint 改变、后追加 Persona mutation、原 receipt Envelope payload 改变，以及 implementation generation 改变。恢复选择 `complete-world-initial`，该 manifest 尚无后来的新人/代表 Session；保留实际完整 suffix，证明不会只验证旧 cut 或回滚后续状态。

[独立审计](canonical-restore-audit-20261014.json)从 seed 独立推导每个 fault，再逐条比对全部实际 WAL 与 Session hash。拒绝后坏源仍在，未自动修复。72 个差异仅为可重建 Team/Channel checkpoint/summary，逐项记录。Participant 缺失用持久 Participant snapshots 的旧 ID 改名制造，保留失效的 activation references；generation fault 修改所有匹配的 hiring pins，不声称隔离验证代表 generation 2。Persona/generation 在 Native open 前拒绝，其余坏 owner 在 open 后、attach 前拒绝。

## 命令与结果

项目根设置 `TMPDIR="$PWD/.local/world-completion/tmp"`。以下 `BASE` 为项目内 `.local/world-completion/r02-canonical-restore`；矩阵每个实际子进程的 command/argv、PID、source/lib 路径由审计保存。source/lib 正常 seed 各 4 案，普通 fault 矩阵各 64 案，generation 各 4 案。

```sh
WORLD_COMPLETE_EVIDENCE_ROOT="$BASE/seeds-source" pnpm exec vitest run --config vitest.snapshot.config.ts examples/simulation-company/tests/complete-world.snapshot.ts -t 'company|laboratory'
WORLD_RESTORE_CONTRACT_SEEDS="$BASE/seeds-source" WORLD_RESTORE_CONTRACT_EVIDENCE_ROOT="$BASE/matrix-source-final" WORLD_RESTORE_CONTRACT_ONLY=none,hire-session-missing,rep-session-missing,hire-session-binding,rep-session-binding,hire-participant-missing,rep-participant-missing,hire-participant-descriptor,rep-participant-descriptor,hire-channel-endpoint,rep-channel-endpoint,hire-channel-missing,rep-channel-missing,hire-persona,rep-persona,receipt-envelope pnpm exec vitest run --config vitest.snapshot.config.ts examples/simulation-company/tests/world-restore-contract.snapshot.ts
WORLD_RESTORE_CONTRACT_SEEDS="$BASE/seeds-source" WORLD_RESTORE_CONTRACT_EVIDENCE_ROOT="$BASE/generation-source" WORLD_RESTORE_CONTRACT_ONLY=implementation-generation pnpm exec vitest run --config vitest.snapshot.config.ts examples/simulation-company/tests/world-restore-contract.snapshot.ts
pnpm exec vitest run packages/simulation/simulation-team/tests/world.spec.ts packages/simulation/simulation-team/tests/restore.spec.ts --maxWorkers=2
pnpm exec vitest run packages/simulation/simulation-world/tests/providers.spec.ts packages/simulation/simulation-product/tests/world-preparation.spec.ts packages/simulation/simulation-product/tests/world-administration.spec.ts --maxWorkers=2
pnpm exec vitest run --config vitest.snapshot.config.ts examples/simulation-company/tests/world-version-policy.snapshot.ts
CLOCKY_EXAMPLE_MODE=lib pnpm exec vitest run --config vitest.snapshot.config.ts examples/simulation-company/tests/world-version-policy.snapshot.ts
pnpm exec vitest run packages/sdk/client/tests/sdk-client.spec.ts -t 'wire payload validation'
PYTHONPATH="$PWD/python/sdk/src" PYTHONDONTWRITEBYTECODE=1 .local/world-completion/c29-public-v1/python-env/bin/python -m pytest python/sdk/tests/test_channel_view.py --basetemp "$BASE/python-wire-tmp" -o cache_dir="$BASE/pytest-cache"
pnpm exec tsc -b tsconfig.host.json
pnpm exec tsc -b tsconfig.client.json
pnpm run build
pnpm run doc-sync
PYTHONDONTWRITEBYTECODE=1 python3 "$BASE/audit.py"
```

前三条另以 `CLOCKY_EXAMPLE_MODE=lib`、`seeds-lib`、`matrix-lib`、`generation-lib` 执行。lib 子进程无 import/loader/require flag。新 snapshot 无 seeds 环境变量时自建真实 warm seed；Python mutator 为 test-only，接受 `PYTHON`。faulted media 独立 COW，只有不可变 baseline 共享硬链接。

日志均在 BASE：`world-focused-final.log` 336 通过；`adjacent-final.log` 227 通过；`matrix-source-final.log`/`matrix-lib.log` 各 64，`generation-source.log`/`generation-lib.log` 各 4。`version-source.log`/`version-lib.log` 各 2；原件根在 `version-roots.json`，当前 Native93 共 760 次旧/未来流 inspect/open 拒绝、8 次未知必需记录拒绝、模型 0。TS wire 82/Python wire 79 通过。Host/Client 类型、10 文件 scoped lint、最终完整 build 和 doc-sync 29/29 通过，build 记录 197 个 Client artifacts。

普通 lib fault 矩阵先于最后的初始化额度修正构建运行；R02 owner 校验代码一致。额度修正之后 `build-final.log` 完整构建、336 focused 回归与现版本 source/lib 策略通过。8 个 evidence bound、2 个 evidence round 回归分别在 `evidence-bounds-final.log`、`evidence-rounds-recheck.log` 通过，无阈值调整。

保留初轮失败：磁盘 ENOSPC 导致 source 初轮 33 通过/31 失败，全部 1079 份原件归档、逐份 SHA-256 验证后才移除展开副本；最终 source 64 全通过。完整归档及 manifest 在 BASE，独立审计再次验证。另有并发 build/seed 负载下 evidence round 超时，原日志保留，隔离运行原两测试通过；未增加 timeout。World fixture 补安装真正 execution factory plugin 及 test-only dev dependency，未用虚假 provider 替代。

4542 份 source/lib/config/SDK/Python 输入副本共 55,009,486 字节，manifest SHA-256 `77460bb5ee9910d4f92fe0838cb301ce712b16e0269e66540a4570fe0046979d`，位于 BASE `inputs/`、`inputs.json`，副本与最终 live bytes 一致；这是验证后的捕获，不是执行前或全发行冻结。所有中间文件、缓存、编译和测试产物保存在项目中。未发布、提交或新增 subagent；仅复用原只读审计 agent。本部分不替代 R03/R06、真实模型、SDK wheel、GUI 或完整 MVP 验收。
