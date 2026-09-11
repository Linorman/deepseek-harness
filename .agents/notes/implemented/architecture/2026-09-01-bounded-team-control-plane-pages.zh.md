# Agent Note: Bounded Team control-plane read pages

Status: implemented

[English](2026-09-01-bounded-team-control-plane-pages.md) | 中文

## Problem

Team provider 已经会以 storage-sized page 读取 channel WAL，但面向产品的 channel、Team、participant 和 task read 仍可能返回完整逻辑结果。因此 Host、SDK、Python 与 Web consumer 没有共享 continuation contract，长期运行的 Team 可能让一次 management request 产生不必要的大 response。Internal scheduler 与 recovery scan 仍需要完整 projection，所以不能把所有已有 full-read caller 都改成 page，否则会混淆产品 pagination 与 provider-owned replay。

## Decision

`clocky-team`新增独立的 bounded read seam：`listTeamsPage()`、`listParticipantsPage()`、`listTasksPage()`和`readChannelPage()`。每个 request 携带 exclusive `afterCursor` 与正整数 `limit`；每个 response 最多返回一个 page，并且只有 bounded look-ahead 确认还有下一项时才返回可选 `nextCursor`。

Team-list cursor 指向 materialized journal descriptor ordinal，包括会从可见 items 中排除的 archived descriptor。Participant 与 task cursor 指向 durable projection map 保留的稳定 provider order。Channel cursor 是 channel-WAL sequence。本地 Hub 会以 `recoveryPageSize` 限制请求 page，校验 channel record 连续性，并只对 bounded page 中的 record 应用 view policy。已有 full `listTeams()`、`listTasks()`和`readChannel()`继续作为 scheduler、recovery 与 finalization scan 的 provider-owned seam。

Recovery Consumer 只有在完成该 page 中每个 summary 的 hydration 后才会提交 Team discovery cursor。Channel admission 与 human delivery queue 在传播临时 Team、channel、storage 或 admission failure 前会把当前 channel 重新放回队列，因此下一次 bounded pass 会重试同一项，而不会越过未处理工作。

Host 的 `team.list`、`team.member.list`、`team.task.list` 和 `team.channel.read` route 接受可选 cursor／limit field，并将解析后的 default 转发给 page seam。TypeScript SDK protocol 与 high-level API 暴露相同 field 和 continuation result。Python SDK 将 snake-case cursor／limit argument 转发为相同 wire field。Browser Team refresh 会跟随 Team-list continuation page，runtime contract 也会暴露 channel page continuation。

已有的 `readAudit()` page 现在也会读取一个 bounded look-ahead record，因此恰好结束的最后一页不会错误地带上指向空 continuation 的 `nextCursor`。

这是只读 contract change，不改变 Team journal、checkpoint、channel WAL 或 channel checkpoint format version。已有不带 page field 的产品 caller 会收到 server 的有界 default page；需要更多内容的 caller 必须显式继续读取。

## Alternatives considered

**原地修改已有 full-read method。** 不采用：scheduler、recovery、finalization 与 test-only authoritative scan 有意需要完整数据。把它们与产品 page 混用，要么破坏 recovery，要么迫使 provider 从 API-shaped page 重新拼出 full result。

**让 Host 对 `getTeam()` 或已经 materialized 的 full result 做 slice。** 不采用：这会让 provider 与 transport boundary 仍然无界，而且 channel read 仍需先重建整个 WAL 再切片。Provider-owned page seam 会在 storage／projection boundary 处限制 response。

**为所有 list 使用 string token 或 Team journal cursor。** 不采用：participant／task list position 是 projection-order cursor，不是 journal position；引入 opaque token persistence 会增加 state，却不会改善本地 pre-release contract。不同 list family 使用 distinct numeric cursor semantics，并在文档中明确说明。

**当 page 恰好填满时直接返回 `nextCursor`。** 不采用：恰好结束的 full page 会错误宣传 phantom continuation，导致不必要的空请求。一个 bounded look-ahead record 可以在保持内存有界的同时明确判断 exhausted。

## Consequences

Management plane 在 local Hub、Host、TypeScript SDK、Python SDK 与 Web refresh 之间拥有统一 page vocabulary。Response 同时受 caller limit 与 Hub 配置的 recovery size 限制；channel view projection 在产品 read path 中不再要求完整 WAL。代价是 list traversal 由 caller 负责，并且并发插入会按文档化的 provider-order traversal semantics 被观察。完整 provider scan 仍只对拥有 replay 或 repair 责任的代码开放。

Core schema、JSON／SQLite Hub restart、Host fetch、SDK server forwarding、Web refresh 与 Python wire test 覆盖 page limit、cursor advancement、最后一页耗尽、channel look-ahead 和 restart reconstruction。Property/model-based、real-model、distributed、browser/GIF 以及 load/retention evidence 仍按 [native multi-agent work-system proposal](../../proposed/architecture/2026-08-27-native-multi-agent-work-system.zh.md) 保持 pending。
