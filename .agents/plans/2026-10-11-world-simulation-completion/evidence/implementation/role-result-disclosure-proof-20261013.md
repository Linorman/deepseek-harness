# F08：可信结果披露；F07 角色读取矩阵进展

2026-10-13，Asia/Tokyo。F08 完成；F07 仍未完成。Native89/compiler9不变。本轮补充可执行验收和保留原件开关，没有修改生产语义。

## 结果披露合同

[结果通知](../../../../../packages/simulation/simulation/src/world.ts)从原结果构造固定JSON，仅包含resultId、封闭outcome和Native领域payload；拒绝原因是枚举，不复制plan rationale。[Native提交](../../../../../packages/simulation/simulation-local/src/world.ts)要求result通信与冻结notification逐字段一致，修改正文、recipient、Channel、时间、outcome或依赖均拒绝。

[外部裁决](../../../../../packages/simulation/simulation-local/src/world-external-mediated.ts)对failure使用固定码对应文本、unverified-report使用固定声明、delayed-event使用Native派生opaque ID，环境事实由受限claim和真实源派生。director原始statement/description/key与私密理由保留在原裁决中，不作为低权限结果正文。结果证据仅保留原request已经声明的引用。代表准备必须来自原有限模板，contactUnit绑定原请求。

生成新人和外部代表的Persona受名称/skills/traits/goals有限模板校验，不接受director开放文本作为新角色Persona。新角色使用独立Session和自己的私有Channel，不继承director历史。[制度公告](../../../../../packages/simulation/simulation-local/src/world-norms.ts)只能取原提案、通过的独立决议及匹配hash的正文；这是一项显式批准的发布，不是把director rationale自动作为全员背景。

审计曾怀疑director通过外部代表first-action传播自由文本。实际Cordis/编译v1/calendar/claimed decision/持久Session/三工具服务复现证明，该请求在Native准入即被明确拒绝：场景director事件不能创建代表或伪造请求人对话。新增[前置拒绝回归](../../../../../packages/simulation/simulation-local/tests/world-director-first-action.spec.ts)确认request/plan/representative/operation全为0、entity/binding/Channel集合不变、全部Channel没有envelope。此测试没有派发模型推理，不冒称完整代表创建成功后的攻击实验；先前静态漏洞判断已撤回，未为不可达路径修改生产代码。

## 当前证据

全部[原件](../../../../../.local/world-completion/thread-01a1336a-role-projection)保留在项目内；`role-matrix.json`、`result-matrix.json`逐进程核对退出码和模型计数。

| 范围 | 证据 |
| --- | --- |
| 真实角色隔离 | `roles-src.log`、`roles-lib.log`各4项；公司/实验室×JSON/SQLite，8案例24进程，warm120、cold0。原生查询、持久context-view和实际模型输入同时验证member/director/生成external代表对public、scope-members、actors事实的允许及隐藏；代表只能看到public canary，不见成员/导演私密事实或导演理由。每案两次独立冷恢复保留原件。 |
| 招聘新人 | `hire-src.log`、`hire-lib.log`各8项；16案例32进程，真实Driver/三工具/原Channel/独立新人Session，普通及maintenance pause路径。冻结Persona、首条消息及结果通知完成，私密理由不进入新人Session；每案独立cold0。 |
| 外部裁决结果 | `results-src.log`、`results-lib.log`各20项；facts/report/failure/delayed/bootstrap-private × 公司/实验室×JSON/SQLite。40案例80进程，实际director读过canary后提交含私密原文本的裁决，Native投影、结果通知、接收Session排除canary；原私密裁决保留，cold原前缀一致且0推理。 |
| 合计 | 64案例136进程；warm1224次keyless scripted调用，cold0。不是付费真实provider、SDK发行或完整GUI验收。 |
| 拒绝及投影 | `result-native.log`50通过、179未选；`governance.log`54通过；`probe-typed-final.log`原配置及严格解析下1通过。证明exact通知、template约束、私密裁决投影、制度原正文/hash及不可达director代表路径。 |
| 用户World正文 | `user-context-final.log`双后端2通过，真实Native自动选入scope fact，由认证产品调用独立授权读取。另一principal拒绝；没有正文grant时withheld；撤销后旧游标stale，在实际provider读取等待期间撤销则不返回正文。历史档案grant独立于当前actor任职，撤任职不擦除获准档案原件。此处是产品服务边界，不冒称HTTP浏览器认证矩阵。 |

相对于上轮完成构建的Native89冻结输入，`production-input-verification.json`核对1597份生产source/lib文件均未变化，因此复用上轮完整build197证据；本轮新增测试和fixture另行冻结。未增加正式额度、修改超时或刷新快照。2245份相关source/lib/测试输入保存于`manifest89.json`、`source-lib89.tar.gz`，manifest SHA-256为`ba60d56b308c669ce8c994674b158635c0d2898c4c3c54340c17e68e0e5cdbb5`；属于执行后相关输入副本，不是全仓发行冻结。

最终`types-verified.log`类型检查通过；`lint-verified.log`及`probe-lint-typed-final.log`无错误；`doc-sync.log`29/29通过。

## 命令与失败记录

```sh
TMPDIR="$PWD/.local/world-completion/tmp" pnpm exec vitest run packages/simulation/simulation-product/tests/world-context-disclosure.spec.ts
TMPDIR="$PWD/.local/world-completion/tmp" pnpm exec vitest run packages/simulation/simulation-local/tests/world-director-first-action.spec.ts
TMPDIR="$PWD/.local/world-completion/tmp" pnpm exec vitest run packages/simulation/simulation-local/tests/world-external-mediated.spec.ts packages/simulation/simulation-team/tests/world.spec.ts -t 'private|canary|template|terminal|rationale|result notification'
TMPDIR="$PWD/.local/world-completion/tmp" pnpm exec vitest run packages/simulation/simulation-local/tests/world-norms.spec.ts packages/simulation/simulation-local/tests/world-governance.spec.ts
TMPDIR="$PWD/.local/world-completion/tmp" WORLD_ROLE_EVIDENCE_ROOT="$PWD/.local/world-completion/thread-01a1336a-role-projection/loader-src" pnpm exec vitest run --config vitest.snapshot.config.ts examples/simulation-company/tests/world-external-actor.snapshot.ts
TMPDIR="$PWD/.local/world-completion/tmp" CLOCKY_EXAMPLE_MODE=lib WORLD_ROLE_EVIDENCE_ROOT="$PWD/.local/world-completion/thread-01a1336a-role-projection/loader-lib" pnpm exec vitest run --config vitest.snapshot.config.ts examples/simulation-company/tests/world-external-actor.snapshot.ts
TMPDIR="$PWD/.local/world-completion/tmp" WORLD_RESULT_EVIDENCE_ROOT="$PWD/.local/world-completion/thread-01a1336a-role-projection/hire-src" pnpm exec vitest run --config vitest.snapshot.config.ts examples/simulation-company/tests/world-driver.snapshot.ts
TMPDIR="$PWD/.local/world-completion/tmp" CLOCKY_EXAMPLE_MODE=lib WORLD_RESULT_EVIDENCE_ROOT="$PWD/.local/world-completion/thread-01a1336a-role-projection/hire-lib" pnpm exec vitest run --config vitest.snapshot.config.ts examples/simulation-company/tests/world-driver.snapshot.ts
TMPDIR="$PWD/.local/world-completion/tmp" WORLD_MEDIATED_ONLY=facts,report,failure,delayed,bootstrap-private WORLD_MEDIATED_EVIDENCE_ROOT="$PWD/.local/world-completion/thread-01a1336a-role-projection/results-src" pnpm exec vitest run --config vitest.snapshot.config.ts examples/simulation-company/tests/world-external-mediated.snapshot.ts --maxConcurrency=2
TMPDIR="$PWD/.local/world-completion/tmp" CLOCKY_EXAMPLE_MODE=lib WORLD_MEDIATED_ONLY=facts,report,failure,delayed,bootstrap-private WORLD_MEDIATED_EVIDENCE_ROOT="$PWD/.local/world-completion/thread-01a1336a-role-projection/results-lib" pnpm exec vitest run --config vitest.snapshot.config.ts examples/simulation-company/tests/world-external-mediated.snapshot.ts --maxConcurrency=2
TMPDIR="$PWD/.local/world-completion/tmp" pnpm exec tsc -b tsconfig.host.json
TMPDIR="$PWD/.local/world-completion/tmp" pnpm run doc-sync
```

开发失败均保留：用户测试首轮lint的void泛型/括号已修；director probe首轮ownerName不匹配被合法拒绝，第二轮原本期待代表创建却被真实规则拒绝。最终测试改为断言实际准入拒绝，并删除无关plan额度扩大，使用原配置复跑通过；类型检查发现probe将JSON对象直接断言为authority，已改为严格字段解析并复跑。未改生产以迎合错误假设，没有提交或推送。

F07仍需完整Norm/领域正文角色矩阵及真实认证用户端到端撤权、迟到响应验证；此次用户产品服务证据和事实角色矩阵不替代这些范围。普通角色主动通信、显式批准发布与可信结果自动传播分别受自己的权限约束；F08不声称阻止合法通信中的所有潜在隐写。
