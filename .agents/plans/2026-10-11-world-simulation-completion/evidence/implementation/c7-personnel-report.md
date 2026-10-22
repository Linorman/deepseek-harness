# C7 人员义务盘点实现包

本证据编号 C7 是本轮实现包编号，不代表开发计划“C7 综合验收”已经完成。O09 完成；transfer/departure/fencing/清偿执行仍待 O07–O08/O10–O17。

`run.inspectPersonnelObligations(query)` 只读 Native，`connection.inspectPersonnelObligations(query)` 组合实际 canonical Team 与 Channel 账簿。selector 固定 person revision，可同时固定原 assignment revision。输出稳定 typed refs、原 owner、当前状态、unknown 与可用 owner 处置，不执行取消。涵盖开放/提交决策、接受 operations/outbox、任务准备用途及attempt cleanup、interactions/commitments、资源控制、未来wake/消息、任意相关关系和世界结构预留；实际 Team 补 task creator/owner/executor/reviewer/hint、attempt、startup/activation、workspace 和 pending deliveries。原 pinned domain 显式提供 personnel subjects，不猜未知 JSON 字段。

真实 source4/lib4 公司/实验室 × JSON/SQLite 使用真实 Agent 三工具产生 pending task 和通信。在实际 Channel IO 成功返回前屏障暂停，Native 尚无回执但 Team 有原 Envelope；盘点正确给出 sender outgoing / recipient incoming、原 owner/ref 与 outcome-unknown。查询不追加 Native/Team/channel/Session、不 claim/ack、不启动模型，不回传任务/消息/Persona body。完整 UTF-8/item 阈值、exact 与 ±1、中文引用、tiny/unknown/stale 拒绝均测试。原 IO 对账后 checkpoint，新进程 paused 零模型恢复当前原件；不会虚构旧 pending 消息永远未清。

[source4](c7-personnel-obligations-source-all.log) 23.40s；[plain Node lib4](c7-personnel-obligations-lib-all.log) 5.23s；[fixture 精确命令/哈希/范围](c7-personnel-obligations-fixture-manifest.json)；[当前输入哈希](c7-personnel-input-manifest.json)。[Native18 与 Team12](c7-inventory-tests-fixed.log) 30 项通过；后续 [邻接回归](c7-final-focused.log) 578 passed、4 stale-hire 分类失败，失败未删除；[精确修复回归](c7-stale-regression-exact.log) 4 passed。最终 [相关34项](c7-final-relevant.log) 3 files passed（152无关用例按filter跳过）；[Host类型](c7-types-final.log)、[build197](c7-build-final.log)、[Root lint](c7-lint-owned-final.log)、[stale分类lint](c7-stale-lint-final.log)、[doc-sync29](c7-doc-sync-final.log) 通过。不借旧失败套件宣布最终全仓通过。

Root Team provider unit 的 typed book facts 额外覆盖 ownership hint 不是承诺、未发布 startup、offline activation 未确认退休、未释放 workspace 与迟到 read close；真实 fixture 没有启动 attempt 或接受 hint，不能把 unit book 投影说成真实执行。多个 owner prefix 被实际重验；source 移动或有限扫描返回 partial。Native-only/partial/overflow 不完整；covered 即使还有责任或 unknown 也只是覆盖完整，不授权离职。

初 fixture 的 Persona name 不在有限 catalog，compiler 在任何 boot/模型调用前正确拒绝。测试可信 catalog 显式声明唯一 probe name 后仍严格编译；没有提高预算或放宽生产 parser。最初两个 provider unit 将读取次数与渠道次数混为期待原因，修为分别验证实际 channel/page work bounds；一次 typed synthetic activation status/字段不合法，修为真实 Core `offline`/startup schema，失败日志保留。

相邻 stale hire 修复先复用原 latest-application admission 再检查审批，第二次 stale 重试恢复 `SIM_WORLD_CONFLICT` 与原消息匹配，零 append/原 plan 保留；没有伪造批准或更换 plan。

所有中间文件和产物留在本项目；未增加 checklist items，完整 v1/SDK/UI、外部代表、调岗离职、真实模型与全设计验收仍待完成。
