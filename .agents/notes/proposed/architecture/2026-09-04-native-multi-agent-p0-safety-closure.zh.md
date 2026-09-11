# Agent Note: 原生 multi-agent P0 安全闭环

Status: proposed

[English](2026-09-04-native-multi-agent-p0-safety-closure.md) | 中文

## 问题

[原生多 agent 工作系统提案](2026-08-27-native-multi-agent-work-system.zh.md)已经具备稳定的本地 Team 基础，但仍有 4 个未解决边界可能违反其安全、持久性或模型输入重建保证。产品 Team 变更没有经过认证的人类 principal，Team 关闭依赖单个进程内 `TeamRun`，active channel 不会在提供方移除后保留适配器或工作流扩展实现，非 direct channel 轮次则以一条临时拼装的 `TeamEnvelopeSource` 消息进入 Session，而不是精确、带版本的 channel view。

这些缺口会阻断安全的产品写入、重启收敛、HMR（热模块替换）安全的协议执行，以及「每项 Team 派生的模型输入都能从 Session 日志重建」的规则。P1 产品扩展不得建立在这些未解决边界上。

## 提案

通过一个 P0 stack 建立经过认证的产品 principal、可跨重启的生命周期结算、保留的 channel 实现租约，以及持久的非 direct channel view。P0 会原子更新相关预发布持久格式和协议格式，拒绝旧格式，并在 P1 开放更广泛的 participant、channel、scheduler 或 UI 行为前达到逐文件覆盖率要求。

P0 拥有以下稳定 requirement id：

| Requirement | 结果 |
|---|---|
| `P0-AUTH` | 每项 Host 或 SDK Team 变更都从经过认证的产品 principal 派生一条人类 `TeamActorProof`；协议 payload 不提供 actor identity 或 proof。 |
| `P0-LIFE` | 已接收的 completion、failure、cancellation、missing-final 和 budget-expiry fact 都能在重启后收敛，不依赖进程内 `TeamRun` credential。 |
| `P0-LEASE` | active channel 会保留其准确的适配器、view policy 与工作流扩展实现，直至终态释放；retirement 只阻止新的使用。 |
| `P0-VIEW` | 每个 consult、discussion、workflow 和 review 轮次都会先记录为精确的 `team/channel-view` Session surface event，再提交 delivery receipt。 |
| `P0-GATE` | 变更涉及的 runtime、Host、SDK 与 provider 文件通过各自的逐文件覆盖率、snapshot、文档和 packed-consumer 检查。 |

### 范围与非目标

P0 为单一 authoritative Hub 开放已认证的变更与生命周期恢复。它不新增 multi-Hub consensus、federation、remote hard-kill authority、child Team、direct broadcast、通用 placement 或最终 Team 管理 UI。这些内容归[原生多 agent P1 产品收敛 specification](2026-09-04-native-multi-agent-p1-product-convergence.zh.md)所有。

Loopback address check、`trustedHosts`、Team membership、Session header、Participant id 和 Team cursor 都不是认证。P0 保留 [Team actor-proof control-plane](2026-09-01-team-actor-proof-control-plane.zh.md)规则：principal 或 proof source 不可用时必须 fail closed。

### Package 与所有权变更

| Package | 角色 | 必需变更 |
|---|---|---|
| `packages/core/product-principal` | Service Definition | 在 `ctx.productPrincipals` 定义 branded product-principal identity、authenticated-call value、credential-provider registration 和可撤销 provider lease。 |
| `packages/host/product-principal-local` | Service Provider | 提供正式 single-user local principal、轮换 bootstrap credential、digest persistence、browser-cookie binding 与 SDK token validation。 |
| `packages/team/team-human-actor` | Consumer／binder | 将一个经过认证的 principal 映射到准确一个 active human Participant，铸造一次性 operation proof，并在 `ctx.teams` 注册相应的 human proof source。 |
| `packages/client/connection` 与 `packages/host/apiproxy` | Transport Consumer | 在 Team mutation dispatch 前完成认证，并在解析后的 JSON request 之外传递 runtime-only call context。 |
| `packages/sdk/protocol`、`packages/sdk/server` 与两个 SDK client | Transport Consumer | 在初始化期间认证 connection，只为该 connection 保留 principal，并让所有 Team mutation payload 不携带 actor。 |
| `packages/team/team-closure-driver` | Lifecycle Consumer | 恢复已接收的 closure work，驱动 durable stall／failure，并通过 source-scoped system proof 结算 quiescing 或 cancelling Team。 |
| `packages/core/team` 与 `packages/team/team-hub` | Definition 与 Provider | 新增 human proof source、recovery proof family、implementation lease、channel-view claim data、format validation 和 recovery operation。 |
| Channel adapter provider | Service Provider | 返回 model-delivery view，并为 active channel 保留适配器、view policy 与 workflow-extension lease。 |
| `packages/team/team-agent-client` 与 ACP／SDK proxy Session owner | Consumer | 在 acknowledgement 前追加并 flush `team/channel-view`，同时保留 task 与 review fence。 |

`product-principal` 是完整的能力 seam：core package 定义它，local package 提供正式实现，Host／SDK 与 `team-human-actor` 消费它。`packages/identity` 下预留的非认证值不会获得认证行为。

### 经过认证的产品 principal

#### Principal 约定

`ProductPrincipalId` 是独立于 `TeamId`、`ParticipantId` 和 `SessionId` 的 brand。经过认证的 principal 是不可变 runtime data，包含其 id、issuer、subject、assurance class 与 credential generation。只有不含 secret 的 principal id 可以进入持久 Team participant ownership；credential、digest、cookie、bearer value 和 proof object 绝不进入 Team journal、Session event、channel WAL、audit payload、diagnostic、metric label 或 model input。

`ctx.productPrincipals` 通过 Cordis effect 注册具名 provider。认证返回可撤销的 lease，而不是 bare value。Provider removal 会拒绝新认证，并在已接收 call 结算后撤销 live lease。不同 request 不共享 mutable authentication state。

Transport 在完成认证后、RPC payload dispatch 前创建以下 runtime-only call context：

```text
AuthenticatedProductCall {
  principal: ProductPrincipal
  credentialGeneration: number
  signal: AbortSignal
}
```

Call context 是 Host 或 SDK dispatcher 的函数参数，不是 `ClientRequest`、`RpcRequest`、`Team*Input` 或 generated Typert schema 的字段。进程内 test 和 transport 必须提供同一 context，不能用 Participant id 绕过认证。

#### 正式 local provider

Local provider 会在 Harness-owned storage 中持久化一个稳定且不含 secret 的 `ProductPrincipalId`。每次 Host 启动都会轮换 256-bit random bootstrap credential，只存储其 digest 与 generation，并使上一 generation 的 credential 失效。CLI 会把 plaintext credential 写入 owner-only 的临时 `file:` handoff document，并在 URL 或 process argument 中不放置 credential。该 document 只向 loopback-only bootstrap endpoint 提交一次 credential，接收 `HttpOnly`、`SameSite=Strict`、path-scoped session cookie，并在接受、过期或 Web teardown 后删除；Browser 绝不把该值写入 persistence 或 application state log。

每个 unary request、response action、SSE subscription 和 WebSocket upgrade 都会在到达 API handler 前认证 cookie。非 loopback deployment 必须用显式 authentication provider 替换 local provider；`trustedHosts` 仍然只承担 DNS rebinding 与 reachability fence。

SDK initialization handshake 可以携带 connection credential，因为它是 authentication boundary，但后续 Team method 不携带 credential、principal id、作为 actor 的 Participant id 或 proof。Server 会通过配置的 provider 比较 credential，只在 connection 生命周期内保留所得 lease，并在 shutdown 或 transport loss 时释放。TypeScript 与 Python client 通过显式 secret option 或 credential reference 接收 credential，并从 exception 与 process argument 中删去它。

#### Principal 到 Participant 的绑定

Interactive root Team creation 会把经过认证的 principal id 记录为其 human Participant owner。Headless system-owned run 会记录封闭的 system owner，不会伪造 human principal；该 Participant 不能调用 generic human control-plane mutation。加载 current-version Team 时，系统会拒绝缺失或格式错误的 owner，也会拒绝一个 principal 在同一 Team 内重复绑定 active human。

对于每项 mutation，`team-human-actor` 会读取 Team，选择准确一个 owner 等于 authenticated principal id 的 active human Participant，验证该 Participant 的 immutable grant 包含所请求 operation，并铸造一条绑定完整 operation payload 及 observed cursor 或 revision 的一次性 proof。Hub 会在 policy 前解析 proof，在每个相关 Team／channel lock 内重新解析，并且只追加派生的 Participant attribution。Retry 会获得新 proof，并命中现有 idempotency record。

Authentication 证明 product principal；Hub 仍负责执行 Team identity、membership、grant subset、target validity、budget 与 policy。任何一层都不能恢复另一层已经拒绝的 authority。

#### 产品 operation 与 error

P0 只有在每条 route 拥有准确 human-proof scope 后，才重新开放 `team.resume`、detached terminal `team.archive`、Team Goal mutation、participant mutation、ordinary channel lifecycle、channel post、task create/update/cancel/delete/review 和 soft interrupt。Current-run `team.start`、`team.postInput`、`team.waitFinal` 与 `team.cancel` 保留其更窄的 `TeamRun` proof path。

| Error code | 条件 |
|---|---|
| `PRODUCT_AUTH_REQUIRED` | Transport 没有为 protected call 提供 authenticated principal。 |
| `PRODUCT_AUTH_INVALID` | Credential verification、generation、issuer 或 lease validation 失败。 |
| `TEAM_HUMAN_ACTOR_NOT_FOUND` | Principal 在所选 Team 中不拥有 active human Participant。 |
| `TEAM_HUMAN_ACTOR_AMBIGUOUS` | Durable state 把 principal 映射到多个 active human Participant。 |
| `TEAM_HUMAN_ACTOR_FORBIDDEN` | Participant grant 或 Team policy 拒绝所选 operation。 |
| `TEAM_ACTOR_PROOF_INVALID` | Proof forged、revoked、stale、跨 Team、跨 operation，或不匹配其 payload fence。 |

Authentication failure 会在 mutation policy waterfall 或 durable append 前发生。只有在 authenticated actor 和 selected Team 已知时，authorization denial 才保留为 durable audit record；unauthenticated probe 不创建 Team fact。

### 可跨重启的 Team lifecycle 收敛

#### Closure driver authority

`team-closure-driver` 会在 Hub、scheduler、activation controller、Link provider 与 workspace recovery owner 之后挂载到每个正式 Team composition。它只能继续已经持久化的 closure 或 cancellation intent，不能创建 completion intent、选择 final answer、冒充 human、恢复普通 stalled Team，或修改无关 task 与 channel。

Driver 会为以下准确 operation 注册短生命周期 proof source：

| Scope | Durable prerequisite | 允许的 effect |
|---|---|---|
| `closure-recover-complete` | Completion intent 指向一个已获 human receipt 的 coordinator final | 重新运行 quiescence cleanup 并提交 `completed`。 |
| `closure-recover-cancel` | Durable cancellation intent | 继续 attempt interruption／fencing、allocation release、channel close 与 terminal cancellation。 |
| `closure-recover-fail` | Durable failure intent | 释放 owned resource，并在完全停稳后提交 `failed`。 |
| `closure-stall-missing-final` | Current coordinator turn 正常结束但没有 accepted final | 以 `FINAL_ANSWER_MISSING` 提交 `stalled`。 |
| `closure-fail-turn` | Current coordinator turn 以 structured infrastructure 或 model error 结束 | 以准确 terminal code 与 message 提交 `failed`。 |
| `closure-stall-budget` | Frozen wall-time、token、turn、cost、retry 或 concurrency ceiling 阻止后续工作 | 以 typed budget reason 提交 `stalled`。 |

前 3 个 scope 可以从 durable Team／channel fact 重建，因此能够在重启后重新创建。后 3 个 scope 需要触发 fact 的 current observer，并在向产品 caller 返回 error 前追加对应 intent。Recovery 绝不虚构不存在的 trigger。

#### Drive 与 recovery algorithm

每次 drive 使用 bounded Team page，并为每个 Team 使用一个 serializer。它会修复 parent charge 与 audit projection、读取 current closure intent、计算 quiescence，并且只执行下一个幂等 cleanup action。每项 provider action 都会先记录 requested、released、preserved 或 unconfirmed state，再进入下一分支。Cleanup 在每个 ownership level 使用 `Promise.allSettled`，并只在所有 accepted branch 结算后返回一个 aggregate。

Driver 启动时只扫描带 closure／cancellation／failure intent 或处于 `quiescing` phase 的 nonterminal Team。Event listener 会请求合并后的后续 drive；可选的已配置 pulse 会修复遗漏的 process notification。没有可能 producer 的 Team 会获得 durable stall reason。Provider 无法证明终止的 remote epoch 会保持 `stopping`，并以 `REMOTE_CANCELLATION_UNCONFIRMED` stall。

Human resume 是独立的 authenticated operation。只有在没有 terminally committed closure intent，且 provider-specific recovery 能生成有效 coordinator epoch 时，它才能把 recoverable stalled Team 转回 `active`。Completion 与 cancellation recovery 不需要这项更宽的 resume authority。

### 保留的 protocol implementation lease

Adapter、view-policy 与 workflow-extension registration 返回由包含 `accepting` state 和 reference count 的 registry entry 支撑的 retirement handle。Dispose contributing Cordis effect 会设置 `accepting: false`，从 list 与 create resolution 中移除实现，并发出 removal event，但只要仍有 active channel lease 引用它，就会保留准确 object。

Opening 或 recovering channel 会原子获取其 adapter 与 optional view-policy lease。Workflow channel 还会获取 validated graph 引用的每个 versioned condition 与 target extension。WAL attachment 失败会释放所有已获取 lease。Loaded channel 只有在 terminal WAL record 已提交、每个 provider-admitted operation 已 drain，且其 in-memory projection 已 evict 后才释放 lease。

Restart 没有可以继承的 in-memory lease。因此 recovery 必须在接收 channel projection 前找到准确注册的 adapter、view-policy 与 workflow-extension version。缺失 version 会让 startup 或 channel load 快速失败；系统绝不替换为较新实现，也不会启发式关闭 channel。

Hub 会公开 active 与 retired leased implementation 的 process-local count。HMR test 必须证明 retirement 会阻止新 channel，已有 active channel 可以继续 replay 并进入 terminal close，且 implementation 只会在 release 后变得可回收。

### 持久的非 direct channel view

#### Claim result

对于 consult、discussion、workflow 与 review delivery，Hub 会在 channel serializer 内解析 bounded WAL range，并让保留的 adapter／view policy 生成一个纯 model-delivery projection。成功 claim 携带以下 JSON-safe value：

```text
TeamChannelViewSource {
  teamId: TeamId
  channelId: ChannelId
  adapter: { type: string, version: number }
  viewPolicy: { type: string, version: number }
  triggeringEnvelopeId: EnvelopeId
  sourceEnvelopeIds: EnvelopeId[]
  delivery: 'context' | 'turn' | 'steer'
  content: MessageContent[]
  causationId?: EnvelopeId
  taskId?: TeamTaskId
  review?: {
    attemptId: TaskAttemptId
    reviewRevision: number
    reviewerId: ParticipantId
  }
}
```

`sourceEnvelopeIds` 非空、去重、按 WAL sequence 排序，并且终点不晚于 triggering Envelope。`content` 是发送给模型的准确内容。非 direct model delivery 必须配置显式 view policy；缺失会使 channel creation 失败。Summarized view 只能选择 covered range 与 provenance 验证通过的 durable summary record。

Claim 保持 ephemeral，但 acknowledgement 前，上述每个字段都会复制到 `team/channel-view` Session event。`team/channel-view` 是必需的 surface event，它只根据存储的 `content` 派生一条 user-role message；message history 绝不会重新渲染 current channel 或调用 live adapter。Event 会保留 optional review fence，使 `team_task_review` 从 current logged view 派生 revision，而不是接收模型 argument。

Agent Client 会追加 event、等待 `ctx.sessions.flush()`，然后才记录 channel receipt。Redelivery 会在 Session log 中找到相同 triggering/source id，并直接确认而不启动第二次 model turn。ACP proxy Session 与 SDK remote Session 使用相同 event 与顺序。Direct unicast 可以继续使用带 `TeamEnvelopeSource` 的 identified `user/message`；task-assignment start 保留其准确 `TeamTaskAssignmentSource` 与 allocation fence。

View generation 必须受 channel limit、recent-window size 或 durable summary range 限制。只有 manifest 的 hard turn 与 byte bound 能证明完整 rendered value 不超过配置的 model-view limit 时，`full-transcript` 才合法。

### Durable 与 wire versioning

P0 会为 principal ownership、lifecycle recovery fact 和新的 proof-derived attribution 提升 Team journal／checkpoint version；只有 retained model-view 或 implementation identity fact 发生变化时才提升 channel WAL／checkpoint version。Host Remote、generated Typert artifact、SDK protocol schema、TypeScript projection 与 Python model 在同一个 stack item 中更新。

新的 Session event 遵循 `SESSION_FORMAT_VERSION = 0`。Current reader 必须理解 `team/channel-view`；除非 owner 把 event 明确标记为 ignorable，否则包含它的日志会被拒绝，而 P0 不会这样标记，因为它携带完整 model-visible meaning。

不会交付 pre-release converter、fallback reader 或旧 direct-session control path。Test 会创建 current-version fixture，并断言旧 Team／channel value 会快速失败且不会修改 user-owned data。

### 交付计划

P0 stack 按以下顺序落地。每个 item 都会更新或新增其 owning Agent Note，并可独立构建。

| Item | 依赖 | 交付内容 | 退出条件 |
|---|---|---|---|
| `P0-0` Contract lock | 当前 Team 主干 | 为 unauthenticated write、restart closure、retired adapter／extension 和 non-direct view logging 新增初始失败的 fixture；完成 bypass inventory | 每项 P0 mutation 与 recovery path 都有失败的 replacement test。 |
| `P0-1` Product principal seam | `P0-0` | Core registry、local provider、Host／SDK authentication context、secret redaction、root-human principal ownership | Authenticated call 识别准确一个 principal；unauthenticated call 不会到达 Team mutation。 |
| `P0-2` Human actor control plane | `P0-1` | `team-human-actor`、一次性 payload-bound proof、重新开放的 Host／SDK／Goal mutation、denial audit | 每项 enabled mutation 都解析 live proof 两次，且 journal 只记录派生 attribution。 |
| `P0-3` Lifecycle convergence | `P0-1`、`P0-2` | Closure driver、durable missing-final／failure／budget intent、restart scan、aggregate cleanup | Kill-point test 收敛到 completed、failed、cancelled 或准确 durable stall。 |
| `P0-4` Implementation lease | `P0-0` | Retiring registry、channel-held adapter／view／extension lease、restart validation、metrics | HMR 无法破坏 accepted active channel，也不能通过 retired implementation 接纳新 channel。 |
| `P0-5` Channel view | `P0-4` | Claim projection、Session event、Agent Client／ACP／SDK admission、de-duplication、snapshot | 每项 non-direct model input 都能在 receipt 前从 Session log 逐字节复现。 |
| `P0-6` Cutover gate | `P0-2`–`P0-5` | Format bump、generated artifact、focused 与 full check、packed probe、docs | Outgoing stack 通过 P0 acceptance criteria 与逐文件 coverage。 |

### Verification matrix

| 范围 | 必需证据 |
|---|---|
| Authentication | Missing、malformed、rotated、revoked、cross-provider、replayed 与 redacted credential；browser bootstrap；SDK initialize；connection teardown。 |
| Human authority | Multiple human principal、absent／ambiguous ownership、inactive membership、grant denial、policy denial、stale cursor、retry、forged／cross-Team／cross-operation proof。 |
| Lifecycle | 在 JSON 与 SQLite 上，对 intent、final receipt、task settlement、activation stop、workspace release、channel close 与 terminal append 前后执行 fault injection。 |
| Missing final 与 budget | Normal turn end、cancelled turn、structured model failure、无需另一 mutation 的 wall-time expiry、token／turn／cost／retry／concurrency ceiling、explicit human resume。 |
| Lease | Adapter／view／extension retirement 期间的 create、send、replay、checkpoint、summary、close、HMR 与 Hub disposal；restart 后缺失准确 version。 |
| Channel view | Directed／full／recent／summarized policy、consult／discussion／workflow／review、duplicate delivery、flush failure、receipt failure、compaction boundary、ACP proxy、SDK remote Session。 |
| Product composition | Keyless Headless、Web、ACP 与 JSON-RPC snapshot；TypeScript 与 Python expected output；不存在 standalone Session product creation。 |
| Repository | Relevant unit／property／race test、`typecheck`、`lint`、逐文件 `test:coverage`、snapshot、`hygiene`、`doc-sync`、website build 与 packed consumer。 |

### Decision ownership 与 supersession

Parent 原生 multi-agent proposal 仍是 product architecture owner。[Team actor-proof control-plane](2026-09-01-team-actor-proof-control-plane.zh.md)仍是 runtime-only proof 的 security owner；P0 会提供其缺失的 product-principal provider 与 authenticated human Consumer。Implemented closure、direct delivery、channel protocol、Session reconstruction 与 local product-run Note 仍是 active foundation，不会被 supersede。

Proposal 阶段没有 implemented Note 符合归档条件。只有 shipped contract 发生变化时，P0 才会更新各 owning implemented Note；archived record 保持冻结。

## 考虑过的替代方案

**把 loopback 或 `trustedHosts` 当作 human principal。** 否决，因为它们约束 network reachability 与 DNS rebinding，而不证明 user identity 的持有。能够到达同一 authority 的 caller 仍可冒充 Team 的 human Participant。

**在每个 mutation payload 中放入 principal id 或 Team actor token。** 否决，因为 serializable identifier 会成为可回放的 authority，进入 generated wire contract，并且可以跨 Team 复制。Authentication 留在 connection admission，proof 保持 runtime-only。

**持久化 `TeamActorProof`，让 closure 能在重启后恢复。** 否决，因为 proof 是可撤销的 process-local capability。Recovery 从已提交 closure intent 获得狭窄 authority，并且只持久化业务 attribution。

**Adapter provider unload 时关闭其所有 channel。** 否决，因为 unload timing 不是 protocol authority，并可能丢弃已接收消息或 outstanding receipt。Retirement 阻止新使用，而 lease 保留已接收 work。

**下一次 model request 启动时从 live WAL 重新渲染 channel。** 否决，因为后续 Envelope、summary、policy change 或 adapter replacement 可能改变 model input。准确 rendered view 会在 acknowledgement 前成为 durable Session event。

**在同一个 stack 中实现 P1 feature。** 否决，因为更宽的 fan-out、remote placement 与 UI mutation 会增加 P0 所要保护和恢复的 boundary caller 数量。

## 验收标准

- 每项正式 Host 与 SDK Team mutation 要么经过认证并由 proof 授权，要么在 policy 与 persistence 前失败；request 不接受 caller-selected actor identity 或 serialized proof。
- Browser 或 SDK credential 可以 rotate 或 revoke，而不改变 durable principal id；任何 secret 都不会出现在 log、diagnostic、Team stream、Session stream、发送给 Host 的 URL、process argument、snapshot 或 telemetry 中。
- Current-format interactive Team 会把每个 human owner 映射到 branded principal id，system-owned Headless Team 会记录其封闭 system owner，二者都会拒绝 missing 或 ambiguous ownership。
- 已接收的 completion、cancellation 与 failure intent 会在完整 Host process restart 后恢复，并在 terminal Team phase 前结算每个 owned task、Activation、Link、workspace、channel 与 human action。
- Coordinator turn 结束但没有 final 时记录 `FINAL_ANSWER_MISSING`；structured model 或 infrastructure failure 记录 `failed`；wall-time 与其他耗尽 budget 无需等待另一项 user mutation 即记录 durable typed stall。
- Dispose adapter、view-policy 或 workflow-extension registration 会阻止新 admission，但不会破坏 active channel；准确 implementation 只会在 terminal quiescence 后释放。
- Active channel 引用的任何准确 implementation version 在 restart 时不可用，系统都会拒绝恢复。
- 每个 consult、discussion、workflow 与 review model turn 都能从一条 `team/channel-view` Session event 逐字节重建，并保留 ordered Envelope provenance 与准确 adapter／view version。
- Session durability 先于 receipt，已接纳 view 的 redelivery 不能启动另一 model turn。
- JSON 与 SQLite lifecycle／recovery suite、Host 与 SDK contract、两个 SDK projection、keyless product snapshot、逐文件 coverage、documentation gate 与 packed-consumer probe 全部通过 P0 变更。

## 风险

- 错误的 local bootstrap flow 可能通过 browser history、referrer、log 或 process inspection 泄露 bearer credential。P0 只在一次性 loopback exchange 前把 plaintext 放入 owner-only 的临时 handoff document，删去所有 error 中的 secret，并测试每个 carrier surface。
- 持久化 stable principal id 会创建 durable account-like reference。它不携带 credential 或 reusable authority，删除或轮换 credential 也不会重写 historical attribution。
- Recovery proof scope 可能意外变成 generic system authority。每个 scope 都要求 existing durable intent、准确 id 与 cursor、单一 operation、lock 内 revalidation，并在 call 后撤销。
- Retained implementation object 可能延迟 HMR memory reclamation。Reference count 与 process-local metric 会暴露 retirement；terminal channel release 是唯一 collection point。
- Channel view 可能放大 context。每项 policy 都有 hard render bound，summary 是 durable input 而非 synthesized replacement，full transcript view 需要 finite manifest limit。
- Format cutover 会拒绝 pre-release Team 与 channel data。仓库的 pre-release stance 选择快速失败，而不是可能削弱 authority 或 reconstruction 的 compatibility reader。
