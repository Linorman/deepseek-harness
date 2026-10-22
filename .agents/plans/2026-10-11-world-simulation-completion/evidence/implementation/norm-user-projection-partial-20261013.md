# F07：制度角色、用户读取与动态授权（部分验收）

2026-10-13，Asia/Tokyo。F07仍未勾选，清单80/112。Native90/compiler9。本轮补齐制度与真实浏览器正文证据，并修复两个实际授权缺口；其他领域机会投影的统一授权审计仍待完成。

## 授权修复

[制度办理机会](../../../../../packages/simulation/simulation-local/src/world-norms.ts)原先只核验grant关系日期及端点ID，失活的actor、委员会或scope仍能返回已批准提案正文。`opportunity-red.log`复现；现复用[当前操作授权](../../../../../packages/simulation/simulation/src/world-membership.ts)，与请求准入共享active端点、原relationRules类型及有效期规则。纯投影反例使用合法提案/独立决议结构及实际entity phase fold；不是运行完整治理场景的伪造成功。

JSON/SQLite的`goal-grant-red.log`进一步证明：原操作授权结束后，成员仍能读取scope fact，缓存goal preparation却也错误地继续返回。共享同步披露检查现在重验原goal的任职及所有操作grant关系；不允许以其他新grant替换原授权。检查覆盖重试准备、Native重取、Session写入紧前及模型派发紧前，旧view不被改写。`world-context-access.spec.ts`新增双后端反例，既有14项Session/pre-step/模型池撤权和历史保留回归继续通过。

Native90拒绝0–89和其他不支持版本；不静默重解释旧准备材料。共享纯查询移至无运行时依赖的Definition模块，`personnel-state`保留同一导出的引用，避免浏览器投影通过它引入宿主Team。没有放宽client purity gate。

## 真实制度角色矩阵

新独立[场景](../../../../../examples/simulation-company/tests/world-norm-role-scenario.ts)从严格v1定义编译，在合法scenario bootstrap中发布public、director actors和scope-members三条advisory Norm；原catalog/source预算保持不变。通过实际Driver、Agent三工具、原Channel和ExternalActor执行创建独立代表。

`source90.log`、`lib90.log`各双后端2项通过，每格warm及两次独立cold，共4案例/12进程/warm120次scripted模型调用/cold0；`native90-matrix-audit.json`核对原件、12个独立PID、退出码及输入hash。逐角色核验：普通成员看到public/member正文，director看到public/director正文，外部代表只看到public正文；检查query、每个原context-view、实际模型messages和Session事件。每条可见Norm核对原definitionHash及run-event来源。cold检查完整Native/Session/journal与原件相同，并且零模型调用。

## 真实用户端到端读取

[浏览器测试](../../../../../apps/web/tests/world-context-privacy.snapshot.ts)使用真实Loader、认证HTTP、运行创建/调度、WorldFact自动上下文、独立正文grant和WebSocket失效链。Browser插件及browser技能未提供，按frontend-testing-debugging技能使用仓库Playwright。`browser90.log`公司/实验室×JSON/SQLite四项通过，每项原业务36次scripted调用，读取阶段不推理且Native快照不变。

run owner身份本身不能读取导演正文，另一个entity的grant也不能授予权限。准确正文grant允许读取实际director-only canary；服务端已生成含canary的旧HTTP响应被明确屏障挂起，再撤销grant，界面清除正文，释放旧响应后也不复活，重开页面仍withheld。保留原允许响应、原Native、director Session、proof和截图。检查真实pageErrors和console warnings均为空；四案合计144次业务scripted模型调用，读取新增0；`browser90-audit.json`核对四份最终proof。仅验证本轮1440×1000读取流程，不冒称U14/U15完整GUI验收。

新增授权后的页面重开用于采用新的正文policy generation；旧generation正确显示需要刷新，不承诺授予权限后自动公开内容。撤权本身则通过真实watch自动清除正文，不靠重开页面完成。

## 检查和失败历史

原件在[本轮目录](../../../../../.local/world-completion/thread-01a1336a-norm-user-projection)。`native90.log`4文件71项；`regression90.log`4文件46项，涵盖当前请求策略、岗位授权和最终上下文/制度代码；`input-provenance90.log`21项通过、377未选，覆盖完整已记录请求/header/context以及provider IO边界。`build-pure90.log`及返回类型补齐后的`build-typed90.log`完整build197；scoped lint见`lint-final.log`，未降低检查门槛。`doc90.log`首轮28/29通过；唯一export JSDoc返回类型注解缺失已补齐，`export-jsdoc-final.log`通过。

开发失败保留：浏览器最初过早把paused当创建完成，已改查原认证创建命令的completed收据；多正文相同提示改为明确首项定位。正文grant变更后的旧generation被正常清除，新grant采用页面重开；未修改产品来迎合测试。Norm场景首次错用query API已修。共享helper引入阶段source Loader因旧lib缺导出失败，最终重新构建后source/lib复验通过。类型检查发现goal grants为判别联合，改为明确拒绝非relation引用；第一次完整构建的client purity失败通过纯模块拆分修复，没有新增外部模块豁免。最后的公开返回类型注解只改变类型/源码映射，不改变授权行为。

## 复现命令

```sh
TMPDIR="$PWD/.local/world-completion/tmp" pnpm exec vitest run packages/simulation/simulation-local/tests/world-context-access.spec.ts packages/simulation/simulation-local/tests/world-norms.spec.ts packages/simulation/simulation-local/tests/world-admission-lifecycle.spec.ts packages/simulation/simulation-local/tests/run.spec.ts
TMPDIR="$PWD/.local/world-completion/tmp" pnpm exec vitest run packages/simulation/simulation-local/tests/world-request-policy.spec.ts packages/simulation/simulation-local/tests/world-hiring-role-permissions.spec.ts packages/simulation/simulation-local/tests/world-context-access.spec.ts packages/simulation/simulation-local/tests/world-norms.spec.ts
TMPDIR="$PWD/.local/world-completion/tmp" pnpm exec vitest run packages/simulation/simulation-team/tests/lifecycle.spec.ts -t 'recorded|context|request-header|provider IO'
TMPDIR="$PWD/.local/world-completion/tmp" pnpm run build
TMPDIR="$PWD/.local/world-completion/tmp" WORLD_NORM_ROLE_EVIDENCE_ROOT="$PWD/.local/world-completion/thread-01a1336a-norm-user-projection/source90" pnpm exec vitest run --config vitest.snapshot.config.ts examples/simulation-company/tests/world-norm-role.snapshot.ts
TMPDIR="$PWD/.local/world-completion/tmp" CLOCKY_EXAMPLE_MODE=lib WORLD_NORM_ROLE_EVIDENCE_ROOT="$PWD/.local/world-completion/thread-01a1336a-norm-user-projection/lib90" pnpm exec vitest run --config vitest.snapshot.config.ts examples/simulation-company/tests/world-norm-role.snapshot.ts
TMPDIR="$PWD/.local/world-completion/tmp" pnpm exec vitest run --config vitest.web.config.ts apps/web/tests/world-context-privacy.snapshot.ts
TMPDIR="$PWD/.local/world-completion/tmp" pnpm run doc-sync
```

剩余F07审计需检查其他goalContext是否自行扫描历史grant而绕开当前端点规则，特别是招聘费用与单案审批机会；不能仅因outer pin仍有另一条有效grant就将全部历史目标材料公开。此次未新增checklist items，也没有提交或推送。

最终2771份相关source/lib/测试/浏览器资产冻结于`manifest90.json`、`source-lib90.tar.gz`，manifest SHA-256为`54bd5434bd62f34807ea95bdb2ea089e4f0d522b619a7579fe27a2636eba3519`。最终返回类型修正后所有已冻结的运行时`.js`字节保持相同；源码映射与类型产物更新。该副本是执行后相关范围证据，不是全仓发行冻结。
