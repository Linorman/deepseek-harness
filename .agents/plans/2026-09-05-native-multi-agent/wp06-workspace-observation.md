# WP06：共享工作区变化观察

主责：工作区程序员。负责 G11，拥有 C4 observation。复用当前 allocation 与 proof 基础，按用户功能优先要求立即开发；与 WP07 协调 unavailable，和 WP11 协调 integration policy。必读[共享约定](contracts.md)。

## 当前基础与范围

[shared provider](../../../packages/team/team-workspace-shared/src/index.ts)已有配置驱动的 baseline、bounded publication 和 target-directory integration；[workspace registry](../../../packages/core/team-workspace/src/types.ts)已有 allocation 与 provider root。现有写范围序列化属于 scheduler。

本包补独立于 artifact/integration 开关的观察记录。不会声称文件锁、不会判断具体写入者、不会增加自动 Git 提交或覆盖用户变更。

## 观察记录

在 allocation materialize 建立有界 baseline，在 publish、release request、integration proposal 和可选 pulse 产生 final version。路径分类为 declared、undeclared、external-window；external-window 表示没有匹配 attempt 持有窗口，不表示已经识别人类或外部进程。

拟新增 workspace/observed Team 事实：allocation/task/attempt、base/final content version、排序后的路径摘要、删除/新增/修改类别、截断计数、观察时间和 observation idempotency key。文件内容不进入 journal。audit 根据业务事件派生 warning。

配置分别限制扫描文件数、hash 字节、记录路径数、持续时间、pulse 频率。超限产生 truncated 事实，不能把不完整扫描解释为无变化；integration policy 可以因此拒绝或要求人工审核。

## 实现步骤

1. 把 source baseline observation 从可选产物发布中分离出来，复用现有 fingerprint 工具，不手写第二套文件遍历。
2. 定义稳定相对路径、symlink/delete 处理、writeScopes 前缀语义和 content-version 计算；路径规范化在真实文件边界执行。
3. 记录扫描开始/结束窗口及基线版本；扫描期间目录变化时保存“窗口内观察”的真实含义，不假称瞬时一致文件系统快照。
4. 锁外扫描，提交前校验 exact allocation/attempt 和 revision；旧 baseline 或已释放 allocation 不能覆写新观察。
5. 在发布、释放、集成前接入 observation，保障没有 artifactProvider 时也能生成有界变更事实。
6. audit append 失败时保留业务 observation，读审计时可修复；integration 只消费足够明确且最新的观察。
7. 与 WP01 协調 crash/release recovery：扫描失败不得妨碍其他资源结算，preserved 与 released 分开报告。

## 验收矩阵

| 场景 | 必需结果 |
|---|---|
| 声明范围内 Bash/generator 变更 | declared，正确路径和版本 |
| 未声明写、attempt 外窗口变更 | 相应分类，不虚构进程/人员归属 |
| symlink、junction、删除、路径逃逸 | 不跟随到非分配根；按当前安全规则拒绝或记录 |
| 大目录/大文件/扫描超时 | 有限资源与明确截断，不报空变化 |
| 并发观察与 stale baseline | 不覆盖新观察，幂等重试 |
| scan 后、journal 前崩溃 | 可以重复观察，保留一致 authority |
| journal 后、audit 前崩溃 | audit 重建不重写业务事实 |
| integration target 外部变化 | expected version 冲突，不覆盖用户修改 |
| provider 丢失或 dirty release | preserved/failed 独立报告，不误标 released |

## 检查与交接

```sh
pnpm exec vitest run packages/team/team-workspace-shared/tests packages/team/team-workspace-recovery/tests packages/core/team-workspace/tests
```

另外新增 Hub/fold/schema 的 observation 验证、真实 shell/文件系统的组装 snapshot 和配置边界测试。部署开销用 WP13 的受限扫描场景测量，不用未计入源目录规模的微型测试代替。

交接 observation schema、分类含义、有限扫描设置、integration policy 输入和 UI 需要的摘要。建议两片：provider+Team 事实；audit/integration/恢复与组装证据。
