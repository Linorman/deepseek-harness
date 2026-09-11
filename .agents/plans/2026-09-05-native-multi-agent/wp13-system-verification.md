# WP13：系统故障、真实模型、浏览器与性能验收

主责：系统测试与性能程序员。负责 G28–G31；协助 WP01 的 G27 和 WP14 的最终证据。阶段 A 可开始场景设计，实际结果依赖相应功能包。必读[验收映射](acceptance-map.md)、[测试策略](../../../docs/testing.md)、[P1 预算](../../notes/proposed/architecture/2026-09-04-native-multi-agent-p1-product-convergence.zh.md)。

## 测试所有权

每个功能作者负责自己的 unit/property/race、逐文件 coverage、runnable-example snapshot 和 GUI GIF。本包负责跨包场景表达能力、真实部署配置、故障编排、性能测量和统一证据索引，不能成为其他包延后测试的理由。

测试运行路径必须是实际 bundle/provider/Hub/Session。mock 适合精确制造错误，但不能替代 provider 真的启动、模型真的读到日志化输入、文件真的变化、进程真的退出。

## 场景集合

| 场景 ID | 场景与必需断言 | 功能协作者 |
|---|---|---|
| SYS-01 | 默认 Team：创建 → human input → coordinator final → sink/receipt → terminal → archive | WP01/08 |
| SYS-02 | 两 worker fan-out/fan-in，依赖完成才开始，shared 冲突序列化 | WP04/06 |
| SYS-03 | mutating worker → reviewer rework → 新 attempt → accepted → verified artifact | WP04/11 |
| SYS-04 | workflow 条件/handoff 与重启，角色按模板解析，无私有子 Session | WP04 |
| SYS-05 | child saga 所有跨日志窗口、parent charging、取消和 archive fence | WP05 |
| SYS-06 | broadcast 与独立 receipts，required/optional invitation timeout | WP02 |
| SYS-07 | static/dynamic credentials，Hub restart、重复/倒序/慢消费、rotation/revoke | WP02/07 |
| SYS-08 | cross-host fence、PID/generation mismatch、cooperative stall、replacement | WP07 |
| SYS-09 | sandbox loss、产物保留、retry/stall、integration target conflict | WP06/07 |
| SYS-10 | principal inbox restart、final 重读、approval/question/review 回答权限 | WP08 |
| SYS-11 | Team UI 管理全流程，分页、冲突保留 draft、offline/reconnect、键盘 | WP09/10/11 |
| SYS-12 | summary 生成/提交窗口、view replay、compaction 水位 | WP03 |

SYS 编号仅用于测试交接；产品输出和诊断使用真实业务含义，不暴露计划编号。

## 分布式故障执行

提供能在同机双进程和实际双主机运行的同一配置：Hub endpoint、participant host endpoint、认证来源、shared test seed、数据库路径、provider/supervisor/version、产物输出目录。所有临时文件和输出留在各自项目目录，secret 从现有受支持渠道注入，不打印到日志。

至少包含静态和动态 credential 两套完整场景；在 append/notify/Session flush/receipt/fence/bind 前后使用具名同步点。网络断开、消息重复和慢消费通过测试 transport/proxy 或 provider 故障入口注入，不用任意 sleep 制造概率性通过。

区分四层证据：纯 contract、同机真实子进程、独立 Hub process restart、实际双主机。低层通过不能填写高层 PASS。没有远程环境或 credential 时登记 BLOCKED_ENV 和负责人，不创建成功占位结果。

## 真实模型和浏览器

用户已提供本机 OpenAI-compatible Chat Completions 入口，供真实 LLM 测试使用。2026-09-06 已确认模型可列举、真实文本请求返回 READY，并返回正确的 `probe_echo({"value":"READY"})` tool call。该 API 检查不代表 Harness 系统场景已通过。

| 配置 | 用户指定值 |
|---|---|
| base_url | `http://127.0.0.1:18000/v1` |
| api_key | `EMPTY`，本机服务占位值 |
| model | `Qwen3.8-27B-AWQ-4bit` |
| reasoning_effort | `high` |
| max_tokens | `10240` |

实际服务以 HTTP 400 拒绝用户示例中的 `high`，错误明确列出 `xhigh`（默认）、`medium`、`low`。连接验证使用 `xhigh` 和其余原参数后成功。后续测试须明确采用这一兼容配置，并保留原始失败与成功请求，不能记录成 `high` 已通过。当前证据位于项目 `.tmp/native-team-development/local-llm/`。

已通过原生 Headless 入口完成真实 coordinator/worker/reviewer 场景：worker 将隔离 workspace 的 task.txt 改为指定内容，reviewer 接受，Team 与 Goal 完成，资源释放，进程以 0 退出。第一次证据位于 `.tmp/native-team-development/local-llm/native-headless/`；该次最终模型文字错误地称未配置审阅人。审计发现 task 工具结果未提供审阅事实，后续已增加有界 reviewPolicy/reviewResult 投影。

修复后在新的 `native-headless-review-projection/` 目录按相同模型、参数和任务复验，142.044 秒退出 0，源码及构建产物 hash 前后相同。独立 SQLite 与三个 Session 确认一次完成的 attempt、一次匹配 reviewer 的接受记录、一次 final admission、四项源频道 receipt，所有 allocation 已释放、三个 activation 已 offline 且保留 quiescedAt。coordinator 实际收到的 completed wait 结果包含相同 reviewer 和 accepted attempt；模型最终文字也正确报告审阅接受。原运行的旧摘要把四项源 receipt 与四项 audit 镜像相加为八项，已另存统计更正，原始证据未覆盖。这两次运行只覆盖本场景，SYS-02 至 SYS-12 的其他分支仍需各自验收。

执行人通过 Harness 已支持的模型路由配置接入，确认实际请求携带上述兼容参数；不只替换 base URL 而保留默认模型名称。所有请求记录、Session、数据库、日志、临时文件和临时目录必须位于项目目录内。对沿用系统临时目录的旧 fixture，先修正其目录配置与隔离语义；不得为了短 socket 路径将产物迁到项目外。TypeScript 脚本使用 `TSX_DISABLE_CACHE=1 node --import tsx/esm`；仅禁用缓存仍不能阻止 tsx CLI 创建系统临时 IPC，因此不使用 tsx CLI 启动测试。

keyed 场景使用已配置模型路由，至少验证 coordinator/worker/reviewer、accept/rework、workflow fan-out/fan-in、真实文件与产物。断言世界结果和 durable streams，避免只匹配模型一句“完成”。记录模型、参数、次数和所有失败；不能无限重试直到随机通过。

browser 使用真实服务和实际模型/回放链路，覆盖完整操作而非手工 seeded 截图。WP09/10/11 每个 GUI PR 提交[规定的 GIF](../../skills/record-browser-gif/SKILL.md)，本包检查其服务提交和场景一致。GIF 是可检查演示，不替代自动断言。

## 性能预算

SQLite reference lane 使用 P1 指定的 dedicated Linux x64 runner，recoveryPageSize=32、checkpointEvery=32。每场景运行三次，保留全部结果，按中位数判定 wall-time，同时记录峰值 RSS 相对基线增长。

| 场景 | 预算 |
|---|---|
| 4,096 records：restart 到首个 32-record page | ≤5 秒，RSS 增长 ≤128 MiB |
| 4,096 records：完整有序枚举 | ≤30 秒 |
| 16,384 records：restart 到首个 page | ≤10 秒，RSS 增长 ≤384 MiB |
| 16,384 records：完整枚举 | ≤180 秒 |
| 10,000 pending delivery、64 Activation、1,000 task | 页不超 limit，队列不超配置 high-water |
| 上述大 Team 的 cancel/shutdown | test provider 全部确认后 ≤10 秒 |

测量将 fixture 写入、Hub startup、首屏、枚举和 shutdown 分段，不能用总测试 timeout 替代各预算。RSS 采样跟踪实际被测 Hub/子进程，记录采样方法及 baseline；不把 test runner 的内存混成 Hub 数据。全平台运行确定性的 page/checkpoint/queue/retained-object/allocation 上限，只有指定 runner 判定 wall-time。

当前[load suite](../../../packages/team/team-hub/tests/load.spec.ts)作为正确性基础，保留 4,096 默认和 16,384 opt-in 行为。新增 release lane 必须显式执行大场景并验证执行数，禁止 flag 未设置而悄悄只跑小场景。

预算超标先分析生成/恢复/fold/读取/队列/清理哪个阶段失效；不得自动更新 baseline、调大限额或跳过慢平台。修改预算需要 measurements 和 owning decision。

## 产物与放行

每次运行输出候选提交、环境、精确命令、场景 ID、实际执行/跳过数、结果、同步点、durable stream、进程终止证明、文件断言、coverage、GIF 和资源统计。大日志留 artifact，交接表只链接。

交付 fault harness、两主机配置、真实模型场景、browser/GIF 索引、reference budget lane 和 PASS/FAIL/NOT_RUN/BLOCKED_ENV 清单。任何必需场景 skip 都阻止对应 Gap 关闭。最终证据由 WP14 绑定同一 release candidate，不跨不同代码版本拼出全绿。
