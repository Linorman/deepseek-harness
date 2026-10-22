# C12 人员崩溃恢复验收

日期：2026-10-12；Native stream69、checkpoint manifest3、Session format0。O17 已完成，本批连同 O14 后 checklist 为 38/112；整体 MVP 仍未完成。当前生产及 fixture 输入 hash `a3d87ee16d06a1906f7d8ca3419b6ae08ad45a0b5741525e003d0b7ba4d1c711`，见 [318文件输入清单](c12-personnel-input-manifest.json)。

实际 Loader／Agent／三工具／原 Team／Channel，company 受信 v0 × JSON/SQLite × source/lib。九个断点覆盖调岗 reserve append 前后、原维护 draining 保存后、调岗 commit append 前后、离职 accepted fence 后、真实退休 raw.dispose 未返回、离职 commit 后、业务已提交而通知回执未保存。父进程收到真实 durable barrier 后 SIGKILL；每例两次独立 OS 冷恢复，均 paused、零模型调用。

当前接受证据为 source 原矩阵16通过＋修正通知断言后的 focused2通过，以及本次构建产物 lib18/18。原 source18 的两项 notification 失败保留：第一次冷恢复已真实对账原 receipt，第二次应核对第一次对账后的实际账本，不能要求仍是回执丢失前的 pending 状态。修正后仍逐项核对原 operation 身份／内容／指纹、旧 attempt 前缀、实际原 receipt 和全部其他操作。准确命令、4源码 hash、接受的108 raw hash及旧失败范围见 [执行者 manifest](c12-personnel-crash-agent-manifest.json)。

Root 独立检查108份原样本及当前318输入全部hash，并比较36组各自两次完整 cold proof：完全一致，共72次cold，全部零模型调用；world／relations／resources／grants与实际durable prefix相同。实际脚本还核验 decisions、operations/outbox、scheduledEvents、wakes、tasks/cancellations、interactions、commitments、原绑定／Persona和Session原前缀。见 [Root raw核验](c12-personnel-crash-root-artifacts.json)。

未知退休的 barrier 已进入真实原 raw.dispose：原 writer revoked且仍charged、Team原Activation尚无quiescedAt，原maintenance draining／fence／reservation保留。冷恢复由实际owner确认同一原epoch／Activation／reservation的停止及Team真实quiescedAt后才charge0；只保留一个原epoch，原maintenance命令和未提交义务继续保留，不伪造业务commit。准备及提交前不丢原assignment，提交后只保留唯一原mutation／result；精确retry零append。资源台账保持原prefix，当前人员操作不含费用协议，不冒称支付验证。

统一build197 artifacts、完整lint含Host/Client类型、doc-sync29/29已通过。通知测试修正后 own Host types和typedlint另有exit0记录，详见执行者manifest；无需因纯测试分支变化重复构建产品。所有临时、日志、编译和原raw都在项目内；未commit/push/PR。O15真实重聘及产品计数、v1／外部／完整产品与双SDK仍待办，不增加或删除checklist items。
