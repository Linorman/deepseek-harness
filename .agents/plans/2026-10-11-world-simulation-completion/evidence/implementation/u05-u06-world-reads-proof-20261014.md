# U05/U06 实际世界查询与来源导航

2026-10-14；Native 95／checkpoint manifest 5／v1 compiler 9，公开 `clocky.world-read/v1`。这是当前未提交工作区的实现与实际构建产物，输入在验证后捕获，非 Git HEAD，也不声称执行前冻结。输入 hash `ab4db5de21f1d529d728f1714e9a7270d6b0d21a54ae6ce2632e10a2f1ea32ad`，共 2,383 文件，见[逐文件输入](../../../../../.local/world-completion/u05-domain-ui/inputs-final.json)。[原件索引](../../../../../.local/world-completion/u05-domain-ui/artifacts-final.json)保留成功和失败；所有中间文件、浏览器 profile、编译产物均在项目内。

U05、U06 完成，原清单 95/112。未新增清单项；U07 用户管理、U13 分发、U14 完整 GUI 剧本、U15 全面设计检查及真实模型／性能／完整故障矩阵继续按原未完成项验收。

该批输入另存[源码与实际构建原件归档](../../../../../.local/world-completion/u05-domain-ui/inputs-final.tar.gz)，2,383 文件均从归档重新读取并逐项核 SHA-256，[归档核验](../../../../../.local/world-completion/u05-domain-ui/archive-verification.json)保留结果。后续开发可以改变当前工作区，原验收输入不随之覆盖。

## 实现与范围

`readWorldDomain` 接通 Native/Team、Product、Host fetch、TS protocol/client/server、Python parser/client，以及 runtime 独立读取生命周期和实际 UI。九类查询覆盖 overview、organization、person、governance、proposal、norm、external、identity、case-extensions；每个结果保留完整原选择、Native revision、readVersion 和当前页覆盖。TypeScript/Python 拒绝未知字段、身份／分区／时点替换、覆盖数量不符及不可定位或矛盾的 Envelope 引用。Native opaque IDs 保留各自品牌，组合制度版本 key 仍为 `[normId, version]` JSON，不混作 Native NormId。

cursor 绑定 query、reader/credential、披露 generation、revision；人员续页还绑定完整来源清单 fingerprint。末页不单独声称全量。组织历史／人员和外部历史生命周期不能由当前状态准确重建时明确拒绝，不回填当前状态。制度／提案历史按真实版本和时点读取。列表、检查器分区和续页彼此独立；Native 推进遮蔽过期正文，metadata 追上已返回响应时不错误清除当前页面。

冷人员盘点通过已安装的 Local Native manifest 读取原前缀，组合 canonical Team tasks、attempts、activation、workspace、Channel 责任，不 `open/attach/restore`、认知或确认消息。原 owner/ref/cursor、未知 IO 与 source-moved 保留；缺少 Team 完整覆盖不把空 Native 清单当清偿。没有驻留证据和义务计数时显示未知，不伪零。

外部页保留实际规则结果、裁决和 actor contact。裁决及联系可共享原 intent，按 source kind 保持两条原件。联系 ready/committed 不等于已回复；实际 reply post 由原询问 Envelope/receipt → 已完成 Native delivery wake → 原代表的原 Decision 关联，再分别显示 publication 和 recipient receipt。该 metadata 不声称 Session 已消费，也不返回私有 Channel 正文。当前页来源跟随当前页，不拿首批记录替换续页来源。代表页只显示返回数组，明确空页不回退到 latest 摘要。

案件、制度、投票、任职、义务及外部记录链接到原 Decision、Entity、operation、record、checkpoint 或 canonical Envelope/task。Envelope 目的地独立验证 Team/Channel/ID/序号并聚焦原消息；错序号拒绝，不替换临近消息。来源引用不授予目标内容权限，浏览不 ack。实际已生效制度跳转保留精确版本。`world.worldInitialized` 来自 Native 初始化记录，使冷只读注册无需管理 owner 也可启用 World 导航；没有额外执行权。

## 实际验证

[准确命令](../../../../../.local/world-completion/u05-domain-ui/commands-final.txt)及[完整 root lint 参数](../../../../../.local/world-completion/u05-domain-ui/root-lint-command.json)均保留。命令使用项目内 `TMPDIR`，Python 禁止写外部 bytecode cache。Browser plugin 不可用，按 frontend testing skill 使用项目 Playwright。

| 范围 | 实际结果与原件 |
|---|---|
| 三种 v1 定义 × JSON/SQLite × source/plain Node lib | 原完整流程 12 格／36 PID，包括 12 warm 和 24 cold 零模型；实际 Loader、Agent、三工具、Team/Channel/Session。原查询 1,812 响应／3,960 refs 见 [初轮审计](../../../../../.local/world-completion/u05-domain-ui/audit-source-lib.json)，初版漏 contacts 的限制保留。 |
| 最终新 cold 补验 | 同 12 原库各两个新进程，24 PID、全部 paused 零模型，1,208 份严格 TS/Python 逐值往返、2,816 实际 refs。公司／实验室逐个 contact 验证真实 applied/published/received；每格核对完整 Native/Session/journal，不替换原库。见[最终审计](../../../../../.local/world-completion/u05-domain-ui/audit-cold-reply-final.json)、[source](../../../../../.local/world-completion/u05-domain-ui/cold-source-reply-final.log)、[plain Node lib](../../../../../.local/world-completion/u05-domain-ui/cold-lib-reply-final.log)。 |
| 实际浏览器 | [4 文件 18 组通过](../../../../../.local/world-completion/u05-domain-ui/browser-final.log)：6 暂停创建的三场景窗口／分页／Entity/record；4 真实已完成公司／实验室历史的非空 contacts／代表／votes，0 writable open／0 model；6 实际案件状态到 Decision/checkpoint/Envelope 往返且 Channel 不变；2 独立授权下精确 Envelope 聚焦、错序号拒绝及来源撤权。 |
| UI/runtime/Host/SDK/purity | [48 文件 532 项通过](../../../../../.local/world-completion/u05-domain-ui/integration-current-final.log)。当前 owner 独立证据包括人员盘点 8 文件 65 项、brand/契约 6 文件 59 项、contacts/严格引用 6 文件 44 项、实际回复 2 文件 10 项、cold metadata 2 文件 14 项；这些范围重叠，不相加伪报独立测试数。 |
| Python | [3 文件 196 项通过](../../../../../.local/world-completion/u05-domain-ui/python-final.log)；最终实际 1,208 份 wire 严格解析／完整往返在最终审计中。包含原 message `envelopeId:null`，缺失 metadata 保持未知，bool 字段拒绝 null／数字／字符串。 |
| 构建与类型 | [完整 build／197 client artifacts](../../../../../.local/world-completion/u05-domain-ui/build-cold-metadata-final.log)，随后仅修改纯 Host 回复关联并[重建 Host](../../../../../.local/world-completion/u05-domain-ui/build-reply-host-final.log)。Host/Client aggregates 均成功；owning CompilerFace 诊断为零。 |
| lint、双语和 docs | [当前 root scoped lint exit 0](../../../../../.local/world-completion/u05-domain-ui/lint-current-final-exit.json)；各 owner scoped lint 均保留。[29 文档门禁通过](../../../../../.local/world-completion/u05-domain-ui/doc-sync-metadata-final.log)。 |

暂停三场景页面及实际案件状态覆盖 390/1440px、浅深主题、减少动效、键盘进入；没有 page/console error 或横向溢出。完成历史页面保存实际联系截图；检查了宽屏和窄屏浅深图。历史截图不当作整个 U14 剧本的 GUI 验收。最终 plain Node 进程明确没有 tsx/import/loader，并验证 Product/Native/world 模块实际解析到 `lib/`。

## 保留失败与边界

初轮真实流程发现 contacts 漏投影；补入后又发现普通通信未列于 frozen Native sources，额外 frozen 条件漏掉真实回复。已用原 delivery wake/receipt 链修复，错 wake／Decision／代表／Envelope/cursor 和无回复保持反例，最终 fresh cold 与 browser 正向核验后才勾选。round 0–2、首轮补证 round 3–4 和最终 round 5–6 都保留，没有覆盖旧证据或修改实际历史。

早期失败包括 Client purity 误经 Team root（改为原纯 schema 入口，未放宽白名单）、旧 fixture 缺新增 reader、strict ID 类型、浏览器旧角色名、历史 Session compression 不匹配、只读注册缺管理侧 scenario 识别，以及文档类型链接／生成目录／配对未刷新。原日志保留；没有提高超时、业务额度或吞掉错误。package 子目录的 Host build 不能发现 workspace，失败命令保留，最终从根执行正式 Host build。

公开方法的严格 SDK 测试与真实 wire 不替代已安装 wheel／compiled stdio 完整恢复验收，U13 保持未勾选。这里的模型均为真实 Agent 调用的 keyless scripted adapter，不是实际 provider 质量／费用证据。全项目 premium 既有五项问题仍由 U15 跟踪；无新 PR／push／部署。
