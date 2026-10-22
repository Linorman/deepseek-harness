# C36 场景事件 SDK、作者字段与真实案件浏览器证据

2026-10-13，Asia/Tokyo；cwd `/Volumes/projects-mac/deepseek-harness`。Node/Python SDK 严格保留场景事件的独立请求预算和必填 nullable 通知；作者台编辑同一 v1 草稿后，通过真实 Host 预检与一次暂停原创建。最终 normal/pause-race × JSON/SQLite 四个浏览器用例全部通过，实际控制状态为 paused 且没有 driver failure；固定竞争点同时证明原 wake、队列项保留与暂停后不新增推理。公共案件详情显示真实领域、操作、目标、非招聘计划和没有 Channel 通知的事实。第三轮及第7轮暴露的真实 revision 竞争和后续修复证据均保留，未把当时的目标案件成功写成健康调度。

## 实现范围

`WorldV1DirectorEvent.maxRequests` 必填，Node 与 Python 拒绝遗漏、null、bool、非正整数、浮点、字符串和超过安全整数的值；声明不能注入 trigger、调用者身份或私有 catalog capability。与有限日历 occurrence 的关系、已安装领域 opt-in、原 trigger 和 Actor 权限由 Host/Native 检查，SDK 不伪造授权。UI 的“事件请求上限 / Event request limit”独立于原 `limits.world.maxRequests`；表单编辑、源码和原创建保持其余字段完整，错误输入仍留在草稿并定位到该单元格。[协议测试](../../../../../packages/sdk/protocol/tests/simulation-director-events.spec.ts)、[Python 测试](../../../../../python/sdk/tests/test_director_events.py)和[真实作者组件](../../../../../packages/client/ui-simulation/tests/world-v1-author.client.spec.tsx)分别覆盖这些拒绝和保留路径。

公共案件 summary 使用必填 `apiVersion: clocky.world-case/v1`、domain/operation/version 和 `targetEntityId`，后者直接来自原 intent，旧 position 字段或旧 summary 拒绝。只有确切 `organization.generate-and-hire/v1` 的 apply 计划解析 Persona；其它领域不解析招聘 payload，也不能附加招聘 reservation。招聘专项的原 payload、人物、任职、计划关系校验继续保留。`notification.request` 必填 `CasePost | null`，null 明确没有 Channel post；Python 的 optional-field wire dump 也保留必填 request、predecessor 和 JSON payload 的 null。[产品 parser](../../../../../packages/simulation/simulation-product/src/case-schema.ts)、[Python 公共模型](../../../../../python/sdk/src/clocky/simulation_world_cases.py)及两 SDK consumer 的相关测试共同验证新格式、旧格式拒绝和 nullable 行为。

[共享 context corpus](../../../../../packages/sdk/protocol/tests/fixtures/simulation-director-context-cases.json)通过 Node/Python 真实 Session envelope parser：director-event、scenario-resolve、scenario-result 只是实际 `simulation/context-view` 中的业务文本，来源为实际 run-event；延迟 scenario-result 文本保留 optional externalEventId。该 corpus 检查跨 run、未来 sequence、重复 source、虚构 Channel/业务 source 等拒绝，不是新增 Python Native 业务 context parser。实际 WorldRequest source 仍为 `decision` 加原 trigger。私有 `catalog.domains.directorEvents` 未暴露进公共 preview DTO。

WorldCases 对非招聘结果显示“业务已提交 / Committed”，显示实际 domain、operation/version 和 target；没有 Channel 的场景事项明确显示原 wake 责任。通知和终态文案以“业务结果”说明，不把它写成已招聘或已任职。[UI README](../../../../../packages/client/ui-simulation/README.md)、Product、协议、Node/Python README 的两语配对均更新并记录。旧普通通知 fixtures 只在已存在真实 notificationOperationId 的分支新增非 null 断言，没有 cast、删除检查或改变业务意图。

## 实际执行与输入

Browser 插件不可用，因此使用项目维护的 [Playwright 程序](../../../../../apps/web/tests/world-director-events-authoring.snapshot.ts)与[真实 scaffold](../../../../../apps/web/tests/scaffold.ts)。前端为稳定完整构建 bundle，后台为实际 Cordis Loader、HTTP/WebSocket、product API、Native、Team、Session 和 JSON/SQLite。部署复用未修改的 C37 `world-director-events/source.ts` 与实际脚本模型；显式 `WORLD_DIRECTOR_VARIANT=rule`。用透明 `llm/stream` waterfall 记录 Loader 真正发出的模型输入，然后原样 `next()`；没有用测试模块中另一实例的数组冒充实际推理。

父任务 [build-generic-copy-final](../../../../../.local/world-completion/c37-director-events/root-tests/build-generic-copy-final.log)确认 exit 0、197 client artifacts 后才执行第三轮。第三轮程序 SHA256 为 `5a42819024c98b22e30f9a40347a544f538435145b08f219085a2ec6bd4ae178`；其执行前 [inputs-before.json](../../../../../.local/c36-director-events-sdk/final-browser-20261013/inputs-before.json)记录 5,520 文件、71,903,881 字节并保留完整 [input-bytes](../../../../../.local/c36-director-events-sdk/final-browser-20261013/input-bytes)。集合 SHA256 为 `defaada6288287caf0e0dcf88e0b3b3e39e358ad0c2f67cb1e87730784afb21c`；[执行后清单](../../../../../.local/c36-director-events-sdk/final-browser-20261013/inputs-after.json)和比较程序 exit 0，所列输入前后相同。原 C37 `595dd09c…` 冻结仍是此前已完成矩阵的历史字节，第三轮 generic 文案后的 runtime 子集 hash 为 `7f0919f03be5c9d9cf805a2665880af8f0abda430a0a6a61b9d537e0c6b82b07`；没有修改任何旧清单或验收原件。

这不是 SDK 发行验证或 source/plain Node lib 双执行矩阵；SDK wire/consumer 和浏览器属于各自实际模式。Native 77/compiler 4 的环境授权、日历计费、普通通知、延迟结果和冷恢复完整执行由 [C37 证据](c37-director-events-proof-20261013.md)与其独立审计负责，不能以本处 decoder 或单个环境案件替代。

## 最终四用例及冻结输入

父任务 C38 [build-version-label-final](../../../../../.local/world-completion/c38-pause-conflict/build-version-label-final.log)确认 exit 0、197 client artifacts 后执行最终用例，production/lib 保持稳定。最终浏览器程序 SHA256 为 `0edcc8f1a17c3a1ff0d8eb2d2f860efd69b7c823f2428aab13a2257c92fd5095`。[实际执行前清单](../../../../../.local/c36-director-events-sdk/final-browser-typed-20261013/inputs-before.json)记录 5,522 文件、71,913,052 字节并保存完整副本，集合 SHA256 为 `7b7856d2ab28db0a9655446bf8aed9e1ece34f5401ce17a63b8711728c337382`；[执行后清单](../../../../../.local/c36-director-events-sdk/final-browser-typed-20261013/inputs-after.json)和比较程序 exit 0，输入完全相同。清单包括 C37 runtime 范围及新 typed-conflict 源码/构建产物，加实际 browser/scaffold、web dist/配置、base/web bundle patch、CLI preset 与 Python/协议输入。runtime 子集为5,356文件，hash `d748273f8aaaa223aa1941c80b78220217b5429d2284ea6cec191b4534a2e8c1`。所有更早 freeze 与失败样本保持原字节。

| 模式/后端 | 实际 origin | 暂停创建模型流 | 显式开始模型流 | Snapshot/HTTP revision | 最终 HTTP control | 原件 |
|---|---|---:|---:|---:|---|---|
| normal/JSON | `http://127.0.0.1:63499` | 0 | 9 | 108/108 | paused/idle，paused | [proof.json](../../../../../.local/c36-director-events-sdk/normal/json/browser-q301jy/proof.json) |
| normal/SQLite | `http://127.0.0.1:63514` | 0 | 10 | 116/116 | paused/waiting，work-limit | [proof.json](../../../../../.local/c36-director-events-sdk/normal/sqlite/browser-oCy2Io/proof.json) |
| pause-race/JSON | `http://127.0.0.1:63525` | 0 | 9 | 110/110 | paused/idle，paused | [proof.json](../../../../../.local/c36-director-events-sdk/pause-race/json/browser-sm86l7/proof.json) |
| pause-race/SQLite | `http://127.0.0.1:63538` | 0 | 9 | 110/110 | paused/idle，paused | [proof.json](../../../../../.local/c36-director-events-sdk/pause-race/sqlite/browser-MBAq8F/proof.json) |

四用例各一原创建、四次实际案件详情 HTTP 回应；模型流为真实观察次数，不能把不满三次的已接受决策写成全世界完成。正常模式保留全部原用户操作；暂停后等待当前已接受的 advance 排空才保存快照，未取消历史工作。两个 pause-race 模式都触达实际 `run.openWindow` 固定断点：场景已 committed 后第一次窗口打开保存原请求、expectedRevision107与完整 Native 状态；UI 真正暂停写入 Native 后放行完全相同的窗口参数，再等待该 advance 排空。Native 继续拒绝过期 revision，driver 将精确 typed 冲突按 paused 停止。原 queue ticket/wake 逐字段保持，模型流均9→9，15/15 advances已排空。四用例记录的 `driverErrors` 都为空，实际 HTTP control 为 paused/非failed，页面不存在“调度失败”；`versions.scenario` 必须 observed 且实际 templateId.text 严格为 `clocky.world/v1/company`，缺失亦使断言失败。

已查看最终 [pause-race JSON 通知截图](../../../../../.local/c36-director-events-sdk/pause-race/json/browser-sm86l7/01-native-scenario-no-channel.png)和[normal SQLite 通知截图](../../../../../.local/c36-director-events-sdk/normal/sqlite/browser-oCy2Io/01-native-scenario-no-channel.png)：终态与通知说明已使用通用业务文案，真实 domain、operation、target、无 Channel 和 wake 责任清楚显示，页首状态健康。独立预算预览截图仍保留在每个 root。

父任务[独立审计](../../../../../.local/c36-director-events-sdk/root-audit/audit.json)exit 0，[审计程序](../../../../../.local/c36-director-events-sdk/root-audit/audit.py)逐项复核5,522个执行前副本及当前输入 hash，验证四个实际 HTTP v1版本/通用案件 DTO/null通知/Persona不适用、控制 paused且 start.ready、driverErrors为空。原 owned Native snapshot 的 Actor/epoch/trigger/consumption、单项 operation、资源不变与 race 的完整 dispatch/scheduled-event数据关系分别核对；Python3.14 stdlib `compression.zstd`直接读取真实 canonical Session view，验证它与 Native接受视图完全相等，并包含原 bootstrap/occurrence run-event source。两个race模型9→9、原队列/wake和HTTP/snapshot版本一致均由独立程序复核。另为66个实际成功原件记录hash，合计7,745,861字节。这个程序独立读Session原件及HTTP/proof事实，不把hash记录写成另一次 Native raw journal fold或SDK发行测试。

## 历史第三轮原件

| 后端 | 实际 origin | 暂停创建模型流 | 显式开始模型流 | 最终 Native revision | 原件 |
|---|---|---:|---:|---:|---|
| JSON | `http://127.0.0.1:58340` | 0 | 9 | 110 | [proof.json](../../../../../.local/c36-director-events-sdk/json/browser-YTUZck/proof.json) |
| SQLite | `http://127.0.0.1:58351` | 0 | 12 | 131 | [proof.json](../../../../../.local/c36-director-events-sdk/sqlite/browser-Sam18k/proof.json) |

每案通过实际键盘进入新预算单元格，将2改为1；源码严格等于仅改此字段的原 v1 定义，世界额度不变。真实 Host 预检通过后仅发一个 original create，Native 原运行已 paused 且已有 checkpoint，实际模型流为零。显式开始后等待一个原 trigger 环境 request committed，再明确暂停；实际 case inspector 经四次 authenticated HTTP 返回 request/plans/execution/notification。计划无 Persona，结果不写成招聘，request notification 是 null，最终通用通知说明与不可撤销业务结果文案均由精确页面文本断言验证。

逐张查看 JSON 的 [独立预算预览](../../../../../.local/c36-director-events-sdk/json/browser-YTUZck/00-independent-budget-preview.png)和[真实案件通知](../../../../../.local/c36-director-events-sdk/json/browser-YTUZck/01-native-scenario-no-channel.png)：预算1、实际外部领域 pin 和角色模型可读；实际环境 case 的 domain/operation/target、业务已提交、无 Channel 和 wake 责任可读。后者也记录真实“调度失败 / 调度器需要恢复”提示，不能据此称运行健康或所有普通事项完成。两后端 pageErrors 为空只表示浏览器未抛出页面异常，不排除该后台状态。

## 命令、检查与保留失败

```sh
python3 .local/c36-director-events-sdk/final-browser-typed-20261013/proof-programs/capture.py before > .local/c36-director-events-sdk/final-browser-typed-20261013/freeze-before.log 2>&1
TMPDIR="$PWD/.local/c36-director-events-sdk" WORLD_DIRECTOR_VARIANT=rule CLOCKY_SNAPSHOT=replay pnpm exec vitest run --config vitest.web.config.ts apps/web/tests/world-director-events-authoring.snapshot.ts > .local/c36-director-events-sdk/browser-typed-final.log 2>&1
python3 .local/c36-director-events-sdk/final-browser-typed-20261013/proof-programs/capture.py after > .local/c36-director-events-sdk/final-browser-typed-20261013/freeze-after.log 2>&1
TMPDIR="$PWD/.local/c36-director-events-sdk" pnpm exec vitest run packages/client/ui-simulation/tests/world-cases.client.spec.tsx packages/client/ui-simulation/tests/world-modules.client.spec.tsx > .local/c36-director-events-sdk/generic-copy-tests.log 2>&1
TMPDIR="$PWD/.local/c36-director-events-sdk" pnpm exec tsx scripts/run-oxlint.ts apps/web/tests/world-director-events-authoring.snapshot.ts > .local/c36-director-events-sdk/browser-lint-typed-final.log 2>&1
TMPDIR="$PWD/.local/c36-director-events-sdk" pnpm exec tsc -p tsconfig.host.json --noEmit --tsBuildInfoFile .local/c36-director-events-sdk/host-types-typed-final.tsbuildinfo --pretty false > .local/c36-director-events-sdk/host-types-typed-final.log 2>&1
```

[最终浏览器](../../../../../.local/c36-director-events-sdk/browser-typed-final.log)1 file/4 tests passed，18.63s；最后文案相关[组件回归](../../../../../.local/c36-director-events-sdk/generic-copy-tests.log)2 files/15 tests passed；locale、[最终 browser typed lint](../../../../../.local/c36-director-events-sdk/browser-lint-typed-final.log)及[最终 Host aggregate noEmit](../../../../../.local/c36-director-events-sdk/host-types-typed-final.log)日志为空、exit 0。类型增量信息单独存于项目内 `.local/c36-director-events-sdk`，没有重新 emit 或 build runtime。此前[最终 Client 类型](../../../../../.local/c36-director-events-sdk/client-types-second.log)、[Host 类型](../../../../../.local/c36-director-events-sdk/host-types-final.log)与[owned scoped lint](../../../../../.local/c36-director-events-sdk/lint-third.log)通过；后续统一 build 也通过两 aggregate 类型。历史第三轮日志为2 passed/8.22s，但当时没有 driver 健康硬断言，不能替代最终四用例。

此前相关验证：[Python 121 passed](../../../../../.local/c36-director-events-sdk/python-final.log)，[UI 3 files/16 passed](../../../../../.local/c36-director-events-sdk/ui-second.log)，[受影响 Node/protocol/UI 3 files/46 passed](../../../../../.local/c36-director-events-sdk/final-affected-retry.log)，[Node Session corpus 77 passed/54 skipped](../../../../../.local/c36-director-events-sdk/ts-context-second.log)。大范围 TS [68 files](../../../../../.local/c36-director-events-sdk/ts-final.log)为1041 passed/1 failed，唯一失败是旧测试仍要求招聘专用 `Hired 14` 文案；修正为通用 `Committed 14` 后，受影响3文件46测试全部通过，不能将原大范围日志写成全绿。最初 context filter 的131 skipped 未计为成功证据。Python 首轮45 passed/1 failed发现 required predecessor:null 被 optional dump 丢失，修 serializer 后46通过，最终121包含全部当前 corpus。第一轮 Client/Host/lint 诊断均保留，未以放宽类型或 parser 消除拒绝。

[第一轮 browser](../../../../../.local/c36-director-events-sdk/browser-first.log)两个 case 流程已产生环境案件，但末尾计数误读了 Vitest 动态 import 的独立模型数组，2 failed；JSON `browser-pbCjAi`、SQLite `browser-eO3ARo` 的原件保留。改为实际 Loader `llm/stream` 透明计数后[第二轮](../../../../../.local/c36-director-events-sdk/browser-second.log)2 passed/7.51s，成功原件 JSON `browser-SVk7w3`、SQLite `browser-4yzLBS` 保留；其9/11模型流不覆盖第三轮的9/12。第二轮视觉检查发现 residual hiring 文案，父任务授权窄修 locale，统一 build 后才第三轮验证。此前父任务 `build-second` 因 browser DTO 从 Core 根导入 value 失败；改为明确 browser-safe `world-domains` 入口后 `build-fifth`通过，历史失败未覆盖。

执行前 capture 最初两次因错误假设不存在的 web/local-model cordis 文件而失败；两份程序与日志保留为 `capture-first.py`、`capture-second.py` 和 `freeze-before-first/second.log`。读取 scaffold 的真实 base/web patch 与 CLI preset 路径后捕获成功，才开始第三轮浏览器。所有 Loader/Chromium/tsx 临时目录、Python cache 和证据均在项目内；旧 C32/C34 fixtures、shared model、报告和原件未改。

## 暂停竞争的诊断

第三轮截图暴露后台失败后，第四至第六轮在实际 administration held Map 的原 WorldOwner 上透明包装 attach，原 attach 后只读取实际 driver 并原样调用/rethrow advance，用于记录完整异常；没有修改 fixture/普通事项、预算或执行参数。三轮两后端均暂未复现，原件全部保留，不以未复现认定已修复。第四轮 lint 发现 Reflect.apply 的 any 返回；测试以 unknown 中间值保留原结果，随后 scoped lint exit 0。

随后新 browser 加入 `driverErrors=[]` 与页面无“调度失败”的硬断言，同输入最多五轮再现程序在首失败即停。[第7轮](../../../../../.local/c36-director-events-sdk/browser-reproduction-7.log)JSON failed / SQLite passed：JSON [driver-errors.json](../../../../../.local/c36-director-events-sdk/json/browser-n7EqiE/driver-errors.json)保存 `Simulation revision conflict`，真实 built `simulation-local/lib/index.js:15712` 在 `LocalSimulationRun.openWindow` 检查 expectedRevision 时拒绝；stack 还包含 assertRevision:17068 与 enqueue:17101。该失败不能列为成功原件。同轮 SQLite `browser-nxTHsQ`无该错误。父任务 C38 增加精确 typed revision conflict，Native 继续拒绝，Driver 仅在 paused 时返回 paused、running 时返回有界 coordination-limit，其它 IO 继续抛；真实 Native 与相关 dispatch/replanning 单测由 C38 记录。前述固定断点四用例是在此修复和统一 build 后重新冻结、执行，未吞掉原异常或放宽 Native 校验。

修复后首组 [四用例](../../../../../.local/c36-director-events-sdk/browser-pause-fixed-final.log)全部通过，输入 hash `65b8d4da…`及所有原件保留，但 normal SQLite 暂停后在已接受 advance 排空前保存了revision135，截图/HTTP已到138，未用该中间观察点做最终 raw 等值验收。新增仅等待实际已接受 advance 排空后，[drained 轮](../../../../../.local/c36-director-events-sdk/browser-pause-fixed-drained-final.log)3 passed/1 failed：normal JSON `browser-9Q9dOD`在异步 original preparation 的 checkpoint readiness 默认 poll timeout 到时仍 pending，尚未进入调度；UI和rawjournal原件均保留。保持原命令、部署和有限额度，只给该异步准备及 drain 等待显式30s timeout，最终 stable 四用例全部通过。两组旧输入目录和前后 hash 保持不变，没有为了目录命名复制镜像或重复模型工作。race 新增的初次格式 lint 诊断也保留，最终 lint exit 0。

暂停稳定观察点的历史 stable 轮为4 passed/13.48s，输入集合 hash `9e8a0d485e2b3ad00ef0ac3e37374c4bc07180471f8d3727ff6ac48b2c34f29b`，原四目录与完整冻结输入保留在 `final-browser-pause-fixed-stable-20261013`。父任务独立查看实际 HTTP 时发现版本 projection 硬编码 v0；修正为原 resolved.apiVersion/metadata.id，并再次统一 build 后，[version-fixed 轮](../../../../../.local/c36-director-events-sdk/browser-version-fixed-final.log)4 passed/15.42s，输入 hash `06f445a1…`及样本均保留。最后 Host 类型检查发现 versions 允许缺失，新测试改为 optional access但仍硬要求 observed/v1/company。没有重build production；Host noEmit和新四用例在当前同一 runtime 字节上通过，才指定上述 typed 轮为最终原件。最初 noEmit命令尝试禁用 incremental，被 composite配置拒绝，`host-types-typed-first.log`保留；最终改为专属项目内 tsBuildInfoFile，类型检查 exit 0。

## 验收边界

此处证明两 SDK 新格式的严格解析/nullable 保存、共享 Session 来源拒绝、独立作者预算与真实公共环境案件显示，不证明所有领域 UI、全部调度完成、生产 provider 或 writable restore。只在 Chromium 1440×1000 中文浏览器执行；两语文案由当前 locale/组件回归维护，没有新增本处窄屏或 motion 证明。U14/U15 不在此验收范围，未新增或勾选 checklist。

### Root补充原始Native只读回放

Root在最终真实四格完成后，使用plain Node实际compiled Simulation/Local provider读取原JSON/SQLite journal，并执行原schema/fold与投影检查，均owner=unowned、execArgv=[]，无open/create/writable restore。原bootstrap/calendar/accepted Decision/request/plan/result/queue/wake与浏览器原件相符；scaffold关闭后的两条真实writer收尾保留，不声称完整snapshot同revision。[准确命令/边界](c38-browser-pause-proof-20261013.md#补充原始-native-日志回放)、[原日志回放结果](c38-browser-native-readonly-replay.json)与[追加4份只读observation后的70原件hash](c38-browser-pause-root-audit.json)是Root补充证据，未改原browser样本或旧清单。
