# P11 进展：补证数据合同与字段注册

2026-10-13，Asia/Tokyo。**P11 未完成，保持未勾选。** 本轮只完成数据格式、公共入口和注册约束，没有启用 Native 补证流程。Native85/compiler8未改变。

[公共 schema](../../../../../packages/simulation/simulation/src/world-evidence.ts)增加询问、文本回答、challenge/revision、品牌身份和状态结构。询问/回答拒绝模型自带actor、binding、responders等授权字段，字段及响应者不得重复；终态结算序号晚于创建，answered必须指向修订。来源引用通过[共用叶模块](../../../../../packages/simulation/simulation/src/context-reference.ts)解析，现有context sources不再内嵌另一份联合。

[领域注册表](../../../../../packages/simulation/simulation/src/world-domain-registry.ts)支持可选有限`evidenceFields`元数据，注册时复制、冻结并验证。schemaRef tombstone同时保留原parser身份和字段定义：注销后改名、改写说明或移除字段仍需新schemaRef。原provider数组的后续修改不影响注册结果。

当前World action/resolution/context联合仍未接入这些新结构；Native challenge状态迁移、实际Channel消费、输入修订读集、deadline/次数结算、driver和SDK投影、真实Loader恢复仍待完成。字段描述不从director自由文本取得，原request/plan不会因这个数据合同自动改写。[Owning note](../../../../notes/implemented/architecture/2026-10-13-world-evidence-data-contract.md)说明当前边界；后续实现继续同一个P11，不增加或替换checklist项。

## 已验证范围

- 严格schema与registry：86项通过，包括未知字段、伪造身份、重复字段/响应者、状态/序号、冻结副本和schemaRef变更拒绝。
- 现有Native context/business-context：25项通过。
- 编译后package exports：plain Node smoke通过，实际从`/lib/`载入新schema/reference/registry入口并验证严格解析和冻结语义；无模型调用。
- 类型构建、定向lint、build197和最终doc-sync29/29通过。

这些不是补证端到端证据，不能支持勾选P11或其他运行流程项。

```sh
TMPDIR="$PWD/.local/world-completion/tmp" pnpm exec vitest run packages/simulation/simulation/tests/world-evidence.spec.ts packages/simulation/simulation/tests/world-domain.spec.ts
TMPDIR="$PWD/.local/world-completion/tmp" pnpm exec vitest run packages/simulation/simulation-local/tests/context.spec.ts packages/simulation/simulation-local/tests/business-context.spec.ts
TMPDIR="$PWD/.local/world-completion/tmp" pnpm run build
node .local/world-completion/thread-01a1336a-evidence-protocol/artifact-smoke.mjs
TMPDIR="$PWD/.local/world-completion/tmp" pnpm run doc-sync
```

[日志与副本](../../../../../.local/world-completion/thread-01a1336a-evidence-protocol)保留`registry-retry.log`、`context-regression.log`、`artifact-smoke-owner.log`、`lint-corrected.log`、`build.log`及`doc-sync-final.log`。315份该包source/lib、相关测试和lock配置的快照共3,369,915字节；manifest SHA-256为`314f468dab957ae138e98d93a108f62120160dce1a647b611ff95f6f823f21cb`。这是数据合同包的输入范围，不是全运行时冻结矩阵。

初轮问题均保留：Vitest `it.each([])`将空数组拆成无参数，改成具名fields用例；非法fixture需显式unknown边界转换；编译入口探针不能从根临时目录解析未声明的zod依赖，改为通过目标包的真实export解析且复用其严格schema；格式、Agent Note章节名与生成API目录已修正。未放宽schema、时限或预算。
