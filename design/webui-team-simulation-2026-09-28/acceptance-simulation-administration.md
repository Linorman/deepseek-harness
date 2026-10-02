# Simulation 行政与时间／预算验收

D07／D08 完整范围于 2026-10-01 验收通过。本文为逐项证据映射，不维护第二份开发 checklist。完成状态以 [plan](implementation-plan.md) 为准；历史记录不能代替本轮执行。

## 行政操作矩阵

| 要求 | 当前实现／测试所有者 | 本轮证据与剩余核对 |
|---|---|---|
| 创建响应丢失／进程退出保留 run、Team、reservation | `simulation-administration.snapshot.ts`、`simulation-process-restart.snapshot.ts` | 待最终构建复验；独立进程案例必须显示不同 PID、同根目录和新认证 |
| 初始完整 checkpoint 前不推理／不允许启动 | `company-preparation.spec.ts`、`company-owner.spec.ts` | 当前 JSON／SQLite Web 两项通过：持有实际初始 checkpoint，页面 start 禁用、合法 manage HTTP unavailable，释放后 paused/ready，零模型 |
| 重复 phase 原结果不覆盖后来 paused | `company-owner.spec.ts`、`simulation-administration.snapshot.ts` | 待复验 API 与浏览器保留原 running、后来 pause 及最新控制状态 |
| 无工作／无 driver 原因准确 | `administration.spec.ts`、`company-owner.spec.ts`、`run-statuses.spec.ts` | 当前 administration/company-owner/run-statuses 源测试通过，包含真实模板 provider/preset/执行闭包在预检/创建处拒绝及完成场景禁继续；最终浏览器完整流程待复验 |
| 暂停仍有推理／真实超时不冻结 | `administration-clock-budget.spec.ts` | JSON／SQLite 新测试已通过：三个真实运行共享两个 permit，全部暂停仍按真实 deadline 取消，清理前 permit 不释放 |
| ingress 同身份、旧 tick、消费和 decision | `maintenance.spec.ts`、`workflow-ingress.spec.ts`、进程浏览器案例 | 待最终构建复验；原 payload 改写拒绝、分配时间和消费不能混同 |
| checkpoint 采集中禁止 ingress／继续，断线可查 | `maintenance.spec.ts` | 当前 JSON／SQLite Web 两项通过：实际 collecting gate 内 start/ingress 禁用，合法 ingress HTTP unavailable；原cut完成后查询终态。断线/独立进程路径另见既有browser/restart用例 |
| checkpoint 失败保留成功 manifest／准确诊断 | `checkpoint-diagnostics.spec.ts`、`maintenance.spec.ts` | 当前 JSON／SQLite Web 两项通过：实际 sessionPersistence.isUnmaterialized 首次 IO 失败，上一成功 manifest保留；公开collect/source-unavailable精确Session/Team诊断、无私有路径，原请求失败查询 |
| restore 缺失／篡改／版本拒绝，不新建或推理 | `checkpoint-corruption.snapshot.ts`、`restore.spec.ts` | 本轮 `checkpoint-corruption.snapshot.ts` JSON／SQLite 2 项通过：不同进程修改真实 Session header，拒绝且损坏字节保持；精确修复后零模型恢复。版本准入原生已覆盖，浏览器失败反馈待补 |
| restore 当前后缀、paused、不重放效果 | `simulation-maintenance.snapshot.ts`、进程浏览器案例 | 本轮 `product-maintenance-recovery.snapshot.ts` 8 项通过，JSON／SQLite × accepted、native-begin、native-complete、terminal 四处真实退出后新 Loader 恢复原命令。UI 流程仍须最终构建复验，不用同 Host 重挂代替独立进程退出 |
| owner 冲突／卸载／未确认清理责任 | `maintenance.spec.ts`、`company-owner.spec.ts`、`lifecycle.spec.ts` | 当前 JSON／SQLite Web 两项通过：真实restore后临时connection.close失败，Native owner仍this-provider，UI cleanup unconfirmed/start禁用；新的明确恢复完成。活动writer/驻留恢复另见lifecycle source381项与Team实际writer验收 |
| 模型取消／未知 usage 按实际清理结算 | `administration-clock-budget.spec.ts`、`lifecycle.spec.ts`、`tokens.spec.ts` | 新测试证明 partial usage 7/2 在清理后记 unknown 并保留 10000 预留，不假装确切消耗 9；Web JSON／SQLite 已证明 cleanup 前 active1/1、reserved10000，cleanup 后 active0、unknown1、observedUsage7/2；两后端完整 16 种语言／主题／尺寸／原生200%通过，证据位于 `.tmp-simulation-plan/ae/admin-budget-browser/` |
| 多候选／低驻留开窗前选择合法 writer | `lifecycle.spec.ts`、`windows.spec.ts`、`dispatch.spec.ts` | 当前 lifecycle381项通过，含 `skips an unbound eviction candidate before hibernating an eligible resident`（限额1、跳过未绑定候选、只退休合法空闲writer）及 `requires recovery rather than starting a second resident while its writer is reserved`；windows/dispatch也通过，入窗writer不得通过换人绕过准入。浏览器剩余驻留表现待复验 |

## 时间与预算矩阵

| 要求 | 证据范围 |
|---|---|
| 大整数模拟时间输入／排序／显示 | 原生未来 ingress 与 Web 已有 `9007199254740993` 场景；本轮还须核对有界集合的准确顺序 |
| 模拟时间与真实时间独立 | 新时钟测试在所有 run paused/time 不变时触发真实 absolute deadline，保留 started/deadline/expiredAt |
| 缺失／未知 usage 不冒充零或已知消费 | metrics、token 原生和 UI 用例需同时证明占用、observed partial usage 与 unknown 语义 |
| Host 共享 permit 与单 run 区间额度独立 | 新时钟测试三个 run 竞争全局上限 2、排队 1，额度各自保持，清理后占用 `[0,10000,10000]` |
| 取消前后容量不能提前复用 | 模型 abort 已到达而 cleanup 被阻塞时 active 仍 2，排队取消不生成第三请求；释放后 active/queued 归零 |
| 区间 token 额度真正禁止下一请求 | 新 JSON／SQLite 测试预算 10000，只允许一个模型请求，下一预留产生持久 SIM_BUDGET_LIMIT，重复旧 running 不推理，新继续拒绝 |
| 实体／驻留不足与未知 writer | 预检、原生注册／开窗、清理失败与 UI 允许性必须各有对应断言，不用数字展示代替准入 |

## 交互与呈现

D 创建／开始、人工输入、检查点、恢复、原请求页需在本轮真实 Host 中验证中英、明暗、桌面／短窗／窄屏、原生 Chromium 200%、纯键盘、焦点恢复、IME、读失败／断线／撤权、原命令未知结果和 cleanup unconfirmed。截图与 JSON 测量保存在项目内 ignored 输出目录；只有执行通过并具有确切条件的证据才能用于关闭 D07／D08。

## 最终完整执行

当前完整构建 `.tmp-simulation-plan/ae/build-complete-ae.log` 通过。原行政四例、维护两例及独立进程重启两例当前构建 **三文件八项通过**（`.tmp-simulation-plan/ae/d-full-browser-final.log`，147.03秒）；扩展行政文件 **四项全通过**（`.tmp-simulation-plan/ae/admin-all-final.log`，58.88秒）。

新增两后端真实 foreign/2 完整 checkpoint 在 Native 接口正常发布，产品页面在恢复前禁用该版本；合法HTTP原restore请求保留 version-mismatch/精确checkpoint诊断，持久原请求通过真实有界分页发现，查询后保留原结果。当前owner没有被close、世界snapshot完全不变、模型调用零。对应Native两项也通过（`.tmp-simulation-plan/ae/restore-version-refusal.log`）。不是将坏配置改为兼容或用新建代替拒绝。

最终五类行政弹窗全部16组合在实际 reduced-motion media 打开，检查无running animation；Escape精确返回同一原trigger。创建名称／人工输入实际composition中Enter不发请求；输入结束后明确提交一次，Native只保留一个ingress。版本拒绝和其他新增要求不缩减原五弹窗／两后端160截图、诊断、预算及原请求恢复断言。历史表中早期“待复验”由此批及对应来源的最终结果补齐。完整4.2十三行和D08边界另经独立read-only审计确认，没有未完成的D功能要求；全仓G门禁不由本文件认证。
