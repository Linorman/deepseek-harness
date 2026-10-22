# Agent Note：场景能力决定编译结果与角色上下文

Status: implemented

[English](2026-10-13-authored-world-capability-context.md) | 中文

## 问题

可移植定义必须提供已安装效果需要的全部关系规则。即使只安装外部操作version3，裁决生成的代表仍使用`represents`。提出委员会决策的角色也需要在已记录上下文中获得原规则与quorum；测试中的隐藏常量不能替代编写制度。

## 决策

[v1 compiler](../../../../packages/simulation/simulation-scenario/src/v1-compiler.ts)为actor操作，或明确允许`representative-preparation-plan`的mediation，安装带作用域的`person → organization`类型`represents`规则。仅允许failure的mediation不安装代表能力。compiler6将确定性规则集保留在resolved承诺中，拒绝旧编译结果。

[Native委员会投影](../../../../packages/simulation/simulation-local/src/world-norm-bootstrap.ts)只在原bootstrap已应用后，通过请求角色精确生效的提案操作grant显示rule/quorum。scope、委员会目标、关系、操作和区间必须匹配。外部角色、其它操作、已结束/被替换grant或未初始化世界都得不到政策材料。投影保留原bootstrap sequence与定义hash，排除其它委员会和私有文档。

制度提案与单次招聘批准的目标上下文均包含这些材料。原`simulation/context-view`和实际Agent模型输入保留它们。Native准入仍独立核验编写规则、quorum与成员；可读材料不授予权限，也不授权投票。

[可移植公司](../../../../examples/simulation-company/scenarios/world-company-v1.json)、[实验室](../../../../examples/simulation-company/scenarios/world-laboratory-v1.json)与[协会](../../../../examples/simulation-company/scenarios/world-association-v1.json)定义使用同一个[driver流程](../../../../examples/simulation-company/tests/complete-world.snapshot.ts)。公司/实验室使用生成录用、原费用、治理生效、代表联络与人员变动；协会使用编写制度、阈值投票、具明确资格的已有志愿者、有限岗位日历和保持未知库存的failure-only外部裁决。外部keyless模型只接收实际已记录输入；测试owner另行核对receipt和state。

## 考虑过的替代方案

**无条件安装全部效果规则。** 这会为仅允许failure的定义声明代表能力。compiler根据精确安装操作与允许outcome派生所需固定规则。

**让模型通过场景名字猜委员会门槛。** 名字不建立政策。角色消费原Native投影，不同制度使用同一个adapter。

## 后果

编写能力保持可执行，不需编译后改写resolved输入。改变默认值、能力或原规则集会改变已复核承诺。冷恢复使用原持久数据并保持暂停。keyless流程证明协议组合；真实模型质量、完整浏览器操作、非空交接与新增收费录用的进程丢失断点仍需各自checklist证据。
