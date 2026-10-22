# C21 请求、确定性求值与通知故障证据

本项完成规则型外部交互的请求、求值、发布与接收回执故障矩阵，不单独代表 X12 所有代表准备／取消竞赛已验收。新增四个独立 fixture，未修改生产代码或 C14/C19/C20 原件，未更新 checklist。

公司／实验室 × JSON／SQLite × source／plain Node lib × 12 个真实 append 窗口，共 96 case、96 次 SIGKILL、192 个独立冷恢复进程，source 48/48、lib 48/48。每个冷恢复首先验证 paused 和零模型调用；只对账已保存原责任。运行前后 653 个源码／fixture 文件及 821 个编译 JS 文件 hash 完全相同。准确命令及四文件原件 hash 见 [command manifest](c21-rule-fault-command-manifest.json)，逐份 672 个 JSON 原件校验见 [artifact verification](c21-rule-fault-artifact-verification.json)，120 个 accepted communication 的唯一 Envelope／原 recipient receipt 校验见 [target verification](c21-rule-fault-target-verification.json)。这些保守 inventory 不是运行时全部 import 的追踪证明。

六组对称 before／after 边界分别为 `request-append`、`evaluation-append`、`request-post-receipt`、`result-post-receipt`、`request-recipient-receipt`、`result-recipient-receipt`。before 回执窗口的 Target Envelope 或 recipient `channel/receipt` 已真实落盘，Native 的对应确认尚未 append；父进程在实际 barrier IPC 后 SIGKILL，不以 mock 抛错代替断电。append 后窗口从持久 Native inspection 取原件，覆盖尚未更新内存 projection 的真实时段。

真实 Goal／三工具／独立 Agent 产生原请求和计划。安装的 `clocky.external.availability/1` 是确定性规则：库存输入与实际求值随唯一 `run/world-mutation` 保存，重放只校验实际 record，不重新调用模型或策略求值器。`evaluation-append-before` 原 Native interaction／mutation／result 为零，不把临时未提交 batch 中的候选计算称为已保存求值或随机样本；after 原实际求值、唯一 result 和唯一安全 wake 保持。原 supplier organization 保持 `cognition:none`；原库存 7 与资金 999 从保存前、append 后到两次 cold 均不变。

所有原 World、永久人物 binding／profile／readiness／phase、资源、关系、安全 wake、Native journal prefix、Channel 原件均精确比较。两次 cold 的 accepted operations 完全相同；回执逐字段匹配实际 Target 原件，没有新 Envelope，也没有重新接受请求、计划或求值。冷进程在 paused 中检查 driver 的 paused 拒绝行为，该调用不改变 Native 或产生模型调用；没有生产性 advance。recipient 回执通过原 `confirmDelivery` 在 paused 中对账。publication 回执尚未记入 Native 时，既有 `dispatchOperation` API 要求 running：原件明确记录 `restored:paused → exact-dispatch:running → exact-dispatch:paused`，这段技术对账仅精确派发原 operation、无 activate／advance／infer；第二次 cold 不再重复派发。不能把 publication-before 窗口的过程称为始终 paused；恢复入口和最终状态均 paused。

最终新 nonce 目录为 `validation-20261012T100312Z-f74a988f`。原默认目录发现来源未知的 288 份 process 文件，混有独立 pilot 同名覆盖记录，没有可靠消费 manifest；原件全部保留，未合并为本次完成证据。最终只引用有实际执行命令、前后输入冻结、真实进程退出及逐份原件审计的新目录。初始 supplier description／长行、TS7022 的 wake 推断诊断和相应 pilot／失败编译日志保留；最终 scoped TypeScript／type-aware lint exit 0。

源码 hash 为 `ef482c197b2c6b9f6b01caac6b7c44efb53f88e77333192aea9458eab87be5e2`，实际 compiled JS hash 为 `503691929390b28686c991b564d461a1c6e29e42ee40e6ecd5bbd2827fcf00f5`。[start manifest](c21-rule-fault-input-manifest.json)、[end manifest](c21-rule-fault-end-input-manifest.json) 分别保存完整文件清单与字节 hash。
