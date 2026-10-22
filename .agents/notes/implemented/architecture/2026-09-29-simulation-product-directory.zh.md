# Agent Note: Simulation 产品登记与已认证读取

Status: implemented

World 控制在进程重启后读取持久回调与 outbox 的不确定状态；调度器缺失不证明业务效果失败。恢复不以已有 maintenance 为前提，对账原 armed 回调，保持暂停并拒绝未完成确认。内存 driver 提示被清空或后台计时器触发，都不能把保留的未知责任变成新执行。

[English](2026-09-29-simulation-product-directory.md) | 中文

## Problem

原生 Simulation snapshot 包含私有世界事实，并要求 provider 身份和不可变 spec。浏览器发现需要跨 Host 重启保留的授权持久身份，又不能成为执行所有者。原生只读检查本身不提供登记、公开删节或凭据绑定的分页。

## Decision

标准 Web 通过命名 Simulation group 安装产品；[默认部署与模型就绪](2026-10-07-web-runtime-stability-and-default-simulation.zh.md)持有该组合。自定义与 headless 部署仍明确选择自身插件。

显式启用的[产品插件](../../../../packages/simulation/simulation-product/README.zh.md) 拥有独立于世界历史的 Storage Log 目录，格式为 1。受信任导入将不透明产品身份绑定到不可变 provider/run spec 和一个所属已认证主体。精确重试与重启复用登记及时间戳；重复产品或 provider/run 身份、导入变化及不完整/损坏历史均被拒绝。移除导入不会删除保留身份或转移权限。

发现只读目录元数据。provider 激活独立于登记；实际检查解析支持能力，并明确拒绝不可用 provider。Loader 激活遵循依赖，因此配置文本顺序不能使登记构造过程假定 provider 已就绪。

列表与检查使用当前仅运行时产品调用上下文。缺失与私有产品身份使用同一拒绝。凭据退役与取消在 provider IO 前及成功或失败后检查。公开观察省略主体关联、provider/spec/路径、profile、知识与模型上下文；保留精确十进制时间、revision、行政 phase、数量及观察到的所有权。检查不打开、不恢复、不修改 run，持久 running phase 不表示调度正在执行。

加密分页绑定服务生命周期、凭据代际、主体 issuer/subject/ID、目录 revision、搜索与 limit。公开 UTF-8 额度覆盖完整请求/结果、包装与游标。持久登记字节使用独立限额，因此降低公开限额不会阻止恢复私有 spec。World 领域分页根据完整回复的序列化字节数缩减行数，每个游标仍保留原查询 limit。下一偏移量只跨过已返回行；单条记录超限时拒绝。普通多行超限因此仍可继续分页，同时保持完整回复限额。文本截断明确标记。配置准入限制独立读取；卸载排空已接受工作后再释放目录存储。

Host fetch 与类型化 carrier 提供 `simulation.runs.list/inspect`。已知 forbidden、invalid 和 unavailable 失败保留各自类别；未知失败返回通用内部消息。精确 run 响应解析器拒绝身份替换。

`simulation.collections.list` 提供绑定 revision 的实体、决策、操作和检查点元数据。筛选总量来自与每页相同的完整原生观察。十进制 slot 精确排序；效果顺序遵循所属 slot/index，无父决策的操作被拒绝。`simulation.objects.inspect` 读取精确 section，实体关系、冻结上下文、attempt 及检查点引用独立分页，并按完整外层包装进行字节准入。选中 revision 或续页不匹配返回 `simulation-product-stale`；未知/其他 run 的对象使用同一缺失状态。类型化 carrier 拒绝被替换的 run、集合、对象、section 和 revision。

实体关系保留精确的左闭右开时间区间，并包含入向、出向及范围引用。冻结上下文分区只读取原始保留视图、有序内容块片段及知识／来源引用。受信任的主体／实体范围 `contextReaders` grant 独立于 run 发现和管理；可选产品 run 进一步限定所属登记。默认删节所有正文。明确 grant 只公开历史纯文本，不授予当前知识或来源 Team／Session 正文访问。不支持的内容块省略 payload。所有者在 IO 前校验并复制策略，异步结算后复查生命周期，退役不能返回已经构建的正文。Unicode 安全片段限制与完整包装额度同时生效；续页绑定公开权限及片段大小。该视图不替代完整已记录模型请求的重建与独立授权。

公开标签只选择实体名称，profile 正文保持私有。决策/上下文计量删节原始内容，不代表完整模型请求。效果状态、发布、输入持久化、接收方 receipt、任务创建和送达失败处理状态分别保留。检查点完成不表示当前来源已验证，公开字段明确为 `not-performed`。Team/Session 引用要求各自的正文授权。共享 Host dispatch 独立于网关其他业务，负责认证与私有错误映射。

浏览器 DTO 与解析器提供明确的 `./types` 和 `./schema` 入口，独立于私有登记和 Host Cordis 声明。Simulation 通过纯 `./time-types` 声明导出现有 `SimTime` 品牌类型，保留原生身份，又不会把 provider 和 Session 声明导入 Client 程序。

纯 `./identities` 入口为相同目的保留原生 entity、decision/slot、operation、checkpoint 和 writer-epoch 品牌类型。现有 schema 和持久编码不变。

[只读历史决策](2026-09-29-simulation-readonly-history.zh.md) 保留原生一致性与协调器观察。这部分实现[产品提案](../../proposed/architecture/2026-09-28-web-team-simulation-product-integration.zh.md)，后者保留活动执行所有权、分区集合、行政与 UI 要求。两个记录均未被完全取代。

[持久创建决策](2026-09-29-persistent-company-creation.zh.md)定义公开分配、原请求结果及 paused 准备句柄；本记录保留其独立规则。

## Alternatives considered

**公开原生 snapshot 与选择。** 它们暴露私有事实，并允许替换 provider/spec，绕过已登记授权身份。

**浏览时打开 run。** 这会竞争协调器所有权，把发现与执行或恢复混在一起。

**在登记构造时解析 provider。** Loader 依赖激活可能稍后才登记 provider；读取时解析也能明确处理 provider 卸载。

**串行推进所有读取。** 不可变目录元数据不要求串行；一次慢原生观察会阻塞无关发现。

独立上下文策略贡献使用仅运行时 registrar 和自己的部署插件 effect。增加／移除改变不授予权限的读取版本，并唤醒有界观察等待；不替换发现、行政 owner 或浏览器模块。已认证观察绑定 run、凭据、策略与来源生命周期，只报告 revision／可用性。原生探测使用普通读取准入，休眠等待采用独立容量。上下文响应携带策略标签；退役与后续客户端观察不能重新公布旧正文。客户端失效保留结果不确定的原命令与草稿，仅有世界更新时保留过期页面，不伪造新总量。

知识检索使用定义包共享的原生时间／传递投影，provider 继续负责日志 fold。历史上下文权限不授予当前或已选知识读取；明确内容范围决定这些读取，决策冻结截止点仍检查当前受众撤销。精确引用不能超出该决策原始选择。报告来源公开需要独立 grant，并核对保留通信／持久送达记录。世界 revision 变化释放知识正文，不重新解释历史上下文权限。

原始日志记录复用原生只读历史验证，元数据与独立授权的 JSON 文本分开。整运行 `recordReaders` 是独立于实体受众／上下文授权的历史特权读取者；授予它意味着明确允许保留的私有历史。惰性文本分片限制分配，完整包装限制公开分页，策略／版本改变拒绝在途原文及续页。浏览器记录／导出由客户端 runtime 和 UI 持有，非 run-event 来源仍是独立工作。

冻结 Team Envelope 引用提供保留来源向量的稳定序号。产品定位每次最多读取一个频道页，不公开无关记录；精确正文页沿用找到的不可变位置。实体来源 grant 与当前 Team 人工读取资格是独立要求，成功和失败都在复查后结算。缺少权限不确认私有目标是否存在。原文片段保持纯文本，未知 provider 块继续删节。

## Consequences

每个不可变登记只允许所属主体访问，没有可变 ACL/删除操作。目录列表包含未观察元数据，对象分页携带精确原生 revision。原生完整历史重放虽有界但可能昂贵，不承诺性能改善。浏览器所有者提供来源检查与独立 Team 权限刷新，完整交互矩阵仍独立跟踪。

[浏览器查看决策](2026-09-29-simulation-browser-viewing.zh.md) 负责可选浏览器组装；[公司准备决策](2026-09-29-company-initial-preparation.zh.md) 负责初始原生拓扑对账。两者均不替代目录的授权或只读观察规则。

必填 `clocky.world-case/v2` 摘要携带同一 Native 前缀的请求、当前计划、回调/业务和通知事实。即使可选领域扩展尚不可用，浏览器也直接使用这些摘要；不能以 run 级停止原因替代案件状态。分区 parser 拒绝矛盾的回调、结果和通知事实，部分计划页仅在原历史结束时核验最终计划。案件元数据与正文、Persona、Team/Session 授权相互独立。补证答案使用案件正文授权及 IO 后最终检查，阻止已撤销的响应返回预先构建的答案。查看原计划或恢复选项只导航，不提交命令。

案件执行元数据分别投影原人事、代表和单案联系责任，与计划授权、不可变业务结果和通知送达分开。共享联系引用首次代表准备，不声明第二个身份。仅返回持久状态和原 intent/plan/序号引用；未完成准备不证明失败、结果未知或可重试。TypeScript 与 Python 解析器拒绝不匹配的选择器、重复责任类别、错误案件归属、倒退序号及私密载荷字段。

`readWorldDomain` 通过 `simulation.world.domain.read` 及共享 SDK 方法公开九类严格选择的 `clocky.world-read/v1` metadata。每个响应保留完整原查询、revision／read version 及精确有界覆盖；续页绑定查询、读者、policy generation 和来源 fingerprint。仅末页不能证明全量覆盖。提案／制度正文、Persona 与案件 business key 使用独立授权，并在异步读取后重验。typed 来源引用保留 Native 身份及精确 canonical Envelope／task metadata，不授予目标正文权限。冷人员盘点组合 Native 与 canonical Team owners，不打开或恢复执行。不支持的历史生命周期查询明确拒绝，不替换为当前状态。浏览器窗口彼此独立；Native 推进遮蔽过期正文，而 metadata 追上时不能废弃当前或更新响应。

外部交互页同时包含实际 simulated-actor 联系、规则结果及 director 裁决。原询问 receipt 与已完成 Native delivery wake 关联已记录的代表回复决策；该 metadata 投影不证明 Session 消费。代表 ready 或联系 committed 不能推断回复。不同来源 kind 保留原 intent 身份不变。引用必须有 canonical Envelope sequence 或 decision/source ordinal，显示与选择的 Envelope 身份一致。身份页数组与所声明覆盖一致，包括明确为空的代表页。

## Verification

JSON/SQLite 目录测试覆盖恢复、精确重试、所有权重复、保留容量、不完整历史、条目限额、加密查询替换、UTF-8 与完整页限额，以及卸载排空。集合/详情测试覆盖精确十进制排序、过期页、类型化筛选、私有正文/诊断省略、分层效果证据、缺失对象、独立 section 分页和完整包装准入。Host 测试通过 fetch 认证，覆盖私有/缺失身份等价、provider 错误、读取途中退役和响应选择器替换。keyless snapshot 使用真实 Loader 组装启动原生 writer 与独立凭据认证产品 reader，读取持久决策和实际资源转移效果，验证持有/释放后的所有权与精确时间，并在 reader 重启后复用登记。

[上下文／关系回归](../../../../packages/simulation/simulation-product/tests/context-and-relations.spec.ts)检查真实 JSON／SQLite 冻结视图，验证 Unicode 片段重建、独立正文 grant 和卸载／凭据约束，并保持世界 snapshot 不变。Web 场景检查生产 actor 上下文及精确关系分页；SDK 维护场景通过真实 stdio 读取两个分区，包含冷生命周期检查。正文 grant 与引用都不授予其他来源内容权限。

观察回归覆盖原生 JSON／SQLite 变化、独立策略退役、凭据／卸载取消、仅元数据不可用状态及旧响应约束。真实浏览器维护组装卸载／重挂载策略插件时保留同一目录、run snapshot、模型次数及后来输入草稿。stdio SDK 场景验证进程重启后旧观察游标 reset。

新增 reader 测试覆盖已记录的调度停滞、原生来源历史缺失、来源查询期间的披露策略变化、已关闭或调用前已取消的 watch，以及意外检查失败的传播。注册器测试检查仅限进程内使用而不可序列化、retry reader 独占、重复释放幂等，以及卸载后拒绝注册。
