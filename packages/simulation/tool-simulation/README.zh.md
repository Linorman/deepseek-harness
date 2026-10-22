# Simulation 决策工具

[English](README.md) | 中文

`resource/reserve` 冻结准确交易、一次性授权和模拟到期时间，不改变账户余额；可用资金扣除全部有效预留。`resource/commit-reservation` 和 `resource/cancel-reservation` 要求原 actor 与预留版本。提交重验账户版本、单位、控制权及授权，并在同一原子批次转账和结算。到期由 Native 调度 deadline 消费；暂停后的墙钟时间不会释放资金。终态历史仍计入必填 `maxResourceReservationHistory` 上限，换新 ID 不能退还额度。这些本地资源动作不负责招聘费用，也不释放跨 owner 的未知 I/O 预留。

stage schema 为已安装且固定版本的领域提供 `world/request`、`world/resolve` 与 `world/evidence`。请求要求已消费的授权 World 上下文，携带 domain/operation/version、business key、期望时间、evidence 与领域 payload；Native 派生主体，并在 acceptance 验证已安装严格 schema 和权限。请求决策只含一个不混合其他动作的逻辑请求。普通请求展开 canonical 私有通知；场景环境请求保留原日历来源。director resolution 携带已安装 apply payload、结构化拒绝或有界补证问题。evidence 答案绑定原 challenge、输入 revision 与已消费通知。生成入职 payload 选择已安装有限 Persona 选项，其他操作保留各自 typed payload。私有 rationale 不作为公开描述。submit 返回效果待执行，不在执行前宣称业务成功。工具不开放世界配置、身份分配、维护、任意 patch 或执行器入口。

`simulation_observe` 只返回当前决策冻结的已授权分节。`simulation_stage` 替换完整提案列表，不产生世界效果。其描述要求模型提交已经确定的暂存列表，而不是反复暂存同一列表。`simulation_submit` 将窗口提案持久记录为 `submitted`，或接受串行决策，然后结束回合。已提交提案等待有序接受；已接受操作 id 等待执行。 模型可见的 stage schema 包含参与者执行的 `task/create` 与 `task-completed` 履约策略；创建者和 Team 身份来自当前决策，不由提案字段指定。

`simulation-team` 从实际 Agent 及其已消费的准备输入推导 run、实体、writer 和决策。其执行守卫拒绝 Simulation 角色调用其他工具。暂存只属于当前 writer epoch。writer 替换会取消未接受决策；已收集的窗口提案保留在 run 历史中。已接受决策及操作独立于旧 writer 保留。

作用域 `@clocky/clocky-tool-simulation/role` 入口在角色预设内登记三种原生 Simulation 工具，并在 agent 加入时限制继承能力，强制原生展示。它在 actor 自有工具后来登记时仍过滤最终装配请求 schema。标准 Web 不在全局工具目录登记这些能力。原生模型 owner 在分发或 token 准入前独立拒绝决策权限之外的公开能力，执行 guard 仍拒绝外部工具调用。先加载基础工具及 system-prompt owner。[公司 preset](../../../examples/simulation-company/presets/simulation/agent.cordis.yml)提供完整 Simulation persona，不包含文件系统变量或无关运行时上下文。新建及恢复激活均经 `agent.preset` 选择此 preset。

对于固定 `bounded-v1` 的 World，`simulation_observe` 默认返回当前上下文的 inputId/hash 引用及空 sections；`detail: full` 才重发完整正文。当前完整上下文已作为可重放 Session 事件提供给模型。招聘请求在 stage 时要求 `expectedTime: null` 和空 evidence，Native 准入仍会独立校验。

`simulation_observe` 支持 `sections: ["input", "authority"]` 按冻结章节读取，与 `detail: full` 互斥；无效、空或重复选择会拒绝，不会暴露其他章节。`simulation_submit` 仅在当前结果决策中接受 `notification: {resultId}`，由宿主解析精确 Native 通知，避免让模型复写 JSON。此路径仍校验上下文消费，不能提交其他结果或覆盖冲突的已暂存提案。规范上下文错误会以持久内部诊断停止推理，不要求模型反复重试。

`communication/post.recipient` 是模拟 Entity ID，不是 Team Participant ID。使用已记录的 `replyTarget` 人物与通道映射。收件人绑定或发送时间无效时会在暂存阶段拒绝，允许在提交结束本轮前纠正；Native 最终接纳仍会独立复查相同前提。

暂存按照当前冻结上下文授权的精确领域版本，预检请求和 apply 计划的 payload；不分配请求或执行租约。替换失败保留此前有效暂存。诊断最多返回八个字段路径，每项最多八个允许值，不回显模型提交的私密正文。修正后的提交仍需通过 Native 的权限、时序和业务校验。

## Model Experience

### Simulation 决策

#### What the model sees

`simulation_observe`、`simulation_stage` 和 `simulation_submit` 分别提供授权观察、完整提案替换和提交。结果区分暂存、提交与接受，不在执行前宣称世界效果成功。卡片使用通用读取/操作展示，没有文件位置。

#### Token effect

工具 schema 和请求的观察内容消耗 token。观察只重复已存储的选中分节，不检索隐藏世界状态。

#### KV Cache effect

工具结果追加到 Session，不替换既有历史或改变已准备的上下文前缀。

## Known Limitations and Deferred Work

- 重试上下文与知识选择仍由调用方拥有；工具不重放先前提案。
