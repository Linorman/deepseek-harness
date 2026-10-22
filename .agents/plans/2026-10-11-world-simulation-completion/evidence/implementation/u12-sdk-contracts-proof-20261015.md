# U12 双 SDK 与 Native／产品合同

2026-10-15；Native96、checkpoint manifest6、Product journal4 及公开 DTO 版本不变。完成原 U12，100/112，未新增 checklist 项。

最终 61 个 owner 输入的 manifest hash 为 `91eef8f2438d289cf4b52267eca8b10095e8726fb859ccd81c8718e2be6256ea`。[最终更正报告](../../../../../.local/world-completion/u12-expiry-sequence/report.json)逐文件记录 SHA-256；[字节归档](../../../../../.local/world-completion/u12-expiry-sequence/inputs-final.tar.gz) SHA-256 为 `792153f57ead213e23f02bdcbb29b763e592861c5d323d1f7eb89e36d368913f`。Root [重新读取归档的 61 个文件](../../../../../.local/world-completion/u12-expiry-sequence/root-archive-verification.json)逐一核 hash；未用 HEAD 或后续 U13 可变文件代替输入。旧 ID、reason、optional 报告及归档保留，最后的 expiry-sequence 报告明确更正前一报告遗漏。

## 合同与修复

[18 行逐 DTO 核对表](../../../../../.local/world-completion/u12-optional-owner/report.json)涵盖管理字段／三动作／预览／影响／费用／提交／结果、执行观察、用户来源、Native resource hold、原请求／重试、案件 v3 四区／取消／分页、领域九类读取、错误和必需事件。最后一份报告的 hold 边界表和 221 条 shared corpus 补足原 seed 未带的 optional 子对象。

Product 管理 commandId 复用 Native 1–256 UTF-16 单元约束，并保留 Product brand；其他 command family 和未知 family 的查询／重试 selector 不继承这一上限。管理 outcome 的 result.id 复用 Native WorldResultId brand。Python 对 ID、reason、用户来源、费用 ID 和 hold ID 使用各自 owner 的相同约束；reason 为最大 65,536 UTF-16 单元且按 JavaScript trim 判非空，保留原文本。Python 共享 Identity 接受严格非空 JavaScript 字符串，没有额外最大长度、trim 或 NFC；只将合法 surrogate pair 合成与 Node JSON 往返相同的值，保留孤立单元。

Python RequestResult 在进入 found／not-found 分支前拒绝分支外 key，包括显式 null。Case owner 的可选非 nullable 字段必须缺省，显式 null 拒绝；真正 required nullable 字段必须存在并保留 null。该规则局限于原 Case owner，没有全局重写 BaseModel。公共用户来源仍不是授权凭证；私有 Native funding-admission 没有 Python 公共 consumer，未添加虚构 DTO。

复核发现 Native `world.expiryConsumed.sequence` 允许 0，而 Python 新 helper 误用了 Positive；已改用原 ObservationCount（0..MAX_SAFE）。最终 [221 条完整 hold 语料](../../../../../python/sdk/tests/fixtures/world-native-hold-boundaries.json)用实际 Native source parser 作 oracle，覆盖全部八个 safe-number 槽、模拟时间／数量／period／version 字符串、三类 settlement、optional 子对象、必填子字段、required nullable 和数组。TS 与 Python 的接收／拒绝决定完全一致。

## 实际证据

准确命令、日志、模式和原失败保留在[更正报告](../../../../../.local/world-completion/u12-expiry-sequence/report.json)、[optional owner 报告](../../../../../.local/world-completion/u12-optional-owner/report.json)、[reason 报告](../../../../../.local/world-completion/u12-management-reason/report.json)与 [ID 报告](../../../../../.local/world-completion/u12-command-bound/report.json)。

| 范围 | 结果 |
|---|---|
| 最终完整 Python SDK | [954/954](../../../../../.local/world-completion/u12-expiry-sequence/python-full-221.log)，11.20s，全部通过；含最终 221 条完整 hold corpus。日志实际文件由更正报告 checks 指定。 |
| TS Product／SDK 合同 | [4 files / 207 passed](../../../../../.local/world-completion/u12-expiry-sequence/contract-221.log)，包含同一 hold 语料及管理／case／receipt 的严格边界。 |
| nullable 结构 corpus | 21 个合法 owner 样本、152 条 optional-null 拒绝、56 条 required-null 删除拒绝，两端同一语料；包含 12 份实际 Native 用户案件四区与既有角色 DTO。构造的 schema mutant 不冒称 Native 业务执行。 |
| 实际 Native 用户管理 | [22/22](../../../../../.local/world-completion/u12-management-reason/host-final-second.log)，JSON/SQLite：合法 ASCII／astral／mixed／孤立单元原件及精确查询重试；非法 ID／reason 在副作用前拒绝，Product journal／Native 零追加、零新 owner。 |
| 实际 Python transport | 低／高层 SDK 通过独立 Node JSON peer 验证 preview→submit→query→retry 的 Unicode 原值；另外六个独立 peer 返回 malformed null，实际 typed SDK 拒绝。peer 仅是 wire/codec 证明，不是 Native server 或分发证明。 |
| 未知必需事件 | [TS 4/4](../../../../../.local/world-completion/u12-identity-owner/unknown-required-ts.log)及完整 Python 回归显式拒绝未知 required Session event；只有 `ignorable: true` 可保留为 raw，不进入已知 typed transcript。无关过滤用例的 skip 不计为通过。 |
| 类型／lint／编译／文档 | 各最终 owning Host CompilerFace 0 diagnostics，scoped lint／Python compileall 退出 0。Root [完整 build](../../../../../.local/world-completion/u10-actionable/build-third.log)包含当前 TS owner 和 197 Client artifacts；[doc-sync 29/29](../../../../../.local/world-completion/u10-actionable/doc-sync-first.log)。这些门禁与 U10 范围重叠，不另算测试总数。 |

首轮失败均保留：Python codec 把合法 surrogate pair 当不同字符串；Pydantic 内建 length 错拒绝 Native 合法孤立单元；JS/Python whitespace 集合不同；公共 commandId 缺 Native 上限；optional-null 被误接收；expiry sequence 0 被误拒绝。六个新 wire fixture 曾在 shutdown ACK 后写 capture，被实际 close 的 terminate 抢先；fixture 改为 ACK 前写记录，未改生产 shutdown、超时或拒绝断言。

128 个 emoji 的完整 request/plan 实际分别为 4,635/4,852 字节，原 4,096 fixture 按字节上限正确拒绝。只有独立 Unicode 压力 fixture 在编译前明确声明 5,120；未增加生产默认额度，旧失败保留。所有临时／编译产物均在项目内。本项不代表全仓所有 JSON 语言的穷尽等价；U13 compiled client／安装 wheel 及真实 provider 仍按原条目独立验收。
