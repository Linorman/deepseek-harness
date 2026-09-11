# Agent Note: Chat 中的持久工作流运行

Status: implemented

[English](2026-08-10-durable-workflow-runs-in-chat.md) | 中文

## 问题

普通工作流工具行拥有模型调用与最终工具结果，但这两条记录无法说明哪些成员真正开始、如何分组、各成员是完成、失败还是取消，也无法说明进程停止时哪些工作尚未结束。实时 `workflow/*` 事件只存在于当前进程，因此刷新或稍后重新打开 Session 会丢失运行历史。

自定义组合只有在拥有能够把一次已接受运行关联到调用 Session 的生产方，以及作为前缀也始终有意义的最小持久协议时，才能保留工作流历史。

## 决策

`clocky-tool-workflow` 把每个已接受的顶层运行投影到调用 Agent 的 Session。`tool-workflow/run-start` 记录稳定 `runId` 与已校验名称；匹配的工作流成员事件记录成员序号、精确标签、可选精确阶段、子 Session id 与结果；只有在结果已取得且 `run.dispose()` 完全停稳后，`tool-workflow/run-end` 才记录停止原因。嵌套 transport 执行照常运行，但不会写工作流记录，因为它不拥有独立根记录。

记录只供观察。任一次 Session append 首次失败后，本运行会停止所有后续写入、只记录一次告警，并且绝不改变取消、结果映射或 dispose。每种失败位置都留下空记录或合法连续前缀：已开始运行可以缺少后续成员或运行终点，已开始成员也可以缺少成员终点。包 invariant 会在冷加载与实时 append 时拒绝重复运行 start、无效或复用的正成员序号、无配对或重复成员 end、仍有开放成员时结束运行，以及运行结束后的任何更新。

workflow 包通过 `@clocky/clocky-workflow/types` 提供浏览器安全的运行与观察词汇；包含活跃 `Agent` 的请求和控制句柄继续只属于 Host。`@clocky/clocky-tool-workflow/types` 拥有四类 Session 事件。Client 只导入这些类型 face，因此 Host 与 Client TypeScript 程序共享持久合同，而不会合并 Host Cordis Context。

随附的 Web 组合不包含 `clocky-tool-workflow` 或工作流专属 Conversation renderer。自定义消费方可以重建这些事件，但仍只是观察者，不能接管工具调用、执行或 dispose 生命周期。

## 验证

包测试覆盖顶层与嵌套准入、零成员与并发运行、先 dispose 后写终点的顺序、四个 append 失败前缀，以及冷／实时 invariant 拒绝。重建这些记录的自定义组合拥有自己的展示证据。

## 曾考虑的替代方案

**把工作流内容附加到现有工具卡。** 拒绝，因为 `ui-tool` 与工具定义拥有该行的展示和交互。工作流专属 appendix 会耦合两个独立 keyed 业务生命周期，并恢复已移除的工具后附加模型。

**持久化服务端 projection 或新增 workflow wire 通道。** 拒绝，因为 Session 事件已经提供持久化、实时传输、分页和 gap repair。另一个 service、cache 或 transport 会复制同一事实并建立第二个生命周期 owner。

**展示声明阶段，或从脚本文本推断静态工作流图。** 拒绝，因为只有成员 start 事件能证明工作真正发生。`meta.phases`、`phase()` 叙述、分支和脚本语法都不是一次运行的权威拓扑。

## 后果

工作流进度可以与父对话保存在同一日志中，能跨刷新与进程恢复；执行所有权仍属于工作流 run holder。持久协议增加四类小事件和一个包所有的 invariant；首次写入失败会刻意牺牲后续观察，而不是牺牲工作流正确性。随附产品放弃工作流专属进度与导航 UI；未来的自定义展示方可以使用这些持久记录，而不改变执行所有权。
