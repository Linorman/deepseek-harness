# C41：三种可移植世界的连续领域流程

2026-10-13，Asia/Tokyo。Native80、v1 compiler6、Session0。原S13已完整验收并勾选，清单现为69/112：公司、实验室、协会共用真实Loader与driver，协会使用不同领域和事件组合。R05仍需非空义务交接，本报告不把空义务结算当成交接，也不宣布完整MVP完成。原112项范围和历史证据保持。

## 实现

生成录用、既有人物录用、调岗在实际assignment/result的同一Native业务记录中，经共享纯installer安装原岗位声明的Relation与operation grant。准备阶段不授权；禁止模型选择actor、岗位权限或替换已有人物。两种招聘在同一commit索引原已确认canonical私有director Channel，不分配第二通道。真实新成员能从自己的Agent/Session通过原Channel提出新事项；离职关闭原派生权限，重试不会恢复旧grant、重付费或重建身份。

委员会rule/quorum按当前actor精确生效的提案操作grant投影，来源绑定已应用bootstrap的sequence/hash；没有对应操作、scope/目标、关系或初始化时不返回材料。提案和招聘审批在真实context-view中保留它，Native独立校验原编写政策和成员。compiler根据external actor操作，或明确允许代表准备的mediation，安装所需`represents`规则；failure-only场景不声明该能力。compiler6拒绝旧5结果，Native80拒绝旧79日志，没有兼容默认或事后改写resolved。

公司/实验室定义声明CEO提案、两名独立委员投票、制度生效、HR申请及原单次招聘批准；新人在岗位日历触发时自主申请未展开供应商代表，原独立代表收取真实私有查询后回复；HR随后调岗并结束该新人物任职。原费用仅一次将cash10/payee0变为7/3，Person/Persona/binding保持。委员会结案调用原Native确定性owner，读取原接受票，不伪造表决或resolution。

协会使用原场景制度、absolute-threshold yes2/quorum2、明确同意的已有候选人录用及双岗位有限日历。两名原理事独立批准，volunteer-seat接收者在触发时选择实际入职candidate；另一个岗位询问未声明库存的模拟图书馆，仅允许failure。原resources为空且始终为空，没有创造书籍、资金、职员或第二雇主。这些领域和时序区别均保存在作者定义中，未在driver按场景名称分派。

三份JSON位于`examples/simulation-company/scenarios/world-{company,laboratory,association}-v1.json`。[公共流程](../../../../../examples/simulation-company/tests/complete-world.snapshot.ts)只提供运行与原件检查；[外部keyless模型](../../../../../examples/simulation-company/tests/fixtures/complete-world/model.ts)仅读取已记录模型输入，不持有Native、Team、storage或场景对象。控制器检查状态与receipt，不向模型注入隐藏回调对象。

## 正式输入与执行

[项目内正式矩阵](../../../../../.local/world-completion/c41-complete-world/final-matrix-20261013-stable)保存完整source/lib副本、每个原JSON/SQLite、Team/Channel/Session、模型输入与工具结果、进程stdout/stderr及两次冷恢复。5,409文件、60,514,853字节，SHA-256 `c330d6f61216a6c408bfc7f9d132778547b69576bbcebfa684f254babf199d4c`。正式source6通过（201.52s）、plainNode lib6通过（153.34s）；before/after-source/after-lib全相同，current与完整runtime副本逐文件相等。12案36不同生命周期PID，24cold均paused/0模型且state/journal/Session逐项相等。

[独立审计](c41-authored-world-root-audit.json)exit0：1764实际调用、8820真实Session assistant chunks、64materialized Session、260真实canonical posts、342原件逐文件hash。实际Session文件与captured events精确相等，三工具call/result与接受decision/context-view逐项对应；从真实JSON/SQLite Channel WAL重建sender/recipient、correlation、envelope、receipt及inbox/user消费。公司/实验室enacted Norm sequence392、hire commit876、transfer1216、depart1369；协会scenario Norm40、existing hire472，并保留实际threshold2独立票据。公司director私密fact未进入新人或代表的模型/Session/通知。

[12原库plainNode readonly Native](c41-authored-world-native-replay.json)实际parser/fold/projection观察owner=unowned，与原snapshot/journal完全相同，无writable restore。[source逐entry纯fold](c41-authored-world-prefix-replay.json)在每个原business commit之前/之后保存真实前缀，独立证明费用、ready/assignment/result、角色grant与私有Channel索引同一实际记录，随后原grant结束、原人binding/Persona保留；不把当前事后snapshot反推成虚构checkpoint或杀进程断点。

Source先导的6案已通过（`workflow-fourth.log`，210.70s），每案3不同进程。公司/实验室warm171实际LlmAdapter调用、57accepted决策、11World事项、revision1423/time18；协会99调用、33决策、6事项、revision808/time9。cold不调用模型、保持paused、原state/journal/Session完全一致。正式plainNode lib同时断言真实lib路径、execArgv=[]及无tsx/import/loader；不把脚本入口的TypeScript文件名当source执行的证据。

## 准确命令与检查

所有命令从项目根执行。短Node TMPDIR、Python cache、进程数据库、冻结副本及构建输出都在项目内。

```sh
TMPDIR="$PWD/.local/world-completion/tmp" pnpm exec vitest run packages/simulation/simulation-local/tests/world-bootstrap.spec.ts packages/simulation/simulation-local/tests/world-hiring-role-permissions.spec.ts packages/simulation/simulation-local/tests/world-hiring-resources.spec.ts packages/simulation/simulation-local/tests/world-hiring-resource-stale.spec.ts packages/simulation/simulation-scenario/tests/v1-resolution.spec.ts packages/simulation/simulation-scenario/tests/v1-director-events.spec.ts packages/simulation/simulation-scenario/tests/v1-hiring-fees.spec.ts packages/simulation/simulation-scenario/tests/v1-association.spec.ts
TMPDIR="$PWD/.local/world-completion/tmp" pnpm exec tsc -b tsconfig.host.json --pretty false
TMPDIR="$PWD/.local/world-completion/tmp" pnpm exec tsc -p tsconfig.host.json --noEmit --tsBuildInfoFile .local/world-completion/c41-complete-world/host-final.tsbuildinfo --pretty false
TMPDIR="$PWD/.local/world-completion/tmp" pnpm run build
TMPDIR="$PWD/.local/world-completion/tmp" pnpm run doc-sync
sh .local/world-completion/c41-complete-world/run-final.sh
TMPDIR="$PWD/.local/world-completion/tmp" node .local/world-completion/c41-complete-world/inspect-native.mjs .local/world-completion/c41-complete-world/audit-cases.json .local/world-completion/c41-complete-world/native-replay.json .local/world-completion/c41-complete-world/audit-native
TMPDIR="$PWD/.local/world-completion/tmp" C41_AUDIT_PREFIX=true node --import tsx/esm .local/world-completion/c41-complete-world/inspect-native.mjs .local/world-completion/c41-complete-world/audit-cases.json .local/world-completion/c41-complete-world/source-prefix-replay.json .local/world-completion/c41-complete-world/audit-prefix
PYTHONPYCACHEPREFIX="$PWD/.local/world-completion/c41-complete-world/pycache" /opt/homebrew/opt/python@3.14/bin/python3.14 .local/world-completion/c41-complete-world/audit.py .local/world-completion/c41-complete-world/final-matrix-20261013-stable
```

[C41目录](../../../../../.local/world-completion/c41-complete-world)保留日志。`current-regression.log`8files106 tests通过，包含费用/权限/时间stale、原hold、bootstrap政策权限、两种真实招聘后World/request、撤权与精确重试。`committee-context-first.log`12 tests通过，包含实际两后端初始化前/后、foreign actor、其它operation及真实关系替换不泄露policy；与106样本重叠，不相加。现有新角色owner六文件103通过、包级类型/lint/配对见[owner报告](../../../../../.local/world-completion/c41-complete-world/role-permissions/implementation-report-20261013.md)，同样有重叠；根随后只用稳定recipient变量修正arrow闭包的TypeScript narrowing，其运行行为未改变。

[协会纯编译报告](../../../../../.local/world-completion/c41-complete-world/association/proof-report-20261013.md)记录12项严格定义/引用/边界、JSON/安全YAML完整语义与hash往返。报告采集时compiler5断言后来由根同步为6，原快照/报告仍保留；当前106回归包含更改后的测试。不能以纯compiler结果替代真实S13运行。

Host aggregate emit/noEmit exit0；`build-final.log` exit0、197client artifacts；两轮root scoped lint及最后签名格式lint通过。`doc-sync-second.log`29 passed/0 failed/0 skipped，53.85s；首次失败的显式返回注解、Agent Note头部位置及README段落落在Model Experience字段内已修复，保持失败日志。两条implemented Note分别拥有原子岗位授权与场景能力/上下文决定。

审计reader的compiled PID52303与source prefix PID52416分别顺序读取12原库，不计入36生命周期PID。prefix reader显式`--import tsx/esm`，沿根`tsconfig.json` paths解析真正source；未设置或虚报`TSX_TSCONFIG_PATH`。lib包只bundle index而未导出journal leaf，初次直接leaf导入失败保留；改为独立plainNode完整inspect加source逐entry纯fold，不捏造lib leaf或将source prefix叫compiled执行。auditor程序与实际cases索引保存于正式目录的`proof-programs`。

## 失败和验收边界

首filter未匹配实际描述，6skipped不计通过。第二轮真实公司两后端到t10后拒绝新人缺世界私有Channel索引；第三轮到代表commit时揭示compiler缺`represents`，协会带说明文字的目标未被测试模型识别。修复分别属于真实owner/compiler或keyless认知适配，不放宽Native守卫、门槛或测试预算。第四轮6Source及首正式12Source/lib均通过；首正式输入 `e5405ac7…75f3bd`在运行中稳定，但末次lint发现一行超长1字符。原12案完整保留，签名仅换行修正后另建上述stable矩阵，以新的输入hash验收，不覆盖或假称旧原件当前完全相同。

本剧本调岗/离职使用真实Native与canonical Team held-cut，检查已结清责任后结束原assignment；未设置非空待交接承诺，R05继续部分。真实provider/model质量、hard费用预算、installed wheel/compiled SDK产品流程、完整浏览器及新收费SIGKILL仍待原对应items。协会原private belief保留在Native，但此driver没有将其选入模型/Session，不声称角色已经知晓。原完整goal保持active。
