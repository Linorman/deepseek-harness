# D/E 本地交付验收

2026-10-20。用户确认 E1/E2「先完成本地测试实现」。本验收覆盖 D1/D2 及 E 的本地沙箱、双 run 故障协议；E01/E07/E08/E15 的真实业务授权、provider 测试环境、部署必要性与正式独立审查保留未交付。原 checklist 不新增或删除项目。

## 实现范围

D1 保留完整私密引用闭包与原业务结果，导出完成后发布，目标空存储校验并登记 paused；离线转换生成新副本，原件保持。真实 Loader 和独立进程矩阵覆盖 JSON/SQLite、普通 World/实验分支、源目录离线、目标无父目录、登记中 SIGKILL、精确重试、冷发现及显式 restore/start。原包、原命令及授权校验随导入保留。凭证不随包迁移。

D2 从可验证的受支持 quiescent cut 建立新运行身份，原历史作为只读 provenance。继承记忆记录在新 Session，按 Session 的实际消息投影进入模型；非模型呈现事件保留为 provenance。Entity 引用精确映射，独立资源/fact ID、Persona 名称及正文保持。v0 分支在接受前验证并冻结能重建原编译语义的完整 catalog，重试使用原件；v1 使用自包含编译输入。原命令、有限比较和因果查询已接 Product、Host、Client runtime 与 TS/Python SDK。

E1 本地适配器通过持久 intent、独立 Grant、原幂等键和 receipt 对账；unknown 保留责任，撤权/到期/额度下降不能重新获得发送准入。补偿是另有授权的独立效果。E2 双 run mailbox 记录真实源消息/回执和源级游标，唯一 ownership authority 隔离旧 generation；时间推进与联合 checkpoint 使用相同的原 mailbox 证据和保守时钟规则。

## 验证与原件

准确命令、最终状态、输入与关键构建产物的 SHA-256 见 [validation manifest](de-final-validation.json)。所有中间文件位于项目内的 `.tmp/world-de/`、各测试项目内临时目录及相应 `lib/`/`dist/`；本次未提交或推送。

| 验证 | 结果/证据 |
|---|---|
| Host、Client runtime、TS SDK 及生成器契约 | 139 文件、2242 测试通过；最终日志见 manifest |
| Simulation 核心与 Team/World 恢复 | 2744 项通过，2 个既有 opt-in benchmark 跳过；首次运行 5 项失败经下述修复和聚焦复验闭合 |
| Product 全部回归 | 1154 项通过，1 项依赖显式历史样本的既有测试跳过 |
| Python SDK | 1003 测试通过；最终日志见 manifest |
| D2 身份、记忆、坏来源、编译和完整 provenance | [19 项矩阵及源码 hash](d2-completion.json) |
| D2 独立双进程恢复 | [JSON/SQLite 快照日志](d2-process-snapshot.log) |
| D1 Loader 迁移与进程故障 | [四例矩阵](../d1/product-import-matrix.json) |
| 联邦与现实效果边界复验 | [独立本地协议报告](../d1/independent-protocol-review.md)、[修复复验](../d1/federation-reference-remediation.json) |
| 冻结后构建产物 | `CLOCKY_EXAMPLE_MODE=lib` 下完整备份、实验分支和外部效果沙箱三快照共 6/6；269 个 compiled invariant 通过 plain Node Loader 检查 |
| 全局静态与文档 | build、typecheck、lint、278 个 NodeNext 声明 API、workspace constraints、doc-sync 29/29 及 diff 检查通过 |

首次广域回归保留完整失败原件：catalog fixture 漏了四个既有 B/C pin，补齐后仍严格覆盖全部 19 个 pin；management/bootstrap 在单 worker 下沿用原五秒期限通过。卸载 fixture 将表示切换错误断言为 `interact`，且断言失败后未释放 lease，表现为超时；改为核对声明的 operation 并在 `finally` 释放后，五项卸载测试均通过。纯 Node 快照还暴露复用测试 harness 漏声明六个依赖，补齐测试依赖后 built 三快照全部通过。生产实现没有因这些测试修复而放宽校验或期限。

## 支持边界

分支支持 initial 及已实现的 settled seed；未解决义务、缺少可恢复 seed owner 的 institutions/norms/external/environment/evolution 等状态明确拒绝。授权记忆仅支持可表示的文本历史，真实媒体输入在预检拒绝；公开事实模式不继承私密媒体。自动 branch merge 明确拒绝。全祖先私密备份要求当前祖先读权，或精确 branch 的显式 `includeProvenance` 授权。原始联邦引用必须进入 E14 的完整协议，普通单运行备份不绕过依赖闭包。

本地确定性测试与故障适配器不证明真实模型质量、外部 provider 资格、跨主机吞吐或生产安全审查。E01/E07/E08/E15 保持原未勾选状态；C15/C16 和整体 H 沿用原计划的独立验收责任。
