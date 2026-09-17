# Agent Note: fork 出的 child 保持 one-shot

Status: implemented

[English](2026-08-10-fork-children-stay-one-shot.md) | 中文

## 问题

fork 与 spawn 的唯一区别是 child 的 Session 会以 parent 已完成轮次的前缀作为初始内容（见 [subagent-fork-in-process](../../../../packages/compat/subagent-fork-in-process/README.zh.md)）。这份初始内容有实打实的 token 成本——继承的历史会在 child 的每次请求中重新发送——而它唯一确定的回报是提供方侧的前缀复用：在提供方与模型相同的前提下，起始字节与 parent 逐字节相同的 child 请求，无需为这段共享区间重新预填充。任何由 child 作用域添加在继承历史*之前*的内容都会消耗掉这份回报，因为复用在第一个不同字节处即告停止。

作用域局部的 `report` 返回通道现在是此类添加中最大的一项，而自[report 义务](../feature/2026-08-06-continuable-child-report-obligation.zh.md)起它是两项而非一项增量：`report` 工具 schema，以及 `tool:report` 系统提示词 section。两者都位于请求头部——系统块与工具块先于所有消息——因此一个可继续的 fork child 会在第一条继承轮次之前就使复用失效，并重新预填充它当初 fork 就是为了复用的整份 transcript（文本记录）。这种组合付出了 fork 的复制成本却收不到它的收益，而 parent 手上仍握着一份 child 本可共享的可复用前缀。

## 决策

[base 组合包](../../../../packages/bundle/base/cordis.patch.yml)、其 headless 衍生组合，以及随附 Web 的 `standard`、`code` 与 `cordis` preset 都不挂载 fork provider，也不公开 `subagent_fork`。产品任务因此经由 Team topology 与 Team 工具进入，而非模型指挥的 Session fork。独立示例和显式自定义组合仍可在继承对话确属部署选择时挂载 fork provider 与工具。

`spawn` 保持 `backgroundMode: continuable`。可继续的 spawn child 与 report 义务仍可用于已配置的 direct-child 组合；它们不再构成第二条产品任务入口。

### 该限制在于组合，不在于代码

`ForkInProcessProvider.prepareContinuable`、`ctx.subagents.startContinuable({ provider: 'fork' })` 与可信的 `ctx.sessions.fork()` 都保持实现。`tool-subagent` 不会在挂载时拒绝带继承上下文的 continuation，因为自定义组合可以省略 child-scoped report contribution 并保留字节一致的前缀。这项 provider policy 属于组合，而不属于通用 delegation tool。

重新开放的条件记录为 `prepareContinuable` 方法上的 `TODO(fork-continuable-prefix-reuse)` 标记——随附组合不调用这个方法——并由 issue #2124 跟踪：当 child 的系统提示词与工具 schema 能与其 parent 逐字节一致时，可继续 fork 即可重新开放。

## 备选方案

**在挂载时拒绝 `inheritsParentContext` 与 `continuable` 的组合。** 一次响亮的加载期失败可以阻止悄然的重新引入，而配置改动做不到这一点。否决的原因是委派工具看不到 report 包，且在没有它时该组合是合法的；对于从不安装任何 child 作用域增量的部署，这个不变量是假的，而 `tool-subagent` 会去断言一件由插件清单拥有的事实。

**在产品组合中保留 fork provider 和 `subagent_fork`。** 不予采纳，因为 Team 成为任务 owner 后，模型指挥的 Session fork 会保留第二条产品编排路径。自定义组合可保留该能力，而无需让它进入随附模型目录。

**删除核心 fork provider 与 Session API。** 不予采纳，因为可信测试与显式自定义组合仍需要已完成前缀 child；产品取消挂载不等于移除这项内部能力。

**照常随附可继续的 fork child 并接受这份损失。** 否决的原因是这份损失是全额而非边际的：复用在继承历史之前就已中断，于是 child 为一份自己复制过来、目的恰恰是不必付费的 transcript 付了全额预填充。想要一个没有继承上下文的长期 child 的部署，本来就有 `spawn`。

**让 `report` 对每个 Agent 可见。** 全局注册会通过让 parent 与 child 拥有相同的 schema 与 section 来恢复逐字节相同的前缀。否决的原因是根 agent、one-shot child、远端 child 与无 agent 调用方都会宣告一件推导不出收件方的工具，而执行期拒绝会让 schema 可见性与权限彼此矛盾——这正是[report 工具 Agent Note](../feature/2026-07-30-continuable-subagent-report-tool.zh.md)已经定下的作用域局部决策。

**把 child 作用域增量安装到继承历史之后。** 否决的原因是它无法表达：在每个提供方的协议格式中，系统提示词与工具 schema 都是请求头部结构，因此它们内部的任何排序都无法把仅属于 child 的添加放到消息列表之后。

## 后果

- 随附 headless 与 Web 模型目录不含 `subagent_fork`；整体组合测试会将这一缺席与 Team final 路径一并固定。
- fork provider 及其包级测试仍可供示例、测试与自定义组合使用；它的 continuable 路径没有随附产品调用方。
- 在随附产品组合中，report 义务仍限定于 continuable spawn child。它的调度、权限模型与覆盖独立于自定义 fork 组合。

### 已接受的风险

显式自定义 bundle 或 profile patch 可以无需修改代码地重新引入 fork provider 与工具。这是可接受的，因为该能力留在随附产品目录之外，而且通用 delegation tool 无法推断自定义组合的 child-prefix policy。
