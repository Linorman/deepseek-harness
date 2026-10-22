# Agent Note: 分离环境与经历状态

Status: implemented

[English](2026-10-19-world-environment-evolution.md) | 中文

## Problem

供需和学习需要持久演化状态，同时保留出生 Persona、权限和已消费上下文。重放不能引入新的随机结果。

## Decision

[领域契约](../../../../packages/simulation/simulation/src/world-environment.ts)通过现有 Native 与执行注册表安装供需和经历操作。状态保存在独立无认知实体中；原 Native mutation 日志拥有实际采样及原子 profile 更新。已安装供需算法为确定性实现并记录实现身份。新实验选择模型，没有原地模型迁移操作。经历更新要求本人原始已提交 intent 和显式读者 audience，限制数值及每周期变化，不发布世界事实，不改变人物实体。

## Alternatives considered

**可变 Persona 字段**混合出生身份和习得状态，使学习覆盖原始输入。独立版本状态保留两者。

**driver 专用环境分支**把调度与某一模型绑定。已有领域工厂提供不可变 pin 和单一 Native 提交所有者。

## Consequences

[集成测试](../../../../packages/simulation/simulation-local/tests/world-environment.spec.ts)覆盖两种存储后端。[评价证据](../../../plans/2026-10-16-world-post-mvp/evidence/implementation/c3.md)区分确定性不变量检查与尚未收集的人工、模型 judge 评价。历史上限为 256 个版本；不支持的迁移及更复杂学习模型需要独立设计。

便携 v1 场景通过共享 compiler 创作严格初始 environment 和 person-state 实体。初始经历版本必须为空，环境 lastTime 必须为 null，并校验人物及 audience 引用。Native 初始化使用编译后的 profile，不增加 driver 业务分支。TypeScript 与 Python 接受同一初始状态结构。

[预登记评估器](../../../../packages/simulation/simulation/tests/environment-registered-evaluation.ts)在发布资源对照前冻结固定/留出输入、对照配置和 rubric。缺货与生产量一起报告，不能仅因缺货较少就推断效率或认知质量改善。CLI 相对自身项目定位并哈希源码，不使用任意工作目录中的同名文件，且仅接受项目内输出目录。登记/结果仅写入一次，确定性验证保留原证据；真实 CLI 回归覆盖误导工作目录、源码不匹配、篡改及拒绝覆盖。报告将算术/隐私 parser 探针、未执行的模型 judge 与用户暂缓的人工评分分开。完整 Session 隐私和人类可信度仍需独立证据。
