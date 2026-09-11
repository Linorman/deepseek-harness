# Agent Note: Activation-authorized Team task creation

Status: implemented

[English](2026-08-29-activation-authorized-task-creation.md) | 中文

## Problem

面向模型的 Team task 生产方需要 retry identity 和已认证的创建者。仅提交 Team cursor 的调用方无法在另一次 Team 变更之后区分已接收的 task creation 与丢失的响应，而自由提供的 Participant id 不能证明发出 command 的 active Session 和 AgentRuntime binding。

## Decision

`TeamTaskCreateInput`要求 `createCommand`，`TeamTaskCreateRequest`再加入仅运行时存在的 `TeamActorProof`。该 command 的 `creator`保留准确的 Team、Participant、Activation、Session 和 AgentRuntime provider identity，品牌化 `idempotencyKey`以该创建者为作用域。每个 `TeamTaskSnapshot`都会不可变地保留该 command。

Hub 会在查找 command 前验证当前 active coordinator Participant 和准确的 idle 或 running activation binding。具有相同 normalized creation field 的匹配 command 会在 cursor comparison 前返回原 task。以不同 task field 重用同一 creator/key pair 会以 `TEAM_TASK_IDEMPOTENCY_CONFLICT`拒绝。包括 in-process producer 在内的任何 provider 都不能创建没有 provenance 的 task。

journal parser、fold 和 checkpoint recovery 都要求该 command，会在 task creation 时验证其 binding relation，在后续 task revision 中保留它，并拒绝重复 command identity，而不要求历史创建者仍然 resident。Team journal format 21 和 Team checkpoint format 22 会拒绝之前的预发布 task shape。

## Alternatives considered

**保留进程本地 retry map。** 不予采纳，因为 Hub restart 和 checkpoint recovery 会丢失已接收的 command identity，并允许重复 task。

**使用调用方提供的 Participant id 授权 task creation。** 不予采纳，因为 Participant id 不能证明准确的当前 activation、Session 或 provider。

**只使用 expected cursor retry。** 不予采纳，因为持久接收后响应可能丢失，调用方的 cursor 会陈旧，却无法识别原 task。

## Consequences

[持久 task attempt 与 lease 决策](2026-08-28-durable-task-attempt-leases.zh.md)仍是 task lifecycle 和 owner fence 的权威。[本地 Team Hub 决策](2026-08-27-local-team-hub-durable-authority.zh.md)仍是 journal 和 checkpoint recovery 的权威。后续 Team Link 或模型工具可以从其 bound activation 导出 `createCommand.creator`，而不向模型公开任意创建者 fact。

该基础不安装模型工具、不选择 worker、不分配 task，也不路由 task result。

## Verification

核心 schema 测试覆盖品牌化 key、必需 command record 以及 Team/task identity relation。Hub 测试覆盖 JSON 和 SQLite restart 后的 replay、stale-cursor replay、冲突复用、policy actor derivation、exact-binding rejection，以及缺失 command 的 journal 与 checkpoint rejection。聚焦包覆盖率对已更改的 core 与 Hub source 达到 100%。
