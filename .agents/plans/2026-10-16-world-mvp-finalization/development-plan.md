# 世界模拟 MVP 剩余开发计划

日期：2026-10-16。本计划执行[剩余设计](design.md)，只补当前真实模型/预算/最终验收差额，不重做已经记录完成的领域。原[112 项 checklist](../2026-10-11-world-simulation-completion/checklist.md)保持原文和勾选；新的[详细 checklist](checklist.md)是 B04/R08/R09/R13 及相关稳定性复核的子任务。

## 1 工作包和依赖

| 工作包 | 交付 | 依赖 | 原验收项 | 责任与相对规模 |
|---|---|---|---|---|
| W0 基线与证据整理 | 当前输入清单、证据漂移表、原失败组清单 | 无 | R13、R11 复核 | 集成维护；小 |
| W1 严格评测配置 | spec parser、价格/能力验证、零副作用 dry-run | W0 | B04 | 评测入口；中 |
| W2 全调用预算与恢复 | dispatch 前持久预留、费用结算、未知占用、总批次上限 | W1 | R09 | Simulation Team/评测所有者；大、最高风险 |
| W3 完整世界真实评测器 | 双场景八例、公共产品路径、自动判定/人工模板 | W1，联调依赖 W2 | R08 | 示例/测试所有者；中到大 |
| W4 时间敏感失败修复 | 可解释复现、修复、正式测试模式验证 | W0，可与 W1–W3 独立推进 | R11 复核、R13 | 失败 owner；规模待定位 |
| W5 有预算真实执行 | 固定 route/price/budget 后运行并保存所有结果 | W2/W3 keyless 通过；实际执行配置就绪 | B04、R08、R09 | 执行及人工评价；模型质量有不确定性 |
| W6 集成验收 | 当前代码、产物、SDK/UI、文档及最终验收包 | W4、W5 | R13 | 集成维护；中 |

关键路径是 W0 → W1 → W2 → W3 联调 → W5 → W6；W4 独立推进并在 W6 前关闭。W3 的用例/检查器可先开发，真实请求必须等 W2 验证。暂不提供日历工期：W2 的 lifecycle 接口可用性和 W4 根因尚需探针，先完成 W0/W1 再按实际差额估算，不把“四个未勾项”理解为四个小修复。

建议按 W1、W2、W3、W4 的独立责任拆可验证变更；W5 是实验产物，W6 是最终集成。依赖 PR 按项目原生 stack 规则处理。此文档不授权提交、发布、付费执行或自动安排未来任务。

## 2 W0 基线和证据漂移

读取当前工作区而不是仅 HEAD，冻结实际选定 owner 源码、fixtures、安装配置、lockfile 和运行版本。建立“历史证据→输入 hashes→当前差异→是否需复验”表；保存旧 108/112 状态及其证据，不把较早全绿覆盖后续失败。

重点读取 [R11 验证报告](../2026-10-11-world-simulation-completion/evidence/implementation/r11-final-verification-proof-20261015.md)与[复查报告](../2026-10-11-world-simulation-completion/evidence/implementation/review-followup-proof-20261015.md)。后者的失败日志及精确命令才是 W4 输入，不能从摘要猜失败文件。检查已有 live benchmark 与完整 World 样本的不同，列清待新增入口。

退出：能由 manifest 复原本轮所评代码和环境；每条旧证据标为可复用、需复验或不适用；所有相关已知失败有 owner 和关闭标准。本次文档生成的 [baseline](evidence/baseline.json)仅是静态核对，不替代实施时冻结。

## 3 W1 配置和无副作用入口

建议新增 `scripts/world-eval-options.ts`、`scripts/evaluate-world.ts` 和对应 owner 测试，具体名称为计划而非当前文件。复用 [benchmark options](../../../scripts/simulation-benchmark-options.ts) 的路径和数值校验风格，保持 World eval 与单 actor benchmark 的语义分开。

严格解析 suite/model/price/currency、每 run/整批 token/call/cost/time/mutation 限制、输出位置和 disclosure。校验 route 元数据不发送模型请求；需要远端 probe 时显式单列并计费。价格上界、输出限制或隐藏重试能力不足就诊断失败，不允许“费用未知按零”。

dry-run 输出目标场景、调用上界、成本上界、缺失字段和预计证据位置，断言存储身份/模型调用均为零。spec 与价格一旦接受 immutable；改变配置需新实验身份。退出：所有错误形状、非法金额/溢出、坏路径、版本缺失、未知能力在 dispatch 前被拒；运行器未实现前不将示例命令写成可用教程。

## 4 W2 预算、结算和未知恢复

先做一个真实调用关系探针：从 [metered stream](../../../packages/simulation/simulation-team/src/metered-stream.ts)追到 Native reservation、Session prefix、模型池和实际 provider 入口，证明普通对话与 compaction 都能在 dispatch 前定位唯一尝试。必要的窄接口放在拥有者，不从私有对象推断身份。

按顺序实现：持久评测账 schema/fold → 批次/run 原子费用预留 → 排队后的最终检查 → 原尝试派发/结算关联 → unknown 与排他恢复 → 明确停止 DTO/报告。只为实际新增 durable schema 选择版本策略，不为了 eval 脚本机械递增 Native stream 或 Session format。

必须测试同预算并发竞争、最后一笔刚好/多一单位、整数舍入、缓存与推理 token、合法零 output、重复/冲突 settlement、缺 usage、overrun、排队取消、权限撤销以及辅助调用。故障注入覆盖费用预留前后、可能 dispatch 标记后、provider 返回后/Session flush 前、Native 结算后/费用结算前；新进程对账不重新推理。

退出：确定性 provider 的每个实际请求均能关联已持久预算预留；总调用和上界不超 cap；unknown 不释放且阻止后续真实推理；原 token 和业务事实未被第二份账改写。不得通过增加 retry、timeout 或预算让断言通过。

## 5 W3 完整 World 评测器

复用 [complete-world scenario](../../../examples/simulation-company/tests/complete-world-scenario.ts)、[真实 Loader fixture](../../../examples/simulation-company/tests/fixtures/complete-world/cordis.yml)及 [v1 产品路径](../../../examples/simulation-company/tests/world-v1-product-scenario.ts)。提取通用启动/暂停/观察流程，把 scripted 模型保留在 keyless 测试入口；live 模式加载真实 provider 并从目标材料开始，不能导入 scripted 输出选择器。

新增拟议 `world-live-eval-scenario`、八例 suite、只读自动检查器、人工 rubric、报告生成和脱敏。检查器验证实际业务里程碑、原身份/票/资源/Session 及失败终态；按允许语义判断，不要求模型产生固定措辞或固定无关调用顺序。完整记录失败、incomplete 和 usage-unknown，重试另记尝试，不删旧结果。

退出：keyless positive/negative 用例证明检查器会拒绝伪造通过、丢失阶段、重复效果、越权和隐私泄漏；真实模式从配置上不能回退到 scripted；只读/报告生成和已接受结果恢复零模型。更新示例 README、参数帮助和明确执行入口，但不把测试 helper 列为产品 API。

## 6 W4 稳定性复核

从复查原日志提取确切失败用例和执行条件，优先原组复现，保存事件时序、进程退出、资源占用和所有未处理错误。若缩小用例后失败消失，保留原组并逐步缩小依赖组合；不先归因“机器忙”。

产品缺陷由 owning runtime 修复；测试等待错误应等待实际状态/事件；环境前置不足必须以测量证据和检查脚本明确。修复保留原测试强度和生产 timeout。退出至少包括原失败组在正式模式通过、相关 lifecycle/recovery 回归通过、重复验证未发现同因失败，并解释证据范围；仍有未定位时间敏感失败则 R13 保持待验。

## 7 W5 真实执行和质量评估

执行前需要：明确 provider/model/profile 与可用凭证引用、冻结费率、每 run/整批硬预算、上述 keyless 通过、预先登记的 suite/rubric。当前文档不需要这些配置即可交付，但实际收费步骤缺任何一项都不得开始。

先做计入总预算的最小 route/usage probe，确认完整 usage、实际模型标识、output 上限和无自动 retry。再串行运行公司/实验室各 V/M/A/P 四例，逐例保存原数据库/Session 来源和自动结果；可独立判读时即人工评分。发生硬不变量失败或 usage-unknown 时停止剩余调用；普通质量失败按预登记策略保留并结束该样本，不追加隐藏补考。

退出：八例有完整分母和判定，两条有效剧本完成，负向/隐私样本安全终态符合设计，人工 applicable 项无 0 且均分达到预先门槛，所有费用和未知占用可对账。若任一要求不足，返回精确原因和修复 owner，R08/R09 不勾选。预算配置正确可独立满足 B04，但不得连带声明模型质量已通过。

## 8 W6 最终验收与文档校准

冻结最终集成输入和产物，按实际 diff 选择 owning Vitest/keyless、编译后 SDK/Python wheel、浏览器受影响流，以及 typecheck、lint、build、doc-sync。W4 涉及 lifecycle 或 W2 触达 shared 模型入口时，必须覆盖原完整世界和采购/招聘回归。没有新 UI 行为时不重做无关设计，但 GUI PR 若发生按仓库要求附真实 flow GIF。

所有失败、skip 和未跑矩阵如实记录；CI 的完整平台矩阵与本地验收分开。重新核对原 B04/R08/R09 对应子项，只在证据满足后由验收者勾选；R13 依赖所有当前必需证据。proposal 转 implemented 时保留有效决策、限制和验证，按 Agent Note 规范处理计划；本轮文档不移动任何 lifecycle。

清理容易误读的文档现状：历史 48.5% 标为 10 月 11 日快照；原 112 项保留。个别 README 仍含“外部完整矩阵尚未验收”等旧限制，应与 X12/R06 的最新证据逐项核对后更正，不能只按最新时间或勾选机械删掉限制。

## 9 验证与交接记录

| 工作类型 | 必需证据 |
|---|---|
| 本次文档 | 链接/Markdown/checklist 唯一 ID、原 checklist 未改、关键源码 hash、配对与 doc-sync 结果 |
| W1/W3 | 实际新增 parser/runner/checker 单测、零 IO dry-run、脚本模型不会进入 live 模式 |
| W2/W4 | 危险时序、重复/冲突/取消/unknown、正式模式整组、两后端业务回归、新进程恢复 |
| W5 | 原始样本、provider/model/价格版本、人工 rubric、全部开销与未知占用、失败分母 |
| W6 | 精确命令/退出码、source/lib 与 wheel hashes、证据漂移、未解决缺口、最终签收 |

文档交付结果记在 [validation](evidence/validation.md)。本轮不宣称功能测试重新通过，不执行真实模型或支付，也不以文档完成代替原 MVP 验收。
