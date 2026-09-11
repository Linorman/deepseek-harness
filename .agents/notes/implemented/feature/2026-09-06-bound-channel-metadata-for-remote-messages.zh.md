# Agent Note: 远程消息的绑定频道元数据

Status: implemented

[English](2026-09-06-bound-channel-metadata-for-remote-messages.md) | 中文

## Problem

远程消息工具需要准确的频道协议来准备 payload 与默认 audience。重连的 endpoint 不能依赖已确认邀请再次重放。

## Decision

`TeamLink.getChannel()` 使用当前 activation proof 和 frame-v7 `channel-get`。Hub 在锁内检查 binding、Team 和 active membership，只返回 manifest、phase 与 cursor。本地和远程 `team_message` 共用按协议准备文本的逻辑，不放宽 parser。

## Alternatives considered

仅缓存 invitation 无法覆盖所有重连。试错 post 混合了协议发现与写入，因此不采用。

## Consequences

隔离的工具 endpoint 可在重连后通过真实 WebSocket 发送 direct-v4 子集与默认广播。JSON/SQLite 快照验证实际模型工具调用、固定 recipient 和 Session receipt；metadata 测试拒绝跨 Team、非成员、已撤销及 offline 的访问。
