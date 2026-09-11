# Agent Note: Multi-Hub projection reconciliation

状态：已实现

[English](2026-08-31-multi-hub-projection-reconciliation.md) | 中文

## 问题

SQLite 允许 replacement Hub 进程打开同一组持久 Team 与 channel 流，但已运行的 Hub 可能仍保留 replacement 或其他 writer 追加前的内存投影。若后续读取直接返回该 stale projection，已完成的接管会看起来像丢失状态；若盲目合并并发 mutation，又不安全。

## 决策

`team-hub` 会在面向读取的操作返回前，读取并验证已加载 Team 或 channel 的有界持久后缀。该后缀使用冷恢复时相同的纯 journal/WAL fold 进行折叠，post-commit observer 会收到新发现的 record，并且每个资源的 reconciliation promise 会被并发调用共享。如果外部扫描等待 storage 时本地操作已经推进了 projection，扫描绝不会覆盖更新的本地状态。

已有 cursor waiter 属于旧的内存 generation。采用持久后缀后会关闭该 generation 并安装新的 `CursorActivity`；因此 stale expected-cursor mutation 仍会走既有 cursor-conflict 路径，而之后的读取和 watch 使用已 reconciliation 的 projection。Watch registration 有意跳过异步 reconciliation，以便 dispose 能确定性地关闭已接收的 waiter。

SQLite backend 仍是多进程持久边界。JSON storage 继续保留单进程 log owner。本变更不引入 multi-Hub consensus、leader election 或 split-brain resolution；并发 mutation 仍使用 expected-tail compare-and-set，stale projection 在冲突时失效。

## 备选方案

**直到写入冲突前都返回缓存 projection。** 不采用，因为只读 failover 和 UI reconnect 会无限期看到 stale Team/channel state。

**每次读取都重新加载完整 journal。** 不采用，因为这会破坏 checkpoint 与 incremental projection；持久尾部推进时只需读取后缀。

**将外部后缀合并进 projection，同时保留旧 cursor waiter。** 不采用，因为 waiter 可能看到含义不明的 generation，stale CAS caller 也可能被误认为写入成功。关闭旧 activity generation 可以明确表达接管。

**给本地 Hub 增加 consensus 或 leader election。** 不采用，因为这是本提案之外的独立 distributed-authority 设计。SQLite expected-tail transaction 在不声称 federation 的前提下提供清晰的单 storage 一致性边界。

## 影响

共享 SQLite database 的两个 Hub 进程可以在一个进程退出后接管持久读取并继续 mutation；存活进程会在后续读取前收敛到外部追加的 Team 与 channel record。JSON 仍明确限制为单进程。跨 Hub cursor conflict、unsupported record 与 malformed suffix 都会明确失败，绝不会静默修复业务状态。

## 验证

- Team Hub edge 测试覆盖外部追加 Team/channel record 的读取时 reconciliation、双向后续写入、stale cursor conflict，以及已接收 watch 的确定性 dispose。SQLite load test 在 Hub 接管之间回放 256 条 Envelope，验证基于 checkpoint 的后缀重建，并保持 pending-delivery 顺序。
- 既有 JSON/SQLite restart、external-tail-conflict、WAL、checkpoint 与 invariant suite 保持通过。
- `pnpm exec vitest run packages/team/team-hub/tests/edge-cases.spec.ts packages/team/team-hub/tests/load.spec.ts` 通过。
