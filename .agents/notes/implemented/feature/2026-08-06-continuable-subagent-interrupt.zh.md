# Agent Note: Continuable subagent 当前轮次中断

Status: implemented

[English](2026-08-06-continuable-subagent-interrupt.md) | 中文

## 问题

一个正在运行的 continuable subagent 需要一种不销毁自身的当前轮次控制。继续执行管理器只在整个 Activation 拆除（结算、drain、scoped drain）内部取消子 Agent，而 `send_message` 只能增加工作。一次性运行有持有方拥有的 disposal 和 task-kill；continuable child 需要对应的当前轮次控制。

## 决策

`ctx.subagents.interrupt(targetSessionId, authority)` 只停止在线目标的当前轮次。管理器原语同步完成鉴权，调用现有的 `Agent.cancel(cause, { keepInbox: true })`，然后返回 `void`——fire-and-return：保证取消信号已发出，但不等待目标完全停稳。其余一切不变：不 dispose Activation、不释放 handle、不级联后代、不清空 inbox，也不改动 `AgentLoop` 或 `CancelOptions`。由于 `keepInbox` 让尚未领取的待处理队列停在 idle，中断绝不会自动启动下一个排队的 follow-up；已被领取进入中断轮次的工作属于该轮次，不会重新入队。被中断的 driver 进入 idle 后，一次显式唤醒发送会按保留的 FIFO 顺序恢复。

授权是一个封闭的双变体 union，刻意比投递权限更宽，因为停止一个轮次是幂等的且不投递任何内容：

- `{ kind: 'user', parentSessionId }`——人类出示持久化直接 parent 地址。在线目标的 `session.header.parentSession` 必须匹配；不涉及在线 parent Agent、目录读取或持久化访问，这正是 parent Agent 离线时在线 child 仍可被停止的原因。取消 cause 为 `user`。
- `{ kind: 'ancestor', agent }`——一个确切在线的 ancestor Agent（直接 parent 或更深）。调用方必须是注册表中其 id 的当前条目（过期调用方即使目标不存在也被拒绝），不得是目标本身，并且必须出现在 Activation 物化时记录的 `ancestry` WeakSet 中。取消 cause 为 `parent`。

目标只在管理器进程本地的 Activation map 中解析。不存在的 id——未知、一次性或已自然结算——是被接受的 no-op，统一覆盖完成竞态和重复请求而不泄露持久化目录信息；disposal 事务已打开的目标在鉴权后同样是被接受的 no-op。一次性生命周期（持有方 `dispose()`、task-kill）不受影响。`SubagentRuntime.interrupt()` 把未绑定管理器的组合视为被接受的 no-op 而不是 `CONTINUATION_UNAVAILABLE`，因为没有管理器就不可能存在管理器拥有的在线 Activation。

核心能力只拥有当前轮次操作。默认产品组合不公开直接 child 的中断传输；显式自定义组合可以选择自己的面向人类的归属方，而不扩大 manager 的授权模型。

## 曾考虑的替代方案

**把当前轮次中断与 Session 生命周期取消混为一谈。** 生命周期取消会清除所有权和队列，而当前轮次中断保留 continuable child 及其未领取的工作。两者仍是独立操作。

**等待目标静止并返回轮次结果。** 取消是协作式的，静止时间无上界；让 RPC（以及一个 `ChildLock` 槽位）保持打开会招致超时并与投递、disposal 形成排队。调用方需要的唯一事实是信号已被接受，而竞态（自然完成、disposal）本就幂等收敛。

**复用整个 Activation 的 disposal 来做中断。** disposal 的取消不带 `keepInbox`，还会 flush、capture 并释放 handle——它销毁排队工作和 child 的驻留。中断是针对一个轮次的控制操作，不是针对 Activation 的生命周期操作。

**顺手把 `send_message`／`followup` 权限扩展到 ancestor。** 投递向对话注入内容且不幂等；其确切直接 parent 权限保持不变。只有中断获得更宽的 ancestor 与基于地址的用户授权。

**中断后自动恢复被暂停的队列。** 在中止 A 后立即启动排队的 follow-up B 会让中断看起来被忽略，并夺走人类重新引导 child 的窗口。暂停到显式唤醒发送为止，让停止可观察且 FIFO 顺序完整。

## 后果

人类或 ancestor 可以停止一个失控的 continuable 轮次，而不丢失 child、其尚未领取的排队工作或正在运行的后代；代价是一个刻意保持弱的后置条件（`accepted` 表示“信号已发出”，目标在观察到信号前可能仍显示 `running`），客户端必须如实呈现。暂停队列规则意味着被中断的 child 会带着保留的工作停在 idle，直到 driver 进入 idle 后收到唤醒消息——这是有意的 human-in-the-loop 暂停，不是调度器缺陷。在 abort 收敛期间被接受的唤醒发送目前会保持排队而不锁存 wake；Issue #1838 跟踪共享的 agent-loop 修正。

显式自定义模型工具可以把 `exec.agent` 作为 `ancestor` 授权传入。核心原语校验在线注册表身份与记录的 lineage，因此该工具可以指定直接 child 或更深的后代，而不获得投递权限。发现仍只是提示而非授权，`send_message` 保持其确切直接 parent 规则。

## 测试

`packages/compat/subagent/tests/continuation.spec.ts` 中的核心覆盖证明了持久化 `turn/end` 中止、队列先暂停后按 FIFO 恢复、后代不受影响、两种授权及其取消 cause、self/sibling/stale/非 ancestor 拒绝、absent/一次性/disposal 竞态 no-op，以及 `keepInbox` 循环行为不变。`packages/compat/tool-subagent-control/tests` 中的自定义工具覆盖证明直接与更深 ancestor 以 `parent` cause 中断并暂停队列、self/sibling/陌生调用方被拒绝且不触碰目标、目标不存在时 no-op 且不冷恢复，以及 descendants 列表的 pre-order 位置。
