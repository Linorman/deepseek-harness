# C13 重聘与人员统计验收

日期：2026-10-12；Native69、checkpoint manifest3、Session format0。O15 已完成，checklist39/112，整体 MVP 仍未完成。当前343源码／契约输入hash `9f8dcbc2c042af8ee0279261789ca5aff2d84308e6b12aa78a5d7f78f48ad872`，见 [输入清单](c13-personnel-input-manifest.json)。未commit/push/PR。

真实 company/laboratory × JSON/SQLite × source/plainNode lib，各模式4/4：原人物先形成私人记忆并真实离职 retire=true；原assignment关闭、原Person／Participant／Session／Persona／privateChannel保留，退休activation及新nomination拒绝且零append。真实HR与另一个非退休witness通过独立Session投票，原validated制度及特定重聘批准约束hire-existing；缺少批准时拒绝。实际原批准后生成唯一新assignment，不分配新人物或生成reservation，原Session进入真实新epoch并完成新岗位首次行动。每create135个keyless实际Agent调用，8独立cold均paused/0model；原commit精确retry零append、私人canary没有串用。

重聘链揭示并修复退休通知调度缺口：原制度公告对退休人物的wake保留pending，但不再触发新的认知准入，也不阻挡其他角色和时钟。当前 public queueDecision拒绝新退休nomination；已有队列责任仍保留且暂不分配。claimed／reserved／已接受效果继续阻挡，原writer退休约束不放宽；新assignment后原公告由同一Session、实际新epoch处理并保留原来源。Native调度/重放相关43测试通过。没有新增durable形状或事件，不递增格式版本。

当前Source4、lib4准确命令及旧失败分类见 [执行者manifest](c13-world-rehire-agent-manifest.json)。Root只核验当前4源码、接受的32stdout/stderr原件和真实build记录37条hash；前const-narrow旧输入hash单独作为历史记录，不当当前源码比较。16stdout中create/cold的全部业务证明字段一致，见 [原件及独立核验](c13-world-rehire-root-artifacts.json)。

`world.people` 从真实run inspection提供whole-run六项计数：当前半开assignment下distinct非terminated人物、全部非terminated Person、当前准入的active认知writer、全部尚未release的writer、完整canonicalTeam的历史Participant和Activation epochs。resident不是物理进程存活，reserved/revoked仍单独占容量。历史来源包含已退休记录；无来源、unsupported或Native读取前后revision变化时明确不可用，不填零，也不公开姓名／Session／provider-local IDs。当前Host和TS protocol/客户端/服务端读取使用同一strict DTO，Python同次增加严格解析及public exports。纯投影7、真实产品双后端4、客户端/组件29、Python113通过；public counts校验scope/revision/time、subset/capacity、完整或未知history。

真实Web／HTTP／runtime／UI的paused公司创建和metadata刷新在双后端验证，零模型调用；显示六计数，完整Team读取失败保留其他Native计数而历史不填零；键盘刷新、reload不写Native／Team账本，窄屏／浅深主题／减少动效实测并保存截图。初次双例SQLite通过，JSON例看到了创建尚未完成的真实0；测试改为等待初始checkpoint完成后明确刷新，JSON定向复验通过，保留该失败与修正范围：[首次](c13-people-browser-tests.log)、[JSON修正](c13-people-browser-json-fixed.log)。Browser插件不可用，使用项目既有Playwright真实服务lane；原文件与截图在项目evidence目录。

最终生成catalog后的build197、完整lint含Host/Client类型、doc-sync29/29均通过。全GUI首次5413pass/1fail/1skip：已有World浮层未重绑scrollbar层级token，已按原theme owner窄修reference picker与窄屏author drawer，并通过该owner定向回归；不把首次全GUI冒称全绿。早期新browser文件未注册正确compiler face时错误生成96份相邻JS/declaration产物，已逐项确认untracked、无C0 baseline且为本批生成，完整移入项目内quarantine而非删源文件，见 [清单](c13-misplaced-output-manifest.json)。

完整Web replay当前仍按原live handle验证，不能声称全量通过；对应R11/U14/U15仍未勾。premium static审计另有4个既有authoring表单问题（3个literal textarea缺canonical resize-none evidence、1个native select与authored contract不一致），不影响本项统计读取但仍须在完整UI验收中修复；[原审计](c13-ui-static-audit.json)不冒称通过。v1输入、外部世界及完整SDK/浏览器剧本继续待办，不添加或删除checklistitems。
