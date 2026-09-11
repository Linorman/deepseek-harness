# Agent Note：本地 Team artifact retention

Status: implemented

[English](2026-09-01-local-team-artifact-retention.md) | 中文

## 问题

本地 Team artifact provider 会保存 content-addressed object，但它的直接 `delete()` 有意是 no-op。这样可以避免破坏共享 hash，却没有 provider-owned collection 路径，也没有 Team-aware 规则判断对象何时不可达。

## 决策

`clocky-team-artifact` 增加可选且有界的 `collect()` provider capability。collection request 携带当前可达 reference、已经超过 retention grace 的 provider-owned object id、exclusive provider cursor 与 row limit。结果报告 scanned、retained、unreachable、deleted、逐对象 failure row 以及 next cursor。provider 未实现 collection 时 registry 会 loud failure；直接 `delete()` 仍是显式 provider operation，而不是隐式 garbage-collection shortcut。

`team-artifact-local` 按确定性的 digest 顺序扫描 regular SHA-256 object file；只有当 object id 同时不在当前 reachable set 中且在批准的 reclaimable set 中时，才会删除对象。symlink、非 regular object、检查失败和删除失败都会留在有界结果中，后续 drive 可以重试 cleanup。scan cursor 允许大型 object root 跨多个 drive 处理，不需要把完整文件列表物化到内存。

可选的 local retention owner 使用 `listTeamsPage()` 分页读取每个未归档 Team，读取每个当前 Team state，并从 completed task attempt 追踪 artifact reference。它维护有界的内存 `unreachableSince` ledger，必须等待配置的 `graceMs` 后才能批准 id，并在完整 sweep 后重置 provider cursor。配置 `pulseIntervalMs` 后会 recurring cleanup；未配置时由调用方显式调用导出的 retention owner。进程重启会丢弃 grace ledger，因此对象会先再次被观察，之后才可能删除。Headless 与 Web 的 shipped composition 显式启用 24 小时 grace、128 对象 page、每小时 pulse 和五秒 disposal bound。

## 考虑过的替代方案

**让 `delete()` 删除所给 reference 对应的文件。** 否决，因为一个 content-addressed object 可能被多个 Team reference，共享全局可达性不能从单个 reference 证明。

**在一次 sweep 中加载所有 object 和所有 Team。** 否决，因为这会产生无界 provider page，使大型 artifact root 造成内存压力。provider 和 Team listing 都使用有界 page；local grace ledger 以配置的 object page size 为上限，超出部分保守地留给后续 drive。

**用 object age 作为 grace 规则。** 否决，因为一个旧 object 可能只在 Team 被 archive 时才变为不可达。retention owner 记录首次观察到对象不可达的时间；重启会重新开始 observation window，而不会立即删除。

## 后果

local store 现在拥有显式、可重试、cursor-bounded 的 collection path，同时保持共享 reference 安全。collection 有意是 provider-specific 的：remote/object-store provider 可以不实现它；需要自动清理的 deployment 必须挂载 Team-aware retention owner。当前 owner 会保护所有未归档 Team 中的 reference，包括 terminal Team，直到显式 archive marker 使其从 retention listing 中隐藏；audit-stream retention 与 WAL compaction 仍是独立 gap。

artifact package 测试覆盖 core registry forwarding、unsupported-provider behavior、local bounded scanning、shared-object protection、Team reachability tracing、grace delay、post-grace deletion 与 retained-reference protection。property/model-based、cross-host、failure-injection、large-state benchmark 和 operational-alert evidence 仍按 [native multi-agent work-system proposal](../../proposed/architecture/2026-08-27-native-multi-agent-work-system.zh.md) 保持 pending。
