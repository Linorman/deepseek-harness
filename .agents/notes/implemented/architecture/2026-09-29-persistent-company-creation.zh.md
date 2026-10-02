# Agent Note: 持久原始公司创建请求

Status: implemented

[English](2026-09-29-persistent-company-creation.md) | 中文

## Problem

创建等待者断线不能证明 Host 是否已分配或准备运行。重试时重新生成身份或解析已变模板，可能创建另一家公司、重置库存或丢失原失败。原生准备 reservation 不保留拥有它们的已认证公开请求。

## Decision

显式[行政入口](../../../../packages/simulation/simulation-product/src/administration.ts)拥有独立 format 1 命令日志。受理在目录登记或原生 IO 前持久记录原命令、已认证主体、分配的产品／原生身份及完整不可变模板解析结果。受信任模板固定版本、原生 policy、preset、模型 route、driver 偏移和采集额度。公开请求选择已安装身份／版本、允许的名称／库存及明确可编辑的额度降低。启动校验部署引用，不推理。

精确重试比较原 owner 与规范化 payload，保留分配并返回原 accepted 或终态 receipt。传输取消只退役等待者。终态追加失败时，持久请求保持 accepted，不虚构成功或失败。结果查询只读；未知／私有请求统一返回 `not-found`，不能据此证明请求失败。后续准备在同一原运行上使用新命令和检查点身份，其成功不会改写早先失败结果。

读取目录提供进程内 registrar，其函数拒绝 JSON 序列化。行政 owner 先持久记录意图，再幂等登记该分配。恢复重放完整有界日志，修复发现，不打开原生句柄。明确重试已受理请求，通过[既有准备 owner](2026-09-29-company-initial-preparation.zh.md)对账部分准备。每个已分配运行持有一个原生句柄；外部所有权返回恢复责任，不接管。已持有、未启动运行上的新准备真正采集自己的检查点。创建不保留 actor、临时 Team connection 或模型工作。

另一次分配前，容量按持久待处理请求及不同的待处理／持有运行计算，防止受理早于异步 job 登记而超限。完整日志条目字节、保留命令数量、传输等待和公开结果字节分别具有部署额度。卸载先停止准入，排空已准入准备后才关闭原生运行和释放日志。原生退役未确认时保留命令 stream；Cordis 通过 logger 报告 disposal 失败。

[产品目录决策](2026-09-29-simulation-product-directory.zh.md)保留独立授权／删节依据；[准备](2026-09-29-company-initial-preparation.zh.md)和 [driver](2026-09-29-company-procurement-driver.zh.md)保留原生拓扑及模型／效果规则。[产品提案](../../proposed/architecture/2026-09-28-web-team-simulation-product-integration.zh.md)仍负责 Web 创建／管理及自动执行。这些记录是部分实现的独立依赖，没有过时。


SDK 请求复用同一行政 owner、原命令日志和产品投影。JSON-RPC server 捕获传输已认证 call，解析可选产品服务，并拒绝凭据替换／退役后的响应。TypeScript 和 Python client 校验精确结果身份及 section／revision 对应关系。SDK 不新增 writer、准备队列或自动重试 owner。调度、检查点／恢复及单实体输入分发复用 Host 请求的行政 owner 和原生日志。严格客户端核对原管理 ID／phase、命令类型、所选恢复检查点及输入目标／时间；精确缺失仍表示结果不确定。旧开始重试不能撤销后来暂停。冷查询不获取所有权；明确恢复验证当前后缀，返回暂停 owner，不推理。 Host 和 SDK 分发通过纯 `./errors` 入口的 `isSimulationProductError()` 识别产品拒绝。公开 code 在独立打包的构造器之间标识拒绝；未知失败仍使用通用诊断。
## 调度所有权

行政服务为每个已准备运行保留一个[公司 owner](../../../../packages/simulation/simulation-product/src/company-owner.ts)。后续成功准备建立自己的完整检查点依据；较早的失败依据不能允许调度。管理与准备在该 owner 队列串行执行，而已受理 driver 工作独立排空，因此推理期间也能受理暂停。只有已授权开始才分配 connection，并且不能替换 live scheduler。

原生 `managePhase()` 拥有持久有序 phase 请求。产品管理限制保留身份数量，在队列位置复查认证，并保持原终态结果，重试不重新调度。Host `control/manage/managementRequest` 提供删节观察及原结果；冷读取和历史重试不获取原生执行句柄。新的冷调度必须恢复。当前 provider 登记参与动作提示，原生 phase 准入仍检查自身可变事实。不透明 ID 选择日志自身键，也包括 JavaScript 属性名。

单一 timer 提名有界 driver 批次。有效工作量上限触发后续批次；技术重试／容量停止遵循配置的真实延迟及原生重试期限。未知结果、恢复、场景阻塞和完成保留停止原因，不反复调用模型。暂停保留这些原因，关闭后续 timer 准入。owner 退役取消受支持的 connection 工作，等待已受理模型清理后才释放原生所有权；carrier 取消不执行退役。

## 维护请求

创建命令日志使用相同的已认证主体、原 payload 和终态结果规则保留 checkpoint 与 restore 命令。严格 fold 将派生检查点 ID 绑定到 checkpoint 命令，将所选完整检查点绑定到 restore 命令。原生世界 phase、库存、输入及检查点 manifest 仍是原生事实，不复制到产品日志。carrier 退役不退休已受理维护操作。

检查点采集与管理／输入串行准入，阻止后续 driver 批次，将取消、退休、来源验证及 manifest 发布委托给原生 connection。只有成功完整采集才替换 owner 启动依据。中断的已受理采集在继续同一原生 ID 前验证保留来源及当前后缀。restore 在退休已持有 owner 前核对兼容完整依据，经原生恢复验证当前后缀，并发布新的暂停产品 owner。历史终态重试只是结果读取；新的 restore 身份重新验证。临时 connection 清理未确认时保留 run，等待后续明确恢复。

外部输入具有独立原生幂等记录、已认证 source 和一个场景允许实体。公开 receipt 删节 text／source，将事件分配与 wake 完成分开表示。输入不修改世界事实，也不继续已暂停 run。当前 owner 队列及原生 ingress 边界复查准入；已完成、仍 running 的采购可处理未来输入，不使用新 key 重建原业务效果。Event／ingress 身份品牌类型位于纯原生 identity 入口，浏览器 DTO 不导入 Host Context augmentation。

行政控制 snapshot 按同一原分配及当前原生 owner 提供观察到的维护准入。兼容依据元数据包含真实发布时间和来源基数，浏览器引用检查独立于普通对象检查器。浏览器确认检查点／恢复后果，在共享额度内保留按运行隔离的输入及原选择，将输入分配与已记录消费分开。查询缺失或精确终态重试响应丢失，不撤销先前已观察的不可变终态 receipt。原生日志版本 40 原子提交检查点发布时间，并拒绝旧格式。

创建预检与持久受理解析同一组明确允许的模板额度降低。部署 `editableLimits` 是允许列表；已安装 spec 兼作默认值与上限，而场景准备、收件人送达、请求预占及完成偏移决定最低要求。公开预检不携带命令身份，也不占用持久或模型容量。通过结果只是观察，因此创建重新检查当前准入。保留请求包含选定额度，保留记录包含完整解析 spec；重新打开和精确重试不会换用当前部署默认值。共享模型 permit、时钟定义和 policy 仍由部署拥有。

Host 重启会轮换产品凭据，因此私有浏览器草稿和保留命令选择不能作为恢复权威。获准的按运行请求发现只返回原 receipt；revision 统计受理与终态日志条目，加密分页绑定新主体代际。明确重试按原运行／ID 选择保留命令，并将精确原正文交给既有操作。终态结果仍是历史事实，冷 review／retry 意图需要明确恢复 owner。此路径不泄露私有输入，不允许调用方重新生成身份或绕过原操作准入队列。

## Alternatives considered

**在持久受理前分配。** 退出会留下没有已认证原分配的原生事实，使重试含义不明。

**每次重试解析当前模板。** 部署变化会静默改变已受理请求的模型 route、policy 或初始库存。

**HTTP 断开就取消准备。** 将等待者生命周期与持久所有权混淆，使部分提交没有稳定结果查询。

**将终态追加失败视为准备失败。** 尝试替换未知结果，可能在原生成功后追加矛盾的终态记录。

## Consequences

创建显式启用，运行保持 paused 且有初始完整检查点。已完成发现／重试不重新打开运行或推理。Host 调度使用原生有序请求日志；完整 Web 维护矩阵和自动任务执行仍保留独立产品要求。命令日志在另行设计完整 checkpoint 格式前不能压缩；容量拒绝新工作时仍可查询原结果。

## Verification

源码 owner 测试覆盖 JSON／SQLite 分配、精确／改变重试、原失败保持、新准备检查点、等待者退役、并发容量、完整字节限制、初始化引用、原生所有权拒绝、终态写入失败及未确认关闭。日志测试拒绝损坏／不完整前缀、序列缺口、保留超限和终态改写。[真实 Loader snapshot](../../../../examples/simulation-company/tests/product-administration.snapshot.ts)在受理、目录登记、原生创建、实体写入、初始检查点和终态追加后终止进程。重启保留原身份，不推理地修复发现，完成同一请求，已完成重试不写入。

[SDK Loader snapshot](../../../../examples/simulation-company/tests/sdk-product.snapshot.ts)通过生产 stdio 和产品服务、确定性凭据输入验证 JSON 与 SQLite。源码及构建入口在重启后保留同一 run，拒绝改变命令 payload，分页读取元数据，并在不推理的情况下发布独立准备检查点。

[产品控制 Loader snapshot](../../../../examples/simulation-company/tests/product-control.snapshot.ts)通过已认证 Host fetch carrier 推进真实后台采购，暂停已受理推理，保持原重试意图，核对原生库存／效果事实，并重新启动进程读取历史结果而不调用模型。外部模型使用脚本；这不代表真实 provider 或跨 Host 验证。

[维护 Loader 场景](../../../../examples/simulation-company/tests/product-maintenance.snapshot.ts)验证单次输入分配、记录消费、完整采集、旧依据／当前后缀恢复及恢复不推理。[进程退出场景](../../../../examples/simulation-company/tests/product-maintenance-recovery.snapshot.ts)在产品受理、原生检查点开始／完成及产品终态追加时终止 JSON／SQLite 进程；重试保留原身份、当前库存和输入历史，并退休旧 writer。

[SDK 维护 Loader 场景](../../../../examples/simulation-company/tests/sdk-maintenance.snapshot.ts)通过生产 stdio 验证 JSON／SQLite 调度、暂停后的原开始重试、关联决策的输入消费、完整采集、冷结果查询及旧依据／当前后缀恢复。公开 DTO 删节输入正文；恢复保留已记录决策／时间，不创建新 Session 文件。

[Web 维护场景](../../../../apps/web/tests/simulation-maintenance.snapshot.ts)验证 JSON／SQLite 输入响应丢失、后来原始编辑、原输入消费、完整检查点响应丢失及精确查询。它在明确恢复前禁用／重挂载真实 Loader 行政 owner，返回暂停状态并保留当前库存／输入／决策及模型调用数。这属于同一 Host 进程内的冷产品 owner 恢复；独立进程退出证据仍由原生维护场景提供。
