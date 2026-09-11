# Agent Note: Team channel implementation leases

Status: implemented

[English](2026-09-04-team-channel-implementation-leases.md) | 中文

## Problem

版本化 channel adapter、view policy 和 workflow extension 可能比注册它们的 Cordis contribution 活得更久。因此 live channel 需要它实际接纳时使用的精确实现；同时 orphan 或 terminal channel 不能无限 pin 住 retired object，也不能在 Team attachment 存在之前发布 durable visibility。

## Decision

`TeamRuntime` 将 accepting registration 与 retirement-retained entry 分开，并为 adapter 和 view policy 暴露 release-once lease。`TeamHub` 在 channel WAL admission 之前获取这些 lease，以及 adapter-private runtime lease。Workflow graph 会为每一个被引用的 condition 和 target extension 获取一个精确 lease，包括 initial 和 default target。

Cordis 的 [effect](../../../../vendor/cordis/src/fiber.ts)只执行一次每项 registration 的 cleanup。`TeamRuntime`只通过这些 effect 发布和移除私有 registry entry，因此旧 disposer 无法移除 replacement registration。私有 lease counter 只有两个写入来源：创建一个真实 lease 时加一，该 handle 首次 release 时减一。Handle 保留自身的 release-once 检查；已释放 handle 拒绝 implementation access，retired implementation 则会保留到其最后一个 handle 释放为止。

Terminal WAL state 会关闭 channel watcher 并进入 deferred eviction。Eviction 会等待 pending delivery 与所有已接受的 Hub admission，移除内存 projection、关闭 stream，并通过幂等 cleanup 释放所有 implementation lease。当 receipt 或 expiry admission 清空最后一个 pending delivery 时，terminal channel 才变得可 evict。Channel WAL cursor conflict 会使用现有 retained implementation 刷新 external suffix，并返回可 retry 的 conflict；它不会 discard active channel。

Channel creation 会先写入 WAL 并保留本地 handle，再提交 `channel/attached`；但只有 Team reference durable 之后才会 emit channel event、写 checkpoint 和 repair audit projection。Attachment 失败会 discard 未暴露的 handle。Attached-channel lookup 发现 orphan handle 时会 discard；per-channel release barrier 会避免 recovery 与 stream close 竞争。

## Alternatives considered

**增加重复 effect 与 lease ownership 保证的 registry-owner 和 counter guard。** 不采用，因为私有 registry 没有其他 mutation path，每个真实 lease 只会产生一次加一和减一。测试另一个 registry owner 或负数 counter 需要绕过 owner 直接修改私有状态；公开契约是 registration replacement 与独立的 release-once handle。

**Provider retirement 时关闭每一个 channel。** 不采用：provider retirement 会阻止新的 admission，但不会使 live channel 已接受的工作失效。

**在 terminal WAL record 后立即释放，不检查 pending delivery。** 不采用：terminal channel 仍可能需要为已接受的 delivery 接收 receipt 或执行 expiry admission。

**每次 channel cursor conflict 都 discard 后 reload。** 不采用：retired provider 无法重新注册 replay active channel 所需的精确 workflow extension object；当前 retained lease 才是该 channel 的权威实现。

**在 Team attachment 前发布 channel event 和 audit。** 不采用：跨 stream attachment 失败后会留下不可撤回的 visible orphan fact，即使 recovery 会忽略未引用的 WAL。

## Consequences

HMR 会将 implementation 从新的 channel resolution 中移除，同时已接纳的 active channel 继续使用其精确的 adapter、view policy 和 workflow extension object。若 pending delivery 或其他已接受的 Hub operation 尚未完成，terminal cleanup 可能延迟 object collection；后续 recovery 仍必须找到精确的 durable adapter、view policy 和 extension version。Orphan WAL bytes 会为 recovery diagnostics 保持 durable，但不会有 channel event 或 audit projection，也无法通过 Team read 访问。

## Verification

Core runtime 与 workflow-extension lease suite 覆盖 retirement、replacement、exact graph reference 和幂等 release。TeamHub test 覆盖 JSON 与 SQLite terminal eviction、pending-delivery drain、watcher closure、cursor-conflict recovery、attachment failure cleanup、orphan lookup cleanup，以及 adapter retirement 后 retained channel 的行为。

Core runtime test 还覆盖 resolver failure 与 recovery、单个 proof 的撤销、另一个 runtime 的拒绝，以及 contribution disposal 后的 source replacement。解析后的 provider snapshot 验证 task、activation 和 channel 已结算时仍保留 pending human/workflow blocker；minimal provider 会明确拒绝不支持的 product 与 scheduler capability。
