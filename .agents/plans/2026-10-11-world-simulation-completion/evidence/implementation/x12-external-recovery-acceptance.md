# X12 外部恢复验收

2026-10-12，当前 Native74／actor schema2/native4。原 checklist 的 X12 已完成；完整 World MVP、director-mediated、v1 编写、完整 SDK/UI 及真实模型质量仍按各原条目继续。没有新增 items。此记录补充并更新早期 company 正常断点的历史汇总，采用已独立冻结且逐件核验的完整双场景证据，不把历史输入当成当前代码。

| 原责任 | 实际证据 | 完整范围 |
|---|---|---|
| 代表取消、已接受 IO 排空、未知跨 cold、commit 赢及取消保存前后 | [当前 Native74 原件](c21-current-representative-verification.json)、[Native73 历史](c19-pending-cold-root-verification.json) | company/laboratory × JSON/SQLite × source/lib；72 case、216 process、24 SIGKILL、144 cold0model |
| 同调用者 keeper 保留、独占 Channel 清理、未知 IO 与 append 竞赛 | [C20 完整](c20-external-contact-report.md)、[逐件核验](c20-root-artifact-verification.json) | 双场景／双后端／双模式；64 case、192 process、24 SIGKILL、128 cold0model |
| 请求、实际确定性求值、发布／收件回执 before/after | [C21 完整](c21-external-rule-fault-report.md)、[root 核验](c21-rule-fault-root-verification.json) | 双场景／双后端／双模式；96 case、288 process、96 SIGKILL、192 cold0model |
| 正常代表 reserve/preparing/Participant/两 Channel/commit/通知/真实通信与 Session 回执 | [C22 完整](c22-normal-actor-fault-report.md)、[root 核验](c22-actor-fault-root-verification.json) | 双场景／双后端／双模式；120 case、360 process、120 SIGKILL、240 cold0model |
| 求值保存前中断，第二 cold 明确完成原 accepted plan | [补证8](c21-evaluation-before-completion-report.md)、[root 核验](c21-evaluation-before-root-verification.json) | 双场景／双后端／双模式；8 case、24 process、8 SIGKILL、16 cold0model |

五组共 360 case、1080 独立 OS process、272 真实 SIGKILL、720 cold0model。仅已安装确定性 availability 规则，不声称随机策略重采样测试。before-request 未 accepted 的临时候选不作实际请求；before-evaluation 未 append 的候选不作已保存样本；第二 cold 通过原公共 owner 提交已接受规则计划，首次保存唯一实际 evaluation/mutation/result/wake，随后精确重试不追加、不再调用 reducer。正常代表 reserve-before 的未保存 provisional UUID 不作历史身份；显式执行原有限 Persona 计划仅分配一次 canonical Actor。同维护结束、原实际输出／资源／组织身份、已存在 Session/Channel 前缀和原 sender/recipient/body 都由原件证明。

恢复不是无条件重做。未知取消保持原 Person、维护、容量和无结果，直到同 owner 取得真实终态证据；另一个已 committed caller conversation 不被关闭。正常 lost-post 恢复含 24 次明确原 retry 预算授权、24 次短暂 running 精确 dispatch，并最终 paused；不得称为无预算追加或全过程 paused。Session-before-ack 恢复含 16 次真实 activation/writer，经 confirmed hibernation 使 chargedActors 0→1→0，原 token 保留；全部 cold 仍零模型调用。库存与资金分别在实际规则和正常 actor 矩阵保存，非空合同保留由独立 [C17](c17-external-contract-report.md)拥有。

源码／编译产物消费清单分别由 [当前代表](c21-current-representative-verification.json)、[C20](c20-external-contact-input-hashes.json)、[C21](c21-rule-fault-input-manifest.json)、[C22](c22-actor-fault-input-hashes.json)、[before-evaluation 补证](c21-evaluation-before-input-manifest.json)拥有，原件完整复制在项目内。后续 Native 历史 Channel 复用拒绝及无维护代表选择修复另有 [owner33](c20-current-owner33.log)、[contact source4/lib4](c20-current-root-verification.json)、[代表 source4/lib4](c19-current-root-verification.json)当前回归；这些子集不冒充完整矩阵重跑。未知来源旧 C21 默认目录及旧 v1 等不纳入最终记录。

准确运行命令、各 case 输入 hash 与退出状态均在上述 manifests；最新 Host 类型、完整 lint 和 doc-sync 29 gates [通过](c22-final-doc29.log)。所有中间文件、backend/Session、编译产物与 raw 在项目。后续新增 mediated 领域须针对新效果与新 persisted 输入再验，不能把本项既有证据直接当成新领域证明。
