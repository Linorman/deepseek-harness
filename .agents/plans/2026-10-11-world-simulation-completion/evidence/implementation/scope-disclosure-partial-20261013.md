# F07：动态作用域披露修复（部分验收）

2026-10-13，Asia/Tokyo。F07/F08 保持未勾选，清单保持79/112。Native89/compiler9。完整跨角色、领域正文和认证用户读取矩阵仍待验证。

## 修复及反例

[当前成员关系](../../../../../packages/simulation/simulation/src/world-membership.ts)由请求准入、scope-members 事实/制度查询及新公告收件人共享：读取当前 Native 时间，要求读者、岗位和组织 active，岗位/组织为 canonical noncognitive 类型。历史内容时间/cursor 不恢复当前已经结束的任职；原历史 Native 前缀仍能重建原材料，已接受公告的冻结收件人不被回写。

[上下文](../../../../../packages/simulation/simulation-local/src/context.ts)持久保存实际选择正文的 `worldScopeAccess`，重试准备、读取、提交及模型准入重验。此字段不进入模型正文或公共 Session DTO。缺少原派生证据或权限失效拒绝，旧 view 和已消费历史保持原件。旧流0–88/99拒绝，不迁移。

[Team](../../../../../packages/simulation/simulation-team/src/index.ts)在下游 pre-step 等待及展示校验之后、Session 写入紧前同步检查当前 Native snapshot；模型容量等待后继续复验，并在异步准入完成后、进入下游模型 waterfall 紧前再次同步检查。拒绝发生在标记 dispatched 之前，因此真实 Token 预留结算为 `not-dispatched`。已派发 IO 不在这一撤销边界内。

原反例保存在[本轮原件](../../../../../.local/world-completion/thread-01a1336a-scope-disclosure)：`dispatch/prestep-red.log` 的四项双后端测试实际撤销岗位/组织，provider 为零但 Session 已泄露 canary；`dispatch/prestep-final.log` 修复后14/14通过，涵盖缓存准备、真实模型池排队、pre-step屏障和已消费历史保留。`announcement/before.log`复现失活端点仍进入新公告，`announcement/final.log`修复后22/22。

## 验证范围

- `native89.log`：7文件94项，在同步边界补丁之前验证当前成员/派生证据/Native版本拒绝及相关context、business-context、facts、Norms行为。
- `dispatch/prestep-final.log`：最终同步边界14项；`dispatch/metered-tests.log`：真实 Native writer/预留的额外1项，同步拒绝后下游零调用、Token占用100→0。
- `boundary-regression.log`：415项中413通过；原通知来源加强后一个旧错误文本断言失效，已更新；另一个task-review测试超时。`boundary-regression-retry.log`按原5000ms时限复跑这两项通过，396未选项不计新通过。
- `loader-source89-focused.log`：源码模式JSON/SQLite两项真实Loader，warm各14次scripted调用、cold各0；未派发canary保留于原Native上下文，首次Session/模型拒绝，冷恢复读取仍拒绝。

- `loader-lib89.log`：构建模式双后端2项；`matrix89.json`核对最终src/lib × JSON/SQLite共4案例/8进程，warm56次scripted调用、cold0。
- `build-boundary89.log`完整构建197 client artifacts；`doc-final89.log`文档门禁29/29；`boundary-lint.log`、`lifecycle-lint.log`、`dispatch/metered-lint.log`无错误。

最终相关source/lib/测试及配置2243份冻结于 `manifest89.json`、`source-lib89.tar.gz`，manifest SHA-256为 `6f0ff100e62d71d842b5afe258a0d42ced65099343016deb5e1ca1c46aede1b5`。这是相关输入的执行后副本，不是全仓发布冻结。

`world-scope-disclosure.spec.ts`的Norm正文使用真实Native快照上的已解析纯投影输入，不冒称真实治理发布。新公告则使用实际 `applyNormEffect` 和实体状态转换。Loader调用为keyless scripted，不是付费provider验收。

## 准确命令及未完成项

```sh
TMPDIR="$PWD/.local/world-completion/tmp" pnpm exec vitest run packages/simulation/simulation-local/tests/world-context-access.spec.ts
TMPDIR="$PWD/.local/world-completion/tmp" pnpm exec vitest run packages/simulation/simulation-team/tests/metered-stream.spec.ts
TMPDIR="$PWD/.local/world-completion/tmp" pnpm exec vitest run packages/simulation/simulation-team/tests/pause-admission.spec.ts packages/simulation/simulation-team/tests/lifecycle.spec.ts packages/simulation/simulation-local/tests/token-integrity.spec.ts
TMPDIR="$PWD/.local/world-completion/tmp" pnpm exec vitest run packages/simulation/simulation-team/tests/lifecycle.spec.ts -t 'rejects changed or missing claimed payloads|waits for canonical task review'
TMPDIR="$PWD/.local/world-completion/tmp" pnpm run build
TMPDIR="$PWD/.local/world-completion/tmp" CLOCKY_EXAMPLE_MODE=src WORLD_SCOPE_EVIDENCE_ROOT="$PWD/.local/world-completion/thread-01a1336a-scope-disclosure/loader-final" pnpm exec vitest run --config vitest.snapshot.config.ts examples/simulation-company/tests/world-scope-disclosure.snapshot.ts
TMPDIR="$PWD/.local/world-completion/tmp" CLOCKY_EXAMPLE_MODE=lib WORLD_SCOPE_EVIDENCE_ROOT="$PWD/.local/world-completion/thread-01a1336a-scope-disclosure/loader-final" pnpm exec vitest run --config vitest.snapshot.config.ts examples/simulation-company/tests/world-scope-disclosure.snapshot.ts
TMPDIR="$PWD/.local/world-completion/tmp" pnpm run doc-sync
```

一次 `pnpm run test:snapshot -- <file>` 参数透传意外启动额外用例，已停止该运行及已识别子进程；保留 `loader-source89.log`，不计为验收。之后使用上述直接Vitest文件过滤。未增加额度或超时，未刷新快照、提交或推送。

尚待完成：同一public/actors/scope-members材料的普通成员/director/外部代表矩阵、领域专有正文授权、真实认证用户撤权及迟到响应、F08低权限结果可信结构投影。此次不新增checklist条目，也不将局部安全修复冒充F07完成。
