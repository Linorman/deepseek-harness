# Agent Note: 验证实际安装的 World 领域目录

Status: implemented

[simulation-world](../../../../packages/simulation/simulation-world/src/providers.ts) 的执行工厂有独立安装 catalog，实际 handler 构造与 [Team 恢复](../../../../packages/simulation/simulation-team/src/index.ts) 共用它。纯 Native 可用性不能替代 execution provider。恢复在 writable open 前检查原历史，比较 strict parser 对象身份与精确 pin，取得独占 open 后再次准入。Generation lease 覆盖恢复 IO，并始终释放。Product 恢复在退休已有 owner 前执行相同准入。[provider 测试](../../../../packages/simulation/simulation-world/tests/providers.spec.ts)覆盖缺失、替换、parser 不一致、关闭准入、inspection 与 open 之间退休，以及暂停态精确恢复。[booking 进程测试](../../../../examples/simulation-company/tests/world-booking-version.snapshot.ts)分别改变 Native 与 execution 安装；仅 provider 拒绝时保留原 records，不调用 writable open、attachment、工厂创建或模型。Loader 把 execution provider 安装为 Team 和 Product 的 sibling；Product 重载不改变其 catalog。

[English](2026-10-13-world-domain-catalog-admission.md) | 中文

## 问题

即使解析器单测通过，正式 provider 仍可能遗漏操作或安装错误世代。领域准入必须在身份分配或业务执行前拒绝畸形请求，包括嵌套权限字段及不可用版本。

## 决定

[目录准入测试](../../../../packages/simulation/simulation-local/tests/world-catalog-admission.spec.ts)针对每种存储后端在新进程中启动现有真实 Loader 组合。[消费端 fixture](../../../../packages/simulation/simulation-local/tests/fixtures/world-catalog-admission.ts)通过 provider 拥有的注册表解析全部导出的内建 pin，获取并释放精确实现，并解析合法 request、plan、未提交结果和 mutation 样本。新增导出 pin 后必须补充样本，测试才能通过。

每个样本中的每个对象分别注入额外字段，形成独立拒绝用例。未知领域、操作、版本、调用者字段及替换世代必须保留各自的拒绝分类。存储保持为空，且不触发 `simulation/committed` 事件。Loader 卸载后，全部原 pin 拒绝新准入与执行。source 和纯 Node 编译模式分别断言实际模块解析路径。

## 考虑过的替代方案

**在测试内另建注册表。** 这能证明解析器行为，但无法发现正式注册缺失。已有单测负责注册表内部规则；本测试消费实际 provider 组合。

**只拒绝空载荷或畸形载荷。** 缺失必填字段可能掩盖额外字段被宽松处理的问题。每个拒绝用例从合法样本开始，只改变一个对象并要求拒绝。

## 影响

探针验证安装、严格解析和生命周期准入，不分配 run 或调用模型。编译模式要求已有构建产物。样本集不穷举全部合法载荷联合分支；各领域测试负责这些分支、授权、效果语义与崩溃恢复。空的未提交结果不能证明已提交结果正确。本测试不提供真实模型、SDK 分发或 GUI 验收证据。

实际 Native 意图、请求、已接受计划与 mutation 准入，以及回放载荷和类型化读集，统一使用 `parseSimulationWorldSchema`。只有结构性 `ZodError` 转为保留 cause 的 `SIM_WORLD_SCHEMA`；业务权限、冲突、配额错误和 provider 实现异常保留原身份。分类不会接受错误载荷，也不会把明确业务拒绝变成未知执行。原始 journal envelope 保持既有日志完整性校验。

执行回调另有 Native 观察记录，绑定原 plan/request/intent 和实现 pin。回调 IO 前先持久记录准入；类型化拒绝属于 blocked 观察，缺确认保持 unknown 并拒绝第二次执行回调。对账只使用原 provider 及其 Native 预留事实。观察不伪造业务终态或物理停止回执。Stream 95 与 checkpoint manifest 5 保留并指纹绑定此责任。每个原计划的观察历史有界：每份已配置操作/计划额度预留四个固定记录槽，覆盖准入、结案与一次对账；重复同一观察不追加。额度耗尽保留未确认责任，不释放所属权。 未确认执行也会拒绝同案的新规划上下文与新计划受理；已接受 decision 的精确重试仍返回原内容。
