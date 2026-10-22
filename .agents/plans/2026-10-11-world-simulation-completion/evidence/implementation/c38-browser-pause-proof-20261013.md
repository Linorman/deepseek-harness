# C38 实际浏览器暂停竞争修复

2026-10-13；补充S11与既有产品/SDK范围，不新增items，也不以该局部证据勾整个R04/U12/U14/U15。Native77/compiler4。最终冻结输入5522files/71913052bytes，hash `7b7856d2ab28db0a9655446bf8aed9e1ece34f5401ce17a63b8711728c337382`；全部保留完整字节副本，before/after不变。原C35/C37输入和样本继续按原版本保存。

## 实际问题与修复

真实作者台创建环境运行，目标case虽committed，用户随后暂停时UI间歇出现driver failed。第7复现轮通过实际WorldOwner/driver对象透明记录得到了真实compiled stack：Native `openWindow()` 排队准入时发生原revision冲突。原frame/args、原pause控制、普通事项和失败原件都保留，未缩减场景或吞异常。

Native `assertRevision()` 保留原比较和拒绝，抛出公开 `SimulationRevisionConflictError`（expected/actual cursor）。World driver只把该类型在已paused时投影为paused、running时投影为有界coordination-limit，保留原ticket/wake，不强行接受旧window，不无限内层重试。无关IO异常即使遇到paused仍传播。只增加运行时分类，不改journal格式。两語GUI文案以通用业务结果描述终态和通知，不把环境事项写成入职/撤销任职；控制API版本从原resolved.apiVersion派生，实际v1不再误标为v0。

## 当前精确证据

最终真实浏览器normal/pause-race×JSON/SQLite四格全部通过。表单把独立maxRequests2改1，保持其余完整定义及World限额；实际Host预检与一次paused-create为零推理，仅显式UI开始后调用模型。真实环境case保持actualDirector/Decision/epoch/canonical binding/trigger；通用selector/target、apply Persona:not-applicable、null申请通知均由实际HTTP返回。浏览器真正打开计划/执行/通知并验证最终通用文案，未预构造成功DTO。

固定race在场景提交后的实际Native `openWindow()` 捕获原request和expected107，等待真实UI暂停先写入Native，再同args调用原方法。两backend原window被拒但driver按paused排空，原wake和queue ticket逐值相等，模型调用9→9。最终HTTP control与Native snapshot均revision110、paused/idle/stoppaused、start.ready、无inFlight/driverErrors。normal JSON在revision108、9模型，SQLite在revision116、10模型，均在已受理advance排空后保存snapshot与同revision HTTP control；正常暂停不声称擦除先前已受理工作。

Root直接读取原Session zstd（Python3.14 stdlib compression.zstd），核对Native context-view/原bootstrap及consumed occurrence来源和真实消费；没有以SDK decoder或stdout标签代替执行。完整[四格root audit](c38-browser-pause-root-audit.json)记录所有原件hash及准确目录。主审计程序、输入和结果分别在[程序](../../../../../.local/c36-director-events-sdk/root-audit/audit.py)、[final inputs](../../../../../.local/c36-director-events-sdk/final-browser-typed-20261013/inputs-before.json)、[字节副本](../../../../../.local/c36-director-events-sdk/final-browser-typed-20261013/input-bytes)、[独立结果](../../../../../.local/c36-director-events-sdk/root-audit/audit-first.log)。

## 准确命令与检查

cwd为项目根；TMPDIR、原日志、cache、证据与编译输出都在本项目。

```sh
TMPDIR="$PWD/.local/world-completion/tmp" pnpm run build
TMPDIR="$PWD/.local/world-completion/tmp" pnpm exec vitest run packages/simulation/simulation-world/tests/driver-revision.spec.ts packages/simulation/simulation-local/tests/dispatch.spec.ts packages/simulation/simulation-product/tests/world-replanning.spec.ts packages/simulation/simulation-team/tests/decision-pause.spec.ts
TMPDIR="$PWD/.local/world-completion/tmp" pnpm exec vitest run packages/simulation/simulation-local/tests/pause.spec.ts packages/simulation/simulation-local/tests/management.spec.ts packages/simulation/simulation-team/tests/pause-admission.spec.ts
TMPDIR="$PWD/.local/world-completion/tmp" pnpm exec vitest run packages/simulation/simulation/tests/world-protocol.spec.ts packages/simulation/simulation-local/tests/window.spec.ts packages/simulation/simulation-world/tests/driver-revision.spec.ts
TMPDIR="$PWD/.local/world-completion/tmp" pnpm exec vitest run packages/simulation/simulation-local/tests/windows.spec.ts
TMPDIR="$PWD/.local/world-completion/tmp" pnpm exec vitest run packages/simulation/simulation-product/tests/world-administration.spec.ts
TMPDIR="$PWD/.local/world-completion/tmp" pnpm run doc-sync
python3 .local/c36-director-events-sdk/root-audit/audit.py .local/c36-director-events-sdk/final-browser-typed-20261013 .local/c36-director-events-sdk/root-audit/cases.json .local/c36-director-events-sdk/root-audit/audit.json
```

两个历史filter名称decision-pause.spec.ts/window.spec.ts不存在：第一条实际3文件20pass，第三条实际2文件27pass，不声称它们验证了不存在的文件。随后按实际文件名pause-admission/windows完整补跑：pause/management三文件31pass、windows14pass；product-version13pass。Driver6包含在不同命令中，不重复累计。全部日志在[Root C38](../../../../../.local/world-completion/c38-pause-conflict)；scopedlint与最终Host noEmit通过，联合build成功197client artifacts、Host/Client aggregate通过，doc-sync-second29/29通过。最终browser准确capture/run命令及4pass日志由[C36报告](c36-director-events-sdk-browser-proof-20261013.md)保存，不把早期前后未冻结或instrumentation有问题的轮次算成功。

## 保留失败与范围

早期module数组与Loader实际实例分离产生错误计数、通用GUI文案误导、间歇pause driver failure、复现第7轮真实失败、checkpoint默认poll超时、测试optional versions类型错误及Note中文链接配对错误均留原件/日志。新的30s checkpoint等待仅用于已受理异步准备，不改产品状态、原command、额度或准备逻辑。

SDK/通用caseDTO与独立预算作者字段的定向测试是本轮局部证明，不替代完整发行/U12/U13或三个场景GUI验收。没有真实付费provider、全部SIGKILL或完整MVP声明。S10 reservation模拟TTL缺口继续未勾；既有R04全维护竞争仍待完整验收。

## 补充原始 Native 日志回放

Root随后用当前plain Node实际compiled Simulation/Local provider只读inspect四个原目录，直接读取JSON/SQLite journal并运行原Native schema/fold/投影检查。没有open/create/restore、model/Team工具或writer获取；实际owner均unowned，execArgv=[]。原R、consumed calendar、实际accepted Decision、单项request intent、规划/结果、队列和wake均与最终浏览器snapshot对应。原场景与资源完全相等，case原消费Decision相等。关闭原scaffold后各目录另外保留两条真实writer收尾记录，因此只读观测revision为110/118/112/112，原浏览器观察点为108/116/110/110；没有声称两份完整snapshot相等或删除收尾。

```sh
TMPDIR="$PWD/.local/world-completion/tmp" node .local/c36-director-events-sdk/root-audit/inspect-native.mjs .local/c36-director-events-sdk/root-audit/cases.json .local/c36-director-events-sdk/root-audit/native-replay.json
```

[compiled原日志回放结果](c38-browser-native-readonly-replay.json)和[实际程序](../../../../../.local/c36-director-events-sdk/root-audit/inspect-native.mjs)均保存；第一次从项目根不能resolve workspace根依赖的错误保留在native-first.log，按原compiled入口加载的第二次成功在[native-second.log](../../../../../.local/c36-director-events-sdk/root-audit/native-second.log)。没有替换Native parser或自造projection。新的Root只读observation原件4份追加到原66份证据，当前[完整70原件hash](c38-browser-pause-root-audit.json)由audit-final.json复核；再次读原目录全部frozen输入和Session hash仍匹配。该证据仍非writable restore/SIGKILL或SDK发行验收。
