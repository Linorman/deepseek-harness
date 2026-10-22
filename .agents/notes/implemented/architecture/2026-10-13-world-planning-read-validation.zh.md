# Agent Note: World 规划读集校验

Status: implemented

[English](2026-10-13-world-planning-read-validation.md) | 中文

## 问题

已准备方案可能晚于其所读取的权限或容量变化。补证询问也是规划动作，不能在失效授权下创建另一条私有消息。重验期间出现容量失效时，必须保留 stale 前驱，不能继续留下可执行的 accepted 方案或误报为失去授权。

## 决策

[World 读集校验](../../../../packages/simulation/simulation-local/src/world.ts)比较领域拥有的类型化依赖与核心授权，而非全局 journal revision。占用变化、领域冲突及明确的岗位容量上限产生 `read-set-changed`；实际授权错误产生 `authority-unavailable`。其他配额及完整性错误保留原分类。Native 追加失效时保留方案 proposal、reads、hash 及原 sequence。显式重规划以 `supersedes` 保留前驱。

[补证准入](../../../../packages/simulation/simulation-local/src/world-evidence.ts)在展开新问题前重新核验原已准备 resolve 读集。过时询问被拒，不创建问题或通知；其 prepared decision 仍占规划额度。问题派生在相同的问题创建前缀上重验，历史问题不使用后续证据修订重验。精确已接受重试返回原展开。第二轮询问消费最新回答修订，仍须留下后续规划机会。

## 考虑的替代方案

**将所有配额拒绝视为 stale。** 历史、消息、字节及其他有限额度不证明原业务读集变化；统一改类会隐藏真实停止条件。

**只在业务 mutation 时检查。** 补证已创建通信和待回答职责，必须在接受这些效果前确认授权仍有效。

**每次 journal append 都失效。** 无关唤醒和独立工作会使原本有效的方案无法执行。

## 影响

双后端 owner 测试覆盖岗位被占、另一原案件的候选人 hold、无关 revision、结束授权、两轮补证及失败规划尝试保留。真实公司/实验室 driver 在冻结额度内记录后继 stale 方案，随后停止且不继续推理；冷恢复保留相同历史。Native stream 94 拒绝旧流，因为重放会核验 stale 原因，不能静默重新解释历史。Compiler 保持版本 9，不以迁移重写旧失效记录。
