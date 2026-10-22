# C39：Native 守恒资源预留和模拟到期

2026-10-13，Asia/Tokyo。Native78、v1 compiler4、Session0。原完整 MVP 目标继续有效；本次完成本地资源 owner 的预留/提交/取消/到期机制，尚未完成招聘费用及未知跨 owner IO 的资源接入。原 S10、O03–O05 保持未勾；没有新增 checklist items。

## 实现与权限

`simulation/src/resource.ts` 保存原交易/账户/数量 schema，避免 operation 与 scheduler 环形初始化；公开 export 保持原名字。新的严格 `SimulationResourceReservationId` 和 persisted reservation 固定原 actor、交易/read-set、一次性 grants、原创建 operation/sequence/time、SimTime expiry 和终态 settlement。Spec 必填正安全整数 `maxResourceReservationHistory`，Snapshot 必填 `resourceReservations`；无兼容默认。Native78 明确拒绝旧76/77及缺必需字段。

`simulation-local/src/resource-ledger.ts` 是立即转账和预留共享 owner。`resource/reserve` 不改余额，可用量扣除全部 active debit holds；新 ID 不能超订，过期但未真正消费 deadline 的责任仍计占用。同 ID/actor/原 body 返回原预留，包括终态；变 actor/body 拒绝。历史上限包含取消/到期/支付，绝不退款历史额度。

`resource/commit-reservation` 重验原账户版本、单位、控制者、一次性授权及 `time < expiresAt`，只排除自己的 hold；守恒转账、grant 消费和 settlement 同次提交。`resource/cancel-reservation` 只释放未结算 hold，不退款已支付金额、不恢复 revoked grant。active hold 锁定 grants，不能被第二 hold 或普通支付复用。原 interaction/task continuation 以及外部合同证据读取准确的已提交交易，不伪造 receipt。现有 company task policy 仍是其明确的立即库存转账策略，不声称新增预留认知行为。

`resource-reservation-expiry` 由原 applied reserve 自动产生，ID/sourceOperation/time/deadline-phase/revision 逐项匹配。实际消费原 deadline 同批记录 expired settlement；明确 commit/cancel 同批取消原事件。active expiry 禁止管理取消。模拟时刻恰等于 expiresAt 时，即使后续 deadline phase 尚未消费，也拒绝 commit。paused 真实 wall delay 不改变模拟时间或资金。

## 正式执行和独立核对

[项目内完整证据目录](../../../../../.local/world-completion/c39-resource-reservation/final-matrix-20261013) 保留每个原 Native JSON/SQLite、Team/Session、输入副本、模型请求、工具记录、process stdout/stderr 和新进程结果。正式输入在运行前复制，5,389 文件/60,178,463 字节；SHA-256 `f743679e30fa20278ff5139e219bd222d4f8f86029652c7a314d7e3d2d9e341a`。before/after-source/after-lib 全相等；root verifier 逐文件重算当前与完整 runtime-bytes 副本。

| face/backend | warm/两次 cold | 模型与决策 | 原目录 |
| --- | --- | --- | --- |
| source/JSON | 3独立进程 | warm27 calls/9 decisions；cold0 | `src/src-json-9o8Mm6` |
| source/SQLite | 3独立进程 | 同上 | `src/src-sqlite-Uv2cRv` |
| plain Node lib/JSON | 3独立进程 | 同上 | `lib/lib-json-o1FIOf` |
| plain Node lib/SQLite | 3独立进程 | 同上 | `lib/lib-sqlite-8gNhiK` |

共12不同 PID/8 cold，全恢复原 completed checkpoint，paused、state/journal/Session 全相等、零模型。lib 进程 execArgv=[]、无 tsx/import/loader，实际包路径为 lib；source 包路径实际 src。真实 Loader 经 v1 compiler、Team ceiling、原准备 checkpoint、明确 start、canonical Agent 执行；模型无 Native/Team/storage handle，只读已记录输入。每次真实 `simulation_observe`→`simulation_stage`→`simulation_submit`，Native 原 accepted actor/epoch/operation 保持；普通直接准备的决策无 Channel consumption 字段，未伪称消费 world 请求或消息。

每格顺序为：cash10/payee0；预留6不扣钱；新 ID 超订5和普通花5均拒绝；wall暂停无效；模拟1仍 active、2真正 expired；旧 commit 拒绝；新 hold 支付3一次；新 hold4取消；换新 ID 再预留因历史3已满拒绝。最终唯一 cash7/payee3、三原 hold 分别 expired/committed/cancelled。

[Root 审计](c39-resource-reservation-root-audit.json) exit0，80份 JSON 原件/25,536,344 字节准确 hash；直接读取原 Session header/binding 与326条真实 events，9 context-view 和 Native 原 source revision 完全相等，逐项核对两 backend 原 reserve/settlement/deadline、所有真实拒绝及所有冷进程。额外[plain Node Native readonly replay](c39-resource-reservation-native-replay.json) 从四个真实数据库走当前 Native parser/fold/projection，owner=unowned，revision167与冻结原件相同，无 writable open/restore/model。

## 准确命令与检查

全部从项目根执行；下列工具、cache、日志、freeze 与构建产物留在项目。SDK代理早期漏传TMPDIR及窄范围纠正保留在其报告，不能把那次执行说成全部项目内。

```sh
sh .local/world-completion/c39-resource-reservation/run-final.sh
TMPDIR="$PWD/.local/world-completion/tmp" node .local/world-completion/c39-resource-reservation/inspect-native.mjs .local/world-completion/c39-resource-reservation/final-matrix-20261013/cases.json .local/world-completion/c39-resource-reservation/final-matrix-20261013/native-replay.json
python3 .local/world-completion/c39-resource-reservation/audit.py .local/world-completion/c39-resource-reservation/final-matrix-20261013
TMPDIR="$PWD/.local/world-completion/tmp" pnpm exec vitest run packages/simulation/simulation-local/tests/resource-reservation.spec.ts packages/simulation/simulation-local/tests/world-external-mediated.spec.ts
TMPDIR="$PWD/.local/world-completion/tmp" pnpm exec tsc -p tsconfig.host.json --noEmit
TMPDIR="$PWD/.local/world-completion/tmp" pnpm run build
TMPDIR="$PWD/.local/world-completion/tmp" pnpm run doc-sync
```

脚本实际 source/lib snapshot 命令、proof 程序及三个输入 manifests 在正式目录保留。`atomic-owner.log` 两文件45 tests 通过（14预留+31外部裁决，不能再累计先前重叠样本）。实际 JSON/SQLite stream.append 注入 reserve/commit/cancel/expiry 下一次拒绝，各次完整 Snapshot 与 journal 不变；原 accepted operation/event 精确重试后只生效一次。另有严格等时刻、单位/控制/授权撤销、stale、原 expiry 来源拒绝；这是边界 fault injection，不称 SIGKILL。

正式矩阵之后独立增加 `resource-reservation-interaction.spec.ts`，4 tests通过、Host noEmit及scoped lint通过（`interaction-reservation.log`、`interaction-types.log`、`interaction-lint.log`）。真实interaction确认：reserve不制造履约证据；commit唯一原payment使承诺fulfilled，外部账户owner并非债权/债务双方时仍依据实际交易认定关联；原订单先取消则commit拒绝，余额/hold/承诺全部保持。新增测试源码单独在 `supplemental-inputs.json` 保存hash及完整副本，不冒充先前5389文件manifest的一部分；生产字节未改变。

本轮 `native-protocol-regression.log` 4文件57通过、`owner-regression-second.log` 4文件62通过，均有重复预留测试，不合并虚增总数。SDK/fixture 的 Node16、Python115、Native115、Host/Client noEmit 和67文件 scoped lint 见[代理准确报告](../../../../../.local/world-completion/c39-resource-reservation/sdk-fixtures/proof-report-20261013.md)。Python仅公开原通用只读DTO消费及quota，未虚构Native付款API或声称wheel发行。

`build-final.log` exit0，197 client artifacts；`host-final.log` exit0；25文件 `lint-fourth.log` 仅随后修正的测试property分隔符，`scenario-lint.log` exit0，其余24文件无诊断。文档首次工具目录过期、第二次生成的中文JSON代码块过期均保留；只同步同一生成schema代码块和pairing，未调用文档翻译 skill。最终 `doc-sync-third.log` exit0，29 passed/0 failed/0 skipped（43.94s）。

## 失败与验收边界

早期 loader ENOSPC、缺identity和section顺序错误全部保留；正式矩阵没有借用这些样本。项目内冻结字节去重只对完全相等的历史 runtime/input 副本建立硬链接，保留全部原路径/hash，未改原Session/数据库、source或旧证据内容。磁盘释放准确清单在 `frozen-dedup.json`，不把同时发生的其它容量变化算成本操作。

Root readonly verifier 初次误读 owner 字符串/目录路径，两轮拒绝记录保留；最终直接 inspect 实际 `simulation` 原库通过。Session verifier 初次未扣独立header，后一次错误以为view source在snapshotRevision之前；最终按原header/binding和恰同原snapshotRevision核对，未改生产、原Native/Session或测试结果。

招聘没有合法费用声明、冻结financial read-set与hold关联；generated preparing unknownIO的资金责任和清理尚未接入，hire-existing也未增加独立资源reserve。不能通过普通资源 expiry 自动释放未清理身份，或推进维护时钟。S10完整人事有效期以及O03/O04/O05需要下一步两招聘owner集成与危险断点证明；真实provider、完整GUI、三场景MVP与SDK发行未由本报告验收。
