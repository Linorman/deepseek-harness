# 读书节运行记录：llmapi / deepseek-flash

本记录按原 `RESULTS.md` 模板填写；场景原件及 `validation.json` 保持不变。

## 运行信息

- 版本：完整版 `scenario.json`；快速版另见末尾。
- 日期：2026-10-21。
- 工作区：本地未提交工作区，保留已有改动；本轮修复新决策提示、暂存/提交提示、带判别字段的 schema 错误定位，以及 Simulation 状态显示等问题。
- 场景 SHA-256：`f8dcc3438425c0ebc992b691046d922ed53b2d3598b15d98bf93f9029fb88686`。
- 提供方 / 模型：`llmapi / deepseek-flash`；使用已配置的模型推理设置，没有切换到其他模型。
- Run ID：`bfb02f33-6dec-445e-8bc0-d9e84a116a34`；SQLite 后端。
- 首次 / 最后一次已记录推理：2026-10-21 03:26:13 +08:00 至 2026-10-21 04:07:29 +08:00。
- 最终模拟时间：305 minute。完成时调度器为 idle；最终恢复及保存后 phase 为 paused。
- 最终检查点：`product-checkpoint/3b62a502-f3e4-4840-9c84-8b728a871858`。
- 模型请求预留记录：162。已报告输入 936,921、输出 79,500、缓存读取 2,874,240，合计 3,890,661 token。
- 另有 1 次未知用量请求，其 65,536 token 预留仍保留计入预算；这不是已知实际用量。未查询提供方账单。

## 观察记录

| 检查点 | 结果 | 证据 |
|---|---|---|
| 预检通过，创建后暂停且无推理 | 通过 | WebUI 预检并创建暂停运行，显式开始后才执行 |
| 一次招聘提交，新人有独立身份与 Session | 通过 | 新人 `world-person:b209ba98-e827-4c48-87e2-32cdfd7190f6`，Session `bef0f2a2-f119-4686-9853-feeff6005c12` |
| 人物 3→4、在职 2→3、实体 9→10 | 通过 | 4 个独立 Session、3 条有效 assignment、10 个实体 |
| 岗位容量仍为 1，没有重复招聘 | 通过 | `volunteer-seat` 容量 1；仅一个 generate-and-hire 事项 |
| 提案原正文 hash、成员、阈值与截止时间保留 | 通过 | `sha256:96a0f6e15613c218fd2bb33332641458aca1ee46e14c97ba43d02f7f4c96509e`；organiser / reviewer；unanimity；quorum 2；deadline 179 |
| 两名委员独立投票 | 通过 | Decision 19 / 20，各自的独立 Session，均投 yes |
| 仅凭 passed resolution 生效原版本制度 | 通过 | `governance-resolution:a3b46a61743fbc3aa7ac22808eb704cb8bbda4444a186cb54b87e475e1848f7c`；2 yes / 0 no；制度版本 1 与提案 bodyHash 相同 |
| 制度为 advisory | 通过 | `event-information-policy/1`；未声称规则自动执行或图书馆已同意 |
| 两次咨询使用同一 library 身份 | 通过 | 两条 external/interact 均保留同一外部 identity |
| 外部结果拒绝或未核实报价 | 通过 | 两次均为 `failure / dependency-unmet`，明确未确认借书、服务或合同 |
| 图书库存仍为 6 | 通过 | `library-books` 数量 6，没有咨询导致的资源副作用 |
| 新人和外部请求没有私人 canary | 通过 | 检查实际新人 Session 与外部请求，均未出现 `LOCAL_ONLY_PLAN_73E1`；不据此推断所有隐私路径均安全 |
| 冷恢复保持暂停，未新增推理 | 通过 | 最终恢复前后预留记录均为 162，恢复后 paused |
| 身份、事项、制度、库存保持 | 通过 | 恢复前后 cases、norms、库存逐项相同，4 个原 Session 保留 |

## 失败或分歧

完整版在 t=245 的首次外部咨询裁决阶段出现了无效 resolution 结构以及反复暂存，之后压缩请求超时。修改 schema 诊断与提交提示后，在原 run 上创建并恢复检查点，再显式继续；没有重新导入场景冒充恢复。

- 中途检查点：`product-checkpoint/12e55552-1472-479c-99d4-8b1803317b88`。
- 当时冷恢复请求：`2cde50cc-a3b8-4b58-91c4-d8d3b218eec6`。
- 最终复核冷恢复请求：`f81f4d48-abee-4133-becd-06bbed18239d`。
- 最终保存请求：`3b62a502-f3e4-4840-9c84-8b728a871858`。

外部咨询拒绝是合法业务结果，不代表借书目标已达成；招聘、投票与制度生效已实际提交。7 个事项是本次真实结果，没有强制写入正向结局。

## 恢复对照

| 项目 | 最终恢复前 | 最终恢复后 |
|---|---|---|
| Run / 模拟时间 | 同一 Run，305 | 同一 Run，305 |
| 新人 Entity / Session | 原身份 | 原身份保持 |
| 世界事项 | 7 个 committed | 7 个 committed |
| 制度 | 两个 enacted，包含新制度 v1 | 相同 |
| 图书库存 | 6 | 6 |
| 未来有限事件 | 无 | 无 |
| 模型请求预留记录 | 162 | 162 |
| phase | running，驱动器 idle | paused |

## 快速版

独立运行 `f1d58f27-3615-4ac2-ae43-c46a8e7afe54` 已通过 WebUI 导入与执行，一次招聘实际提交并在 t=1 空闲。提案、投票、制度与外部咨询未安排，属于不适用；未把完整版导入此运行作为续跑。

## 原始证据

- [最终结构化核对](festival-audit-detailed.json)
- [最终恢复前状态](festival-before-final-save.json)
- [独立检查脚本](audit-festival-detailed.ts)
- [完成时页面](festival-full-idle.png)
