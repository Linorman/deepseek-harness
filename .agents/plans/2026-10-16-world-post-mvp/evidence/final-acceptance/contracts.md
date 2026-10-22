# H01–H04 契约与恢复验收

2026-10-20。H01–H04 在已完成的 F/A/B/C01–C14/D 及用户授权的本地 E 范围内通过。此次仅检查源码、测试和证据，未修改实现或 checklist，未重复运行输入未变的测试。

| 项目 | 真实证据与验收范围 |
|---|---|
| H01 | Product public/persisted 输入采用严格 parser；branch journal 校验原命令及状态帧，backup 校验完整 hash/版本/引用闭包。[Server 真实分派测试](../../../../../packages/sdk/server/tests/simulation-world.spec.ts)覆盖 owner lookup 前拒绝附加字段；[Python experiment](../../../../../python/sdk/tests/test_simulation_experiments.py)及[retention](../../../../../python/sdk/tests/test_simulation_retention.py)覆盖严格标量、状态字段、UTF-16 长度及原选择不符。 |
| H02 | [D/E 独立审查](../de-review/review.md)及[真实导入进程矩阵](../d1/product-import-matrix.json)覆盖 JSON/SQLite、写前故障、提交后丢回执、惰性 Session 预留重试、SIGKILL 后冷恢复、unknown 责任、跨 owner receipt 及来源时间承诺；原义务未因重试释放。 |
| H03 | [原契约日志](../implementation/de-contracts.log)2242 项、[Python 日志](../implementation/de-python.log)1003 项的输入保持匹配。TS/Python 拒绝未知必需 Session event，仅将未知 `ignorable: true` 从 typed transcript 省略；Python 对照 Core 已知事件词表。[最新 built 日志](../de-review/built-snapshots.log)为 plain Node 三快照 6/6。 |
| H04 | [真实认证 fetch](../../../../../packages/host/apiproxy/tests/world-creation.spec.ts)并发发送同一 command 返回同一 run，同 ID 改 payload 拒绝；[请求恢复](../../../../../packages/host/apiproxy/tests/simulation-request-recovery.spec.ts)及[Client 原命令测试](../../../../../packages/client/runtime/tests/simulation-administration.client.spec.ts)覆盖 timeout/断线、竞争提交合并、刷新查询原件和未知回执对账。预览/查询/导出及显式创建证据断言零模型调用。 |

[机器记录](contracts.json)保存全部来源 manifest hash、原日志期望/实际 hash 和当前构建产物 hash。`de-final-validation.json` 的 1605 个源码条目与后续 `de-review/hashes.json` 的 26 个条目按新覆盖旧合并，得到 **1613 个当前源码输入，漂移 0**；其中 Host 84、Client runtime 135、connection 39、TS SDK 82、Python SDK 69 个。两份 manifest 登记的 **34 份原日志全部匹配**，包含先前失败日志；失败日志保留为复现证据，不计为通过。

旧 manifest 的 12 个构建 hash 中，仅 `packages/simulation/simulation-team/lib/index.js` 随后续分支修复变化；当前 SHA-256 为 `55ce9a023aab9fbc3a8f01bf69f6bd1c55b2afd3c95707048aba6352f19351ff`。最新独立审查已重新完整 build 并通过 built 6/6，旧 manifest 保持历史原件。

C15/C16 人评继续暂缓，E01/E07/E08/E15 维持未验收。分支支持 initial/settled seed、可表示文本记忆及现有局部协议限制；本记录不扩张为真实 provider、跨主机或生产安全资格，也不把有限拒绝和恢复矩阵称为所有故障组合的穷尽证明。
