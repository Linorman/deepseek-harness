# C26：v3 director-mediated ActualActor 准备、取消与断电恢复

13 个危险边界 × JSON / SQLite × source / plain Node lib，共 52 格全部通过。52 个 create 进程到达真实 Native / canonical IO barrier 后收到 SIGKILL，104 个新 PID 冷恢复全程 paused、零模型调用，共 156 个不同 PID。source 26 例用时 154.71 秒；lib 26 例用时 34.01 秒。

本轮只新增 `world-external-mediated-actor-fault.snapshot.ts`、`world-external-mediated-actor-fault-scenario.ts`、`world-external-mediated-actor-fault-model.ts` 和对应 Loader fixture，没有修改既有冻结 C23 / C25 / finite / actor fixture、production 或 checklist。source 同样由真实 C23 模型流程先建原 requester / custodian 非空合同，再经 v3 director-mediated request、actual recorded Agent context、接受的 Persona plan 和 Native owner 准备独立 Actor；新 fixture 使用独立明确的 provider / module 名称。

| barrier | SIGKILL prefix 中 reservation | cold 2 原责任对账后 |
| --- | --- | --- |
| reserved-after | 原 Persona / adjudication / identities 已保存，reserved | 同一 allocation committed |
| participant-unconfirmed | actual Participant 已接受，Native binding append 前，preparing | 同一 binding / Session / Participant committed |
| participant-bound-after | Native binding append 后，preparing | 同一 binding committed |
| director-channel-unconfirmed | actual canonical Channel 已创建，Native confirm 前 | 同一 Channel committed |
| commit-before | v3 commit 完整 batch append 前 | 同一 original Persona / adjudication committed |
| commit-after | v3 commit、ActualActor、ready / represents / result / 双 wake 已提交 | 原提交保持，maintenance 完成 |
| notification-lost | director 实际通知 Channel 已接受，Native receipt append 前 | 原 Actor / 通知 in-flight 保留，不重发 |
| cancel-participant-unconfirmed | actual Participant 已接受但 binding 未确认，取消先赢 | 同一身份 cleanup / abandoned |
| cancel-before-commit | Participant / Channel 已准备，取消先于 commit | 同一身份 cleanup / abandoned |
| commit-wins-cancel | commit 先赢，取消 recorded 为 already-committed | ActualActor 与原提交保持 |
| cancel-abandon-before | actual terminal cleanup IO 完成，Native abandoned append 前 | 原 cleanup / cancelled result 提交 |
| cancel-abandon-after | 原 abandoned / cancelled result append 后 | 原取消结果不重复，maintenance 完成 |
| cancel-close-receipt-lost | 原 Channel 实际 close 已接受，receipt 未返回；cancel-requested | 读取原 canonical closed 证据，再完成同一 cleanup |

每个 barrier 都保存真正持久 journal prefix、inspect 重放 snapshot、原 append entries / IO witness、真实 canonical Team / Channel / Session 数据、原 Persona model requests、原 owner anchor 及当前最新合法 completed checkpoint manifest。不是 mock 抛错式断电。`cancel-close-receipt-lost` 直接停在实际 close receipt 返回 Native cleanup owner之前，原取消责任没有被当成 absence 或已经 settled；没有注入假的 read/close failure。

cold 1 仅核对原 prefix，pending preparing / cancellation / in-flight 通知保持原状。cold 2 只调用原 adapter 的 `driver.reconcile()`，使用已保存的同一 reservation、Persona、adjudication、identities、owner 和 cleanup；不恢复 running，不调用 productive 模型，不替 Actor 执行 first action。已完全完成 maintenance 的 notification-lost case 正确返回 idle 且 revision 不变；真实 pending maintenance 原责任完成后再调用 reconcile 也 idle 且 revision 不变。commit / cancellation settlement 的精确重试不增加 revision。

独立核验确认 v3 pin、director-mediated identity representation 和原 accepted plan；committed ActualActor 的 identityId / generation / entityId / relationId / requesterEntityId / contactUnit / requester Channel 均精确映射原 reservation，committedSequence 与真实 result sequence 相同。独立 person ready、独立 Session binding、真实 active local-agent Participant、represents relation 与 actual result 投影都保持一致。每个 committed case 恰有一次真实 external/committed journal 记录，原 first-action wake 对 requester，原 result wake 对 director，均保留。v2 旧案例没有被算作该 ActualActor 折叠证据。

取消先赢后，原 Persona 与 IDs 不变，实体 abandoned / terminated，真实 Participant terminal，Session unmaterialized，没有 represents / contacts / adjudications 的实际 Actor 效果，也没有 first-action wake。恰有一次 external/abandoned，cancelled result 来自原 cancel command，cleanup.sequence 与 result.sequence 相同，原 director result wake 保留。commit 先赢的 cancelled command 保持 already-committed，原 actualActor、ready、result、represents 和双 wake 不撤销。

所有 case 的原非空合同、interaction、resources、debtor / creditor、assignment 和原 external subject 逐字段保持不变；原 requester / custodian Session prefix 完整保留。真实 Channel / Session 原 prefix 都保存。60 条 canonical post（按各格独立原件计）对应真实 sender Participant、唯一 accepted Envelope 和 canonical recipient input。已 delivery 的消息精确保留唯一 Agent inbox/spliced 输入；若 productive turn 已消费，也验证唯一 user/message surface。通知丢失时某个独立 Actor 输入已送达 inbox 而尚未成为 productive surface，cold 不运行模型制造 surface。原 director notification 的 Channel envelopeId / sequence 与未 append Native receipt 完全相同，outbox 仍 in-flight，不替换或重发。代表 Session / Inbox 和 model-visible result 不含 buyer-floor、director-rationale 两种私密 canary。

真实 restoreManifest 精确等于 barrier 保存的最新合法 completed manifest，anchor 和 original owner 不变；没有伪造 checkpoint 或绕过 fingerprint。C26 使用原 C23 的 16384 plan-byte allowance、原 policy / grants / 模板与运行预算，没有提高 limits 或扩大权限。lib 子进程无 --import / tsx，execArgv 为空，运行包均解析 `/lib/`。

输入库存 5,290 文件，before / after-lib / after 完全一致，聚合 SHA-256：`cac7dedce37cc849033d0e2018323a03335b7bfdee13b9b282afe585c2959b42`。最终 52 格完整保留 1166 个原始文件，包括 Native journal、JSON / SQLite Team / Channel 数据库、Session JSONL、合同基线、model requests、actual manifest、IPC barrier 与精确 command / args / PID / exit / signal / stdout / stderr。路径和逐文件 hash、156 PID、原/最终状态、model counts 都在 `verified-matrix.json`。

原件入口：`.local/world-completion/c26-mediated-actor-fault/matrix-20261013/verified-matrix.json`。独立验证器 `.local/world-completion/c26-mediated-actor-fault/verify-evidence-20261013.py` 已 exit 0；`verify.log` 核验 52 SIGKILL、104 cold、156 distinct PID、60 canonical post、1166 原件。局部类型检查和 lint 均 exit 0。

精确成功命令（cwd `/Volumes/projects-mac/deepseek-harness`；TMPDIR、编译缓存和所有中间产物均在项目）：

```sh
TMPDIR="$PWD/.local/world-completion/c26-mediated-actor-fault" node --import tsx/esm scripts/run-oxlint.ts examples/simulation-company/tests/world-external-mediated-actor-fault.snapshot.ts examples/simulation-company/tests/world-external-mediated-actor-fault-scenario.ts examples/simulation-company/tests/world-external-mediated-actor-fault-model.ts > .local/world-completion/c26-mediated-actor-fault/matrix-20261013/lint.log 2>&1
TMPDIR="$PWD/.local/world-completion/c26-mediated-actor-fault" pnpm exec tsc -p .local/world-completion/c26-mediated-actor-fault/tsconfig.json --noEmit > .local/world-completion/c26-mediated-actor-fault/matrix-20261013/types.log 2>&1
python3 .local/world-completion/c26-mediated-actor-fault/freeze-inputs-20261013.py .local/world-completion/c26-mediated-actor-fault/matrix-20261013/inputs-before.json
TMPDIR="$PWD/.local/world-completion/c26-mediated-actor-fault" WORLD_MEDIATED_ACTOR_FAULT_EVIDENCE_ROOT="$PWD/.local/world-completion/c26-mediated-actor-fault/matrix-20261013/src" CLOCKY_EXAMPLE_MODE=src CLOCKY_SNAPSHOT_MAX_CONCURRENCY=2 pnpm exec vitest run --config vitest.snapshot.config.ts examples/simulation-company/tests/world-external-mediated-actor-fault.snapshot.ts > .local/world-completion/c26-mediated-actor-fault/matrix-20261013/source.log 2>&1
TMPDIR="$PWD/.local/world-completion/c26-mediated-actor-fault" WORLD_MEDIATED_ACTOR_FAULT_EVIDENCE_ROOT="$PWD/.local/world-completion/c26-mediated-actor-fault/matrix-20261013/lib" CLOCKY_EXAMPLE_MODE=lib CLOCKY_SNAPSHOT_MAX_CONCURRENCY=2 pnpm exec vitest run --config vitest.snapshot.config.ts examples/simulation-company/tests/world-external-mediated-actor-fault.snapshot.ts > .local/world-completion/c26-mediated-actor-fault/matrix-20261013/lib.log 2>&1
python3 .local/world-completion/c26-mediated-actor-fault/freeze-inputs-20261013.py .local/world-completion/c26-mediated-actor-fault/matrix-20261013/inputs-after-lib.json
python3 .local/world-completion/c26-mediated-actor-fault/freeze-inputs-20261013.py .local/world-completion/c26-mediated-actor-fault/matrix-20261013/inputs-after.json
python3 .local/world-completion/c26-mediated-actor-fault/verify-evidence-20261013.py > .local/world-completion/c26-mediated-actor-fault/matrix-20261013/verify.log 2>&1
```

历史原件未覆盖或删除：`.local/world-completion/c26-mediated-actor-fault/history-manifest-20261013.json` 保存 729 个 pilot / diagnostic 原件和逐文件 hash，6 个 source failed-pilot 均精确匹配保存的失败版本 source hash，保留真实进程日志。初版 evidence collector 误序列化 runtime-only close authority token、误要求尚未productive turn的已送达 inbox必有user/message，以及误要求已无pending responsibility的reconcile必须返回paused；修正均限新 fixture。当前生产行为符合原合同，未作 production workaround。两次初始 tsx CLI lint 遇 macOS UNIX socket path EINVAL；使用同 lint 脚本的 node --import tsx/esm 入口后成功，未提升权限或外写临时文件。未运行全套测试、doc-sync、发布或推送。
