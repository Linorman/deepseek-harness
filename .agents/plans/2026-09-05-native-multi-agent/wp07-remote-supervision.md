# WP07：跨主机监督、终止证明与 sandbox loss

主责：远程执行程序员。负责 G12–G14，拥有 C3 和 C4 loss 增量。复用当前 C0 恢复接口，按用户功能优先要求独立开发 supervisor；组合验收依赖 WP02/04/05，完整 P0 不作为开工前置。必读[共享约定](contracts.md)与[防御模式](../../../docs/defensive-patterns.md)。

## 当前基础

[AgentRuntime](../../../packages/core/agent-runtime/src/types.ts)、[SDK provider](../../../packages/agent-runtime/agent-runtime-sdk/src/index.ts)、[ACP provider](../../../packages/agent-runtime/agent-runtime-acp/src/index.ts)已有 activation 和 bounded owned-process teardown。[recovery Consumer](../../../packages/team/team-activation-recovery/src/index.ts)只支持同主机 SDK；[E2B workspace](../../../packages/e2b/team-workspace-e2b/src/index.ts)在 sandbox 失效时 fail closed。

本包新增 activation-supervisor Service Definition、至少一个能真实证明 fence 的 Service Provider 和 recovery Consumer 接入，构成完整 seam。不要仅定义 interface 或返回“假定已停止”的 mock provider。

## Supervisor 约定

provider 声明 owned-process、externally-fenced 或 cooperative。durable recovery descriptor 含 provider、supervisor name/version、host/endpoint identity、可用时的 process/sandbox creation identity、非 secret fence generation。secret、实时根目录、socket 和进程句柄保持 provider 私有。

health 返回 reachable、unreachable、terminated、unknown，unknown/unreachable 均不自动映射 offline。fence 接受 exact descriptor/generation，只有目标无法继续执行或提交该 epoch 的模型、工具和 Team 操作时才成功。只撤销 Hub credential 可阻止提交，但不能证明任意外部工具副作用停止；provider 必须声明并验证其实际隔离范围。

第一 provider 可复用现有同主机 process inspector；另提供通过部署认证的 supervisor endpoint 或 sandbox provider 实现跨主机 fence。通信机制使用现有 subprocess/transport seam 或维护中的依赖，不临时拼接任意 SSH shell 和凭证。

## 恢复与 sandbox loss

1. recovery 分页扫描未完成 epoch，匹配 descriptor 的精确 supervisor/version；缺实现直接记录 typed unavailable，不替换成新版本。
2. 根据健康与终止模式选择继续等待、精确 fence、cold resume 或 durable stall；每次只替换一个 Participant 的当前 epoch。
3. provider action 在锁外执行；前后校验 generation。新 epoch 发布前旧 epoch 必须失去执行 authority，旧 heartbeat/report/integrate 一律拒绝。
4. disposal/rotation/revoke 保留当前 v4 cooperative cancel；拥有进程的路径额外等待 process-tree exit，cooperative 无外部证明时保持 stopping/stalled。
5. sandbox loss 写入 allocation/attempt 的不可用事实；可访问的已持久化产物保留，丢失字节不能伪造恢复。按 task policy retry 新 attempt 或 stall，不重建“同一个已过期 sandbox”。
6. 与 WP01 的 closure、WP04 的 task cancel、WP05 的 child cancellation 共享 disposition，不创建专属远程任务状态机。

## 验收矩阵

| 场景 | 预期证明 |
|---|---|
| 相同 PID、不同创建身份 | 不能杀新进程或承认旧 fence |
| stale generation、旧凭证 | 不能 heartbeat/report/integrate/恢复为 current |
| 网络分区 | unreachable/unknown，不当作 offline |
| cooperative cancel 无 ack | 有界等待后明确 stall，不报告 cancelled |
| fence 成功、bind 前崩溃 | 重启确认旧 generation 已隔离后只发布一个新 epoch |
| 两个 recovery 并发 | 同一 Participant 一个合法 replacement |
| supervisor retire/HMR | 新操作拒绝，已接纳 fence 结算，secret 不入日志 |
| sandbox 过期、manifest 缺失 | allocation/attempt 明确损失，旧 root 不被猜测复用 |
| child Team cancel 遇到 remote stall | parent 等待或同因 stalled，不提前 archive |
| macOS 缺精确进程创建身份 | 现有 fail-closed 限制保留，不能用低精度时间代替 |

## 测试与部署交接

本地 unit/race 复用 agent-runtime-sdk、agent-runtime-acp、team-activation-recovery、team-link-websocket-hub 的 suites；新增 provider conformance 和真实 process-tree 测试。WP13 提供两主机可执行的部署配置、endpoint 参数和同步点，本包提供实际 fence provider。

区分关闭 socket、remote 宣告 offline、owned process exit 和 supervisor fence 四种结果，证据分别记录。真实远程/云运行需明确环境与现有凭证；无凭证记 BLOCKED_ENV，不以 mock 结果标远程验收 PASS。

交接 C3 类型、descriptor 版本、允许的部署配置、health/fence 错误、资源成本、终止界限、恢复 runbook 和脱敏日志。建议切片：seam 与同主机复用；跨主机 provider 与恢复；sandbox loss 与 child/cancel 组合。
