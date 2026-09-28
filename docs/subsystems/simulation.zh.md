# Simulation

[English](simulation.md) | 中文

Simulation run 具有具名提供方、稳定的 `SimulationRunId`，以及包含时钟与规则/策略版本的持久化 `SimulationRunSpec`。`SimTime` 是规范的非负十进制字符串。`SimulationSnapshot` 包含精确的规格、日志 revision、管理状态、实体和组织关系。Entity 的 kind/cognition 保持稳定，profile 单独记录 revision，终止状态不可逆。关系规则约束端点类型、明确允许的组织作用域类型，以及同一作用域内在同一模拟时刻成立的环；有效期采用半开区间。`SimulationRun` 句柄拥有校验 revision 的状态写入和排空关闭操作；单独的运行状态不会执行模型或业务工作。

`SimulationEntitySnapshot` 包含 `runId`、全局 `revision` 和可选的独立 `entity`。`SimulationRun.inspectEntity(id)` 读取该观察，不复制其他实体、决策或历史。未知身份不包含实体；权限消费方在策略等待后重新读取。

[注册表](../../packages/simulation/simulation/README.zh.md)定义提供方选择。[本地提供方](../../packages/simulation/simulation-local/README.zh.md)拥有专用存储、严格重放和同宿主协调器排他控制。[协同设计与状态](../../.agents/notes/proposed/architecture/2026-09-17-durable-simulation-coordination.zh.md)涵盖 Entity 写入者、Team 集成、调度和业务效果。

闲置角色可在排空已受理投递、完成 Session 检查点后，通过精确的控制器所属激活休眠。恢复保留规范 Session，并在下一决策前恢复待处理输入。清理失败时保留 writer 与容量。

`SimulationRun.population()` 报告未终止实体和已占用 writer 额度。持久的 `maxEntities` 与 `maxResidentActors` 限制在实体创建和运行时预留之前生效；revoked writer 保留额度直到释放。

`ctx.simulationTeams.modelUsage()` 报告服务级模型许可与有界 FIFO 等待者。请求取消不提前释放许可，需等流清理完成；等待请求在派发前复核 writer 与已记录上下文。

`ctx.simulationTeams` 将一个 run 连接到规范执行 Team。`SimulationSnapshot.channelReservations` 保留配置的 direct 频道身份、成员与确认状态；未确认的预留会阻止执行。`SimulationEntity.participantReservation` 在 Team IO 前保存角色配置与规范 Participant/Session 身份。`SimulationTeamConnection` 创建该成员、绑定预留 Session、激活实体并协调本地恢复。`SimulationWriterLease` 为控制器携带一个 epoch 范围内的启用/撤销/释放能力；未结算 writer 会保留 run 所有权锁。[控制器生命周期接口](../../packages/team/team-activation-controller/src/lifecycle.ts)定义不可变 Team 规则选择的可信回调。

`SimulationWindow` 固定共享 run revision、有序决策及其已准备上下文。`submitted` 决策保留提案而不创建操作意图；有序接受先于窗口关闭和世界执行。`maxDecisionsPerWindow` 限制准入角色数。决策的 `inference` 保留现实时间的开始、截止及完成或过期时间；`decisionTimeoutMs` 在创建 run 时固定预算。超时取消未完成 slot，不取消已经提交的提案。

决策在接受提案前固定输入游标和 writer epoch。接受记录与全部初始意图一同提交。`executeOperation()` 按 slot/index 顺序执行守恒资源转移及精确的一次性授权；重试返回原结果。交互分别保存回复和执行状态，承诺必须以世界转移证据或债权方明确确认兑现。

`SimulationIngress` 保留请求、接收序号、事件身份、已分配键与日志序列。消费后创建接收者 wake；对应决策保留 `ingressId`。上下文准备将精确正文作为必需输入，并附带有作用域的 run-event 引用。暂停或接收更多输入不会改变既有窗口 view。

资源冲突与失败结果原子保留 `conflict-retry` 事件或重试耗尽标记。重试决策通过已消费 wake 继承根决策与次数。耗尽需确认后再显式恢复，不返还已消耗的重试预算。

调度事件保留原有排序键与终态历史。已消费 wake 是持久责任，与 Session 输入消费相互独立。defer 回复和期限事件与业务状态转移在同一批次生成队列记录。`drive()` 在等待决策、达到配置工作上限、暂停或发生类型化 microstep 停滞时停止。

`SimulationTeamTransport` 是可信的幂等发布能力。Outbox 尝试独立于模拟时间保存现实时间戳，回执除操作 id、指纹和频道外，还保留 run、Team、接收者及精确 Envelope 序号。检查点收集与恢复根据对应 Envelope 或不可变任务创建记录核对已应用目标。未知结果保留意图，预算耗尽后需要显式决定新的重试预算。发布不等于接收者持久化，也不等于业务接受。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxsimulations--simulations"></a>

### `ctx.simulations` — `Simulations`

Registry whose providers own run IO and exclusive coordinator lifetimes.

```ts cordis-catalog
/**
 * Register an implementation.
 * @param provider - Named implementation.
 * @returns effect-scoped disposer.
 */
registerProvider(provider: SimulationProvider): () => void

/**
 * Validate explicit selection before IO.
 * @param request - Run request.
 * @returns resolved selection.
 */
resolve(request: SimulationRunRequest): SimulationRunSelection

/**
 * Open a resolved run.
 * @param selection - Explicit provider and run configuration.
 * @returns caller-owned run.
 */
open(selection: SimulationRunSelection): Promise<SimulationRun>
```

Source: [`packages/simulation/simulation/src/index.ts`](../../packages/simulation/simulation/src/index.ts)

<a id="ctxsimulationteams--simulationteams"></a>

### `ctx.simulationTeams` — `SimulationTeams`

Named run attachments using durable Team rules to prevent controller bypass.

```ts cordis-catalog
/**
 * Open an existing run, verify a completed manifest and every retained owner suffix, then retire old writers.
 * @param selection - Exact existing run configuration; create mode rejects.
 * @param request - Completed checkpoint id, required implementation version and owner-movement retry bound.
 * @param signal - Optional cancellation; admitted controller cleanup is still drained.
 * @returns caller-owned run and connection, paused without model calls or outbox effects. Repeated restores
 * revalidate current retained suffixes; they never roll state back to the checkpoint. Retired decision windows
 * close only after every slot is accepted or cancelled; restoration never accepts a submitted proposal.
 */
restore(selection: import('@clocky/clocky-simulation').SimulationRunSelection, request: import('@clocky/clocky-simulation').SimulationCheckpointRestoreRequest, signal?: AbortSignal): Promise<import('./types.ts').SimulationCheckpointRestoration>

/**
 * Inspect host-local Simulation model admission across all attached runs.
 * @returns reserved/executing permits, queued requests and their configured limits.
 */
modelUsage(): { readonly active: number; readonly queued: number; readonly limit: number; readonly queueLimit: number }

/**
 * Create or reconcile the run's canonical execution Team before attaching its lifecycle owner.
 * @param run - Open, unattached run whose root identity is journal-owned.
 * @param creation - Explicit Team goal, budgets and optional authority grant.
 * @param ownerName - Immutable lifecycle owner used by the subsequent attachment.
 * @returns the confirmed Team; target response loss reuses the reserved identity.
 */
ensureTeam(run: SimulationRun, creation: Omit<import('@clocky/clocky-team').TeamRootCreateInput, 'rules'>, ownerName: string): Promise<import('@clocky/clocky-team').TeamStateSnapshot>

/**
 * Register a versioned pure summary policy over explicitly selected authorized knowledge.
 * @param policy - Bounded synchronous, IO-free transformation; ambient histories must not be read.
 * @returns effect-scoped disposer; retained summaries do not depend on the implementation remaining loaded.
 */
registerSummaryPolicy(policy: import('@clocky/clocky-simulation').SimulationSummaryPolicy): () => void

/**
 * Register an effect-scoped pure computation policy; duplicate ids reject even across versions.
 * @param policy - Explicit identity/version and bounded synchronous computation over a frozen authorized view.
 * @returns disposer stopping new computation; already recorded outputs remain durable.
 */
registerDeterministicPolicy(policy: import('@clocky/clocky-simulation').SimulationDeterministicPolicy): () => void

/**
 * Execute a model operation using its actual current Agent identity.
 * @param agent - Registry-owned local caller, supplied by tool execution.
 * @param request - Observation, replacement proposals or submission without caller-selected identities.
 * @param signal - Calling tool cancellation.
 * @returns authorized observations or proposal acknowledgement, never fabricated world results.
 */
modelRequest(agent: Agent, request: SimulationModelRequest, signal: AbortSignal): Promise<SimulationModelResult>

/**
 * Attach one run to a dedicated Team whose immutable activationLifecycleOwner rule names this owner.
 * @param run - Caller-owned open run.
 * @param teamId - Canonical Team selected by the deployment.
 * @param ownerName - Exact durable rule value, unique in this controller.
 * @returns a connection that derives entity identity and drains activation ownership on close.
 */
async attach(run: SimulationRun, teamId: TeamId, ownerName: string): Promise<SimulationTeamConnection>
```

Types: [Agent](core.zh.md) · [TeamId](team.zh.md) · [TeamRootCreateInput](team.zh.md) · [TeamStateSnapshot](team.zh.md)

Source: [`packages/simulation/simulation-team/src/index.ts`](../../packages/simulation/simulation-team/src/index.ts)

<a id="simulation-events"></a>

### `simulation/*` events

<a id="simulationcommitted--emit"></a>

#### `simulation/committed` — emit

Projection published after the matching journal append or replay. The run may contain several independently bound Sessions.

```ts cordis-catalog
/**
 * Projection published after the matching journal append or replay.
 * The run may contain several independently bound Sessions.
 * @mode emit
 * @param snapshot - Committed detached projection.
 * @param durableTail - Tail returned by storage.
 * @param previousRevision - Tail before this append; absent for initial replay publication.
 */
'simulation/committed'(snapshot: SimulationSnapshot, durableTail: number, previousRevision?: number): void
```

Source: [`packages/simulation/simulation-local/src/index.ts`](../../packages/simulation/simulation-local/src/index.ts)
<!-- END GENERATED cordis-surface -->
