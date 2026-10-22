# C25：director-mediated 原始责任的断电与冷恢复证据

9 个危险边界 × JSON / SQLite × source / plain Node lib 共 36 格通过：36 个 create 进程到达真实持久化或 Channel 边界后收到 SIGKILL；72 个全新进程各自合法冷恢复，共 108 个不同 PID。两次 cold 全程 paused，均零模型调用。source 18 例用时 117.24 秒；lib 18 例用时 19.27 秒。

本轮仅新增 `world-external-mediated-fault.snapshot.ts`、`world-external-mediated-fault-scenario.ts`、`world-external-mediated-fault-model.ts` 和对应 Loader fixture；没有修改既有冻结 finite / actor fixture、production 或 checklist。barrier 挂在真实 Native LogStream.append / Team postChannelEnvelope 边界，等待 IPC 后由父测试进程发送 SIGKILL；没有用 mock 抛错替代断电。模型通过真实 Agent、simulation_observe / stage / submit、实际 recorded context 提议，Native 负责合法校验和发布。

| 边界 | SIGKILL 时原责任 | 原 create 模型调用 | 冷启原裁决 / leaf / canonical post |
| --- | --- | --- | --- |
| request-accepted-after | request 已接受，原私信 operation 保留，未发布 Channel | 3 | 0 / 无 / 0 |
| request-channel-before | 原 outbox in-flight，实际 Channel 发布前 | 3 | 0 / 无 / 0 |
| request-notification-lost | Channel 已接受，Native outbox receipt append 前 | 3 | 0 / 无 / 1 |
| plan-accepted-after | 原 director plan 已接受，尚无裁决 append | 6 | 0 / 无 / 1 |
| adjudication-before | 原 accepted plan 的裁决 batch append 前 | 6 | 0 / 无 / 1 |
| adjudication-after | 原裁决、initial result、finite leaf duty 同 batch 已提交 | 6 | 1 / scheduled / 1 |
| leaf-before | 原 finite leaf consumption batch append 前 | 12 | 1 / scheduled / 2 |
| leaf-after | 原 leaf、fact publication、director 通知 wake 同 batch 已提交 | 12 | 1 / consumed / 2 |
| delayed-notification-lost | 原 leaf 后续通知 Channel 已接受，Native receipt append 前 | 15 | 1 / consumed / 3 |

每格都保存 append 前的原始 entries、真正落盘的完整 journal prefix、inspect 重放状态、全部原始 Channel records、Session prefix、实际 model requests、初始合法 checkpoint 和 owner anchor。cold 保存实际 restoreManifest；独立证据验证器确认两次恢复的 manifest 完全等于原始 checkpoint manifest，anchor 和 owner 不变，没有伪造 checkpoint 或替换 epoch source。

两次 cold 逐字段对账 world、relations、resources、grants、commitments、interactions、decisions、operations、wakes、scheduledEvents 和 maintenance；Entity binding / Persona / readiness 保持不变，writer 由真实恢复释放。原 Native journal 和 Session prefix 精确保留，Channel records 精确一致。未提交或未消费的 accepted plan / finite leaf 继续 pending；未收到 Native receipt 的通知保留同一 in-flight outbox。cold 没有改成 running 去补执行，也没有重新推理、选择结果或创建替代 identity。

已提交裁决和 leaf consumption 的独立 journal 计数精确为 1，未提交侧为 0。consumed leaf 保留原 eventId、leafHash、deliverAt、policy fingerprint、adjudicationSequence 与真实 fact provenance.event / consumedSequence；原 canonical director wake 不丢失。两次冷恢复 suffix 没有新的 world-mutation、operation/intent 或 externalConsumption。恢复可关闭原有 window；这属于正常恢复清理，不等于新提议。

44 条实际 canonical post（按 36 格的独立原件计数）都对应真实 sender Participant、唯一接受信封和原 operation correlation。receipt 丢失两类边界，保存于未 append entries 的原 receipt envelopeId / sequence 与实际 Channel 信封完全一致，Native receipt 仍空；没有重新发送或替换该信封。已有 delivery receipt 的 post 在 recipient Session 中保留唯一规范消息，尚未 delivery 的消息仍未进入该 Session。director floor 与 rationale 两种私密 canary 都不出现在 requester Session、canonical Channel 信封或 result。

预算和权限沿用既有 finite mediated 场景：maxBytesPerPlan 固定 16384，maxDelay 固定 10，仅安装既有 conditions 与 lead-time future condition；禁 public / scope 披露，actorDisclosure 为空，requester-only 披露，没有提高既有 mediated 场景限制或扩大其 grant。lib 子进程没有 --import / tsx，execArgv 为空，运行包均解析到 `/lib/`。

输入库存包含 5,290 个 runtime source、built lib、package/config metadata、场景、presets 和当前 fixture 文件。`inputs-before.json`、`inputs-after-lib.json`、`inputs-after.json` 完全一致，聚合 SHA-256：`65b648c1303e8078e9a1310c7fa5f9652494b6e5017a4139db48486a429c2741`。最终 36 格保留 582 个原始产物，每个文件 SHA-256、108 PID、root、calls 和状态汇总见 `verified-matrix.json`；所有 Session JSONL、Native journal、JSON / SQLite Team / Channel 原件完整留在各格 root。

原始证据入口：`.local/world-completion/c25-mediated-fault/final-matrix-20261012/verified-matrix.json`，可执行独立验证器 `.local/world-completion/c25-mediated-fault/verify-evidence-20261012.py`。验证已 exit 0，`verify-final.log` 汇总 36 SIGKILL、72 cold、108 distinct PID、44 canonical post、582 原件。局部 fixture typecheck 和 lint 均 exit 0。

精确成功命令（cwd `/Volumes/projects-mac/deepseek-harness`，所有临时文件和编译产物均在项目）：

```sh
python3 .local/world-completion/c25-mediated-fault/freeze-inputs-20261012.py .local/world-completion/c25-mediated-fault/final-matrix-20261012/inputs-before.json
TMPDIR="$PWD/.local/world-completion/c25-mediated-fault/tmp" pnpm exec tsc -p .local/world-completion/c25-mediated-fault/tsconfig.json --noEmit > .local/world-completion/c25-mediated-fault/final-matrix-20261012/types.log 2>&1
TMPDIR="$PWD/.local/world-completion/c25-mediated-fault/tmp" pnpm exec tsx scripts/run-oxlint.ts examples/simulation-company/tests/world-external-mediated-fault.snapshot.ts examples/simulation-company/tests/world-external-mediated-fault-scenario.ts examples/simulation-company/tests/world-external-mediated-fault-model.ts > .local/world-completion/c25-mediated-fault/final-matrix-20261012/lint.log 2>&1
TMPDIR="$PWD/.local/world-completion/c25-mediated-fault/tmp" WORLD_MEDIATED_FAULT_EVIDENCE_ROOT="$PWD/.local/world-completion/c25-mediated-fault/final-matrix-20261012/src" CLOCKY_EXAMPLE_MODE=src CLOCKY_SNAPSHOT_MAX_CONCURRENCY=2 pnpm exec vitest run --config vitest.snapshot.config.ts examples/simulation-company/tests/world-external-mediated-fault.snapshot.ts > .local/world-completion/c25-mediated-fault/final-matrix-20261012/source.log 2>&1
TMPDIR="$PWD/.local/world-completion/c25-mediated-fault/tmp" WORLD_MEDIATED_FAULT_EVIDENCE_ROOT="$PWD/.local/world-completion/c25-mediated-fault/final-matrix-20261012/lib" CLOCKY_EXAMPLE_MODE=lib CLOCKY_SNAPSHOT_MAX_CONCURRENCY=2 pnpm exec vitest run --config vitest.snapshot.config.ts examples/simulation-company/tests/world-external-mediated-fault.snapshot.ts > .local/world-completion/c25-mediated-fault/final-matrix-20261012/lib.log 2>&1
python3 .local/world-completion/c25-mediated-fault/freeze-inputs-20261012.py .local/world-completion/c25-mediated-fault/final-matrix-20261012/inputs-after-lib.json
python3 .local/world-completion/c25-mediated-fault/freeze-inputs-20261012.py .local/world-completion/c25-mediated-fault/final-matrix-20261012/inputs-after.json
python3 .local/world-completion/c25-mediated-fault/verify-evidence-20261012.py > .local/world-completion/c25-mediated-fault/final-matrix-20261012/verify-final.log 2>&1
```

历史诊断留存于 `.local/world-completion/c25-mediated-fault/history-manifest-20261012.json`：550 个 pilot / partial 原件都有 hash 和路径。唯一 source pilot runtime 失败是初版 barrier 错把 externalEventId 当公开通知字段；公开通知实际保留 leaf 的安全投影，externalEventId 在持久 decision.context.world 中。失败源版本与该格 frozen-inputs 的 SHA-256 精确匹配 `82b346d9744fb079d8f15582210ea14b2e68fc7754667d08a976199f9ecb79aa`，原失败状态、原 Vitest stderr、draft 输入都保留。该 draft wrapper 在 barrier race 报错后没有写 process-0.json，manifest 明确注明，没有补造 PID 或声称该格触达 barrier。修正只涉及新 fixture 判定；两 backend 重跑成功，正式矩阵全部使用最终冻结版本。

早期 `.local/world-completion/c25-mediated-fault/matrix-20261012` 在修正最后一处样式诊断之前主动停测，精确进程树 / SIGKILL 和理由保留于 administrative-stop.json，所有 partial 原件保留且不计验收。独立验证器初版把正常恢复的 window/closed 也误判为新 business 提议，失败 verify.log 与 draft script 保留；最终版本仅拒绝新 operation/intent、mutation 和 consumption，已通过实际原件核验。未执行全库测试、doc-sync、发布或推送。
