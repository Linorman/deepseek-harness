# U08、U09、U11 原命令、惰性读取和撤权

2026-10-15；Native 96／checkpoint manifest 6／Product journal 4，公开案件 v3。完成原 U08、U09、U11，99/112，未新增 checklist 项。

验证后的未提交输入为 `b82bf84faafcce8913b02413c371c3a9f4694c4e994b03275d36d0f714eeedd3`，包括 3,265 个相关 owner 源码、声明、SDK、浏览器 fixture 和实际 Client 构建文件，见[逐文件清单](../../../../../.local/world-completion/u08-u09-u11-final/inputs-final.json)。[字节归档](../../../../../.local/world-completion/u08-u09-u11-final/inputs-final.tar.gz) SHA-256 为 `09231d45df078f2848db46fc7979dd11a794727ed7c330ef9e467b351887300e`；[核验](../../../../../.local/world-completion/u08-u09-u11-final/archive-verification.json)重新读取全部文件逐一核 hash。这是验证后工作区输入，不是 Git HEAD。历史 U05/U06、U07 归档未覆盖；本次原件有[日志索引](../../../../../.local/world-completion/u08-u09-u11-final/artifacts-final.json)和 [38 份实际浏览器 proof 的路径及 hash](../../../../../.local/world-completion/u08-u09-u11-final/browser-proof-hashes.json)。所有中间文件和编译产物均在项目内。

## U08：原件恢复和精确重试

Client runtime 冷查询保留实际 `worldManagementOutcome`，核对 runId、commandId 和 receipt kind 后才提供原案件导航。外 run／外 command 结果拒绝，查询失败不能变成可重建的新命令。三步表单在双击时忽略第二次指针 click，保留独立确认；提交后同坐标出现的关闭按钮也不能接收这次双击的第二下，键盘激活仍有效。

实际 Web／认证 HTTP／Product／Native 人员管理通过 8/8：三动作 × 两后端，加两格 transfer lost-ack。lost-ack 使用真实 provider 栅栏和真实服务端返回；浏览器实际 500ms deadline 先发生，服务端原响应保留 750ms，未构造成功 DTO。预览后返回编辑保留表单，双击只受理一个原件；断网期间保留 unknown、原 ID 和完整表单，联网后在 provider 仍 pending 时刷新。冷页面从持久请求记录查询原命令，原案件可打开并后退；第二标签页再次查询／精确重试仍返回原件。最终仅一次 provider、一个 Native request／plan／result；三个进入 owner 的完整输入相同，两个 selector retry 使用原 ID。原身份／profile 保持，run paused，模型与新增 writable open 均为 0。

证据为 [8 格首次完整通过](../../../../../.local/world-completion/u08-originals/browser-eight-final.log)、[加入实际断网后两格再次通过](../../../../../.local/world-completion/u08-originals/browser-offline-original-second.log)和[独立原件审计](../../../../../.local/world-completion/u08-originals/audit-final.json)。正常六格没有 console/page error；故意断网两格仅允许精确的 `net::ERR_INTERNET_DISCONNECTED`，原 console 列表保留。

既有创建超时与案件取消 [2 files / 8 passed](../../../../../.local/world-completion/u08-originals/browser-existing-originals-final.log)，保留原 command、实际取消预览、刷新和第二标签页。原取消 fixture 漏装真实 World execution provider，start 请求实际返回 unavailable，导致旧屏障一直等待；加入明确 provider 后原断言通过。此处没有据此宣称生产 control readiness 的缺 provider 提示已修复，留在 U10。

## U09：读取不启动运行

[6/6 浏览器](../../../../../.local/world-completion/u09-inert-reads/browser-first.log)覆盖两后端公司／实验室真实完成历史查询，以及两后端定义导出／导入。历史来自 U07 当前 Native96 完整 Agent 剧本的实际库，readonly 冷读无需执行 owner，前后完整 Native snapshot 相同；真实 votes、制度、外部表示及联系人都有原件。导出实际 JSON/YAML 后重新文件导入和 HTTP preflight，支持的字段／null／作者私有事实保留，没有 restore 请求、模型调用或 Native revision 变化。导出没有被当作运行备份。

[4/4 预检恢复](../../../../../.local/world-completion/u09-inert-reads/browser-preflight-first.log)覆盖 390/1440px × 两后端。预检拒绝／review 不分配 Native、Team 或 command；真实 catalog 上限变化拒绝旧 preview，保留草稿后重新预览才接受新 command，恰好创建一个暂停运行。U08 pending 原件重开与 U11 过时刷新补充零模型、零新 writable open 的页面重开证据。准确 proof 见[读取／导出原件索引](../../../../../.local/world-completion/u09-inert-reads/browser-proof-index.json)。显式 restore 属于用户写命令，本项不把它列为纯读。

## U11：撤权、迟到响应和断网

使用公司／实验室完成库中真实 proposal 正文及 hash，先确认 withheld，再经真实 reader registrar 授予该 principal／run／proposer 的 context 权限。浏览器刷新显示正文，原 proposer Session history 仍独立返回 `TEAM_HUMAN_ACTOR_FORBIDDEN`。随后通过实际 HTTP `route.fetch()` 取得合法正文并延迟交付，撤销真实 grant，观察 DOM 正文消失，释放原合法响应后正文仍不能复活。再次断网刷新保留非敏感 proposal 元数据、显式“数据可能已过时”和刷新入口，敏感正文保持移除；联网刷新也不恢复权限。

[3 files / 12 passed](../../../../../.local/world-completion/u11-domain-privacy/browser-final-first.log)包括新领域正文四格和既有案件／context 隐私八格。[领域四格独立审计](../../../../../.local/world-completion/u11-domain-privacy/audit-final.json)核对实际 proposal/bodyHash、真实授权响应、迟到丢弃、独立 Session 拒绝及前后 Native snapshot 相同；新增 writable open 和模型调用均为 0。故意断网只允许精确的预期网络 console error，page error 为 0。原命令断网保留由 U08 实际 pending 管理命令证明，不把断网期间无法加载的新页面描述为已成功重载。

## 质量检查与保留失败

[U08 准确命令](../../../../../.local/world-completion/u08-originals/commands.txt)、[U09 命令](../../../../../.local/world-completion/u09-inert-reads/commands.txt)、[U11 命令](../../../../../.local/world-completion/u11-domain-privacy/commands.txt)保留实际参数。Browser plugin 不可用，按 frontend testing workflow 使用项目 Playwright，所有 backend 都是实际 JSON／SQLite，Vitest source fixture + Loader 正式 package exports 的 built Host／Client。

运行时／UI [4 files / 36 passed](../../../../../.local/world-completion/u08-originals/runtime-ui-final.log)，[完整 build](../../../../../.local/world-completion/u08-originals/build-verified-final.log)包含 Host／Client 和 197 Client artifacts，Client 类型和 scoped lint 退出 0。[doc-sync](../../../../../.local/world-completion/u08-originals/doc-sync-first-final.log) 29 passed、0 failed、0 skipped。Python 完整 SDK 699/699 属于 U12 另行登记，不作为本三项浏览器结果求和。

失败原件保留：双击使原确认框关闭；冷页面错误使用仅本地表单保留时存在的 footer；Playwright 私有 context 的第二页创建方式错误；实际断网 console 未先分类；原生 details 在策略刷新后折叠导致已授权正文 attached 但 hidden。前两项分别修复生产 click 语义和冷原件投影；其余修复测试真实路径／断言，未删除撤权／原件／零模型不变量。旧浏览器取消的两个 SIGINT 诊断及缺 provider 的真实返回保留，不计为通过。未宣称 U10 全部下一步、U13 wheel、U14 完整 GUI、U15 全设计检查或真实 provider 已完成。
