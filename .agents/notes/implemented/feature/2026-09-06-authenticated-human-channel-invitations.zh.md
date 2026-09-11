# Agent Note：认证 human 频道邀请

状态：已实现

[English](2026-09-06-authenticated-human-channel-invitations.md) | 中文

## Problem

认证 human endpoint 需要只能发现并接受自己拥有的持久频道邀请，同时不能因此获得创建频道的 authority，也不能针对已变化的 manifest 重放确认。

## Decision

Host 和 SDK 查询返回当前 principal 自己的邀请与完整不可变 manifest。只检查成员归属的只读 proof 绑定 `channelId`，不能授权创建频道或确认协议。显式确认通过现有 human consent proof 绑定 manifest fingerprint、revision 和重试键。关闭的频道拒绝确认，包括之前已接受的重试键。

## Alternatives considered

**把 membership 当作 consent。** 不采用，因为 membership 不能证明 endpoint 接受了准确的 manifest 或 revision。

**让 discovery proof 创建或确认频道。** 不采用，因为 read authority 与 channel mutation authority 必须分离。

**重试时不要求原始 manifest fingerprint。** 不采用，因为复用 retry key 不能确认另一条持久邀请。

## Consequences

Host 群组测试使用两个真实 Agent 接收者。TypeScript 与 Python 可运行 SDK 示例验证认证 JSON 查询、显式接受和持久 Session receipt。无需改变邀请或 Channel WAL 格式。
