# C22 正常外部代表故障矩阵

当前 Native74／actor native4 在 company/laboratory × JSON/SQLite × source/plainNode lib 中覆盖 15 个真实故障边界：[source60](c22-actor-fault-source60.log)、[lib60](c22-actor-fault-lib60.log)通过，共 120 case、360 OS process、120 预期 SIGKILL、240 cold 0model。Warm 实际模型调用合计 960；各 cold 无模型调用，不等于无其他恢复 IO。[完整核验](c22-actor-fault-verification.json)、[root 逐件核验](c22-actor-fault-root-verification.json)与[冻结输入及准确命令](c22-actor-fault-input-hashes.json)保留 960 raw／2 log 和 4539 消费文件完整副本。

边界包含代表 reserve 前／后、preparing 后、Participant 已接受但 Native 尚未绑定、commit 前／后、director/requester Channel 已接受但尚未确认、结果通知派发前、请求者联系／代表回复失 post 回执，以及代表／请求者 Session 已持久但未 ack、Target ack 后但 Native 尚未确认。第一 cold 只保留原责任；第二 cold 用原公共 owner 完成精确恢复。commit 后仍未完成维护时，必须结束同一原维护。reserve 前未 append 的 provisional UUID 不作历史身份；第二 cold 显式执行原已接受有限 Persona 计划，只分配一个 canonical Actor，原 latent identity、唯一 result/wake、资源及 exact retry0append 保持，状态仍 paused 且零模型调用。

恢复原件记录 16 次真实新 activation／writer，chargedActors 为 0→1→0，并由 confirmed hibernation 释放；历史 token 费用保持，不能把它们说成零 activation。24 个 case 使用显式临时 running 精确派发原 operation 后回到 paused，不调用生产性 advance 或推理。固定 outboxMaxAttempts=1；24 个明确原 retry 预算授权追加一次额度，再由 canonical Target 同 key 读回唯一原 Envelope，不能称其为无预算追加的自动恢复。已 Target ack 的消息只读原 WAL receipt，再在 paused 中确认 Native delivery，无需 residency。

原 supplier-stock=7、supplier-money=999、buyer-money=1000，外部组织 cognition、原已存在 Session/Channel 前缀、finite Persona 和 canonical sender/recipient/body 均保持；已投递输入及原 receipt 至多一份。代表 Session 排除买方私密底价和 director 规划 canary。该 fixture commitment 为空，不替代非空合同的独立 C17 证明。旧仅 source60、未完成 reserve-before 的 v1 原件独立保留；最终 v2 的 source/lib 使用两个新 nonce，运行前后输入 hash 全相同，不复写旧原件。X12 最终验收仍须合并规则保存及取消矩阵，并核对未覆盖的拒绝路径；该报告不单独勾选。

最新整体静态验证：[Host 类型](c22-final-host-types.log)、[完整 lint](c22-final-full-lint.log)、[doc29](c22-final-doc29.log)通过；对应真实命令为 `pnpm exec tsc -p tsconfig.host.json --noEmit`、`pnpm exec tsx scripts/run-oxlint.ts .`、`pnpm run doc-sync`。生产文件与最终 C22 归档输入仍逐项一致。
