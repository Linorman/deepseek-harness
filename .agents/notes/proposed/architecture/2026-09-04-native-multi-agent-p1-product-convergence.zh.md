# Agent Note: 原生 multi-agent P1 产品收敛

Status: proposed

[English](2026-09-04-native-multi-agent-p1-product-convergence.md) | 中文

## 问题

[原生多 agent 工作系统提案](2026-08-27-native-multi-agent-work-system.zh.md)已经有广泛的本地实现，但正式产品仍公开固定的 local coordinator／worker topology，而不是完整 Team model。Child-Team delegation 没有 Consumer，direct channel 仍是 single-recipient 或准确 two-party，channel invitation 尚未持久化，产品 task creation 只能解析 local worker pool，shared work 不记录 undeclared filesystem change，remote recovery 只支持 same-host，Team page 大体只读，legacy orchestration 仍存在于 public catalog，最终 browser、performance、distributed、SDK 与 release evidence 也不完整。

[P0 安全闭环 specification](2026-09-04-native-multi-agent-p0-safety-closure.zh.md)会让 human mutation、lifecycle recovery、channel implementation 和 model-visible channel view 具备安全保证。P1 必须在这些 P0 保证上构建剩余产品行为，不能引入第二条 orchestration path，也不能削弱 fail-closed remote cancellation。

## 提案

通过一个按依赖排序的 P1 stack，把稳定 Team 主干转变为唯一完整的正式 work model。P1 会新增 child-Team delegation、direct multicast 与 channel admission、通用 task placement 与 cancellation、shared-workspace observation、multi-host supervision 与 human delivery、authenticated Team UI mutation、literal legacy cutover、可衡量 performance budget 和最终 promotion evidence。

P1 拥有以下稳定 requirement id：

| Requirement | 结果 |
|---|---|
| `P1-CHILD` | Coordinator 或 authorized human 可以把 parent task 委托给有界 child Team，其 authority、budget、result 与 cancellation 保持持久关联。 |
| `P1-DIRECT` | 正式 direct protocol 支持 explicit nonempty recipient subset 与 `null` broadcast，且没有 automatic reply；`final` 仍是准确 two-party communication。 |
| `P1-ADMISSION` | Channel invitation、acknowledgement、activation、expiry 与 failure 是 durable protocol fact，而不是立即执行的 `opened -> active` shortcut。 |
| `P1-SCHEDULE` | Default scheduler 与 placement Consumer 会从完整 authorized roster 中确定性选择 local 或 remote participant，并支持 durable running-task cancellation。 |
| `P1-WORKSPACE` | Shared work 会记录有界的 declared 与 undeclared change observation，但不会声称拥有 filesystem lock 或无法证明的 actor attribution。 |
| `P1-REMOTE` | Cross-host activation recovery、external fencing、remote human delivery 与 sandbox-loss settlement 通过单一 authoritative Hub 收敛。 |
| `P1-UI` | Team page 公开 authenticated participant、channel、task、review、artifact、human-action、lifecycle 与 pagination operation。 |
| `P1-LEGACY` | Legacy same-Session Goal、direct subagent、fork 与 script-workflow product control 不再出现在正式 catalog、bundle、snapshot 与 release artifact 中。 |
| `P1-BROWSER` | Real-server browser scenario 与 optimized GIF 覆盖完整 Team management 和 human-action flow。 |
| `P1-PERF` | Reference-runner latency、memory、pagination、queue 与 shutdown budget 会把 bounded design claim 变成 measured release gate。 |
| `P1-PROMOTION` | Distributed fault、keyed model、SDK、coverage、documentation、packed-consumer 与 platform-release evidence 会关闭 parent 的每项 acceptance criterion。 |

### 范围与非目标

P1 保留单一 authoritative Hub 与现有 Agent／Session／agent-loop execution primitive。它不引入 multi-Hub consensus、leader election、transparent federation、exactly-once model 或 tool execution、distributed filesystem lock、automatic Git integration，或由 LLM 选择的 core scheduler。

只有配置的 provider 能证明 external fencing 时，remote hard termination 才可用。缺少该 provider 的 cooperative endpoint 在 cancellation 时保持 durable stall。P1 绝不会仅因 transport disconnect 而报告成功。

### 对 P0 的依赖

只有 `P0-AUTH`、`P0-LIFE`、`P0-LEASE` 与 `P0-VIEW` 通过 cutover gate 后，P1 implementation 才能开始。P1 channel work 会获取 retained implementation lease；UI 与 SDK write 使用 authenticated human proof；child 与 remote lifecycle 复用 restart-safe closure driver；每个 protocol turn 都使用 durable model-view admission。

```text
P0 safety closure
  ├─> direct + channel admission
  ├─> scheduler + placement ─> child Teams
  ├─> workspace observation
  ├─> remote supervision + human delivery
  └─> authenticated Team UI
all P1 capabilities ─> legacy cutover ─> final evidence and promotion
```

### Package 与约定变更

| Package | 必需变更 |
|---|---|
| `packages/core/team` 与 `packages/team/team-hub` | 新增 task execution kind、delegation binding、running-task cancellation fact、channel invitation／ack record、direct-v4 manifest、shared-change observation、remote settlement fact 与对应 proof scope。 |
| `packages/team/team-delegation` | 拥有 parent-task／child-Team saga、source-scoped child creation、result projection、parent charging、cancellation propagation 与 recovery。 |
| `packages/team/team-channel-direct` | 注册 direct v4，提供 subset／broadcast delivery、text／image message 与准确 two-party final restriction。 |
| `packages/team/team-channel-admission` | 邀请 participant、收集 authenticated acknowledgement、激活或使 pending channel 过期，并恢复 unfinished admission。 |
| `packages/team/team-placement-default` | 根据 durable task requirement provision 或 resume eligible local／SDK／ACP participant，且不把 provider logic 放入 scheduler。 |
| `packages/team/team-scheduler-dag` | 对 complete eligible roster 排名，使用 deterministic observed-outcome input，dispatch cancellation，并保留 shared-scope serialization。 |
| Workspace provider 与 `team-agent-client` | 记录 shared change observation、消费 generalized placement／allocation、发布 artifact，并结算 cancellation。 |
| `packages/core/activation-supervisor` | 在 `ctx.activationSupervisors` 定义具名 cross-host fence／health provider。 |
| AgentRuntime 与 supervisor provider | 声明 termination mode、durable recovery descriptor、external fence capability 与准确 terminal proof。 |
| `packages/team/team-human-client` | 持久化 principal-bound human delivery，并在不依赖 process-local `TeamRun` 的情况下确认它们。 |
| Host、SDK、Client runtime 与 `ui-team` | 公开 authenticated paged mutation，并渲染完整 Team interaction model。 |
| Legacy goal／subagent／workflow group | 把保留的 compatibility code 移到 private、renamed explicit composition 后，或在 parity 完成后删除；移除 product catalog 与 release reachability。 |

### Child-Team delegation

#### Durable task model

`TeamTaskSnapshot` 新增一个创建时选择的 immutable execution discriminator：

```text
TeamTaskExecution =
  | { kind: 'participant' }
  | {
      kind: 'child-team'
      templateId: string
      templateVersion: number
      authorityGrant: TeamAuthorityGrant
      budget: TeamResourceBudget
    }
```

Child-Team task 还会保留 delegation projection，其 phase 为 `requested`、`creating`、`active`、`settling` 或 terminal `completed | failed | cancelled | stalled`；其 idempotency key、optional `childTeamId`、observed parent／child cursor、result Envelope／artifact reference，以及准确 failure 或 stall reason 都是 durable fact。Participant task 保留当前 lease path，绝不会获得 child-Team binding。

Child authority grant 与 budget 必须同时是 parent task、remaining parent Team grant 和 human authority 的子集。系统会在 child creation 前检查 `maxTeamDepth`、total child count、live Activation、token、turn、wall-time、cost、retry、concurrency 与 artifact limit。与现有 child usage accounting 一样，pending parent charge 会阻止新的 child work。

`TeamResourceBudget.maxChildTeams` 统计累计接纳的后代身份。每个已接纳 delegation 永久预留一个 child 身份及其冻结的 `maxChildTeams`，取消、终态结算、删除和归档后仍保留额度。有界父 Team 拒绝未明确后代额度的 child。现有父任务日志预留整个子树即可建立祖先上限，无需跨日志计数器；未使用的后代额度也不回收。TeamRun 的可选 `maxChildTeams` Config 在 root 创建时冻结上限；省略时不增加数量上限。

Child template 会 provision 一个代表准确 parent delegation 的 service Participant。Child completion 要求 coordinator result Envelope 只发给该 service Participant，并具有 durable service receipt；它不会伪造 human recipient。Root Team 仍是最终 human-addressed answer 的唯一 owner。

`maxLiveActivations` 统计 Participant 的持久启动预留、所有未确认 quiescence 的 epoch（包括 coordinator、idle 与 stopping）及未结算 child 的冻结 live 额度。controller 在调用 provider 前预留，binding 只能消费准确预留一次。只有未发布启动的已确认清理或 epoch quiescence 才释放本地额度。provider 抛错但未返回句柄时，预留跨重启保留，关闭恢复记录 `ACTIVATION_STARTUP_UNCONFIRMED`；已返回的句柄在清理失败后保留并重试。发行 root 配置 32 个累计后代与 128 个 live slot，支持现有 32-member worker pool 和有界 child fan-out；部署可以覆盖这些 Config 值。

#### Delegation saga

`team-delegation` 拥有 restart-safe cross-stream saga，因为 parent Team journal 与 child Team journal 无法原子提交：

1. 在 task CAS 下提交 parent task 与 `delegation/requested` fact。
2. 铸造一条绑定 parent Team、task、observed parent cursor、complete child payload 与 retry key 的 `TeamSystemChildCreationProof`。
3. 创建或恢复 child Team；child creation 使用 retry key 返回同一个 `TeamId`。
4. 在新 parent revision 下把该 child id 绑定到 parent task。
5. 启动 child template，并且只把它的 explicit parent-service result、terminal failure、artifact 与 usage 投影到 parent settlement。
6. Child Team 到达 terminal phase 且所有 parent charge 提交后，结算 parent task。

Recovery 会修复 request-without-child、child-without-binding、binding-without-start、terminal-child-without-parent-settlement 与 parent-cancel-with-live-child state。它绝不会仅从 hierarchy 发现 ownership，也不会为同一个 delegation key 创建第二个 child。

Coordinator tool owner 新增 `team_task_delegate`；authenticated human 通过同一 Host／SDK task-create schema 使用 `execution.kind: 'child-team'`。模型提供 task intent、bounded requested grant／budget 与 template selection，但绝不提供 parent actor、depth、child id 或 proof。

Parent cancellation 会记录 intent，通过 closure driver 请求 child cancellation，并等待 confirmed child settlement 或 durable remote stall。Child 不能比 archived parent 存活更久，只要存在 nonterminal child delegation，parent archival 就会被拒绝。

### Direct v4 与 channel admission

#### Direct v4

Direct v4 接受至少 2 个不同的 active Participant。Message audience 要么是 `null`，表示 manifest 中除 sender 外的所有 participant；要么是去重、非空且不包含 sender 的 subset。Hub 会在 commit 时把 broadcast 展开为 immutable per-recipient delivery intent。每个 recipient 独立 claim 与 acknowledge；一个 slow 或 failed recipient 不能伪造另一 recipient 的 receipt。

Message 使用 direct-v3 ordered text／image content，并保留 caller-selected `context | turn | steer` intent，且受 policy 约束。Direct v4 没有 automatic reply、speaker selection 或 transcript sharing。`final` 只在准确 two-party product channel 上合法，必须仅发送给 authorized human peer，使用 `turn`，且绝不 broadcast。

正式 Team template 会在一次 pre-release cutover 中迁移到 direct v4。Direct v1-v3 不会被扩大语义。如果 compatibility package 保留它们，它们会在正式 template 与 product catalog 之外使用 explicit adapter version。

#### Durable admission

Opening channel 会在一个 WAL batch 中追加 `channel/opened`、`channel/phase pending` 与每个 required participant 的一条 `channel/invitation`。每项 invitation 会快照 role、visibility、required／optional status、acknowledgement deadline 与 endpoint expectation。Participant 只能通过其 activation proof、authenticated human proof 或 service-owned system proof 进行 acknowledge。

Endpoint 证明自身可以接收该 manifest version 后，Hub 追加 `channel/acknowledged`。只有每项 required acknowledgement 都已持久化，且每条 retained implementation lease 仍有效时，Hub 才会追加 `channel/phase active`。Pending 期间的 send 会被拒绝。错过 deadline 的 optional participant 通过 adapter-authorized transition 移除；缺失 required participant 会以 structured reason 追加 `expired` 或 `failed`。

Admission Consumer 会在 startup 时回放 pending channel，只重新发送 unacknowledged invitation，并应用配置的 bounded deadline。Acknowledgement 表示 endpoint admission，而不是 model execution。Channel close 或 Team cancellation 会在释放 implementation lease 前终止 pending invitation。

### 通用 scheduling、placement 与 task cancellation

#### Placement Consumer

`team-placement-default` 会分离 participant provisioning 与 deterministic assignment。它消费没有 eligible live Activation 的 ready task，根据 task capability、workspace mode、provider／model route、preset 与 budget 过滤 authorized Participant descriptor 和 configured template，然后请求 `ctx.teamActivations` 启动或恢复 selected Participant。它不记录 task lease。只有存在 durable idle binding 后，scheduler 才执行 assignment。

Task creation 可以限制 allowed Participant id、role、AgentRuntime provider、model route、preset 与 workspace mode，但每项限制都必须是 creator grant 的子集。省略 placement constraint 表示使用 Team template 的 frozen default；该 default 在 task creation 时解析一次，不能隐藏在 provider execution 中。

Workflow role resolution 使用相同 roster query 与 placement path，且不硬编码 local default coordinator、worker 或 reviewer。只要不超过 Team 与 workflow bound，多个 worker 与 reviewer 可以并行 active。

#### Deterministic ranking

Scheduler 先按 priority 与 creation order 选择 task，再按以下 immutable tuple 对 eligible owner 排名：

1. 准确 explicit owner proposal；
2. 最小 capability surplus；
3. 最低 current assigned／running load；
4. 对相同 capability set，completed-attempt count 减去 failed、expired、released 与 cancelled attempt 后的最高值；
5. 最低 bounded median task latency bucket；
6. Task 带 cost ceiling 时的最低 frozen cost-rate bucket；
7. 稳定 `ParticipantId` lexical order。

Observed outcome 只来自 Hub-derived durable stats。Missing history 在相同 proven outcome 之后、negative outcome 之前排序，防止 unused Participant 被永久饿死。Ranking 使用 integer count 与 configured bucket，而不是 floating-point score。Team rule 会快照 ranking-policy name 与 version，因此 replay 和 restart 会选择同一 owner。

#### Running-task cancellation

`cancelTask()` 通过 authenticated actor 接受 pending、assigned、running 或 review task。当没有 live provider work 时，pending 与 review task 立即变为 `cancelled`。Assigned 或 running task 会追加 cancellation request，其中包含 actor attribution、reason、task revision、attempt id 与 activation epoch；task 在 owner 报告 `cancelled`、provider 证明 termination，或 lease expiry 记录准确 failed cancellation attempt 前保持 nonterminal。

Task-assignment Link 会投递由 task、attempt、activation 与 Session fence 保护的 cancellation command。Stale acknowledgement 不能取消 replacement attempt。Failed 或 offline endpoint 遵循 retry／reassignment 或 Team stall policy；cancellation 绝不会把 running task 静默返回 pending。

### Shared-workspace change observation

Shared provider 会在 allocation materialize 时记录 bounded baseline version，并在 publish、release request、integration proposal 或配置的 observation pulse 上记录 final version。处于 task `writeScopes` 下的 changed path 分类为 declared，超出这些 scope 的分类为 undeclared，在没有 matching attempt 拥有 allocation 时发生变化的分类为 external-window。系统不会声称哪个 process 或 person 写入了某个 path。

每项 observation 都成为 Team-journal `workspace/observed` fact，其中包含 allocation、task、attempt、base／final content version、排序后的 bounded path summary、truncation count 与 observation time。Audit projection 从该 source record 派生 warning；audit failure 不能回滚 observation。File content 保留在 workspace 或 artifact provider 中，而不是 journal。

Config 会限制 scanned file、hashed byte、recorded path、observation duration 与 optional pulse frequency。超出 bound 会记录 truncated warning，并可根据 policy 阻止 integration，但不会声称 checkout 未变化。Shared write-scope serialization 仍是 scheduler rule，而不是 filesystem lock。

Test 会覆盖 declared Bash 与 generator write、undeclared write、attempt 之间的 change、symlink、deletion、oversized tree、concurrent observation、restart、stale baseline、audit repair 与 target integration fence。

### Multi-host supervision 与 human delivery

#### Activation supervision

每个 AgentRuntime provider 都会声明一种 termination mode：`owned-process`、`externally-fenced` 或 `cooperative`。Durable recovery descriptor 会记录 provider、supervisor name／version、host identity、endpoint identity、可用时的 process 或 sandbox creation identity，以及不含 secret 的 fence generation。Secret 与 live filesystem root 保持为 provider state。

`ctx.activationSupervisors` 解析具名 health 与 fence provider。Supervisor 可以无副作用地验证 descriptor，报告 `reachable | unreachable | terminated | unknown`，并 fence 一个准确 generation。只有 endpoint 无法再以该 Activation 发送、接收、heartbeat、settle 或 integrate Team work 后，它才返回成功。Provider 或 supervisor removal 会阻止新 operation，但允许 admitted fence 结算。

`team-activation-recovery` 会分页读取所有 configured host 上的 unfinished Activation，选择 durable supervisor version，验证其 descriptor，然后在新 epoch 下 cold-resume 同一 Participant／Session，或记录准确 stall。`unknown` 绝不会变成 `offline`。E2B sandbox loss 会把 allocation 与 attempt 记录为 unavailable，发布任何 retained artifact，然后遵循 retry 或 stall policy，且不会重建 expired sandbox。

#### Human delivery

`team-human-client` 会把 authenticated product principal 绑定到其 active human Participant，而不创建 Activation 或 Session。它会持久化 bounded `principal-inbox/<ProductPrincipalId>` stream，其中包含 final Envelope、approval／question request、分配给 human 的 review request 与 lifecycle notice，并保留准确 Team／channel／task provenance 与 rendered content。该 stream 拥有独立 monotonic version、idempotency key 与 display cursor。Inbox append flush 后，Consumer 会写入 channel receipt。Browser 或 SDK display 位于 durable Host admission 下游。

Reconnect 会在 last client cursor 后列出 pending principal inbox page；explicit client acknowledgement 会推进 display cursor，但不用于证明 Team delivery durability。因此 final Team result 可以在 Host restart 后存活，而不依赖 `TeamRun` 保留 process-local final-receipt proof。每次 page read 前都会重新验证 visibility 与 Team membership。Retention 只会移除低于 durable display、Team-audit 与 channel-replay watermark 的 entry；删除或撤销 principal 会阻止读取，但不会重写 historical Team attribution。

同一 provider 通过 P0 one-shot proof 路由 authenticated human response。Response 只携带 action id、cursor 与 typed answer；绝不接收 caller-selected Participant、Session、task 或 reviewer authority。

### 完整 Team product UI

Team page 继续作为 Team、channel、task、artifact、audit 与 principal-inbox owner 的 projection。它不抓取 Session transcript，也不维护 optimistic business-state copy。

Page 新增：

- 带 grant-aware disabled state 的 participant invitation、activation、removal 与 interrupt control；
- channel create、participant／audience selection、post、close、pending-invitation 与 delivery status view；
- task create／edit、dependency 与 workspace selection、owner proposal、cancellation、attempt history 与 child-Team navigation；
- human-reviewed task 的 reviewer accept／rework control；
- 通过 authenticated human-action owner 路由的 approval 与 question response control；
- artifact preview／download 与 explicit integration proposal／result view；
- lifecycle resume、cancel、archive、stall diagnostic、budget use 与 remote termination status；
- Team、member、task、channel、channel record、audit entry、artifact 与 principal inbox record 的 bounded `Load more` control。

每项 mutation 都会发送 current cursor 或 revision 以及 idempotency key。Conflict 会刷新 authoritative projection、保留 unsent form input，并解释发生变化的 subject。Cancellation 只会中止 local request，除非 mutation 已经提交。Loading、empty、denied、stale、offline、partial、retryable、terminal 与 provider-unavailable state 都有显式 UI coverage。

Participant selection 只在 Session 存在时打开 descendant Session。Human、service 与 offline remote Participant 仍可检查，而不会伪造 Session。Accessibility test 覆盖 name、focus restoration、keyboard operation、live status announcement、error association、reduced motion 与 non-color state distinction。

Real-server Playwright scenario 覆盖 default Team、multiple worker、participant review、child delegation、broadcast delivery、remote disconnect、approval／question response、pagination、artifact read、cancellation stall、resume 与 archive。每项 product-visible flow 都从真实 server 与 model／replay path 录制所需的 optimized GIF。

### Legacy product cutover

P1 执行 parent proposal 要求的 literal cutover。Default bundle、generated tool／config catalog、app snapshot、SDK runtime carrier、packed Clocky release 与 public product doc 不再包含 same-Session Goal scheduler、direct subagent／fork tool、private child report／control tool 或 model-written JavaScript workflow tool。

移除前，source 与 built-artifact scanner 会枚举每项 import、config row、generated entry、snapshot、package dependency 与 runtime tool name。Replacement Team snapshot 会覆盖产品仍承诺的每项行为。

存在 current explicit consumer 的 compatibility code 会移入 private `packages/compat/` group，获得 `@clocky/clocky-compat-*` package name 与 `legacy_*` tool name，并排除在 release-family discovery 和 generated product catalog 外。Example 通过自己的 `cordis.yml` opt in。没有 current consumer 的 code 会被删除。Compatibility package 不能注册正式 Team tool name，也不能变更 Team authority。

最后一个 direct subagent consumer 迁移后，`origin: 'subagent'` 与 `delegationDepth` 会离开 core product Session header。保留的 compatibility implementation 会在自己的 versioned descriptor event 中存储 lineage classification 与 depth；`parentSession` 仅保留 fork-seed lineage。旧 pre-release Session header 按现有 format-zero policy 拒绝。

Package map、architecture extension table、subsystem reference、user doc、generated catalog、example 与 active Agent Note 会一起更新。只要 implemented subagent、workflow 与 same-Session Goal Note 的 rationale 仍约束 compatibility code，它们就保持 active；只有 `P1-7` cutover diff 证明其 production reachability 已消失后，archive workflow 才会重新分类它们。

### Performance 与 release evidence

#### Reference budget

SQLite reference lane 在 dedicated Linux x64 release runner 上运行，使用 `recoveryPageSize: 32` 与 `checkpointEvery: 32`。它执行 3 个 sample，对 median 设门禁，并保留 individual diagnostic。

| Scenario | Budget |
|---|---|
| 4,096-record default WAL restart 到 first 32-record page | 最多 5 秒，RSS 增长不超过 128 MiB |
| 完整有序枚举 4,096-record WAL | 最多 30 秒 |
| 16,384-record release WAL restart 到 first page | 最多 10 秒，RSS 增长不超过 384 MiB |
| 完整有序枚举 16,384-record WAL | 最多 180 秒 |
| 10,000 pending delivery、64 active Activation 与 1,000 task | page 不超过 configured limit，queue 不超过 configured high-water mark |
| 所有 test provider acknowledge 后取消并 shutdown large Team | 最多 10 秒 |

Wall-time budget 只在 reference runner 上评估；deterministic page、checkpoint、queue、retained-object 与 allocation counter 在每个平台运行。超出 budget 的 regression 会使 release lane 失败，而不会静默更新 baseline。变更 budget 需要新 decision，或用 measurement 与 resource trade-off 更新本 proposal。

#### Promotion evidence

最终 promotion run 包含：

- direct、review、workflow、child、cancellation 与 recovery path 的 keyless assembled Headless、Web、ACP 与 JSON-RPC snapshot；
- 带 filesystem 与 artifact assertion 的 keyed local coordinator／worker／reviewer 和 workflow fan-out／fan-in run；
- 带 restart、duplicate、out-of-order、slow-consumer、revoked credential 与 cancellation fault 的 SDK、ACP、WebSocket、E2B 与 human-client remote run；
- real-browser Team management scenario 与附加的 optimized GIF；
- TypeScript 与 Python SDK contract、expected-output、bundled-runtime 和 shutdown suite；
- JSON／SQLite storage conformance、model-based state machine、property test、race／fault suite 与 performance budget；
- build、typecheck、lint、duplication、coverage、hygiene、snapshot、`doc-sync`、website build、release verification、pack 与 isolated consumer installation；
- canonical Clocky、vendor、native 与 Python artifact 的 Linux、macOS 与 Windows release workflow result。

只有每项 acceptance criterion 都命名其 owning test、workflow 或 generated artifact，且完整 outgoing diff 通过仓库 pre-push policy 后，parent proposal 才会移入 `implemented/`。

### Durable 与 wire migration

P1 会为 task execution、delegation、cancellation、workspace observation、supervisor descriptor 与 principal inbox reference 提升 Team journal／checkpoint version。Channel WAL／checkpoint version 会因 invitation、acknowledgement、direct v4 与 human delivery receipt 而提升。Link frame 只会为跨越该 transport 的新 cancellation、invitation 或 human-delivery operation 提升版本。

Host Remote、generated Typert schema、TypeScript SDK model、Python model、browser runtime contract、fixture 与 expected output 会与各自 owning format 原子更新。旧 pre-release stream 会快速失败；不会交付 converter、dual reader 或 hidden legacy mode。

### 交付计划

| Item | 依赖 | 交付内容 | 退出条件 |
|---|---|---|---|
| `P1-0` Contract lock | P0 complete | 初始失败的 direct／admission、placement、child、workspace、remote、UI、legacy 与 performance fixture | 每项 P1 acceptance path 都有具名 initial failure 与 owner。 |
| `P1-1` Direct 与 admission | `P1-0` | Direct v4、invitation／ack、pending recovery、per-recipient delivery、template cutover | Broadcast 与 pending-channel restart 通过，且没有 automatic reply 或 lost receipt。 |
| `P1-2` Placement 与 cancellation | `P1-0` | Default placement Consumer、full roster filter、deterministic outcome ranking、running cancellation | Local／SDK／ACP multi-worker task 在相同 task semantics 下 assign 与 cancel。 |
| `P1-3` Child Team | `P1-2` | Task execution union、delegation Consumer／saga、child result／charge／cancel recovery、tool 与 API | Kill-point test 为每个 delegation key 结算一个 child 与一个 parent result。 |
| `P1-4` Workspace observation | `P1-0` | Baseline／final version、`workspace/observed`、audit warning、integration policy | Declared、undeclared、truncated、restart 与 audit-repair case 持久且有界。 |
| `P1-5` Multi-host runtime | `P1-1`、`P1-2`、`P1-3` | Supervisor seam／provider、cross-host recovery、human client、E2B loss、external fencer | Remote work 通过准确 evidence terminate、resume、retry 或 stall；disconnect 本身绝不结算它。 |
| `P1-6` Team UI | `P1-1`–`P1-5` | Authenticated mutation pane、human action、pagination、nested／remote state、accessibility | Real-server browser test 完成每项 Team management flow。 |
| `P1-7` Legacy cutover | `P1-3`、`P1-6` | Source／artifact inventory、private renamed compatibility 或 deletion、catalog／bundle／docs cleanup | Shipped source、catalog、snapshot 与 packed artifact 不包含 legacy product control。 |
| `P1-8` Performance 与 promotion | `P1-1`–`P1-7` | Reference budget、keyed／distributed／browser／GIF／SDK／release evidence、final docs | 每项 parent acceptance criterion 都有 passing named evidence，parent Note 可以移入 `implemented/`。 |

### Verification matrix

| 范围 | 必需证据 |
|---|---|
| Direct 与 admission | Multi-recipient subset、broadcast、final restriction、independent receipt、pending invite replay、optional／required timeout、cancellation、HMR lease retention。 |
| Scheduling | Full roster filter、explicit proposal、capability、load、outcome、latency／cost bucket、stable tie、concurrent fan-out／fan-in、shared conflict、remote placement。 |
| Task cancellation | Pending／review immediate cancel、assigned／running request、stale epoch、owner acknowledgement、lease expiry、reassignment policy、Team cancellation race。 |
| Child Team | Grant／budget／depth denial、每个 saga kill point、duplicate retry、parent／child restart、usage charge repair、result／artifact projection、cancellation 与 archive fence。 |
| Workspace | Declared 与 undeclared path、no-owner window、bound、symlink／delete、concurrent scan、restart、audit failure／repair、policy-denied integration。 |
| Remote | Two-host-capable transport、supervisor validation／fence、cooperative stall、hard termination、credential rotation、Hub restart、sandbox expiry、slow consumer、duplicate／out-of-order frame。 |
| Human 与 UI | Principal inbox durability、final receipt、approval／question／review response、每项 mutation state、pagination、accessibility、real-server screenshot 与 GIF。 |
| Legacy | Source、config、catalog、snapshot、dependency、generated output、package 与 packed-artifact absence scan，加 explicit compatibility composition smoke。 |
| Performance 与 release | Reference budget、逐文件 coverage、两个 SDK carrier、全部 repository gate、platform release workflow、isolated consumer install、final acceptance map。 |

### Decision ownership 与 supersession

Parent 原生 multi-agent proposal 仍是 product architecture owner。P0 拥有其 safety closure；本 Note 拥有后续 product convergence。[Team actor-proof control-plane](2026-09-01-team-actor-proof-control-plane.zh.md)以及 implemented closure、channel、scheduler、workspace、artifact、telemetry 与 remote-placement Note 仍是 active foundation，不会被本计划 supersede。

Proposal 阶段没有 implemented Note 符合归档条件。只有 `P1-7` 证明 legacy goal、subagent 与 workflow code 是保留为 private compatibility 还是完全消失后，才会重新分类对应 Note。Archived record 保持冻结。

## 考虑过的替代方案

**把 fixed local coordinator／worker template 保留为完整产品。** 否决，因为它无法公开 first-class remote Participant、multiple worker、human reviewer、child Team 或 task-specific execution world，除非在 Team model 旁增加 special path。

**所有 broadcast 都使用 discussion channel，并保持 direct 不变。** 否决，因为 direct addressing 是通用 peer-message contract，parent proposal 明确要求没有 speaker scheduling 的 subset 与 broadcast semantics。Discussion 仍是 bounded conversation protocol。

**让 coordinator 私下 spawn child Agent，再把 result summary 写入 task。** 否决，因为 child 会缺少 Team identity、grant 与 budget inheritance、channel receipt、restart recovery、human visibility 和 parent cancellation authority。

**把 placement 放进 scheduler。** 否决，因为 provider process creation、Session materialization、credential use 与 fencing 会独立于 deterministic task selection 演进。Placement Consumer 创建 eligible idle binding；scheduler 拥有 assignment CAS。

**把每个 changed shared-workspace path 当作 external writer 的证明。** 否决，因为仅凭 filesystem state 无法区分 Bash、generator、editor 与 unrelated process。P1 会记录 declared、undeclared 与 no-owner-window observation，而不虚构 actor attribution。

**把 disconnected remote endpoint 标记为 offline。** 否决，因为 transport loss 不能证明 process 或 tool termination。Provider 必须提供准确 fence，否则 Team 保持 stalled。

**保留 public legacy package，只在 default bundle 中禁用。** 否决，因为 generated catalog 与 release artifact 仍会呈现第二种 product orchestration model，违反单一 Team product invariant。保留的 compatibility 必须 private、renamed 且显式组合。

**把 browser、performance 与 release check 视为 deployment evidence。** 否决，因为 proposal 会变更正式 UI、persistence、remote lifecycle、SDK 与 package。Architecture record 变为 implemented 前，需要 repository-owned reproducible evidence。

## 验收标准

- P0 acceptance 保持通过，且 P1 path 不会绕过 authenticated human proof、restart-safe closure、implementation lease 或 durable channel view。
- Child-Team delegation 对每个 parent task／idempotency key 最多创建一个 child，执行 depth／grant／budget subset，传播 cancellation，修复每个 cross-stream kill point，并结算一个 durable parent result。
- Direct v4 支持 explicit recipient subset 与 `null` broadcast，并有 independent receipt；final 保持准确 two-party 且不 broadcast。
- 每个 channel 都以带 durable invitation 的 pending 状态开始，只在 required acknowledgement 完成后变为 active，并通过 durable record 到达 expired、failed、closing 或 closed。
- Default placement Consumer 与 scheduler 使用完整 authorized local／remote roster、deterministic versioned ranking、workspace eligibility、budget 与准确 activation fence。
- Pending、assigned、running 与 review task 都有显式 cancellation behavior；stale 或 disconnected owner 不能结算较新的 attempt。
- Shared allocation 会记录 bounded declared、undeclared 与 no-owner-window change observation；audit warning 可以重建，且绝不声称 filesystem lock 或无法证明的 actor。
- Cross-host Agent execution 与 human delivery 可以在 Hub／Host restart 后存活、回放 pending work，并在准确 provider evidence 下 terminate、resume、retry 或 durably stall。
- Team UI 公开完整 authenticated Participant／Channel／Task／review／artifact／human-action／lifecycle model，并提供 bounded pagination 与 accessible conflict／error state。
- Shipped source region、generated catalog、default bundle、SDK carrier、snapshot 与 packed artifact 不公开 standalone Session creation、legacy Goal scheduler、direct subagent／fork control 或 script-workflow child ownership。
- Reference performance budget 在没有 skipped release case 的情况下通过，所有 measured structure 均受 config 限制。
- Keyless、keyed-model、distributed fault、real-browser／GIF、两个 SDK、property／race、coverage、build、hygiene、documentation、website、packed-consumer 与 platform release evidence 全部通过，并命名每项 parent acceptance criterion。
- 只有前述 criteria 全部通过后，parent Note 才会与 shipped reality 对齐、完成 supersession classification，并移入 `implemented/`。

## 风险

- Child-Team cross-stream settlement 可能在 crash 后分歧。Parent request、child creation key、binding、child terminal fact 与 parent settlement 各自幂等，recovery 会处理每个 prefix。
- Direct broadcast 可能放大 token use 与 pending delivery。Team／channel limit、explicit audience policy、durable per-recipient receipt、view bound 与禁止 automatic reply 会限制放大。
- Outcome-aware ranking 可能强化早期噪声。Versioned integer bucket、bounded history、对 missing history 的 neutral treatment、explicit owner proposal 与 deterministic tie 使其可检查。
- Placement Consumer 可能在 assignment 前启动昂贵的 remote capacity。它会在 activation 前预留 Team concurrency 与 cost budget，并通过 activation controller 释放 unassigned epoch。
- Shared-work observation 可能报告合理的 undeclared change。它们是 warning 与 integration input，不是 lock 或 misconduct proof；准确 path bound 使其可评审。
- External fencing 会扩大 deployment security boundary。Supervisor credential 保持 provider-owned，每个 descriptor 与 generation 都准确；fence 不可用时会 stall，而不是猜测 termination。
- 完整 Team UI 会产生大量 mutation race。每项 action 都由 cursor／revision fence 保护，state 保持 server-owned，unsent user input 会在 conflict refresh 后保留。
- Literal legacy cutover 可能破坏 custom composition。Renamed private compatibility package 保留 current explicit consumer，而 pre-release product 有意不提供 public compatibility promise。
- Fixed performance budget 可能暴露缓慢的 reference hardware 或真实 regression。只有 declared reference runner 对 wall time 设门禁；deterministic bound 在每个平台运行，budget change 需要 measured review。
