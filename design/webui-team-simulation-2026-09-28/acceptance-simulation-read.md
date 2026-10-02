# C06：Simulation 读取验收

核对日期：2026-10-01。结论：**C06 读取范围通过，可关闭**。[计划 4.1 的五条读取要求](implementation-plan.md#41-读取和授权)及[第 5 节](implementation-plan.md#5-浏览器视觉与可访问性验收)在 C 读取页面上的要求均有本轮证据。创建／取消／调度／输入表单、执行故障矩阵及全仓最终门禁由 D、E、G 的证据分别认证，本文件不以读取通过替代这些验收。

## 当前构建和执行

实机使用当前工作树的完整构建：`.tmp-simulation-plan/ae/build-final-web.log`，主任务记录构建 exit 0。以下 Web 场景均用真实 Loader／Host、当前 `lib/client.js` 和无 replay fixture 的 keyless scaffold；意外模型调用直接失败。所有执行 handle 已终态，没有待完成的 C 测试进程。

| 命令 | 本轮结果 | 权威证据 |
|---|---|---|
| `CLOCKY_SNAPSHOT=replay pnpm run test:web:built apps/web/tests/simulation-read-lifecycle.snapshot.ts` | JSON／SQLite 2 项通过；5.46 秒 | [生命周期场景](../../apps/web/tests/simulation-read-lifecycle.snapshot.ts)；`.tmp/simulation-read-lifecycle/{json,sqlite}/lifecycle-evidence.json` |
| `CLOCKY_SNAPSHOT=replay pnpm run test:web:built apps/web/tests/simulation-workspace.snapshot.ts` | JSON／SQLite 2 项通过；22.41 秒；无未处理拒绝 | [workspace 场景](../../apps/web/tests/simulation-workspace.snapshot.ts)；`.tmp-simulation-plan/web-browser/*-presentation.json` |
| `CLOCKY_SNAPSHOT=replay pnpm run test:web:built apps/web/tests/simulation-records.snapshot.ts` | JSON／SQLite 2 项通过；13.82 秒 | [records 场景](../../apps/web/tests/simulation-records.snapshot.ts)；`.tmp/simulation-records-browser/{json,sqlite}/*-presentation.json` |
| `CLOCKY_SNAPSHOT=replay pnpm run test:web:built apps/web/tests/simulation-sources.snapshot.ts` | JSON／SQLite 2 项通过；19.99 秒 | [source 场景](../../apps/web/tests/simulation-sources.snapshot.ts)；`.tmp/simulation-source-ui/{json,sqlite}/*-presentation.json` |
| `CLOCKY_SNAPSHOT=replay CLOCKY_EXAMPLE_MODE=src pnpm run test:snapshot`，选择下列三个只读 fixture | 3 文件、6 项通过；12.53 秒 | [readonly](../../examples/headless-agent/tests/simulation-readonly.snapshot.ts)、[product](../../examples/headless-agent/tests/simulation-product.snapshot.ts)、[sources](../../examples/headless-agent/tests/simulation-sources.snapshot.ts) |
| 相同三个 fixture，`CLOCKY_EXAMPLE_MODE=lib` | 3 文件、6 项通过；3.45 秒 | plain Node、真实 package exports；独立 writer／reader 进程与 source／Team 授权 |
| `pnpm exec vitest run`，选择下面矩阵中的 Product／API／runtime 与读 UI 19 个 spec | 19 文件、117 项通过；4.27 秒 | 每行链接的断言覆盖；包含 93 项读取 native／API／runtime 和 24 项 UI／store |
| 模块 Node 半／browser loader 两个 spec，加 connection fixture、SDK client/server 和 Host task-control | 6 文件、204 项通过；新增 sibling 后 node-half 单文件 25 项通过 | [真实模块生命周期](../../packages/client/modules/tests/node-half.client.spec.ts)；仅一个同包 ACTIVE sibling 也保留单个 graph row |

新增行政取消 wire 的 Host／TS SDK 116 项、Python 71 项及 connection fixture 33 项均已通过。其接口和原请求契约由相应包 README 及 D／E 记录拥有；本表只保留与当前公共 carrier 完整性有关的执行证据。

## 4.1 读取与授权逐条核对

| 明确要求 | 直接断言与当前证据 | 结果 |
|---|---|---|
| 列表、详情、观察、原文／下载、SDK 每次读取重新鉴权；随机／私有 run 无存在性泄露 | [Product](../../packages/simulation/simulation-product/tests/product.spec.ts)、[watch](../../packages/simulation/simulation-product/tests/watch.spec.ts)、[fetch API](../../packages/host/apiproxy/tests/api-proxy-simulations.spec.ts)、三个 src／lib Loader fixture | 通过；私有／不存在 run 同为 forbidden；IO 前后检查 credential／授权退休；不存在或其他 run 的对象不返回实体正文 |
| run／collection／object／section 不可替换；来源只允许保留的 ordinal，不接受伪造 Team／principal／正文来源 | [API 回包身份检查](../../packages/host/apiproxy/tests/api-proxy-simulations.spec.ts)、[集合边界](../../packages/simulation/simulation-product/tests/collection-bounds.spec.ts)、[source](../../packages/simulation/simulation-product/tests/sources.spec.ts)、[source schema](../../packages/simulation/simulation-product/src/sources-schema.ts) | 通过；合法 JSON 形状但身份不同的结果拒绝，跨对象 cursor 拒绝；其他 run 对象为 missing／无正文；错误 Envelope sequence 不转向其他消息，上传 actor／source 字段在严格 wire 解析处拒绝 |
| 浏览／刷新／重连不 open／restore 第二 owner，不改 phase／世界，不启动模型 | Product 对不同真实 provider 的 open spy、8 项 Web snapshot equality、source Web `turn/start=0`、跨进程 Loader | 通过；浏览器生命周期重连及 product 卸载重挂时 open 调用为 0，原 Native snapshot 相等；独立 reader 不接管 live writer，释放后只观察 unowned |
| 损坏历史与另一 owner 持锁可区分 | [Product 真实 journal 用例](../../packages/simulation/simulation-product/tests/product.spec.ts)、readonly／product Loader | JSON／SQLite 通过；live lock 返回 `observed/other-owner`；释放后破坏 journal，详情／集合／records 明确 `UNAVAILABLE`；还原字节后 `unowned`，从未 acquire execution |
| 页大小、完整 UTF-8 响应字节、排序／过滤、revision／credential／policy cursor 绑定；超限拒绝 | [collection-bounds](../../packages/simulation/simulation-product/tests/collection-bounds.spec.ts)、[collections](../../packages/simulation/simulation-product/tests/collections.spec.ts)、[records](../../packages/simulation/simulation-product/tests/records.spec.ts) | 通过；wrapper、cursor 与单行都计入预算，单行超限及空 wrapper 超限拒绝；跨页不丢行；错误筛选／revision／凭证／策略 continuation 拒绝；decimal slot／time 用精确字符串排序 |
| 断线／游标缺口重读后形成一致授权视图；晚到旧响应不可覆盖新选择 | [runtime](../../packages/client/runtime/tests/simulation-runtime.client.spec.ts)、[observation](../../packages/client/runtime/tests/simulation-observation.client.spec.ts)、[source-reader](../../packages/client/runtime/tests/simulation-source-reader.client.spec.ts)、life／workspace／records Web | 通过；握手前没有 Simulation 请求；捕获真实旧 entities 响应后切 decisions，不被旧回包覆盖；真实 WebSocket 断线保留获准 stale 内容并禁用读取，重连重读；分页失败保留原页、返回首页重试；策略／主体退休清除正文 |
| 世界元数据、实体当前／冻结知识、context 正文、Envelope 原文与整运行历史分别授权；Team 身份不隐式授予 Simulation 内容 | [knowledge](../../packages/simulation/simulation-product/tests/knowledge.spec.ts)、[context](../../packages/simulation/simulation-product/tests/context-and-relations.spec.ts)、source／records specs 与两类 Web | JSON／SQLite 通过；默认 world metadata 不含 profile secret／knowledge／model context；当前与冻结 knowledge 分开且精确 premise；Simulation 来源 grant 与当前 Team membership 两者同时成立才读原文；IO 中撤权也不返回旧正文 |
| 导出用同一授权，完整文件有界，最终复验后才下载 | [records exporter](../../packages/client/runtime/tests/simulation-records-export.client.spec.ts)、records native／Web | 通过；完整 suffix／UTF-8 字节、part 顺序、total、重复 cursor、最后一次权限／revision／total 均校验；断线／撤权／取消丢弃全部临时字节，不下载部分文件；浏览器真实下载核对 4 条 metadata 和 3 条原文 |
| run 额度与 Host real-time permit 分开；大于 Number 安全整数的模拟时间准确显示 | [RunStatus 组件](../../packages/client/ui-simulation/tests/run-status.client.spec.tsx)、workspace／src／lib product fixture | 通过；未知指标显示 unavailable，不能伪造零；预算及 shared pool 独立；真实页面与跨进程输出保留 `9007199254740993 minute`、规则／策略版本及预算 interval 精确文本 |

## 第 5 节：C 读取页面的真实组装与交互

[模块 owner 修复](../../packages/client/modules/src/index.ts)仅发布 enabled 且当前 fiber 为 `ACTIVE` 的条目，`internal/plugin`／`internal/status` 共用原按包合并队列。真实 Loader 测试验证 pending／异步 loading 不发布，`loader.await()` 返回时 graph 已正确；必需服务丢失撤下，重新提供后恢复同一 bundle revision，effect 单次退休、通知 `[1,0,1]`。同包第二 entry pending／active／退休均不撤下仍 ACTIVE 的 sibling，也不重复发布。两后端浏览器实际禁用 `simulation-product` 后入口消失、原深链显示未部署；重新启用恢复唯一 workspace／navigation，原世界未变，没有第二写 owner。这些断言没有使用显式 UI entry toggle 代替真实 required-service loss。

深链保留模块、提交的状态／认知／实体／记录筛选、对象／section／record sequence；刷新和历史返回恢复选择。Source 的关联 Team／channel 和精确绑定 Session 走已有授权入口，返回后保留来源 URL；查看 Session 不开启 turn。空态、单项、跨页、长名称／不透明完整 ID、局部状态／分页失败、私有原文 withheld、grant 增加及 Team／record grant 撤销均在实际流程覆盖。普通失败保留 stale，权限失败清除正文；非模态 inspector 的 Tab 路径能够离开摘要到主 Refresh，未陷阱焦点。

[本轮矩阵索引](acceptance-simulation-read-matrix.json)列出 16 个 backend／page 身份与原始文件位置：**列表、概览、实体、决策、操作、检查点、records 原文、Envelope source 原文八类页面 × JSON／SQLite × 中文／英文 × 浅色／深色 × 1440×1000、1280×480、390×844、1440×1000 原生 200%**。共 256 张本轮 screenshot，其中 64 张原生 200%。[helper](../../apps/web/tests/simulation-read-presentation.ts)通过实际设置 UI 改语言／外观，调用 [Chromium tab zoom](../../apps/web/tests/browser-native-zoom.ts)并核对 `getZoom=2`、1440 physical→720 CSS viewport；没有用 CSS zoom／DPR 仿真替代浏览器缩放。

每张图片对应 JSON 记录 URL、locale、theme、physical viewport、实际 zoom／CSS viewport／DPR、数据身份与 computed color。13,296 个渲染文本样本按祖先背景逐层混合计算，普通文本至少 4.5、大字至少 3，禁用控件除外；本轮最小实测比值 **5.230267640077466**，没有页面横向 overflow。每个 backend／page 还在原生 200% 下纯 Tab 找到主 Refresh，记录 outline／box-shadow 可见焦点后 Enter；保存 ariaSnapshot 与具名按钮检查，并在 reduced-motion 下确认没有正时长动画。框架 overlay、page errors 和非预期 console warnings 均为零。

共享 Settings／行政 Modal 的命名、focus isolation、Escape／返回焦点以及可写表单／中文 IME／重复提交等完整交互由 D／Team 证据拥有；C 在这些页面提供只读查看、筛选、导航、复制和导出，不借读取通过认定全部写入交互或全仓 G 验收完成。

## 发现的失败与复验

初始 lifecycle fixture 的 `goto(load)` 握手 hold 与错误 RPC 名 `simulation.runs.browse` 导致超时，改为 `goto(commit)`、实际 `simulation.collections.list` 和明确 probe 时限；120 秒测试门槛未放宽。修复 fixture 后发现实际 modules owner 错误发布 pending UI，已修真正可用性发布条件；新构建上两后端 life 通过。Presentation 在 200% 窄布局切偏好时 Settings 隐藏，改为切换前恢复 desktop/native1；功能断言未削弱。诊断-only `response.json()` 复制可能在取消／reload 后被 Chromium 回收，其拒绝现记录为 `diagnosticBodyUnavailable`；实际 runtime 校验、page errors 与 console checks 保持，完整 workspace 复验 exit 0。

Product Loader 的旧 inline snapshot 未包含已正式实现的 metrics／rulesVersion／policyVersion，核对产品投影后只刷新这些字段，保留原 revision 15、owner／phase／time、隐私和 native 事实断言；src／lib 各六项独立 replay 全过。新的授权／字节／撤权／原请求检查均未以放宽门槛取得通过。

本轮定向 oxlint、diff-check 与相关中英 pairing 通过。全仓 lint／覆盖率、真实付费模型、跨 Host 以及其他平台不由 C06 声称认证；读取的精确保证已由上表的当前 native、API、runtime、browser 和跨进程证据分别证明。
