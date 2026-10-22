# Agent Note: 原 World 请求收据不再重复准入

Status: implemented

[English](2026-10-13-original-world-request-receipts.md) | 中文

## 问题

已有人员录用后，再准备原请求上下文会重复检查候选人资格。原成功招聘自身已经建立任职，因此请求者无法通过该上下文消费原收据。原命令及普通 goal 路径仍幂等，但专用 request 路径错误地按新招聘处理。

## 决定

[Native 上下文 owner](../../../../packages/simulation/simulation-local/src/world.ts)区分尚未接受的 intent 与已接受的原请求。后者要求原请求者、pin、request/intent 关联、载荷指纹及来源 operation；记录不可变 proposal、当前收据状态和原日志引用，执行读集为空，不调用领域准入或规划投影。只能提交精确原请求；改变载荷、另一 intent 或另一 actor 仍被拒绝。既有展开与结算 owner 阻止第二次通知及业务效果。

未接受的 intent 和新的 goal 请求保留当前授权、资格及依赖校验。只有在上下文准备 revision 时原请求已经存在，该 request 上下文才按收据解释。领域实现准入、writer 和上下文消费检查仍然有效。

Native stream 83 拒绝旧流，因为重放会重建上下文准备结果。原字段结构不变；SQLite schema、Session format 和场景 compiler 版本不随此次选择逻辑修复改变。不会绕过 stream 边界，用不同语义重建历史视图。

## 考虑过的替代方案

**在新招聘准入中忽略候选人冲突。** 这会让真正的新招聘绕过任职资格，而非区分收据重试。

**将 director 的旧计划作为重试上下文。** 请求者需要自己的原 proposal 和收据，不需要另一 actor 的解释或可执行计划。

## 影响

[收费 owner 测试](../../../../packages/simulation/simulation-local/tests/world-paid-idempotency.spec.ts)覆盖两种上下文、原件与改件、不同决策、actor 隔离及 Native 句柄重开。[Loader 预约流程](../../../../examples/simulation-company/tests/world-booking.snapshot.ts)在真实 Agent Session 中记录通用收据，通过三模型工具执行，保留唯一 booking，并在新进程恢复相同视图。收据正文仍受既有 required-context 预算约束。本修复不授予新操作权限，不执行目标 IO，也不自动重启。
