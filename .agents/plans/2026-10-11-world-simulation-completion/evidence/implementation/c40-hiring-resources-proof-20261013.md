# C40：招聘岗位与一次性费用预留

2026-10-13，Asia/Tokyo。Native79、v1 compiler5、Session0。两种招聘操作接入同一守恒资源 owner，保留原 Person/Persona、岗位、账户、批准和跨日志准备责任。本报告与 C4/G10、C35 日历和 C39 本地资源证据共同完成现有 O03、O04、O05、S10，已勾选，清单为68/112；完整 MVP、真实 provider、发行与 GUI 验收继续依原 checklist 执行，没有新增 items。

## 实现合同

Core World 与 portable v1 的可选 `hiringFees` 声明固定 operation/position、原 money 账户、unit、正数量、精确一次性 grants 和正 SimTime 周期。省略表示免费；不填价格或付款默认值。未知原语、无效单位/账户/控制、重复规则、不支持的数量/期限在拥有者处拒绝。Bootstrap 在原声明已保留但账户尚未创建时核验同一原资源声明，并在真正创建后再次核验；没有虚构余额或跳过验证。

原招聘计划冻结 fee policy、账户、有效预留集及 grant-set 的 typed read-set。资金预留绑定真正 requester、原 accepted Decision/World resolve/plan、批准依据及实际 Native reserve sequence；窗口接受可能早于 operation settlement，不能伪造 applied transfer。generated 的身份/岗位/资金在同一个 reserve fact 固定；existing 保存原 Person 对应的资金和岗位承诺。占用计算覆盖从当前模拟时刻起的未来任职峰值，自己的 hold 仅在执行占用核算时排除，不刷新原交易版本。

支付复用资源账本控制权、单位、余额和 grant 校验，`available = balance − active debit holds`。原 assignment/generated ready、支付、World result、hold settlement 与派生 deadline 取消属于同一 Native append 批次。一次性 grant 以真实 World commit sequence 留下 `worldConsumption`，不会假装规划操作是付款操作。普通模型资源工具不能提交/取消 World owner 的 hold。

reserve/commit 重验原权限、制度/批准、岗位及金融读项。变化保留旧 proposal/read-set/hash 并明确 stale，不能改价、换人、换计划或偷偷重新报价。精确重试复用原件，包括终态；历史额度不会因取消/到期退款。模拟 expiry 由实际 reserve fact 所有，不把尚未结算的规划 operation 当 scheduler source。到期不扣钱；准备中的未知清理继续占用资金和身份。维护冻结模拟时间，不能用墙钟或强行 drive 制造清理确认。显式取消只在原 canonical Participant/Session/Channel 责任获确认后释放可释放的占用。

## 正式执行与原件核对

[权威矩阵](../../../../../.local/world-completion/c40-hire-resource-integration/final-matrix-20261013-stable) 包含运行前完整 source/lib 输入副本、原 JSON/SQLite、Team/Session/Channel、模型输入与工具记录、进程输出和两次新进程恢复。输入 5,398 文件、60,374,542 字节，SHA-256 `95a5fd3427b278765a0d6e7414b9ad146d2e67b85f7e5ce26179d074a436d78a`；before/after-source/after-lib 全相等。

Source/lib × JSON/SQLite × generate-and-hire/hire-existing 共 8 例。真实 Loader 经 v1 compiler、Team 限额、初始 checkpoint、显式 start、World driver、canonical Agent 和 observe/stage/submit 三工具执行。模型仅持有已记录输入，没有 Native/Team/storage handle。每例 warm 18 calls；最终唯一收费3，cash10/payee0变为cash7/payee3。已有人物保留原 Entity/cognition/profile/binding；新人保留已接受有限模板选择并在原独立 Session 首次行动。共24独立进程、16 cold；恢复 completed checkpoint 后 paused、零模型，原 state/journal/Session 保持。lib 使用实际 lib 路径、plain Node、execArgv=[]。

[Native readonly replay](c40-hiring-resources-native-replay.json) 从8个真实原库执行当前 parser/fold/projection，owner=unowned；generated revision186、existing178均等于原件，未 writable restore。[独立原件审计](c40-hiring-resources-root-audit.json) exit0，逐文件核验252原件、24条canonical posts、24份materialized Session以及每案6个accepted决策与18次实际模型调用。审计从真实JSON/SQLite Channel WAL和压缩Session文件重建原envelope、sender/recipient、correlation、delivery与实际消费；Native context-view和Session/模型输入精确一致，低权限人物输入没有director私密canary。generated reserve78/commit91/planning operation result97；existing reserve79/commit81/planning operation result85，未混淆来源sequence。当前和完整runtime副本逐字节同三份manifest。

## 验证命令与结果

项目内 [C40 目录](../../../../../.local/world-completion/c40-hire-resource-integration) 保留所有日志。命令从项目根执行；Node 临时文件、Python cache、输入副本及构建输出均在项目内。

```sh
sh .local/world-completion/c40-hire-resource-integration/run-final.sh
TMPDIR="$PWD/.local/world-completion/tmp" node .local/world-completion/c40-hire-resource-integration/inspect-native.mjs .local/world-completion/c40-hire-resource-integration/final-matrix-20261013-stable/cases.json .local/world-completion/c40-hire-resource-integration/final-matrix-20261013-stable/native-replay.json
TMPDIR="$PWD/.local/world-completion/c40-hire-resource-integration/tmp" PYTHONPYCACHEPREFIX="$PWD/.local/world-completion/c40-hire-resource-integration/pycache" /opt/homebrew/opt/python@3.14/bin/python3.14 .local/world-completion/c40-hire-resource-integration/audit.py .local/world-completion/c40-hire-resource-integration/final-matrix-20261013-stable
TMPDIR="$PWD/.local/world-completion/tmp" pnpm exec vitest run packages/simulation/simulation-local/tests/world-hiring-resources.spec.ts packages/simulation/simulation-local/tests/resource-reservation.spec.ts packages/simulation/simulation-local/tests/resource-reservation-interaction.spec.ts packages/simulation/simulation-local/tests/world-hire-existing.spec.ts packages/simulation/simulation-local/tests/world-hire-approval.spec.ts packages/simulation/simulation-scenario/tests/v1-hiring-fees.spec.ts packages/simulation/simulation-local/tests/run.spec.ts
TMPDIR="$PWD/.local/world-completion/tmp" pnpm exec vitest run packages/simulation/simulation-local/tests/world-hiring-resource-stale.spec.ts
TMPDIR="$PWD/.local/world-completion/tmp" pnpm exec tsc -p tsconfig.host.json --noEmit --tsBuildInfoFile .local/world-completion/c40-hire-resource-integration/host-current.tsbuildinfo --pretty false
TMPDIR="$PWD/.local/world-completion/tmp" pnpm run build
TMPDIR="$PWD/.local/world-completion/tmp" pnpm run doc-sync
```

正式 source4/lib4通过（49.16s/10.89s）。当前七文件118 tests通过（`current-owner-regression.log`）；其中 Native28实际 owner tests检查原预留、两种支付、旧身份、可用量、普通工具越权、一次性 grant/撤销、期限/历史、真实 append 拒绝与 preparing Session 清理未知。原 append 拒绝前后 Snapshot/journal不变，原件重试只生效一次；这不是 SIGKILL 证明。审批测试检查冻结依据、新增/变更/撤销 Norm 拒绝，并复用 G10 的真实制度批准链。

独立补测16通过（`stale-supplement-final.log`）：两 backend × 两 owner 的真实资金、can-hire、未来 assignment 变化使原 plan stale，原 hold 保持；future occupied+reserved达到2，新增第三占用拒绝且 Snapshot不变。两 owner 均实际消费 SimTime2原 deadline，余额不变；未 IO 新人无法从到期原预留准备。该测试在正式矩阵后新增，完整源码单独保存于 `supplemental-bytes` 与 `supplemental-inputs.json`，集合 hash `74e6c7c89ac39781a642bf01f2b4bec9312a57346969c560d2b9e359de131f71`，不冒充5398输入之一；生产字节未改变。Host当前noEmit、44文件 scoped lint及补测lint均exit0。

[SDK报告](../../../../../.local/world-completion/c40-hire-resource-integration/sdk/proof-report-20261013.md) 保存15个 owned文件hash、准确命令及各轮重叠关系。最终 Node3files79、Python35通过，Host/Client noEmit通过；作者 fee保留wire `from`、省略不填默认，三个固定资源停止分类同步严格 parser。没有新增SDK Native付款API、私有compiler DTO或wheel证明。UI新增三个停止原因的中英文展示，组件测试77通过（`status-labels.log`）；不声称真实浏览器流程。

`build-second.log` exit0，197 client artifacts；`doc-sync-second.log` exit0，29 passed/0 failed/0 skipped（45.04s）。最初长项目TMPDIR触发tsx IPC EINVAL，使用项目内短TMPDIR重跑；文档首次目录生成/中文schema代码块过期修复后通过，原失败日志保留。首正式矩阵执行时文档生成改动两个 tool-cordis lib文件，虽8运行通过却未通过输入稳定性验收；保留在 `final-matrix-20261013`，另建上述 stable矩阵，未覆盖或冒充冻结原件。早期 Loader暴露的账户准备顺序、窗口计划先接受、deadline来源问题已按实际所有者修复；所有失败样本保留。

独立审计使用实际Python3.14.6的`compression.zstd`读取原Session，运行路径记录于`audit-python-runtime.json`。前三次审计分别误用其它领域的result接收者、将持久decision触发消息误当展开后的模型context消息、忽略模型context的source投影；按真实通用招聘/Session/模型转换合同纠正审计假设后通过，保留`audit-first.log`、`audit-second.log`、`audit-third.log`。没有修改生产、Native/Channel/Session原件或放宽验收。

## 尚未验收

收费路径新增的危险 SIGKILL 矩阵、完整跨领域剧本、三个场景、真实模型硬预算、installed wheel/compiled SDK公共产品流程及浏览器仍由原未完成项验收。Premium静态审计仍有5条既有表单/控件 findings（`premium-audit.json`），没有改规则或假称全UI通过。S10的组合证据只证明当前已安装事件与持久预留；不承诺未安装的任意租约、付款、网络或后台任务语义。完整目标继续 active，不能以本部分完成宣布 MVP。
