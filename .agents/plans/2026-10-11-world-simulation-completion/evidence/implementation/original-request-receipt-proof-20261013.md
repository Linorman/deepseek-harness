# P05：原请求收据与业务幂等验收

2026-10-13，Asia/Tokyo。Native82；场景 compiler6、SQLite schema 和 Session format 不变。本记录补齐[此前收费重试缺口](paid-idempotency-partial-20261013.md)，验收原 P05；不新增 checklist items，不宣布完整 MVP 完成。

## 修复与验收范围

[Native owner](../../../../../packages/simulation/simulation-local/src/world.ts)在准备 `request` 上下文时，先区分尚未接受的 intent 与已有原请求。已有请求核对原 actor、intent/request/pin、载荷 hash 及原 operation，仅生成原 proposal 和收据状态，不再调用新业务的 eligibility/planning 投影。执行读集为空；只有原请求在该 context 的 baseRevision 前已经存在时才采用这种解释。普通获准事实/制度背景仍由原 actor 的读取策略选择。未接受事项继续核验当前授权、资格与执行读集。

提交仍需原 writer、实际消费上下文、原业务键和完全一致的载荷；改件、其他 actor、其他 intent 或不匹配 pin 无法借空读集执行新业务。既有 acceptance 展开和 settlement 复用原 request，不产生第二条通知或效果。Native stream 从81升为82，因为上下文准备在 replay 中重建；旧流直接拒绝，没有以新解释重放旧历史的 shim。字段形状和双 SDK 的既有 context-view 文本 envelope 不变。

[收费 owner 回归](../../../../../packages/simulation/simulation-local/tests/world-paid-idempotency.spec.ts)在 JSON/SQLite 分别使用 goal/request 两种实际三工具上下文：已有人员收费入职 10/0→4/6；重排原 command/mutation 的 JSON 字段返回原件；改变原载荷拒绝且不写；跨 decision 同 businessKey 保持唯一人物、任职、资金 hold、result 和通知。句柄重开后仍返回原 mutation/result。新增 foreign actor 读取拒绝、原 request hash 损坏拒绝、收据不得含 director rationale、原 sequence 和空读集检查。原 [World owner suite](../../../../../packages/simulation/simulation-team/tests/world.spec.ts)还覆盖 generated-hire 的相同/改变 decision、plan、取消命令、跨 decision、失去提交回复及 reopen；[产品命令 suite](../../../../../packages/simulation/simulation-product/tests/world-administration.spec.ts)覆盖原创建 commandId/payload、改件、catalog 变化及 paused 准备。

## 实际模型、分发 owner 和恢复

[会议室 Loader 流程](../../../../../examples/simulation-company/tests/world-booking.snapshot.ts)在一个独立测试领域验证通用行为，不增加主 driver 的剧情分支。真实模型 adapter 从原已记录收据提取 proposal，经 observe/stage/submit 重试；不会读取 owner 回调或拼造成功状态。该流程在公司、实验室 × JSON、SQLite × source、plainNode lib 共8案通过。16个独立PID分别执行 warm/cold，warm每案15次实际 keyless调用（含3次收据重试），cold全部0调用。两种 mode 均断言真实 package 解析路径，lib断言 execArgv 为空；测试 fixture 仍是由 Node 执行的 `.ts`，不把它冒称编译后的 fixture 文件。

每案只有一个 request/intent/plan/mutation/result、一个 booking relation，原两条通信不增加；重试决策只含一个去重请求 operation。实际 Session 中的 receipt context、模型输入和三工具参数对应同一个原 proposal；不含 director 的私有解释。新进程 checkpoint restore 恢复相同 receipt view 和 decision，保持 paused，不重新推理。

[正式矩阵](../../../../../.local/world-completion/thread-01a1336a-receipt/final-matrix)保存 5,742 份 source/lib/config/test 输入、62,963,568 字节，SHA-256 `8daeef20014bc9c26dcbb89afeb9138c4c581b26e75722d3ad86199493f487a1`。执行前后字节一致，doc-sync 后当前输入仍与副本逐文件相同。[独立审计](original-request-receipt-audit-20261013.json)核对全副本 hash、16 PID、实际 JSON/SQLite 原日志与导出的完整 journal 一致、82版 checkpoint、唯一效果、真实 Session 文件前缀及原工具 call 参数。40个主要原件的 hash 同时保留。原项目目录包含运行库、Session、模型输入、stdout/stderr 和命令，不含真实凭证。

## 精确命令与门禁

所有命令从项目根执行，TMPDIR、构建和测试输出均在项目内。

```sh
TMPDIR="$PWD/.local/world-completion/tmp" pnpm exec vitest run packages/simulation/simulation-local/tests/world-paid-idempotency.spec.ts packages/simulation/simulation-local/tests/run.spec.ts
TMPDIR="$PWD/.local/world-completion/tmp" pnpm exec vitest run packages/simulation/simulation-team/tests/world.spec.ts packages/simulation/simulation-product/tests/world-administration.spec.ts packages/simulation/simulation-local/tests/world-paid-idempotency.spec.ts packages/simulation/simulation-local/tests/run.spec.ts packages/simulation/simulation-local/tests/checkpoints.spec.ts
TMPDIR="$PWD/.local/world-completion/tmp" pnpm exec vitest run packages/simulation/simulation-product/tests/world-administration.spec.ts
TMPDIR="$PWD/.local/world-completion/tmp" pnpm exec tsc -b tsconfig.host.json --pretty false
TMPDIR="$PWD/.local/world-completion/tmp" pnpm exec tsc -p tsconfig.host.json --noEmit --tsBuildInfoFile .local/world-completion/thread-01a1336a-receipt/host.tsbuildinfo --pretty false
TMPDIR="$PWD/.local/world-completion/tmp" pnpm run build
sh .local/world-completion/thread-01a1336a-receipt/run-final.sh
PYTHONDONTWRITEBYTECODE=1 /opt/homebrew/opt/python@3.14/bin/python3.14 .local/world-completion/thread-01a1336a-receipt/audit.py
TMPDIR="$PWD/.local/world-completion/tmp" pnpm run doc-sync
```

[日志目录](../../../../../.local/world-completion/thread-01a1336a-receipt)保存全部历史及完整 scoped lint/配对命令。focused 29项通过。相关5文件244项首轮只有一个异步创建轮询在 accepted 状态超时，其余243项通过；原产品文件在相同阈值下单独复跑13项全通过，未改变业务断言或等待上限。首轮 fixture 类型错误为 string/Branded entity key、closure narrowing 和未解析 JSON，已修复，Host emit/noEmit、最终 lint 均 exit0。构建197 client artifacts通过；source矩阵4项33.47s，lib矩阵4项7.73s，root审计exit0。旧版本拒绝列表包含81，两个后端均通过对应run测试。

文档同步新Native版本，双语修复说明记录决策。原 C42 Note 的 Status 位置与 README Model Experience 段落改为规范结构，保留原正文并补充收据模型/token/KV影响。最终完整 doc-sync 29 passed/0 failed/0 skipped（44.92s）；此前失败日志不删除。只读审查确认新事项仍走准入、收据不暴露 director 计划、历史通过版本边界保护，无具体新缺陷；该审查没有代替执行测试。

## 完成判断

P05 的同 command/operation 原件重试、改件拒绝、跨 decision 同业务键效果唯一及当前已知旧 request 上下文缺口均有当前实现和上述证据，因此勾选 P05。P06 的每 actor/周期额度、P11 补证流程、SDK发行、完整GUI、真实provider与剩余故障矩阵仍归原未完成项，不以本次8案代替整体验收。早期“P05部分”证据作为历史保留，由本记录补齐其明确缺口。
