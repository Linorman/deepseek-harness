# U07 认证用户人员管理

2026-10-15；Native 96／checkpoint manifest 6／Product journal 4，公开案件 `clocky.world-case/v3`、管理 `clocky.world-management/v1`。完成 U07，原清单 96/112，未新增清单项。

验证后的未提交输入 hash 为 `b16006442102dac949ecfa043068431a5b6e548f5684a39b6cbe906a17db6065`，3,001 个 owner 源码、声明及实际构建文件，见[逐文件输入](../../../../../.local/world-completion/u07-product/inputs-final.json)。这不是 Git HEAD，也不是执行前冻结。[字节归档](../../../../../.local/world-completion/u07-product/inputs-final.tar.gz) SHA-256 为 `e8e20aeec43b6f69684a7b2a6f0b118f090373d72de9761cb90be44e4630f985`；[归档核验](../../../../../.local/world-completion/u07-product/archive-verification.json)重新读取全部 3,001 个文件并逐一核 hash。[原件索引](../../../../../.local/world-completion/u07-product/artifacts-final.json)保留成功及失败，后续开发不覆盖本归档。临时文件、编译、浏览器及 Python 产物均在项目内。

## 实现

实际 Product owner 提供 transfer、depart、hire-existing 的字段、只读预览、固定原件提交及查询。预览读取真实 Native 与 canonical Team/Channel 义务，绑定原人物／任职 revision、完整解析动作、来源指纹、当前策略与实际 Native 前缀；返回身份、费用、准入阻塞及后续交接条件。精确 assignment 盘点排除本次 Native 自行关闭的关系，其余资源控制和已受理工作保留。缺来源、旧任职、旧预览、任职开始同刻结束、容量或权限不足均不伪装可执行。

来源来自真实认证调用，记录 principal、credential generation、安装策略与原 command ID。有限事件栅栏和 live authority 保持到 Native 队列准入；HTTP 短响应等待真实 Native 受理后才释放调用 lease，较长执行有独立完成责任。用户不成为模拟 director、requester 或 Channel sender，也不创建虚构 Decision/Operation。原 Person、Participant、Session 和 Persona/profile 保持；独立招聘资格与岗位派生权限按持久来源区分，离职后可复用原人物重新入职。

Product 在 Native 受理前持久保存完整原表单和 Native 意图。同 ID 同 payload 返回原 request／intent／plan；改 payload 拒绝。响应丢失保留原件，查询／精确重试对账，未知不能当失败再建。原 World owner 只执行这个直接计划并保持暂停，不启动全局调度或模型。资源费用仅接受显式 principal→真实 Native controller 委托；hold 的 Operation 为 null，真实 controller 和用户来源分别保留，一次原招聘仅扣费一次。

案件取消使用实际 Native revision/hash 和受影响原 plan/reservation 预览。Native 先确认取消，再排空原 role driver／人员 provider／清理责任；即便业务已经立即 cancelled，也不能在原回调仍 admitted 时重入 reconciler。独立有界 cancellation job 不覆盖原人员完成 job。终态案件没有可提交预览，拒绝不能冒充取消成功；需要停止旧自动恢复时单独提交真实 pause。

Host、Client runtime、TS protocol/client/server 与 Python strict DTO/client 已接通。UI 保留完整表单与单一 command，分别显示执行确认和业务结果，并可查询后定位实际案件。待处理筛选使用主摘要的真实生命周期，不依赖未发布的扩展 tracks。模型版本和部署／披露权限仍由原 owner 管理。

## 验证与原件

[Root 准确命令](../../../../../.local/world-completion/u07-product/commands-final.txt)、[Native 命令](../../../../../.local/world-completion/u07-native/commands.txt)、[Python 命令](../../../../../.local/world-completion/u07-python/commands.txt)、[取消合同命令](../../../../../.local/world-completion/u07-cancel/commands.txt)及[维护矩阵完整报告](../../../../../.local/world-completion/u07-control/maintenance-report.json)保留实际调用。Browser plugin 不可用，按 frontend testing workflow 使用项目 Playwright。

| 范围 | 实际结果 |
|---|---|
| 三动作 × JSON/SQLite 实际浏览器 | [6/6 通过](../../../../../.local/world-completion/u07-product/browser-six-final.log)。真实 Web/Loader/认证 HTTP/Product/Native；只读预览全 Native 不变，提交唯一原件、原查询→原案件→实际已提交业务详情。390/1440px、浅深主题、减少动效，0 page/console error。模型 hook 一旦调用即失败，全部 0 model/0 新 writable open。独立审计核对原 binding/profile/resources、真实任职结束／新建区间和原 hash，见[六格审计](../../../../../.local/world-completion/u07-product/browser-audit-final.json)。 |
| Product owner／取消／维护 | [4 files / 73 passed](../../../../../.local/world-completion/u07-control/maintenance-owner-final.log)，包含真实 Registry call lease 撤权、短受理确认后 provider 延续、lost Native ack、原件精确重试、显式费用委托与一次扣费、真实 handoff、在途取消及两种满额度 0 append。 |
| Native／Team | [16 文件首轮](../../../../../.local/world-completion/u07-native/regression-final.log)中 15 files/328 passed；退休 fixture 在原 assignment 开始时刻提交离职被严格时间校验拒绝，改为真实 drive 到时间 1 后，原 [10/10 退休断言通过](../../../../../.local/world-completion/u07-native/retirement-time-fixture.log)。生产时间约束和所有退休／迟到 IO 断言未放宽。 |
| 原用户命令只读冷查 | [source PID 74232](../../../../../.local/world-completion/u07-native/cold-source-verified-final.log)、[plain Node lib PID 74221](../../../../../.local/world-completion/u07-native/cold-lib-verified-final.log)，各读取实际 owner 生成的 6 个双后端原库，完整 snapshot 和原 command/request/plan/result 相同，unowned，禁止 writable open hook 0，model 0；lib 明确无 loader/source alias，模块实际为 lib。 |
| 三 v1 场景完整剧本 | [source 6/6](../../../../../.local/world-completion/u07-product/complete-world-source-final.log)、[lib 6/6](../../../../../.local/world-completion/u07-product/complete-world-lib-final.log)，真实 Loader/Agent/三工具/Team/shared Native domain driver。新 Native96 原库共 36 独立 PID，其中 24 cold paused 零模型；完整 Session/journal/checkpoint 按原 fixture 核对。[独立进程审计](../../../../../.local/world-completion/u07-product/complete-workflow-audit-final.json)保留实际启动及返回。 |
| 维护与用户意图竞赛 | source/lib 各 44 个受影响组合、176 成功独立 warm/cold PID，两后端公司／实验室。首轮 source42/44、lib41/44；5 个推进屏障超时原件保留，在原 20/90 秒阈值下串行复验全部通过。精确命令、并发、原失败和重验分列于[维护报告](../../../../../.local/world-completion/u07-control/maintenance-report.json)，不宣称首轮全绿或未重跑组合通过。 |
| 合同／runtime／UI／purity | [5 files / 66 passed](../../../../../.local/world-completion/u07-product/contract-client-final.log)，另 [3 UI files / 33 passed](../../../../../.local/world-completion/u07-product/ui-modules-final.log)。范围重叠，不相加为独立测试总数。 |
| 双 SDK 和旧案件取消 | TS 实际 stdio 的 source4组在[首轮综合日志](../../../../../.local/world-completion/u07-product/source-cancel-sdk-first.log)通过；[lib SDK＋完整旧案件取消 16/16](../../../../../.local/world-completion/u07-product/lib-cancel-sdk-first.log)，另[修正 carrier 拒绝分类后的 source terminal 4/4](../../../../../.local/world-completion/u07-product/source-terminal-cancel-second.log)。Python [15 files / 404 passed](../../../../../.local/world-completion/u07-cancel/python-final.log)，实际 source stdio 双后端另见 u07-cancel 的 python-stdio-source-third.log；不将这些计为当前已安装 wheel 证明。 |
| 构建／类型／lint／文档 | [完整 build、197 Client artifacts](../../../../../.local/world-completion/u07-product/build-current-final.log)包含 Host/Client aggregate；[Client 最终类型](../../../../../.local/world-completion/u07-product/types-client-final-second.log)、各 owner 类型／scoped lint、[新 browser/筛选 lint](../../../../../.local/world-completion/u07-product/lint-browser-current-final.log)、[diff-check](../../../../../.local/world-completion/u07-product/diff-check-verified-final.log)通过。[29 文档门禁通过](../../../../../.local/world-completion/u07-product/doc-sync-verified-final.log)，含 1,146 组双语配对。 |

## 保留失败及未覆盖范围

早期真实 HR 调岗被资源控制义务阻塞；未删除职责或放宽 Native 来制造成功。正向浏览器使用明确创作的独立初始人物／岗位，并真实声明 hire-existing 领域及个人资格。空行为场景只在所有管理读取之前通过可信 fixture drive 到时间 2，不增加产品时钟写入 API。创建检查点的异步等待改为已有浏览器 10 秒等待范围；这不是性能或真实模型质量通过证据。

其他原失败包括缺必填字段／用户来源判别、无实际 package export 的类型子路径、声明 helper 返回类型、纯 Client 引用、窄屏隐藏集合选择器、carrier 的 bad-request 与 Product invalid 区别、缺 JSDoc／生成目录链接和双语数据。两项新 role-after-user 补证用例的完整最小批次实际为 4,638 字节，原 4,096 fixture 失败保留，仅这两个 fixture 显式采用 8,192；未改生产默认／上限。维护恢复只允许精确的原 execution reconcile 两记录追加，并核对其余完整 snapshot，不删除回调证据来匹配旧快照。

U08 的人员命令 timeout／刷新／多标签完整 GUI 证据、U10 全部等待原因与下一步、U11 私有领域正文迟到撤权、U13 当前安装 wheel、U14 完整 GUI 剧本、U15 全面设计检查仍独立待验。U12 已知 management commandId 的公开上限与 Native 256 上限需对齐，保留未完成，不把当前 normal-ID 证明扩成完整合同一致性。没有真实 provider／费用质量样本，未新建 PR、推送或部署；不得据此宣布整个 MVP 完成。
