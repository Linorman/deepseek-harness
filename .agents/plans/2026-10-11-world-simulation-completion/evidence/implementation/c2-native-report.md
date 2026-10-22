# C2 Native 通用领域接线与预约证据

输入 [manifest](c2-input-manifest.json)，SHA256 `9bac3e9c2ede3f93f7718445105119a5ad770026b5e9b37b68a84a369b6ebb6a`，日期2026-10-12。此次完成P14，仍不是全部C1或完整MVP验收。原112items保持不变。

Native provider提供显式parser/reducer catalog；每个Native owner持有原manifest完整schema/implementation/generation的pure leases，bootstrap、append、replay与inspect使用同一套原实现，不用module级招聘fallback。新准入核对live registration，关闭后不能接受新操作。公共共同intent保留实际actor、scope、完整业务payload、expectedTime/evidence/description；apply与committed结果的业务内容进入strict领域payload。日志stream62拒绝旧61，hiring schema/implementation artifact更新为2；SDK case结果迁移共同outcome+JSON payload。未知必需event拒绝保持有效。checkpoint并未新增独立领域manifest，因此P16/R01仍需后续工作。

通用Native mutation由接受的原plan派生ID，只能在窗口/结构维护外由原pure reducer生成闭合核心changes；Native核对当前授权/read-set并原子提交mutation、业务变化、结果及原通知wake。相同原mutation重试返回原件，不重复效果，改变输入拒绝。driver接受显式handlers集合、按原pin分派，reconciliation由handler提供原责任ID；driver不再构造招聘模块或按招聘reservation查找。

会议室测试模块只登记自己的四种strict payload schema、同步验证/Relation效果投影和public execution adapter。预约使用原Native relations（booking、半开区间），没有第二业务库。真实Loader、真实Agent/observe-stage-submit、原私有Channel/Envelope/消费、director规划、Native原子效果、请求者结果通知均实际执行。公司/实验室 × JSON/SQLite各运行一次并新进程冷恢复，0预建intent、唯一mutation/booking、重复commit零append，恢复保持paused且零推理。最终脚本同时拒绝未安装版本、payload requester伪造、错误room、mutation额外字段以及重叠预约。

该测试使用受信测试composition在v0 compiler产物上增加房间、权限及booking relation rules，并单独保存完整resolved/hash；它不证明v1作者输入或UI支持，S01/U项未勾选。lowered Scenario Entity/Relation IR支持Native命名类型，但v0 input schema仍关闭。

准确命令（输出重定向本目录，snapshot默认replay、未refresh/record）：

```sh
TMPDIR="$PWD/.local/world-completion/tmp" CLOCKY_EXAMPLE_MODE=src pnpm run test:snapshot examples/simulation-company/tests/world-booking.snapshot.ts
TMPDIR="$PWD/.local/world-completion/tmp" CLOCKY_EXAMPLE_MODE=lib pnpm run test:snapshot examples/simulation-company/tests/world-booking.snapshot.ts
TMPDIR="$PWD/.local/world-completion/tmp" pnpm run build
TMPDIR="$PWD/.local/world-completion/tmp" pnpm exec tsc -b tsconfig.host.json
TMPDIR="$PWD/.local/world-completion/tmp" pnpm run test packages/simulation/simulation/tests/world-protocol.spec.ts
```

- [source4](c2-booking-source-final.log)、[lib4](c2-booking-lib.log)：同实际handler与Native path，两场景/后端、新进程restore、完整结果/Channel和拒绝路径。
- [build197](c2-build-pure.log)：Host/Client聚合、打包与Web通过；[Host types](c2-host-types-pass.log)、[共同parser21](c2-contract-tests-current.log)。
- [招聘source8](c2-hiring-source-fixed.log)、[自主产品source4](c2-autonomous-source-current.log)。[其余lib16](c2-flow-lib.log)同命令覆盖hiring8/retirement4/autonomous4通过；该文件的最初booking4因Node strip-only参数属性失败，已修正并单独正确lib4通过，不把失败隐藏为全20绿。
- [双SDK准确命令](c2-sdk-commands.log)：TS185、Python source135及installed wheel135、SDK typecheck/lint/doc pairing通过。

保留早期失败日志：缺pure source alias导致source/lib pin混用；pin当selector被strict拒绝；Native acceptanceRecords漏传runtime；预约fixture owner误用未带原resolved hash的名称；fixturestrip-only参数属性；通用mutation不该依赖尚未结算的local记录而应核对真实accepted decision/plan；招聘fixture新增真实HR任职后容量过滤三元判断优先级错误（已改成明确逻辑）。没有放宽预约重叠、actor权限、pin、epoch/Channel/消费约束或修改snapshot制造通过。

仍在验证/整理：原低层hiring tests和旧CLI bootstrap输入迁移、整个相关typed lint/doc-sync、完整DTO的领域投影与checkpoint manifest及新领域fault矩阵。其结果将续写此证据，P01/P02/P15/P16等保持未完成。通用公共API仅trusted owner接收显式actor，产品SDK不暴露可伪造actor的创建入口。所有中间脚本/编译产物在项目内，未提交或推送。

最终低层核心验证：[182 tests/3 files](c2-native-team-tests-final.log)已通过，显式catalog投影验证、真实HR任职、全局与招聘岗位作用域计数分别验证，safe通知payload与旧格式拒绝随新契约更新。新增package source imports已补.ts后缀；[Host聚合](c2-host-types-final.log)、[39files scoped typed lint](c2-lint-final.log)、[新增JSDoc](c2-jsdoc.log)通过；JSDoc后[两文件lint](c2-doc-lint.log)通过。当前输入manifest在格式/JSDoc/metadata修正后重算；最终docs及旧CLI矩阵仍在继续，不把运行中进程当通过。

最终门禁：[docs29](c2-doc-sync-final.log)与[完整scoped lint](c2-lint-complete.log)通过；[最终lib12](c2-booking-hiring-lib-final.log)重新验证最新构建招聘8/预约4。旧低层CLI [source26](c2-original-protocol-hire-source-fixed.log)、[lib26](c2-original-protocol-hire-lib-fixed.log)通过（同world-protocol.snapshot.ts/world-hire.snapshot.ts，分别CLOCKY_EXAMPLE_MODE=src/lib、TMPDIR项目内，未refresh）。旧fixture新增HR实际任职后，严格验证旧任职不变、全局任职和目标岗位分别计数；改变common payload布局对应调整精确结果/通知断言，保留SIGKILL/原日志/独立身份和零恢复推理证明。修正已废弃private source import suffix、strict committed helper返回注解、缺失JSDoc，以及catalog/graph/pairing生成输出。图表和JSON代码块按同owner来源同步双语，未修改既有翻译叙述。后续仍需完整C1领域DTO、checkpoint manifest、缺失版本双SDK/恢复以及其它全部领域/作者/产品/预算/真实模型验收，不能把此增量当完整MVP完成。
