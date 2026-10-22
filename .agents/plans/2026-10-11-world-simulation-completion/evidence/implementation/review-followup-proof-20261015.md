# 开发复查与修复

2026-10-15 重新审查 World 执行/暂停/治理、产品读取/管理/授权和双 SDK 衔接。真实模型继续按用户要求跳过；没有新增 checklist 条目，也没有修改持久版本、授权规则或业务预算。仅使用一个 subagent 独立审查产品和 SDK 契约。

## 修复的实际问题

1. **普通读取失败未标记缓存过期。** `SimulationRuntime.read()` 原先仅对 statuses/preflight/worldPreflight 设置 stale，目录、集合等在一次HTTP错误后保留旧值却仍是fresh。现在所有实际保留值在网络错误后都标记stale，成功观察再清除；私有World案件详情仍按原合同丢弃。目录回归先在旧实现上失败，再验证修复；集合回归同时验证失败保留和成功刷新。
2. **领域页没有遵守完整回复字节预算。** `readWorldDomain()` 原先只按行数切片，再拒绝超限的整页。实际20条短norm、合法maxBytes5000配置即可使默认页失败，而单行完整回复1925字节可读。现在按完整DTO序列化大小缩减行数，cursor仍绑定原query/limit/generation，推进量等于实际返回行；单行仍超限明确拒绝，不截断结构。JSON/SQLite回归逐页验证≤5000字节、原norm完整无重复/遗漏和单行拒绝。

## 修正的测试证据

外部联系纯投影fixture漏填Native请求必需的sequence，导致record来源无效；补充两个原请求的1/2序号（早于contact的10/20），并断言来源确实引用原请求。没有放宽生产parser，也没有把这种手工fixture称为真实Native提交。

Administration旧测试预期缺Team服务时进入构造函数再抛错；`teams`已经是必需注入，Cordis此时保持插件未激活。现断言无服务、无命令日志、无run open、无模型调用，保持实际依赖装配语义。第一次新断言错误假定日志仍存在，观察到日志也不存在后改为准确的未创建断言；失败日志保留。

README与原product-directory Agent Note的双语合同同步更新并重录pair。新增返回值JSDoc导致API目录校验发现过时的派生文件，已经通过 `pnpm run gen-cordis-catalog` 重生成API目录及双语子系统片段；没有手改生成区。

## 验证范围与原始结果

所有过程材料位于项目内 [review-20261015](../../../../../.local/world-completion/review-20261015)。

| 范围 | 结果 |
|---|---|
| runtime相关 | 12files/193通过，包含网络失败与刷新恢复；单文件23项是重叠验证，不重复计数 |
| 领域分页、联系人和披露 | 4files/18通过；补充来源断言后contact2再次通过 |
| 真实Web读取生命周期 | JSON/SQLite 2案通过；1440×1000、zh-CN、Playwright。单次HTTP失败与WebSocket断开分别验证，保留原实体且刷新恢复；原Native state不变、0 writable open、0 pageerror、无框架错误覆盖层 |
| 首轮宽范围 | 258files：249通过/8失败/1跳过；4538tests：4526通过/11失败/1跳过。10项超时、1项旧依赖预期；[完整日志](../../../../../.local/world-completion/review-20261015/focused-first.log) |
| 第一批失败相关筛选 | 6files/42通过，332项因明确name filter未执行；原阈值不变 |
| 失败文件整组串行复验 | 8files：6通过/2失败；380tests：374通过/6项不同用例超时。首轮失败均已通过，但本轮仍非全绿；[原日志](../../../../../.local/world-completion/review-20261015/failure-files-final.log) |
| 新超时项单独复验 | 2files/9通过，251项因name filter未执行；[原日志](../../../../../.local/world-completion/review-20261015/isolated-timeouts.log) |

这些计数存在重叠，不相加成唯一通过总数。整组运行存在间歇性时间敏感失败，根因尚未定位；不能仅凭单独通过就归因于机器负载或宣称整轮全绿。没有更改测试超时、重试次数、覆盖门槛或业务上限。首次Network red、分页复现、fixture错误和doc-sync目录失败均保留。

浏览器证据：[JSON](../../../../../.local/world-completion/review-20261015/browser/json-http-failure-retained.png)、[SQLite](../../../../../.local/world-completion/review-20261015/browser/sqlite-http-failure-retained.png)。当前无Browser插件，使用仓库已有Playwright；测试调用真实Loader/Host，故意注入的HTTP connection reset属于被测故障，不代表应用异常。新增browser步骤未替换既有握手、旧响应退役、重连及插件重新挂载断言。

最终构建、Host/Client类型、完整lint、生成catalog消费者测试、doc-sync和diff-check的准确命令/退出码见 [final-commands.json](../../../../../.local/world-completion/review-20261015/final-commands.json)。本次没有重新执行真实provider、全平台CI、收费预算或全部SDK发行矩阵；DTO/schema未改变，源码SDK包含在首轮宽范围回归中。

最终上述六步全部退出0：完整build输出197个Client artifacts，Host/Client类型及全lint通过，API目录消费者15项通过，doc-sync29/29，diff-check通过。[16个改动owner文件的归档与最终命令](../../../../../.local/world-completion/review-20261015/completion.json)保留精确源码指纹，不宣称覆盖全部传递依赖。
