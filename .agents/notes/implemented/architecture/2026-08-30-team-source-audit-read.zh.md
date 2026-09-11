# Agent Note：Team 源审计读取

Status: implemented

[English](2026-08-30-team-source-audit-read.md) | 中文

## 问题

Host 可以读取 Team 或 channel 投影，但没有有界读取持久记录的路径来解释投影如何达到当前状态。

## 决策

`TeamRuntime.readAudit()` 按源游标从 Team journal 或已附加的 channel WAL 读取一页记录。每条结果保留所属 Team、可选 channel、源游标、记录类型、时间戳以及去除源元数据后的 JSON facts。Host 以 `team.audit.read` 暴露该能力，并处理默认游标和分页；它不会把投影当成第二份权威状态。

## 考虑过的替代方案

**通过组合当前 Team 和 channel snapshot 生成审计条目。** 否决，因为 snapshot 不包含 replay 和事故诊断所需的有序转换。

**持久化第二个 audit 数据库。** 否决，因为只读投影会在不拥有业务真相的情况下增加另一条故障与一致性边界。

## 影响

Host 和浏览器客户端可以按源游标分页读取持久 Team 或 channel 历史，包括归档和 adapter 转换；现有 journal 和 WAL 仍是唯一权威流。
