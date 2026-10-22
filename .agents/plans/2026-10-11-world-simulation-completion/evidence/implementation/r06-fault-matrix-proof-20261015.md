# R06 领域故障矩阵验收

2026-10-15 对已有实现和原始产物做独立复核。原 R06 已满足设计 9.2 的十行故障责任，不代表真实模型或最终全项目验收。

## 当前输入与原始证据

当前 1,391 个 source/lib/fixture 输入与 [输入清单](../../../../../.local/world-completion/r06-final/inputs-final.json)及归档逐字节一致；归档 SHA256 为 `7db389da6e82a9624bac4dae32090a99875c38acba620d575b914ced5206f5bc`。2,652 个原始产物的 hash 均一致。[独立审计](../../../../../.local/world-completion/r06-root-review/independent-audit.json)重新执行原数据库、journal prefix、业务引用和 canonical receipt 断言，并非只读取成功摘要。

主矩阵为 30 阶段 × JSON/SQLite × source/plain Node lib：120 案、360 独立 PID、120 次 SIGKILL、240 次冷恢复，检查 440 条 canonical receipt。另复核当前生产治理 close 前后 8 案、24 PID、8 次 SIGKILL、16 次冷恢复及 764 个未变化输入；合计 128 案、384 PID、128 次 SIGKILL、256 次冷恢复。每个恢复进程均为零模型调用。[逐案路径与责任映射](../../../../../.local/world-completion/r06-final/audit.json)保留实际原件位置。

## 设计矩阵映射

| 故障责任 | 实际用例 |
|---|---|
| 请求 accepted 后、Channel 前；Channel 后、receipt 前 | `mediated:request-accepted-after`, `mediated:request-notification-lost` |
| vote/close/enact append 前后 | `norm:vote-before`, `norm:vote-after`, `norm:enact-before`, `norm:enact-after`, `norm:notification-lost`；当前生产 close 前后 8 案 |
| Persona/plan accepted 后、身份准备前 | `hire:accepted-before-reserve` |
| 代表/候选人 Participant 已建立、binding 未确认 | `hire:participant-afterIO`, `actor:participant-unconfirmed` |
| 调岗 append 前后 | `personnel:transfer-commit-before`, `personnel:transfer-commit-after` |
| 离职撤权后、writer 停止未知 | `personnel:depart-accepted-fence-after`, `personnel:depart-retirement-unknown`, `personnel:depart-commit-after` |
| 外部 reservation/采样结果保存后 | `rule:evaluation-append-before`, `rule:evaluation-append-after`, `actor:reserved-after` |
| 业务 committed 后、通知未知 | `norm:notification-lost`, `personnel:notification-lost`, `actor:notification-lost`, `funded:generate-notification-lost`, `funded:existing-notification-lost` |
| 取消与任何准备/提交竞争 | `hire:cleanup-before-append`, `hire:cleanup-after-append`, `actor:cancel-participant-unconfirmed`, `actor:cancel-before-commit`, `actor:commit-wins-cancel`, `personnel-cancel:before-native-commit`, `personnel-cancel:commit-wins` |
| 注册卸载/实现缺失 | `retirement:retired-executor` |

## 验证与失败记录

[执行报告](../../../../../.local/world-completion/r06-final/report-final.json)及[准确命令](../../../../../.local/world-completion/r06-final/commands.json)保留 source 60、lib 60、owner 28 项通过和类型零诊断。此前失败没有删除：严格检查输入错误、观察器重入维护期间队列、旧 stdout 缺 phase、测试 metadata selector、错误码期望和遗漏最终审计文件；修复测试后重跑完整矩阵。空 lint 日志本身不作为退出码证据；组合最终检查仍归 R11。

独立复核通过 `python3 -B` 读取 manifest、tar 和原件计算 SHA256，加载 `audit-current.py` 的逐案函数，重新运行 `audit-close.py` 的断言；输出仅保存在项目内 [r06-root-review](../../../../../.local/world-completion/r06-root-review)。未重复执行已通过且输入未变化的故障矩阵。

## 适用范围

使用真实 Loader、Native、Team、Channel 和 Session，模型回答为 scripted。维护持有的 canonical 队列不由观察器重入：保存原基线、明确的 held-cut 标记、原始数据库和完整冷恢复记录。部分 actor/rule 案第一冷进程仅检查 paused 原责任，第二冷进程才显式对账并证明同身份重试不追加；不宣称每个未决事项自动终结。missing/replaced handler 在 Native/Team restore 后拒绝；恢复前 provider 拒绝另由 owning tests 覆盖。没有改变生产额度、故障时间阈值或格式，也没有以最新实现代替原 generation。
