# Team 改进实施结果

本次落实[审查报告](README.md)中的改进，全程未使用 subagent。按用户确认，保留同工作区并行中的 activation reservation、子 Team 和 live-activation 预算修改，不把它们计入本次成果。没有提交或推送。

## 已落实的改进

| 问题 | 实现与验证 |
|---|---|
| 连续输出截断丢失 task 归属 | 续跑消息保留准确 assignment 来源，按 Session 中的确定性消息 ID 累计次数，重复通知不多占预算，delivery 重建后仍可继续。报告工具接受一致的重复来源，拒绝冲突来源。真实连续截断流程已通过。 |
| Worker 结束但没有 report | 正常结束默认提醒一次，仍不报告则明确失败；模型请求重试耗尽后及时结算。取消、过期和替换的 attempt 不复活；未成功 flush 的输入不能进入模型步骤。 |
| Wake 扫描阻挡后续调度 | Wake、review 和新 assignment 分别受额度约束。已有 wake 超过扫描额度时，空闲 worker 仍能接到独立任务。任务在发布期间推进造成的自有 proof 失效，使用有限的新状态重试；持续失效仍拒绝并清理未提交频道。 |
| Review 发布失败后重复建频道 | Hub 按 Team/task/attempt/reviewer 派生稳定频道身份。创建后发送失败、Hub 重新加载后继续使用原频道。 |
| Reviewer 收不到任务正文和结果 | Review 频道使用携带 payload 的有界 `recent-window` 视图。实际 reviewer 请求已验证包含任务说明和结果。 |
| Reviewer 异常后无限等待 | Task/workflow wait 和阻塞式 task watch 报告明确错误；不会伪造 review 决定或重复 worker 工作。已存在的持久响应交给 scheduler 恢复。 |
| Coordinator 丢失工作证据 | `team_task_wait` 保留 evidence、artifacts、changed_paths、verification、integration 和失败 outcome。超大渲染结果继续由现有 spill policy 管理。 |
| 返工换 worker 缺少依据 | 新 assignment 携带最近 attempt 的结果及对应审查理由，按字节限制并显式提示截断。真实 A→review→B 场景验证输入内容，并从持久记录确认 A、B 不同。 |
| Workflow 输入难以构造 | 模型可见 schema 完整定义嵌套字段，并提供两阶段示例；coordinator prompt 提供配置的 worker capability。已直接从模型收到的 schema 取出示例，运行前驱写文件、后继读文件的真实流程。 |
| Watch 指引与返回值不一致 | 明确首次省略 cursor 获取快照，之后使用 watch 返回的 cursor。 |
| 委派策略过强、重复 | 由 coordinator prompt 统一说明按独立价值与验证收益委派，尊重用户的委派约束；允许小型紧密关联工作由一个执行者完成，工具描述聚焦操作。 |
| 永久连接故障重复重连 | Provider 明确标记配置、协议及远端 unauthorized 故障的不可重试性；暂停到 provider 重配或新 activation。暂时断线和普通远端操作拒绝仍按正常恢复策略处理。 |
| 关闭时仍操作旧 Link | Session flush 期间 delivery 关闭时，不再确认旧 Link；回执留待重放。 |
| 运行文件被当成工作变更 | 默认 Headless/Web 将实际 Clocky home 排除出共享工作区观察，保留用户文件变化。真实只读任务不会再把 Session/SQLite 文件放入 changed_paths。 |

实现仍由现有插件负责，没有修改 agent loop，也没有添加统一无限重试、自动切模型、自动判定审查通过或全历史复制机制。设计依据和替代方案见[Agent Note](../../notes/implemented/architecture/2026-09-13-team-recovery-and-evidence-handoffs.md)。

## 验证证据

不同测试命令覆盖有重叠，以下数量不相加作为独立测试总数。

| 检查 | 结果 | 证据 |
|---|---|---|
| 隔离本次代码后的 Team 与 core/team 相关包 | 142 文件、2034 项通过 | [日志](evidence/isolated-team-tests-final.log) |
| 实际 Loader / Team / workflow / SDK 场景 | 整组 22 项通过；剩余频道视图预期对齐后定向复查 1 项通过 | [整组日志](evidence/implementation-assembled-final.log)、[频道复查](evidence/implementation-channel-view-final.log) |
| 跨 worker 返工与 reviewer 失败 | 7 场景 refresh 通过；失败等待与 watch 另有定向验证 | [返工日志](evidence/implementation-review-refresh.log)、[错误反馈](evidence/implementation-review-errors.log) |
| 模型可见 workflow 示例 | 实际前驱文件和后继读取验证通过 | [日志](evidence/implementation-workflow-example.log) |
| 调度器 proof 竞争、额度与清理 | 115 项通过 | [日志](evidence/implementation-scheduler-race-tests.log) |
| Link 分类与协议 | 122 项通过 | [日志](evidence/implementation-link-final.log) |
| Python keyless SDK | 105 项通过，包括本机已有 exe/node carrier 的启动检查 | [日志](evidence/implementation-python-sdk.log) |
| TypeScript 与 Host 构建 | 定向构建和 doc-sync 内 Host 构建通过 | [类型日志](evidence/implementation-types-final.log)、[文档门禁](evidence/implementation-doc-sync-final.log) |
| 改动文件 lint | 通过 | [日志](evidence/implementation-lint-final.log) |
| 文档 | doc-sync 27 项通过；唯一剩余配对问题修复后，1073 对文档与 2192 文件的链接复查通过 | [门禁日志](evidence/implementation-doc-sync-final.log)、[最终复查](evidence/implementation-final-doc-fix.log) |

原有 Python fixture 缺少服务组装，以及显式启动参数下缺少配置与认证设置，已通过修正 fixture 解决，没有放宽 SDK 认证。原有 workflow cancellation fixture 已补齐 human inbox Consumer；旧 prompt、review 视图断言和 golden 输出已按最终行为更新。

## 验证边界

整文件 100% 覆盖率门禁仍未满足。[隔离基线](evidence/baseline-coverage.log)的同范围 1882 项测试通过，但已有多处覆盖缺口；[实施期覆盖检查](evidence/implementation-coverage.log)同样未达到 100%。本次通过行为回归与真实组装验证改进，不把这些日志当作最终代码全覆盖的证明。

没有可用的真实模型配置，真实模型 smoke 跳过。Prompt/schema 的可构造性、输入输出交接和运行行为已有 keyless 证据，实际 LLM 的规划质量与成功率未测量。Python 检查使用本机已有打包载体，不能替代重新发布后的跨平台验证。

隔离工作区仅用于区分本次修复与并行修改；代码仍保留在原工作区。当前工作区的整体差异包含其他工作，不能把全体差异视为本次交付。
