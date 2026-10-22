# P04：请求权限与制度准入验收

2026-10-13，Asia/Tokyo。P04 完成，Native88/compiler9。只完成本项的新请求准入，不将其扩张为所有读取/正文权限、SDK 分发或 UI 总验收。

## 实现与反例

[核心准入](../../../../../packages/simulation/simulation-local/src/world.ts)要求任职岗位和组织仍 active、noncognitive；实际 operation grant 的端点保持 active，并符合原 relationRules 的主体/目标/作用域类型。profile.role/director/requester 文本不能替代 Native 身份、当前任职或实际授权。`lifecycle-red.log` 先复现岗位、scope 和 target 终止后的双后端新案件漏洞，修复后8项通过。原 accepted request 的精确 receipt 重试仍返回原件，不新增案件。

[招聘策略准入](../../../../../packages/simulation/simulation-local/src/world-hire-approval.ts)在请求阶段核验全部当前有效 validated 制度的岗位白名单，即使 availableAt 尚未到达或 audience 不包含请求人；advisory 与未来生效制度不提前限制。生成招聘还核验实际 active、noncognitive 的组织与岗位。尚无 accepted request 的预开 intent，在首次实际目标提交时重新进入 domain admission；`policy-red.log` 先复现四个漏验，`policy-green.log` 32项通过。此处的 Norm 插入是明确的纯准入输入，完整制度来源由真实 Loader 正/负矩阵验证。

审批依赖原案件 ID，不能在建立案件之前要求已通过的同案审批。允许岗位继续建案，之后仍在 reserve/commit 两处取得和核对原委员会审批。拒绝消息不包含私密制度正文或身份；模型可从实际工具拒绝中得知失败，放弃原提案并提交零效果。Native88 明确拒绝旧请求准入语义的历史，不迁移或静默重新解释旧记录。

## 最终证据

[原件与日志](../../../../../.local/world-completion/thread-01a1336a-admission)全部在项目内。

| 范围 | 结果 |
| --- | --- |
| Native88 | `native88.log`：4文件/54项，包括0–87/99旧流拒绝、生命期、预开intent/有效私有政策、既有人物准入 |
| 相关领域回归 | `regression88.log`：8文件/146项，涵盖招聘、资金、审批、治理、外部及人员 |
| 伪造身份/版本/作用域 | `forgery88.log`：25项；JSON/SQLite上的未知domain/operation/version、伪造requester/Session/proof/director、实际foreign organization、旧writer和被替换Agent；未选测试不计通过 |
| 定向检查 | `lint-final.log`、`runner-lint.log` 无错误；`build88.log` 完整构建/197 client artifacts；`doc-sync88.log` 29/29 |
| 真实 Loader 正反路径 | `source88.log` 与 `lib88.log` 各12项。负向覆盖JSON/SQLite × 生成/既有人物：真实三工具收到当前私有制度拒绝，随后零效果提交；0World intent/request/plan/result、0资金预留/支付，请求人Session无私密canary。正向覆盖公司/实验室 × 双后端：原案件之后的独立投票审批、一次录用、原身份/记忆及私有Channel |
| 独立冷进程 | `matrix88.json`：24案例/56进程，warm1984次scripted模型调用、cold0；负向8案例各两次cold，正向16案例各一次cold。目录保留原Native、Session及进程输出，非真实provider验收 |

2234份simulation与示例相关source/lib/测试及配置输入保存在 `manifest88.json`、`source-lib88.tar.gz`；manifest SHA-256为 `d27a7680bf20437ad9c8304ef82d8a55dbc4537092f9c931a82b1b6a01b3ae8a`。这是相关范围，不是全仓最终发布冻结。只在测试 runner 中新增可选保留原件开关，未提高任何预算、修改超时或刷新快照。

## 准确命令

```sh
TMPDIR="$PWD/.local/world-completion/tmp" pnpm exec vitest run packages/simulation/simulation-local/tests/run.spec.ts packages/simulation/simulation-local/tests/world-request-policy.spec.ts packages/simulation/simulation-local/tests/world-admission-lifecycle.spec.ts packages/simulation/simulation-local/tests/world-hire-existing.spec.ts
TMPDIR="$PWD/.local/world-completion/tmp" pnpm exec vitest run packages/simulation/simulation-team/tests/world.spec.ts -t 'self-authored|old world writer|model-selected.*plan'
TMPDIR="$PWD/.local/world-completion/tmp" pnpm run build
TMPDIR="$PWD/.local/world-completion/tmp" WORLD_AUTHORITY_EVIDENCE_ROOT="$PWD/.local/world-completion/thread-01a1336a-admission/loader88" WORLD_ADMISSION_EVIDENCE_ROOT="$PWD/.local/world-completion/thread-01a1336a-admission/approval88" pnpm exec vitest run --config vitest.snapshot.config.ts examples/simulation-company/tests/world-request-authority.snapshot.ts examples/simulation-company/tests/world-norm.snapshot.ts examples/simulation-company/tests/world-hire-existing.snapshot.ts
TMPDIR="$PWD/.local/world-completion/tmp" CLOCKY_EXAMPLE_MODE=lib WORLD_AUTHORITY_EVIDENCE_ROOT="$PWD/.local/world-completion/thread-01a1336a-admission/loader88" WORLD_ADMISSION_EVIDENCE_ROOT="$PWD/.local/world-completion/thread-01a1336a-admission/approval88" pnpm exec vitest run --config vitest.snapshot.config.ts examples/simulation-company/tests/world-request-authority.snapshot.ts examples/simulation-company/tests/world-norm.snapshot.ts examples/simulation-company/tests/world-hire-existing.snapshot.ts
TMPDIR="$PWD/.local/world-completion/tmp" pnpm run doc-sync
```

保留的开发失败包括：初轮CLI误读v1 assignments字段、fixture未解析Branded ID、旧纯既有人物夹具缺少真实权限关系的relationRules、格式问题，以及一次无输出exit1的forgery运行。分别以正确字段、严格schema、完整声明和成功复跑修复；不把失败或未选测试当作通过证据。没有提交或推送。
