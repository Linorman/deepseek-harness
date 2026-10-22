# C37 S11 场景主动环境请求验收

2026-10-13；原 S11，不新增 items。Native stream 77、v1 compiler 4。输入 hash `595dd09c7afa14e5a354f2f996c6925da92751c09dab58f924b4811d120d19e9`，5354 源码/配置/实际 JS 输入均保存完整字节副本；source、lib 前后 hash 相等。该输入是本次运行的冻结字节，不以 Git HEAD 代表 dirty 工作区，也不覆盖 C33/C34 的历史 compiler3/Native76 证据。

## 实现和验收范围

已安装领域显式声明 `directorEvents` 能力，纯 compiler 和 Host 都检查原有限日历、根作用域、目标、selector 及独立正整数 `maxRequests`。Native 每次实际 occurrence 保存 eligible 或 budget-exhausted；原场景与 consumed calendar 派生 trigger、business key 和真实 Director wake。接受的 request/intent 保留实际 Decision、epoch、canonical binding 和 trigger，未预建请求。每次 occurrence 只准入一个 business identity；改变 ID/key 不产生额外场景权限，拒绝或取消不返还历史计费。

场景 case 使用 `notificationOperationId:null` 和同次 acceptance 保存的 Native 规划 wake；实际 Director 经 observe/stage/submit 消费独立 director-event、scenario-resolve、scenario-result 视图，没有发给自己的 Channel/Envelope。裁决来源与延迟 leaf 都核对原 trigger；场景环境请求拒绝代表准备/自发会话，普通 requester 的代表能力保持原语义。普通 case 保留原真实通知、Channel 与收件消费证明。共享 Native queue 全部以实际等待顺序准入，未提高全局额度。

rule/v1 与 director-mediated/v3 两种真实 Agent 方式 × JSON/SQLite × source/plain Node lib 共 8 案、24 独立 PID。每案 3 轮普通事项按轮完成，director 两轮后第三 occurrence 记录额度耗尽、不排第三 wake。每个单次 Native drive allowance 为 1；rule 共 66 有界批次、18 独立决策/54 模型调用；mediated 共 84 批次、24 决策/72 模型调用。每个原决策均三工具。裁决场景保留真实 delayed leaf 及后续空动作结果观察；不同条件区间不重叠，普通环境询问保留 typed failure 回应。原库存始终7，无人物/资产展开。每案随后两次新进程 checkpoint restore 均 paused、零模型调用，Native/Team/Channel/Session/原 journal 相等，共16冷进程。

原公共 Session 中的 context-view 与 Native view 完全相等；每项场景 request 的 bootstrap/occurrence run-event 引用、Actor binding/epoch、消费记录、单项 request operation、原 plan/result 均独立复核。两个 completed checkpoint manifest 的真实 Native stream version 都为77。原件104份/130421168字节的 hash 见 [root audit](c37-director-events-root-audit.json)；不是用 stdout 成功标签代替 Native 或 Session。

## 准确命令与产物

从项目根执行：

```sh
sh .local/world-completion/c37-director-events/proof-programs/run.sh
TMPDIR="$PWD/.local/world-completion/tmp" pnpm exec vitest run packages/simulation/simulation-local/tests/world-bootstrap.spec.ts packages/simulation/simulation-scenario/tests/v1-director-events.spec.ts packages/simulation/simulation-local/tests/world-external-mediated.spec.ts packages/simulation/simulation-local/tests/world-execution-time.spec.ts packages/simulation/simulation-scenario/tests/v1-resolution.spec.ts
TMPDIR="$PWD/.local/world-completion/tmp" pnpm exec vitest run packages/simulation/simulation-team/tests/world.spec.ts
TMPDIR="$PWD/.local/world-completion/tmp" pnpm run build
TMPDIR="$PWD/.local/world-completion/tmp" pnpm run doc-sync
python3 .local/world-completion/c37-director-events/final-matrix-20261013/proof-programs/audit.py .local/world-completion/c37-director-events/final-matrix-20261013
```

矩阵脚本本身保存 source/lib 的完整准确命令及输入程序副本。[source4](../../../../../.local/world-completion/c37-director-events/final-matrix-20261013/source.log)、[lib4](../../../../../.local/world-completion/c37-director-events/final-matrix-20261013/lib.log)、[冻结前后](../../../../../.local/world-completion/c37-director-events/final-matrix-20261013/freeze.log)、[独立审计](../../../../../.local/world-completion/c37-director-events/final-matrix-20261013/audit-final.log)、[完整 runtime 副本](../../../../../.local/world-completion/c37-director-events/final-matrix-20261013/runtime-bytes)分别保存实际证据。

拒绝测试覆盖未选择支持的 domain、遗漏/非法/超 occurrence 独立额度、坏 calendar/scope/target/version、重复 declaration、任意 capability metadata、修改/复制 wake、父 calendar 未消费、改变原 actor/phase/time/reason/trigger、没有场景权限的 director、普通角色冒充原 trigger、变更 business key 或 payload，以及代表准备不适用于场景环境请求。[五文件72 pass](../../../../../.local/world-completion/c37-director-events/root-tests/unit-final-second.log)与[旧 Team 世界168 pass](../../../../../.local/world-completion/c37-director-events/root-tests/team-world-third.log)独立记录；其它旧 target fixture188 的结果另见 C35 intent-target-fixtures 报告，不重复累计。联合[build-fifth](../../../../../.local/world-completion/c37-director-events/root-tests/build-fifth.log)成功197 client artifacts，Host/Client aggregate types 随 build 通过；[doc-sync-second](../../../../../.local/world-completion/c37-director-events/root-tests/doc-sync-second.log)29/29通过；scoped lint 日志保留在同一 root-tests。

## 保留失败与验收边界

所有 pilot、失败 native/browser/build/test 日志完整保留。修复包括环境裁决来源仍只接受旧 resolve、delayed leaf 忽略原场景权限、旧 rejected-result wake 没有向 fold 传原 runtime、浏览器 DTO 误用根 value import，以及新的 schema import 循环。对账程序前两次失败分别为读取 Session `kind` 而实际为 `type`、使用相对 root 生成绝对归属；保留原程序与失败日志，修正后完整审计成功。未改变 Native 业务拒绝、跳过字段检查或放宽全局预算。

v3 新测试部署在 compile 前明确指定16384 plan字节，沿用此前真实 v3 夹具的声明；v1仍用原默认。没有修改产品默认、已接受运行的额度，或通过增额掩盖拒绝。没有声称真实付费 provider、SIGKILL 矩阵、完整浏览器剧本或整个 MVP 完成。S10 的 reservation 模拟到期仍待生产支持；C35 已验证其它时间行为，不能用墙钟 lease 充数。S11验收只覆盖本条定义的场景权限/触发源/普通有限服务，R06及其余未完成项仍保持原状态。
