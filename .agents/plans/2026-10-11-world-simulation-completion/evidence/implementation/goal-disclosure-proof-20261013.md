# F07：当前目标授权与附带提案正文的完整披露

2026-10-13，Asia/Tokyo。Native91/compiler9。本轮完成 F07 剩余授权审计，结合原 [Fact/Norm 与真实用户证据](norm-user-projection-partial-20261013.md)、[结果角色隔离](role-result-disclosure-proof-20261013.md)及本轮复验勾选 F07；清单由80/112变为81/112，不新增items。

## 实现与反例

[招聘费用](../../../../../packages/simulation/simulation-local/src/world-organization.ts)、[单案审批](../../../../../packages/simulation/simulation-local/src/world-hire-approval.ts)和[委员会规则](../../../../../packages/simulation/simulation-local/src/world-norm-bootstrap.ts)统一采用 `currentWorldOperationGrants`。一条有效授权不能让同operation下其他失效目标的费用、案例或委员会材料进入goal。已有人物招聘也采用该筛选；调岗/离职的源岗位与目标岗位复用相同当前端点、关系类型和区间规则。

`fee-red.log`在两后端复现有效与失效岗位混合时的费用泄漏。`approval-confirmed-red.log`用修正后的合法前置条件对原owner复现两种招聘审批的失活端点泄漏。日期边界、未来授权、目标替换、actor/scope/target失活和缺失/不匹配关系规则均有拒绝反例；全部纯投影检查保留原Native状态且不推理。

只读subagent审计发现另一实际缺口：[worldContext](../../../../../packages/simulation/simulation-local/src/world.ts)为非goal上下文附带提案正文，原同步披露检查只重验goal grant。现在 `SimulationWorldContext.governanceAccess`为每个附带提案保存原revision/hash、vote pin和准确关系引用；[披露检查](../../../../../packages/simulation/simulation/src/world-membership.ts)在缓存读取、Session插入与模型派发紧前覆盖所有selection，缺证据或撤权则拒绝。原preparation、Session历史和已派发IO不被改写。`missing-witness-red.log`临时移除该检查后新增反例确实失败，随后逐字节恢复原文件；未保留调试开关。

Native91拒绝0–90及99等不支持格式，不猜测旧授权见证。compiler9、原正式预算及模型/费用上限不变。新字段属于Native冻结authority及已记录context-view文本；Session事件envelope与公共产品DTO没有新增格式。双SDK从同一实际Loader view派生的共享wire样本保留完整文本及来源，不擅自重解释权限。

## 实际运行与冷恢复

[真实治理场景](../../../../../examples/simulation-company/tests/world-governance-disclosure.snapshot.ts)通过原Loader、Driver、三工具、canonical Channel和独立Session形成实际提案、投票与resolution。在原提案申请人的已接受request收据上下文中附带提案，再仅撤销can-vote；任职和提案权限保持。分别检查缓存读取与真实下游pre-step等待。拒绝尝试可追加不含正文的turn/error元数据；不追加提案context-view，不调用模型，不更改原准备材料。取消该测试决策并明确恢复原授权后，原独立投票、业务通知和checkpoint仍完成。

公司/实验室×JSON/SQLite×source/plainNode lib×两边界，共16案例32独立进程。实际业务624次keyless模型调用，撤权拒绝新增0、16次cold恢复全部paused/0model；Native、完整journal和Session与warm原件逐项相同。[独立审计](goal-disclosure-audit-20261013.json)核对128原件、原票据/授权/来源、PID与准确启动命令。lib模式由plain Node运行可擦除类型的测试driver，所消费包为编译lib；不声称测试driver是发布SDK。

`roles-source91.log`与`roles-lib91.log`重新验证三种真实角色的Fact/Norm披露和scope撤权：Norm四案例12进程warm120/cold0，scope四案例8进程warm56/cold0。原public/director/member audience、body来源和外部代表独立Session继续成立，旧合法历史不擦除。

最终3332份相关source/lib/fixture输入、43,601,106字节在 `.local/world-completion/f07-goal-disclosure/inputs` 与 `inputs91.tar.gz` 保存；`manifest91.json` SHA-256为 `41be36a26000bea39ecfef477fde04ad169ca0e579c01b1e8c564831354ef575`。这冻结本轮相关范围，不代表全仓发行验收。

## 浏览器读取复验

使用 frontend-testing-debugging 技能；Browser plugin not available，采用仓库Playwright/Chromium。公司/实验室×JSON/SQLite四案，1440×1000、中文、真实认证HTTP与watch。路径为创建/开始后打开实际director正文→独立grant允许→挂起原已授权HTTP响应→撤权→释放迟到响应→页面重开仍withheld。run owner或其他entity grant不能读正文；Native及模型计数在读取前后保持不变。业务144次keyless调用，读取新增0。页面标识、实际内容、正文控件及截图均被检查，四案console warnings/pageErrors为空。[浏览器审计](goal-disclosure-browser-audit-20261013.json)保留28原件及实际URL。

撤权截图已实看，明确显示正文未公开。这一读取fixture的页面也显示调度失败，末决策为submitted；前轮同fixture已存在该状态，本轮不将读取成功冒充完整运行完成。完整driver错误/恢复、三场景GUI、移动布局/主题/焦点/GIF仍由U10/U14/U15及恢复项验收。本轮未改UI。

## 检查与失败记录

原件和全部日志在 `.local/world-completion/f07-goal-disclosure`。最终Native九文件170项通过；原初轮167项中两项旧revision测试冲突已修，修正后bootstrap12项通过。另有披露/准入57项、人员/既有招聘及输入来源59项（含Team来源21项），与前者有重叠，不能相加作唯一test数量。TS wire79项、Python wire76项通过。完整build成功，Host/Client类型及197前端产物完成；scoped lint与diff whitespace通过。doc-sync初轮28/29，双语链接顺序修正后完整29/29通过。

保留所有开发失败：过长项目内TMPDIR造成macOS Unix socket EINVAL，改用同项目内较短 `.local/world-completion/tmp`；测试fee ID缺Branded/parser及快照类型已修；审批测试最初误把有限模板全部允许值等同于单个选择，已改为核验合法前置条件；bootstrap新增生命周期变化后的旧revision已修。真实pre-step首次错误要求Session完全不增加事件，实际只新增不含正文的turn/error元数据，现验证原前缀不变、无新正文/模型输入及零派发。lint发现两处原长行已折行；文档配对失败按相同段落/链接顺序修复，未放宽任何gate。

## 准确复现命令

所有命令在项目根运行，先设置 `TMPDIR="$PWD/.local/world-completion/tmp"`；Python另设 `PYTHONDONTWRITEBYTECODE=1`。build是lib与浏览器命令的前置条件。

```sh
pnpm exec vitest run packages/simulation/simulation-local/tests/world-goal-disclosure.spec.ts packages/simulation/simulation-local/tests/world-hire-approval.spec.ts packages/simulation/simulation-local/tests/world-bootstrap.spec.ts packages/simulation/simulation-local/tests/world-context-access.spec.ts packages/simulation/simulation-local/tests/world-norms.spec.ts packages/simulation/simulation-local/tests/world-governance.spec.ts packages/simulation/simulation-local/tests/world-personnel-domain.spec.ts packages/simulation/simulation-local/tests/world-hire-existing.spec.ts packages/simulation/simulation-local/tests/run.spec.ts
pnpm exec vitest run packages/simulation/simulation-local/tests/world-governance.spec.ts packages/simulation/simulation-local/tests/world-context-access.spec.ts packages/simulation/simulation-local/tests/world-admission-lifecycle.spec.ts
pnpm exec vitest run packages/simulation/simulation-local/tests/world-personnel-domain.spec.ts packages/simulation/simulation-local/tests/world-hire-existing.spec.ts packages/simulation/simulation-team/tests/lifecycle.spec.ts -t 'recorded|context|request-header|provider IO|pure|existing'
pnpm run build
pnpm exec vitest run --config vitest.snapshot.config.ts examples/simulation-company/tests/world-governance-disclosure.snapshot.ts
CLOCKY_EXAMPLE_MODE=lib pnpm exec vitest run --config vitest.snapshot.config.ts examples/simulation-company/tests/world-governance-disclosure.snapshot.ts
WORLD_NORM_ROLE_EVIDENCE_ROOT="$PWD/.local/world-completion/f07-goal-disclosure/norm-source" WORLD_SCOPE_EVIDENCE_ROOT="$PWD/.local/world-completion/f07-goal-disclosure/scope-source" pnpm exec vitest run --config vitest.snapshot.config.ts examples/simulation-company/tests/world-norm-role.snapshot.ts examples/simulation-company/tests/world-scope-disclosure.snapshot.ts
CLOCKY_EXAMPLE_MODE=lib WORLD_NORM_ROLE_EVIDENCE_ROOT="$PWD/.local/world-completion/f07-goal-disclosure/norm-lib" WORLD_SCOPE_EVIDENCE_ROOT="$PWD/.local/world-completion/f07-goal-disclosure/scope-lib" pnpm exec vitest run --config vitest.snapshot.config.ts examples/simulation-company/tests/world-norm-role.snapshot.ts examples/simulation-company/tests/world-scope-disclosure.snapshot.ts
pnpm exec vitest run packages/sdk/client/tests/sdk-client.spec.ts -t 'wire payload validation'
PYTHONPATH="$PWD/python/sdk/src" .local/world-completion/c29-public-v1/python-env/bin/python -m pytest python/sdk/tests/test_channel_view.py --basetemp .local/world-completion/f07-goal-disclosure/python-tmp -o cache_dir="$PWD/.local/world-completion/f07-goal-disclosure/pytest-cache"
pnpm exec vitest run --config vitest.web.config.ts apps/web/tests/world-context-privacy.snapshot.ts
pnpm run doc-sync
python3 .local/world-completion/f07-goal-disclosure/audit.py
```

scoped lint的16个准确输入及环境见[命令记录](goal-disclosure-commands-20261013.json)，日志为 `lint91-final.log`；原red命令见 `fee-red.log`、`approval-confirmed-red.log`与`missing-witness-red.log`。未测试真实provider质量、SDK发行安装或完整危险边界，不代替原未勾项目。本轮只使用一个只读subagent，没有新增清单任务或提交/推送。
