# C24：稳定身份与原实施租约

X01 和 P15 的 owner 契约已核对，现有条目据此验收。[精确输入清单](c24-identities-leases-inputs.json)包含 Native75 的 identity/registry/runtime/dispatcher 源和 focused tests，聚合 SHA-256 为 `b9af722a810ef4d18913a7070985b91c45478b5c762c6eb070b6075e5425c922`；不是传递依赖清单。

```sh
TMPDIR="$PWD/.local/world-completion/tmp" pnpm exec vitest run packages/simulation/simulation-local/tests/world-external.spec.ts packages/simulation/simulation/tests/world-domain.spec.ts packages/simulation/simulation-local/tests/world-domain-disposal.spec.ts packages/simulation/simulation-world/tests/execution.spec.ts
TMPDIR="$PWD/.local/world-completion/tmp" pnpm exec tsx scripts/run-oxlint.ts packages/simulation/simulation-local/tests/world-external.spec.ts packages/simulation/simulation-local/tests/world-domain-disposal.spec.ts
```

2026-10-12，4 files/74 tests 通过；日志为项目内 `.local/world-completion/c24-external-boundary/identity-domain-final-tests.log`，最终 lint 无诊断。owner 单测使用 source，Local disposal 使用 JSON provider；registry/dispatcher 的 generation 和 lease 语义不依赖存储后端。真实 JSON/SQLite source/plain Node lib 身份和 unknown 库存链路复用已冻结 [C14 原件](c14-external-report.md)，最新 v3 实际代表／跨表示复用见 [C23](c23-mediated-actor-proof-20261012.md)及其 [root 原件核验](c23-mediated-actor-root-audit-20261012.json)。不声称 compiled 单测卸载或新的 SIGKILL 矩阵。

稳定身份按原 run、scope、externalKey 派生。focused test 补充三个命名空间的独立性，并通过 executor 拒绝错误 scope；相同名字或不同 Decision/request 不能将原 key 重绑给另一主体。实际规则链路有两次同 key 查询和另 key 未建库存，结果分别 known7/known7/unknown；不存在库存账户才返回 unknown，明确零余额才返回 known0。账面库存不产生信用判断，未安装信用策略不输出默认零值或已核实承诺；新字段和隐藏条件不能绕过严格 parser。X01 不代表已完成 v1 的预配置 registry 输入或外部公开产品查询。

注册表固定 schemaRef、implementationRef、generation。接受的 Native manifest 持有原纯 reducer 租约，executor 的每个实际原计划持有原 handler 租约；payload/hash 或 generation 不符在 IO 前拒绝。注册卸载同步关闭新 admission，等待已准入 callback；原责任未知时返回 implementation-unavailable 并继续持有原 lease，只能由该原 handler reconcile。并发 execute/reconcile 不能重复执行原计划，新 generation 不重定向旧计划、未知 mutation 或结果。测试验证 disposer 排空、未知责任保留、精确 release、schema tombstone、替代 generation 和真实 Cordis Fiber effect 生命周期。

Local provider 的 disposal 测试扩展至 external v3，与 v1/v2 一起核验 unload 后关闭 admission、下一 plugin lifetime 使用新的 registry；未知 provider cleanup 不提早释放原 lease，也不让原 pin 在同 registry 重注册。现有 55 项首次检查、扩展后 56 项和最终 74 项日志均保留；初次扩展的缩进 lint 错误仅作历史诊断，最终 lint 已修正。SDK 缺版本拒绝、通用 public DTO、v1 authoring 和真实模型质量仍按未完成条目推进。
