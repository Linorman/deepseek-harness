# C23：director-mediated 独立 Actor 实际链路验证

company / laboratory × JSON / SQLite × source / plain Node lib 共 8 格通过。每格真实启动 create、cold 1、cold 2，合计 24 个不同 PID；每格模型调用为 `54 / 0 / 0`。source 4 例用时 69.96 秒，lib 4 例用时 22.92 秒。

本轮只修改 `world-external-mediated-actor.snapshot.ts`、`world-external-mediated-actor-scenario.ts`；模型和 Loader fixture 原有行为保留。本轮没有修改 production 或 checklist。旧 `source-second.log` 的 4 例真实失败由 production `commitExternalRepresentative()` 漏记 v3 first-action wake 导致；父 agent 已修复并完成 host lib build。本轮验证不替换旧失败日志或旧目录。

快照现在保留成功和失败目录中的 Native journal、JSON / SQLite Team 和 Channel 持久化、Session JSONL、原始模型输入、合同基线、进程日志和 proof。每个进程日志记录实际 command、args、PID、exit code、signal、timeout、stdout / stderr 和原始 root。每格 `frozen-inputs.json` 固定场景、fixture、model、基准配置和 catalog 输入 hash。

先通过实际 requester 与 custodian cognition 的 propose / accept、Native applied operation 建立非空合同。通过真实 director-mediated v3 world request → resolution → 独立 representative Persona、Entity、Session、Participant、represents relation 和 Channel；再由同一 caller 明确发起 v2 reuse。reuse 不增 Session、representative identity 或 Channel，不重写 original adjudication。第三个 v3 request 观察原 custodian 的非空 commitment-as-of，fact claim 精确匹配原合同 ID 与 phase。

create 和两次 cold 均校验原 debtor / creditor、resources / interactions / commitments 逐字段保持不变，原 requester / custodian Session prefix 保持不变。冷启还逐字段比对 external state、results、代表 Entity、represents relation、assignments、original subject、9 条 communication operation 及其 canonical Channel / Session proof。代表收到 2 条 canonical inquiry、产生 2 条普通 reply；每条 post sender 对应真实 Participant，accepted envelope、sequence 与 recipient 的唯一 Session user/message 均精确一致。

准备期 Entity / direct Team activation / queueDecision 被拒绝，未物化 Session，模型未调用。代表的 Session 和真实模型输入不含 requester 私密 buyer-floor、director 私密 rationale；外部 results 同样不泄露。original subject、representative、director 三类伪造 sender 请求均拒绝且 revision 不变。lib 子进程的 execArgv 为空、未使用 --import / tsx，三个运行包路径均解析到 `/lib/`。

全输入 inventory 固定 5,290 个文件（runtime source、built lib、package/config metadata、场景、presets、fixture），`inputs-before.json`、`inputs-after-source.json`、`inputs-after.json` 完全一致，聚合 SHA-256：`4acc317c0e3f7e9ef5236b35eae91a19b50bfd74ef9f437a1cd28eff58ab5809`。`verified-matrix.json` 逐文件记录 8 格原始产物 SHA-256 和原始目录。

| mode | scene | backend | model calls | PID (create / cold 1 / cold 2) | 原始目录 |
| --- | --- | --- | --- | --- | --- |
| src | company | json | 54 / 0 / 0 | 58546 / 58693 / 58737 | `.local/world-completion/c23-mediated-actor/matrix-20261012/src/loader-company-json-ZeFZaB` |
| src | company | sqlite | 54 / 0 / 0 | 58755 / 58897 / 59020 | `.local/world-completion/c23-mediated-actor/matrix-20261012/src/loader-company-sqlite-SgQegA` |
| src | laboratory | json | 54 / 0 / 0 | 59028 / 59242 / 59372 | `.local/world-completion/c23-mediated-actor/matrix-20261012/src/loader-laboratory-json-nWQg7F` |
| src | laboratory | sqlite | 54 / 0 / 0 | 59394 / 59531 / 59538 | `.local/world-completion/c23-mediated-actor/matrix-20261012/src/loader-laboratory-sqlite-vb42Ta` |
| lib | company | json | 54 / 0 / 0 | 60674 / 60699 / 60700 | `.local/world-completion/c23-mediated-actor/matrix-20261012/lib/loader-company-json-u7791p` |
| lib | company | sqlite | 54 / 0 / 0 | 60718 / 60828 / 60829 | `.local/world-completion/c23-mediated-actor/matrix-20261012/lib/loader-company-sqlite-4elWi1` |
| lib | laboratory | json | 54 / 0 / 0 | 60830 / 60859 / 60860 | `.local/world-completion/c23-mediated-actor/matrix-20261012/lib/loader-laboratory-json-SNw6zL` |
| lib | laboratory | sqlite | 54 / 0 / 0 | 60861 / 60974 / 60975 | `.local/world-completion/c23-mediated-actor/matrix-20261012/lib/loader-laboratory-sqlite-MK813B` |

精确命令（cwd 为 `/Volumes/projects-mac/deepseek-harness`；所有临时及编译产物位于项目 `.local/`）：

```sh
python3 .local/world-completion/c23-mediated-actor/freeze-inputs-20261012.py .local/world-completion/c23-mediated-actor/matrix-20261012/inputs-before.json
TMPDIR="$PWD/.local/world-completion/c23-mediated-actor/tmp" WORLD_MEDIATED_ACTOR_EVIDENCE_ROOT="$PWD/.local/world-completion/c23-mediated-actor/matrix-20261012/src" CLOCKY_EXAMPLE_MODE=src CLOCKY_SNAPSHOT_MAX_CONCURRENCY=1 pnpm exec vitest run --config vitest.snapshot.config.ts examples/simulation-company/tests/world-external-mediated-actor.snapshot.ts > .local/world-completion/c23-mediated-actor/matrix-20261012/source.log 2>&1
python3 .local/world-completion/c23-mediated-actor/freeze-inputs-20261012.py .local/world-completion/c23-mediated-actor/matrix-20261012/inputs-after-source.json
TMPDIR="$PWD/.local/world-completion/c23-mediated-actor/tmp" WORLD_MEDIATED_ACTOR_EVIDENCE_ROOT="$PWD/.local/world-completion/c23-mediated-actor/matrix-20261012/lib" CLOCKY_EXAMPLE_MODE=lib CLOCKY_SNAPSHOT_MAX_CONCURRENCY=1 pnpm exec vitest run --config vitest.snapshot.config.ts examples/simulation-company/tests/world-external-mediated-actor.snapshot.ts > .local/world-completion/c23-mediated-actor/matrix-20261012/lib.log 2>&1
TMPDIR="$PWD/.local/world-completion/c23-mediated-actor/tmp" pnpm exec tsc -p .local/world-completion/c23-mediated-actor/tsconfig-final-20261012.json --noEmit > .local/world-completion/c23-mediated-actor/matrix-20261012/types-final.log 2>&1
TMPDIR="$PWD/.local/world-completion/c23-mediated-actor/tmp" pnpm exec tsx scripts/run-oxlint.ts examples/simulation-company/tests/world-external-mediated-actor.snapshot.ts examples/simulation-company/tests/world-external-mediated-actor-scenario.ts examples/simulation-company/tests/world-external-mediated-actor-model.ts > .local/world-completion/c23-mediated-actor/matrix-20261012/lint.log 2>&1
python3 .local/world-completion/c23-mediated-actor/freeze-inputs-20261012.py .local/world-completion/c23-mediated-actor/matrix-20261012/inputs-after.json
```

上述两次矩阵、最终局部 typecheck 和 lint 均 exit 0。`types-final.log`、`lint.log` 为空代表命令无诊断；初次局部类型检查未包含 imported catalog fixtures.ts 的 TS6307 保留于 `types.log`，后已补齐文件输入，未改变源代码来避开检查。未执行项目全套测试、doc-sync 或 publication。

证据入口：`.local/world-completion/c23-mediated-actor/matrix-20261012/verified-matrix.json`。原始保留目录是上述 8 格目录，可直接审查日志数据库和 Session；root 之外的 convenience JSON copies 不承担原始持久化证据。
