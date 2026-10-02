# Agent Note: Simulation 任务来源与尝试证据

Status: implemented

[English](2026-09-30-simulation-task-source-evidence.md) | 中文

## Problem

同一 Team 中的任务可能属于无关创建者或执行者。只关联任务身份、revision 和阶段，可能让该任务完成错误地兑现另一个实体已接受的交互。

## Decision

规范 Team reader 校验不可变 Simulation 创建者来源、原创建 key 及当前 run 的已受理任务创建回执。对账和检查点目标检查共用该投影。持久证据保留创建操作，以及当前或最后已结算尝试的 participant、存在时的 activation、尝试身份和结果。日志版本 43 拒绝早期格式。

原生 fold 独立检查已受理操作／回执关系，要求观察到的执行者等于交互 assignee。completed／review 任务证据必须包含已完成尝试。同 revision 证据不可变；精确重试返回原事实而不追加记录，包括后续窗口打开时。只有 `task-completed` 履约策略派生完成；显式验收和资源转移保留各自证据。后续任务完成不会恢复已撤销承诺。

[自动执行提案](../../proposed/architecture/2026-09-28-web-team-simulation-product-integration.zh.md)及[协调提案](../../proposed/architecture/2026-09-17-durable-simulation-coordination.zh.md)仍负责 execution link、执行 scope proof 与 executor 所有权。该观察机制没有取代这两份提案。[创建 owner](2026-09-29-persistent-company-creation.zh.md)保留独立行政所有权。

## Alternatives considered

**按标题或 Team 成员身份推断关联。** 二者都不能标识已受理来源或授权执行者。

**只将任务阶段作为完成证据。** 它遗漏产生结果的尝试，并可能允许另一 participant 兑现承诺。

**在检查点和对账 reader 中重复来源校验。** 独立实现可能对同一创建作出不同判断。

## Consequences

普通 Team 创建的任务不能作为 Simulation 完成证据。历史 activation 身份在退休后仍可作为归属证据；观察不会授予实时权限。该机制不自动分配任务，也不证明世界效果。

## Verification

JSON／SQLite 单元测试拒绝无关回执、错误执行者及同 revision 事实变化，并验证合法证据在重启后保留。真实 Loader 知识／任务 snapshot 在任务创建和完成后终止进程，再恢复同一回执及精确已完成尝试。该示例仍通过测试 helper 构造分配和完成，不是生产 executor 的证据。
