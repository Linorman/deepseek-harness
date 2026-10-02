# Agent Note：有界公司采购 driver

Status: implemented

[English](2026-09-29-company-procurement-driver.md) | 中文

## Problem

running 管理意图不会推进公司采购。生产协调须在冻结窗口前安置 actor，按顺序处理传输与通知 wake，区分已提交提案与已应用效果，并在暂停／恢复期间保留原决策。

## Decision

[公司 driver](../../../../packages/simulation/simulation-product/src/company-driver.ts) 是原生运行与规范 Team connection 的受信任 version 1 消费者。调用者负责准备／恢复、不可变场景设置、调度周期与生命周期。构造时核对保留的模型 route 与受支持规则／策略版本。推进批次合并并遵守 `maxControlSteps`；浏览器读取、构造或 paused 批次均不启动推理。工作开始前，初始完整公司检查点须指向规范 Team。

采购协议推进请求、接受、转移、结果及已交付报告确认。原生通知和 ingress wake 使用独立 input 决策。每阶段保留原始已接受决策；后到重复记录不能替换其效果。Driver 选择一个 actor，通过原生安全驱逐取得驻留，冻结单 actor 窗口，并执行真实模型／Session／工具路径。串行依赖决定此窗口大小；主机共享模型 permit 与原生 run 预算仍是权威。当前 epoch 的 submitted 窗口重试原记录输入而不再推理；其他窗口、上下文或未确认 writer 须恢复。

上下文选择两个协议账户、actor 自有余额、共享账户 ID／revision 及采购／承诺事实。Supplier 转移证据只在已交付报告检查时进入 buyer 上下文。不包含 profile 或无关资源。所选 section、版本和来源 cursor 在模型调度前进入既有必需 Session 上下文事件；完整请求仍有普通 Session 历史与工具定义。

公司 preset 提供完整 Simulation persona，并抑制无关动态运行时上下文。编码部署 persona 可能要求 Simulation actor 不拥有的文件系统 `cwd`；环境文件系统数据不能替代授权世界知识。Actor 自有 Team 工具不受继承 registry 限制，因此 role 在协作装配后过滤最终 prompt 工具 schema。原生模型分发器在模型或 token 准入前独立拒绝决策权限之外的公开能力。执行 guard 保持独立于展示。

暂停关闭后续控制准入。Submitted 提案保留窗口供明确恢复。暂停期间模型回合结束却未提交时，先持久取消，再释放对应 wake 并关闭窗口。返回值独立标识此中断。Drain 等待已准入工作；调用者须先排空，再采集检查点或关闭 connection／run。未分类执行／存储失败仍返回错误并保留原生责任。Deadline 和 permit 清理继续使用真实时间。

[准备决策](2026-09-29-company-initial-preparation.zh.md) 独立负责初始拓扑与首个检查点。[产品提案](../../proposed/architecture/2026-09-28-web-team-simulation-product-integration.zh.md) 继续负责Web／SDK 控制、冷 owner 恢复、ingress 及自动任务。两者均未被完全替代。

[持久创建决策](2026-09-29-persistent-company-creation.zh.md)定义公开分配、原请求结果及 paused 准备句柄；本记录保留其独立规则。

受信任 `driver.tasks` 选择模型或确定性库存任务，并显式配置 lease、尝试次数和重试策略。转移阶段变为一次已受理 `task/create` 与规范 attempt；任务输入、已应用库存证据及目标完成分别保留。产品 owner 安装／移除场景策略并提供规范 reader。恢复遵循[任务完成决策](2026-09-30-simulation-task-completion.zh.md)：退休的效果前工作创建新 attempt，原转移已应用时则以新记录输入受理无提案 continuation 确认。已关闭承诺事实不变，旧失败 attempt 保留，原效果不能再次提出。未来事件沿用有界 driver／周期推进。目录及 Web 表单显示 Host 选择的任务模式。

## Alternatives considered

**只改变 phase。** 这不能提名认知、安置 actor 或协调传输。

**完成响应丢失后重建决策。** 这会重复推理并丢失原 wake 与窗口身份。

**把发布或自动履约当作报告完成。** 发布不代表接收方 wake 已被收集；结果报告要求自身已应用操作与确认。

**无批次额度地轮询未完成工作。** 这会把空闲／阻塞／重试变成忙轮询及无界 HTTP 工作。

## Consequences

Driver 实现一个受信任采购协议，提供有界 Host 能力。调用者通过创建 owner 提供持久产品创建和命令／结果 API，而产品行政 owner 为已持有创建提供受配置控制的后台周期；它不提供公开模板目录；可选任务模式使用规范 executor 和场景策略。Running phase、driver 停止、驻留及模型占用仍是独立事实。拒绝或缺失的必要效果阻塞场景，不猜测进展。

## Verification

Source-plane 原生 owner 测试覆盖完整采购、当前／未来传输重试、驻留要求、输入顺序、提交前／后暂停、live 响应重试、其他窗口／上下文、缺失检查点、拒绝／缺失效果及排空时序。Driver 每文件覆盖率为 100%。真实 Loader snapshot 仅脚本化外部模型，限制为三个 scoped 工具，验证 JSON／SQLite 采购、单驻留驱逐、三个进程中断点、冷后缀恢复、原已接受效果及完成重试不推理。Snapshot 从已准入请求固定模型可见阶段指令。

真实产品任务 Loader 场景覆盖 JSON／SQLite、模型／确定性任务认知、后台调度及九个跨所有者进程退出点，核对一个任务和一次转移、新输入／epoch 的 continuation、失败保留、目标回执对账及最终完整检查点。组装的 Web 流程显示已安装模式并产生真实完成任务，不暴露通用 Team 执行。
