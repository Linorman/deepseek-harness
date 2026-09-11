# Agent Note: SDK post-bind Team Link enrollment

Status: implemented

[English](2026-08-29-sdk-post-bind-team-link-enrollment.md) | 中文

## 问题

由 SDK placement 的远程 Agent 不共享 Team Hub 或 Session store。它的 activation 可以先于远程 Link 授权而变为持久化状态；但在 binding 提交前启动 delivery 会与 Hub 的 attach 检查形成死锁。进程级 capability 环境变量也无法安全区分并发 child activation。

## 决策

`ctx.teamLinks` 拥有独立的 effect-scoped enrollment-issuer 注册表。受信任 activation owner 只能在 Team controller 提交精确当前 binding 后为其预留不透明 credential。issuer 返回 endpoint、远程 Link provider 名称、credential 与 revoker。credential 明文绝不进入 configuration、Team journal、Session log 或 diagnostic；[持久 WebSocket enrollment ledger](2026-09-01-durable-websocket-enrollment-ledger.zh.md)只保留其 SHA-256 digest、generation 和 revocation state。

SDK runtime provider 观察匹配的持久 `activation/changed` 事件，预留 credential，并对 child 调用严格的 `activation/link-enroll`。请求重复完整 activation target 和带 provider 的 binding。SDK server 只接受当前 live Agent 及该精确 binding，将相同 enrollment 视为幂等，以内存 credential closure 安装 activation-local WebSocket provider，并为该 Agent 启动 `FixedBindingTeamAgentLinkDelivery`。

child shutdown 会在远程 activation dispose 前关闭该 delivery 并注销 provider。placement owner 在远程侧关闭后撤销 credential，再回收 SDK process。撤销会移除 Hub credential 并关闭已附接 socket。

## 考虑过的替代方案

**向每个 SDK child 传入静态环境 credential。** 不予采用，因为并发 activation 会共享可变的进程级 authority。

**在持久 binding 前 attach。** 不予采用，因为 WebSocket Hub 正确拒绝没有当前 binding 的 attach，而 activation controller 只有在 placement 发布后才能提交该 binding。

**增加第二套 SDK Envelope-delivery 协议。** 不予采用，因为它会重复 Link 的认证、claim、receipt 顺序、reconnect 与 task-start 语义。

## 后果

SDK child 可以在没有共享 Hub 内存的情况下接纳 direct 或 task-assignment delivery 并写入持久 receipt。同进程 listener/issuer HMR 和完整本地 Hub restart 会从持久 ledger 恢复当前动态 credential。远程 worker 可以报告 outcome，远程 coordinator 可以经借用的固定 Link 发送原子 direct final。同主机冷替换由 [SDK 远程 placement 决策](2026-08-28-sdk-remote-agent-runtime-placement.zh.md)拥有。

## 验证

core registry、WebSocket Hub、WebSocket client、SDK protocol/client/server、remote placement 与 fixed delivery 测试覆盖 issuer 注册、无效或已撤销 credential、post-bind 顺序、精确 target/binding 检查、重复 enrollment、child teardown、receipt admission、task report 和原子 final delivery。真实两进程 SDK child 通过动态 credential 接收 direct Envelope、记录 Hub receipt、在 listener/issuer HMR 后续签，并可提交面向 human 的 final。
