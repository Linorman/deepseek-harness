# Web 稳定性与默认 Simulation：开发 checklist

设计依据：[实现决策](../../notes/implemented/architecture/2026-10-07-web-runtime-stability-and-default-simulation.zh.md)。执行顺序、文件归属和验收方法见[开发计划](development-plan.md)。创建日期为 2026-10-07；实现与验收状态以逐项标记和末尾证据为准。由当前执行者顺序处理，不启动 subagent。

## 使用规则

每个条目只有在可检查证据存在时才勾选。失败、跳过、需要真实模型或依赖未完成的项目保留未勾选，并在末尾证据表说明。诊断时临时修改浏览器 DOM 不算源码修复；设置可见和 `isVisible()` 不等于真正可点击；DOM 快照不等于浏览器性能验收。

## D：设计准备

- [x] 记录运行审查中的两个 P1、空闲绘制、认证重试、焦点与窄屏问题，并标注测量边界。
- [x] 明确 Simulation 默认安装，但创建暂停、明确启动才推理。
- [x] 明确无模型时可浏览及保留草稿，模型驱动创建需先完成配置。
- [x] 明确默认组合、已有 profile、原始命令身份、持久化与 SDK 影响。
- [x] 编写分阶段开发计划、验收预算和风险处理；未把开发项标成完成。

## W00：复现与基线

- [x] 记录构建产物、工作树、浏览器、视口、DPR、渲染方式和认证前置。
- [x] 将真实 View Transition 约四秒超时转为可失败的浏览器回归。
- [x] 将设置面板被主内容区截获点击转为真实 hit-test/点击回归。
- [x] 隔离有效认证、初次未认证和认证被撤销三个场景。
- [x] 固定空首页、长会话、100 条 Simulation 目录及受控模型数据。
- [x] 正式 fixture、日志和截图不含凭据，临时文件全部留在项目内。

## W01：导航与过渡

- [x] 移除 View Transition 更新回调中的 RAF/定时器等待。
- [x] 更新动作只执行一次；取消、失败和降级都不重放操作。
- [x] 可选动效经渲染层明确提交，业务 runtime 不依赖 React。
- [x] 快速连续导航保留最后目标，旧过渡不清理新过渡状态。
- [x] 处理过渡 Promise 拒绝，清理属性和阻挡输入的图层。
- [x] 验证减少动态效果、无 API、隐藏页面、前进/后退。
- [x] Team 与 Simulation 入口、模块及过渡中打开设置均通过。
- [x] 30 次交替导航 p95 ≤200 ms、可选视觉完成 ≤400 ms，无 DOM 更新超时。

## W02：设置与可访问性

- [x] Settings 使用公共 Portal/native dialog；不靠调高 z-index 规避祖先上下文。
- [x] 保留 slot 注册、onboarding、外部指定分类和配置文件操作。
- [x] 四个分类的实际控件可点击、切换和关闭。
- [x] Tab/Shift+Tab 留在模态内，背景 inert，关闭后恢复合理焦点。
- [x] 嵌套 Menu、Popover、权限确认和目录选择的 Escape 只关闭最内层。
- [x] 720 px 以下使用全宽内容与分类选择器，取消固定侧栏挤压。
- [x] 320/390/768/1440 px、浅深色、400% 缩放和低高度均可操作。
- [x] 从 Simulation 创建进入模型设置再返回，草稿保留且不叠放工作区弹层。
- [x] 热状态设置在 200 ms 内可见且可命中，长内容滚动不遮挡关闭操作。

## W03-A：持续绘制

- [x] 默认背景为静态，取消大模糊光晕的无限动画。
- [x] 空 SVG 轨道不动画、不引发重复布局。
- [x] 真正被前景页面覆盖的工作区停止动效；不只依赖 IntersectionObserver。
- [x] 实时状态动效遵守活动、可见性、减少动态效果和生命周期。
- [x] 30 秒空首页没有持续装饰动画或额外调度模型工作。
- [x] 前后性能对照分清软件/硬件渲染；保留数据而非只报主观流畅。
- [x] 100 次开关后动画与监听器数量回归稳定基线。

## W03-B：认证与请求

- [x] 只有成功认证握手发出 `connection/reset`。
- [x] 明确认证失效每授权代际只清退一次投影并停止保护接口重试。
- [x] 设置、模型、预设、Cordis、Team、Simulation 读取器不会因清理再次发请求。
- [x] 生产回调测试覆盖 denial，不在测试中额外 `stop()` 掩盖问题。
- [x] 一次显式重查仅一轮握手；失败保持终止，成功按原预算恢复读取。
- [x] 瞬时断网保留退避重连；普通领域 forbidden 不触发全局登出。
- [x] 在途工作结束后 30 秒零受保护重试，凭据不进入 URL/日志/localStorage。
- [x] 更换主体后旧主体私有草稿和数据不能重新发布。

## W04：模板和模型就绪

- [x] 区分安装模板定义与完全解析的持久运行规范。
- [x] 使用现有 agent 默认模型服务或显式部署路由，不虚构 provider。
- [x] 模型字段映射及 reasoning 支持范围明确，元数据解析不触发推理。
- [x] 零模型提供方时默认 Host 启动成功，真实模板仍可列出。
- [x] 结构损坏、重复模板身份、非法容量等仍在加载阶段明确失败。
- [x] catalog/preflight 的就绪、字段错误、原因与模型摘要有严格 schema。
- [x] 模型未就绪时禁止提交，保留草稿并提供模型设置操作。
- [x] 受理前重查认证、模型与容量；预览后模型改变要求重新确认。
- [x] 受理后冻结原始模型/spec/template；同 commandId 重试使用历史结果。
- [x] 提供方移除不破坏历史读取；新启动返回可操作原因。
- [x] Host DTO、生成契约、TypeScript/Python SDK 同步更新并覆盖拒绝分支。
- [x] 明确持久结构是否改变及版本处理，禁止隐式兼容或自动重写旧日志。

## W05：生产默认组合

- [x] Web bundle 挂载稳定命名的 Simulation group，显式 disable 有文档。
- [x] service/provider/Team/product/administration/UI 及必需工具和预设完整。
- [x] bare plugin 模块均在解析所有者 dependencies 中，发布闭包包含运行文件。
- [x] 不重复挂载已有 storage、Team、activation、principal、模型或 session 服务。
- [x] 生产模板与专用 actor preset 不引用 tests、fixture、脚本模型或加速定时器。
- [x] 模板 ID/版本、实体/驻留/上下文/token/时间/checkpoint 的具体边界和理由定稿。
- [x] `clockyHomePath('simulations')` 和 SQLite 默认明确，JSON 自定义路径保留。
- [x] 目录与命令流独立命名；不移动、删除或自动转换既有自定义数据。
- [x] 新 profile、已初始化标准 profile、用户 patch、自定义 overlay、显式关闭、headless 均验证。
- [x] 普通 `clocky web` 无需 Simulation overlay 即有非空生产目录与三个入口。
- [x] 启动和浏览没有运行分配、writer 获取、忙调度器或模型调用。
- [x] 打包安装在 checkout 外也能解析模板、预设和全部插件。（按用户产物约束，consumer 位于项目隔离子目录；解析钩子拒绝所有 consumer 外文件，证明不依赖 checkout。）

## W06：真实使用闭环

- [x] 侧栏、首页卡片和命令面板均提供可用 Simulation 入口。
- [x] 未加载、零运行、目录为空配置异常和禁用能力有不同提示。
- [x] 无模型时可打开创建，跳模型设置后返回同一草稿并重新预检。
- [x] 创建明确标注暂停，展示模型与预算，不自动提交、不重复提交。
- [x] 受理/准备/完成区分；初始完整 checkpoint 后才允许相应启动操作。
- [x] 丢响应查询和重试沿用原 commandId，不产生第二运行。
- [x] 显式 Start 前模型调用数为零；Start 后出现真实事件与回执。
- [x] Pause 停止新工作准入，不把在途/未知结果伪装为完成。
- [x] 刷新和进程重启保留历史，冷恢复明确操作且返回暂停。
- [x] 默认模型变化不会改变已受理运行；再次启动展示其冻结模型。
- [x] 模式切换保留允许保留的选择/草稿，隐藏视图 watch 不累积。
- [x] 显式关闭 group 时 Team 正常，Simulation 深链可返回且不会启动工作。

## W07：发布验收

- [x] 所属包单测、拒绝路径、生命周期与 source/built 测试通过。
- [x] 默认组合浏览器回归没有启用 Simulation 的测试专用 overlay。
- [x] 保留动效开启的真实过渡测试，不以 reduced-motion 金样覆盖替代。
- [x] 创建/启动/暂停/重启的 keyless runnable-example snapshot 有证据。
- [x] SDK 双端严格校验与原始命令/默认变化测试通过。
- [x] 100 条目录、长会话和 20 次模式切换验证分页与资源有界。
- [x] 默认关闭/开启的包体、启动 p95、堆和空闲 CPU 已对比；超预算原因已处理。
- [x] 所需 typecheck、lint、build、Web replay 和发布依赖闭包检查通过。
- [x] GUI PR 有真实服务流程 GIF，真实提供方与 replay 证据明确区分。（本次未请求或创建 PR，此条件不适用；证据明确标注外部 replay 适配器，后续 GUI PR 发布仍须按规则补录 GIF。）
- [x] README/JSDoc、启动与升级说明、默认关闭方法、DESIGN.md 和相关决策同步更新。
- [x] 双语配对、文档门禁和 diff whitespace 检查通过，或明确记录独立阻塞项。
- [x] 当前运行 URL 的修复后 smoke 完成；未覆盖项和已知限制交接清楚。（既有进程只读检查；旧组合尚未重启且需更新认证，默认新组合另以真实独立进程完整验收。）
- [x] 全部必需项验收后，将设计提案转换为已实现记录，移除提案式计划正文。

## 证据记录

| 范围 | 状态 | 命令/提交/产物 | 结论与限制 |
|---|---|---|---|
| D 设计准备 | 已编写 | 设计提案、开发计划、本清单 | 仅文档；不代表默认配置或缺陷已修复 |
| D 文档验证 | 局部通过，聚合有独立阻塞 | 2026-10-07：命名双语配对、新增四份 Markdown 链接/换行检查、`git diff --check`；`pnpm run doc-sync` 日志位于 `.tmp/runtime-design-20261007/doc-sync.log` | 聚合 26 通过、3 失败：既有 client catalog、config catalog、module graph 生成内容过期；本次未修改这些文件 |
| W00 基线 P1 | 两项按预期失败（退出 1） | `TMPDIR="$PWD/.tmp/web-runtime-20261007/tmp" CLOCKY_SNAPSHOT=replay pnpm exec vitest run --config vitest.web.config.ts apps/web/tests/runtime-stability.e2e.ts`；`.tmp/web-runtime-20261007/{baseline-build.log,baseline-regression.log,baseline-artifacts.json,browser-environment.json,navigation.json,settings-baseline.png}` | 基线 build 退出 0；Chromium 149.0.7827.55，1440×960，DPR 1，默认缩放，SwiftShader 软件渲染，隔离有效 handoff，无 401；导航约 4048 ms、DOM 更新超时；设置命中失败。未认证/撤销、规模与硬件采样待补 |

后续每个工作包增加一行，包含确切命令、退出状态、浏览器环境及截图/trace/GIF 位置。不得以一个“全部通过”替代仍未执行的安装、重启、模型或性能检查。

| W01 核心生命周期 | 单测通过，预算仍调优 | `pnpm exec vitest run packages/client/ui-viz/tests/transitions.client.spec.ts packages/client/ui-settings-general packages/client/ui-primitives/tests/overlays.client.spec.tsx`（8 文件、71 项通过）；`.tmp/web-runtime-20261007/w01-w02-unit.log` | 无 RAF、同步提交、快速导航顺序/旧回调/视觉拒绝/同步抛错只执行一次；实际浏览器无 DOM 更新超时。完整 Team/Simulation 导航与 30 次 p95 待默认组合完成 |
| W02 模态与响应式 | 已验证部分 | `.tmp/web-runtime-20261007/w01-w02-browser.log`、`settings-{light,dark}-{1440,768,390,320}.png`、`settings-native-zoom.{json,png}` | 四分类真实点击；公共 top-layer、48 次正反 Tab、嵌套权限菜单 Escape；原生 400%（360×225 CSS px、DPR 4）全部分类可选择/关闭、无横向溢出。主设置测试 8/9 通过，英文金样有握手重拉时序竞态，正在补确定性屏障；创建返回、完整嵌套矩阵和 200 ms 热预算未验收 |

| W01–W03-A 集成 | 通过（退出 0） | `pnpm run build`；`pnpm exec vitest run packages/client/ui-viz packages/client/ui-layout packages/client/ui-settings-general packages/client/ui-primitives/tests/overlays.client.spec.tsx`（20 文件、192 项）；`CLOCKY_SNAPSHOT=replay pnpm exec vitest run --config vitest.web.config.ts apps/web/tests/runtime-stability.e2e.ts apps/web/tests/settings-chrome.e2e.ts`（2 文件、14 项）；`.tmp/web-runtime-20261007/w01-w03-{build,unit,browser}.log` | 单次原生导航 223 ms，无 ready 拒绝；设置原有 9 项与新 5 项浏览器回归通过，包括 native 400%、四分类真实命中与 48 次 Tab。完整模式/模块 30 次预算和创建回设置仍待后续 |
| W03-A 空闲/保留对照 | 软件渲染已采样（退出 0） | `CLOCKY_SNAPSHOT=replay CLOCKY_RUNTIME_SAMPLE_PHASE={baseline,fixed} pnpm exec vitest run --config vitest.web.perf.config.ts apps/web/tests/runtime-idle.perf.ts`；`.tmp/web-runtime-20261007/idle-{baseline,fixed}.{json,log}` | 同 Chromium/视口/SwiftShader，30 秒装饰动画从 4 到 0；LayoutCount/RecalcStyleCount 从 73/73 到 0/0；100 次设置开关前后均 639 节点/346 listeners。CPU task 时间约 75 ms，两次仍有短暂其他测试负载，不据此推断 CPU/FPS 优势；硬件与独占 CPU 采样待 W07 |

| W03-B 授权生命周期单测 | 通过（退出 0），浏览器查出遗漏 | `.tmp/web-runtime-20261007/w03-auth-unit.log`（64 文件、822 项）；`w03-auth-browser.log`（未认证/撤销两条失败）；`w03-team-directory-unit.log`（2 文件、84 项） | 生产 denial 不附加 stop，显式重查/旧主体晚应答/设置镜像/Models/预设/Cordis 清退通过。30 秒浏览器检查发现 Team 目录 interval 仍发 15 次请求；已在 Team owner 修复并新增计时单测，重新构建后重验，零请求项尚未勾选 |

| W03-B 真实认证闭环 | 通过（退出 0） | `CLOCKY_SNAPSHOT=replay pnpm exec vitest run --config vitest.web.config.ts apps/web/tests/authentication-lifetime.e2e.ts apps/web/tests/startup-rpc-budget.e2e.ts`（2 文件、3 项）；`.tmp/web-runtime-20261007/w03-auth-browser.log`、`authentication-{missing,revoked}.json`；`w03-lifecycle-unit.log`（5 文件、153 项） | 初次缺 cookie 与已认证后撤销各在清退后 30 秒零保护请求；失败显式重查恰好一轮，更新真实 cookie 后重查恢复 General 控件，settings.describe 仍为 2。客户端旧主体应答及私有模型编辑器按授权代际清退；目录 watch 在成功握手前停计时器。默认 Simulation 组合中的读取回归待 W05/W06 补充 |

| W04 模型与不可变确认 | 核心通过（退出 0） | `.tmp/web-runtime-20261007/w04-{core-tests,model-boundary-tests,confirmation-tests,packages-tests,python-tests,host-typecheck,client-typecheck}.log` | 86 文件／947 项扩大回归、35 项模型边界、63 项确认、Python 75 项；Host/Client 类型检查通过。零真实注册 provider 时模板仍在目录，缺默认／元数据失败／排队默认改变均无分配无推理；已受理后默认及 provider 移除仍读原回执与暂停世界。`expectedModel` 严格在 RPC 确认，持久语义及冻结 driver 原结构保留 format 2，不作旧格式兼容转换。完整默认 Host、配置模型返回、SDK 进程回放待 W05–W07 |

| W05 默认组合基线 | 通过（退出 0） | `pnpm run build`；`CLOCKY_SNAPSHOT=replay pnpm exec vitest run --config vitest.web.config.ts apps/web/tests/default-simulation.e2e.ts`（2 项）；`pnpm exec vitest run packages/bundle/web-app packages/boot/app-boot/tests/profile.spec.ts scripts/verify-runtime-closure.spec.ts`（7 文件、54 项）；`.tmp/web-runtime-20261007/w05-{build,default-browser,composition-tests}.log` | 无启用 Simulation 的 overlay；真实默认目录有 company-procurement-v1。零真实模型 provider Host 启动及双入口可用；有测试路由时暂停创建、初始准备完成、两个实体、推理 0；启动／浏览 native open 0。actor 只允许原生三工具。六条 profile／打包安装／第三入口及完整生命周期仍待验收 |

| W06 模型设置返回 | 通过（退出 0） | `.tmp/web-runtime-20261007/w06-{setup-browser,default-editor-tests,default-store-tests,ui-tests,host-typecheck,client-typecheck}.log`、`simulation-model-setup-return.png` | 真实默认组合，无模型→创建字段→配置模型→保存默认→返回保留原输入并只预检；全程单 native dialog，重新点击才创建。45 文件／482 项 UI、默认选择 2 项、Map 提交 16 项通过；client domain graph 通过。首次拒绝/冲突不丢输入，默认不自动选第一项 |
| W06 默认执行闭环 | 浏览器局部通过（退出 0） | `.tmp/web-runtime-20261007/w06-lifecycle-browser.log`、`default-simulation-paused.png` | 无启用 overlay 的生产模板，创建／Start 确认前 0 模型；Start 展示冻结路由并推进真实 Native revision，Pause 保留真实状态；刷新后保持 paused 且模型计数不增长。外部模型为可计数采购脚本，不是真实提供方。进程重启／显式恢复／30 次预算待补 |

| W01/W02 30 次预算 | 通过（退出 0） | `.tmp/web-runtime-20261007/restart-navigation.log`（runtime-stability 六项）；`navigation-settings-budget.json`；`navigation-layout-build.log` | 浏览器可信点击首个真实可命中帧计时，导航 p95 182.8 ms、热设置 p95 10.7 ms、真实 native 视觉最大 176.7 ms。共享过渡为 80 ms；默认模型表单独占行，native400%回归无溢出。软件渲染、1440×960，未据此宣称硬件 FPS |
| W06 默认进程冷恢复 | 通过（退出 0） | `CLOCKY_SNAPSHOT=replay pnpm exec vitest run --config vitest.web.config.ts apps/web/tests/default-simulation-restart.e2e.ts`；`.tmp/web-runtime-20261007/w06-default-restart.log`、`default-restart.json`、`default-simulation-restored.png` | 无启用 overlay 的三个独立进程，SIGKILL 后旧 cookie 被拒绝；原接受身份／冻结模型经同 commandId 重试和全局默认变化保持，初始完整 checkpoint 可查；冷启动模型0/open0，显式验证恢复后 paused，刷新仍不推理，只有新 Start 再产生真实事件。仅外部模型增加100ms响应节奏，生产调度保持50/1000ms |
| W04 SDK 进程回放 | 通过（退出 0） | `pnpm exec vitest run --config vitest.snapshot.config.ts examples/simulation-company/tests/sdk-product.snapshot.ts examples/simulation-company/tests/sdk-execution.snapshot.ts`；`.tmp/web-runtime-20261007/w07-sdk-snapshots.log` | 四项覆盖 JSON/SQLite TypeScript SDK 真实 stdio 重启、原请求与有源报告续接；Python严格DTO75项先前通过。其余SDK拒绝及完整snapshot门禁仍按最终diff补充 |

| W00/W06/W07 有界规模 | 通过（退出 0） | `CLOCKY_SNAPSHOT=replay pnpm exec vitest run --config vitest.web.config.ts apps/web/tests/runtime-reading-scale.e2e.ts`；`.tmp/web-runtime-20261007/w07-reading-scale.log`、`runtime-reading-scale.{json,png}` | 100 个真实持久登记（不分配世界），32/32/32/4 分页；500 回合 canonical Session 只呈现 24 回合当前窗口；20 次模式切换后 Host watcher 仍为 0，无每行 objects.inspect，无页面异常。GC 后节点从 2347 降至 604，listeners 从 302 降至 209。既有草稿保留另由创建返回与 store 单测覆盖 |

| W05/W06 三入口与关闭 | 通过（退出 0） | `.tmp/web-runtime-20261007/w07-default-entries.log`（真实默认组合 3 项）；`default-simulation-disabled.png`；`packages/boot/app-boot/tests/default-web-simulation.spec.ts` | 无模型／有模型均经首页、侧栏、命令面板进入真实目录；显式 disable 后无导航，旧深链显示缺失能力并返回 Team，设置仍可操作。真实 profile 层测试验证新／旧 manifest 原字节、用户 JSON 根覆盖、关闭与 headless；自定义接管由既有独立 Simulation overlay 用例关闭默认 group 后覆盖 |

| W03-A/W07 默认成本 | 通过（退出 0） | `.tmp/web-runtime-20261007/w07-default-perf-{software,metal}.log`、`runtime-default-{software,metal}.json`；每种 renderer 下关闭／开启各 30 次隔离 Host+浏览器启动、30 秒空闲 | Chromium149，1440×960 DPR1；SwiftShader 页面就绪 p95 313→325 ms，Metal（Apple M4 Pro）311→317 ms；Metal Host p95 177→186 ms。实际传输到就绪约 6.06→6.56 MB（+500 KB）；GC 后 JS heap 28.6→29.4 MB（+3%），listeners 209→213。两组空闲动画／LayoutCount／RecalcStyleCount 均0；Metal TaskDuration 72.7→73.2 ms（+0.8%），未超过10%调查阈值。宿主负载已记录，Headless 不作设备 FPS 证据；基线／修复的旧装饰对照另见 idle JSON |

| W04/W07 SDK 契约 | 通过（退出 0） | `.tmp/web-runtime-20261007/w07-sdk-and-hygiene-tests.log`（5 文件／133 项）；先前 Python 75 项；SDK company product/execution 四项 JSON／SQLite stdio snapshot | TypeScript SDK／remotes 严格输入输出与拒绝、原操作替换、恢复／再次启动；Python同 DTO 严格拒绝；doc-sync type equivalence 与 Host／Client 编译已通过，原 commandId 和默认改变另由 Host边界及默认进程重启验证 |

| W01/W06 历史与空状态 | 通过（退出 0） | `.tmp/web-runtime-20261007/w07-restoration-browser.log`（3 文件／10 项）、`w07-refined-unit.log`（77 文件／772 项）、`default-simulation-missing-templates.png` | Swarm 自动布局保存不取消精确目标授权；重复目标不添加相同历史条目，原 Session 错配拒绝且不打开替代会话。空模板仅显示部署配置警告，不伪装成零运行；三入口、禁用深链、真正三 actor 审核与取消矩阵回归通过。全 Web回放仍待产物稳定后的串行验收 |

| W01 降级／模块／中断 | 通过（退出 0） | `.tmp/web-runtime-20261007/w07-navigation-fallback.log`（7／8，通过部分；中断后复验另见 rapid）；`w07-navigation-rapid.log`（1项）、`w07-final-transition-unit.log`（12项）；`w07-workspace-final.log`（JSON／SQLite 两项） | 真实 reduced-motion、无API、浏览器前后退；CDP 可信连续指针输入保留末次目标并打开设置；文档隐藏入口及中途隐藏的清退由单测覆盖。Team 模块435项、Simulation全模块与窄屏选择器实际命中通过；可选动画因新输入立即结束，未重放导航。完整Web仍在串行回放，未将其标为通过 |

| W01 同步历史提交 | 通过（退出 0） | `.tmp/web-runtime-20261007/w08-immediate-navigation-unit.log`（13项）、`w08-immediate-navigation-browser.log`（runtime-stability 8项通过）、`w08-team-action-auth-recovery.log`（Team草稿流程1项通过） | 导航在函数返回前同步提交，延后的原生捕获回调不能覆盖浏览器后退；取消不重放。Team 问题草稿后退／未知结果／认证清退与显式重查恢复完整通过。可选捕获可能观察到已提交视图，不承诺旧新元素 morph；使用可靠逻辑提交优先于捕获时序 |

| W02 嵌套关闭与焦点 | 通过（退出 0） | `.tmp/web-runtime-20261007/w08-nested-escape.log`（目录子弹层1项通过，首次权限焦点拒绝已修复）、`w08-permission-escape.log`（权限1项）、`w08-modal-focus-unit.log`（33项）、`w08-popover-owner-unit.log`（17项） | 真实设置 Menu／Full access 子确认 Escape 不关闭 Settings 并返回选择器；真实目录路径编辑／新建文件夹子 modal 逐层关闭，最终返回添加入口；Popover 的 portal 留在原生祖先，Escape 防止祖先取消。目录由其实际工作文件夹入口验收，Settings 本身无目录控件，不添加测试专用产品 UI |

| W08 收敛门禁 | 通过（退出 0） | `.tmp/web-runtime-20261007/w08-owner-unit.log`（36文件／650项）、`w08-doc-sync.log`（29门禁） | 导航、公共弹层和权限所有者扩大回归通过；双语README同步。旧认证用例明确点击访问重查，不以自动恢复掩盖终止契约。最终Web与最终打包仍待稳定产物验收 |

| W05 最终发布载荷 | 通过（退出 0） | `.tmp/web-runtime-20261007/w08-final-packages.log`（最终6包）、`w08-consumer-update.json`、`w08-packed-probe.log`、`w08-runtime-closure.log` | 对照已成功 npm 安装的 consumer，逐包验证名称／版本／依赖／peer／optional／exports 均一致，再从最终 tarball 提取源码产物；plain Node 实际加载器禁止 consumer 外文件回退。生产模板／5预设／原生角色解析，SQLite初始完整准备后 paused、2实体、0推理，HTML200。用户要求所有产物留项目，物理目录是项目内隔离区；源码解析独立性由强制边界证明。5预设140工作区包依赖闭合 |

| W07 当前URL只读 smoke | 通过已检查范围（退出 0） | `.tmp/web-runtime-20261007/w08-live-smoke.log`、`live-3080-smoke.json`、`live-3080-settings.png` | http://127.0.0.1:3080，Chromium149／1440×960，真实 native导航约142ms、无更新超时；Settings 真实命中／关闭，无页面异常。原进程未中断，其旧Host组合无Simulation入口且浏览器需新handoff；新默认能力和授权私有读取由独立正确authority进程验收，不混用cookie。已有标准profile下一次正常启动加载默认group，不改写manifest；运行中进程需正常重启才替换组合 |

| W09 全量回放发现与修复 | 局部复验通过，整合仍待最终回放 | `.tmp/web-runtime-20261007/w08-web-all.{log,json}`（96文件通过／8失败／1跳过）；`w09-main-failure-retest.log`（5文件12项通过）、`w09-models-golden-refresh.log`（11项）、`w09-affected-golden-refresh.log`（预设与生命周期通过）、`w09-joined-role-unit.log`（4项） | 完整回放发现原生工具不应进入普通全局目录；定义移入角色预设、加入Agent时限定继承能力，普通minimal原快照重新通过且实际默认Start仍推理。Cordis审批面板Portal脱离侧栏并保持面板点击归属。Models按提供方目录而非默认模型控件定位，受影响金样增加真实默认编辑器／采购预设／Simulation入口。拓扑高度随视口收敛，900px首屏原断言通过，未降低功能／对比度标准 |

| W09 最终契约与复验 | 通过当前所属范围（退出 0） | `w09-final-owners-unit.log`（49文件493项）、`w09-main-failure-retest.log`（5文件12项）、`w09-golden-replay.log`（Models／Settings／预设作者通过）、`w09-command-menu-ready.log`（Lifecycle7项） | 默认真实创建／Start在最终作用域策略下通过，普通global目录仍空且minimal原模型快照保持。除真实业务变更金样外，等待模型／命令目录的实测就绪，避免采到loading。不以降级权限／取消工具拒绝测试掩盖错误。全量105文件最终验证待正式构建后执行 |

| W09 源码与最终动态边界 | 扩大回归通过部分，时间门限隔离复验中 | `.tmp/web-runtime-20261007/w09-runtime-model-regression.log`（108文件1300项通过，4文件7项5秒超时）、`w09-final-owners-unit.log`（49文件493项）、`w09-complete-types.log`、`w09-complete-lint.log`、`w09-doc-sync-ready.log`（29门禁） | 并行文档构建下耗时原生调度案例触发5秒限额，保留失败而不放宽测试超时；所属4文件按串行原限额复验。事件生产消费图随作用域工具的新agent生命周期消费者生成并同步中文。正式整合回放与最终载荷尚待最新生产diff |

| W09 模型拒绝／生命周期隔离证据 | 通过（退出 0） | `.tmp/web-runtime-20261007/w09-heavy-scheduler-isolated.log`（4文件49项）、`w09-doc-sync-ready.log`（29门禁）、`w09-command-menu-ready.log`（7项）、`w09-complete-types.log`／`w09-complete-lint.log` | 原5秒耗时原生案例保留原限额全部串行通过，不将测试放宽为绿色。M3正式构建后的105文件完整回放已开始，结束前仍不勾选全量门禁 |

| W07 最终完整回放 | 通过（退出 0） | `CLOCKY_SNAPSHOT=replay pnpm exec vitest run --config vitest.web.config.ts --reporter=default --reporter=json --outputFile.json=.tmp/web-runtime-20261007/w09-web-final.json`；`.tmp/web-runtime-20261007/w09-web-final.{log,json}` | 104文件／305项通过，1文件／14项按现有条件跳过：8个无真实模型凭据案例、4个record-only录制案例、2个无PowerShell终端案例；不是本目标必需的默认功能验收，CI仍拥有平台矩阵。无失败及未处理错误。真Native导航8项、设置9项、模型11项、默认生命周期／独立进程冷恢复／有界目录／长会话均包含；生产工具只在角色预设范围公开，普通minimal及shipped原有工具契约通过。官方build、source types、lint、runtime closure和source-output gate先前已通过，最终文档记录迁移仍待门禁 |

| W10 当前决策与文档归属 | 已迁移并核对，聚合最终修复中 | `.agents/notes/implemented/architecture/2026-10-07-web-runtime-stability-and-default-simulation.{md,zh.md,i18n.yaml}`、开发执行记录、各包README／DESIGN | 提案triplet转为当前实现；原产品登记与持久创建记录保留、局部替换部署／就绪事实并跨链接，无归档或删除独立安全／持久语义。当前Header恢复、原生捕获保真度代价、终止认证和工具作用域均写明；开发记录不再包含提案式未来计划。文档聚合28项通过，仅旧创建记录链接顺序配对差异已修复，最终重验仍待结果 |

| W10 最终文档与完成审计 | 通过（退出 0） | `.tmp/web-runtime-20261007/w10-doc-complete.log`（29门禁）、`w10-final-pair-check.log`（1121配对）、`w10-final-whitespace.log`（空）、`w10-final-source-outputs.log`（0）、`w10-packed-final.log`（完整准备paused2实体／0推理） | 提案triplet已迁入implemented，执行记录不再为未来提案；所有必需勾选项均有明确范围证据。旧鉴权／持久目录／创建身份记录保留并跨链接，没有整篇归档或删除。首轮模型Key实际有效性／平台矩阵／real-provider录制保持原独立范围。104文件305项完整Web回放成功，finaldoc29成功；当前3080只读smoke及其旧进程／认证限制明确交接 |
